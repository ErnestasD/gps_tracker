import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { Decoder } from 'cbor-x'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { encodeAvlPacket, encodeCodec12, type EncodableRecord } from '@orbetra/codec'

import { IngestMetrics } from '../src/metrics.js'
import { createIngestUdpServer, type IngestUdpServer, type UdpConfig } from '../src/udp.js'
import { DEFAULT_CONFIG, SHARD_COUNT } from '../src/index.js'

const IMEI = '356307042441013'
const SHARD = Number(BigInt(IMEI) % BigInt(SHARD_COUNT))
const cbor = new Decoder()

let container: StartedTestContainer
let redis: Redis

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  redis = new Redis(container.getMappedPort(6379), container.getHost(), { maxRetriesPerRequest: null })
}, 120_000)

afterAll(async () => {
  await redis?.quit()
  await container?.stop()
})

let server: IngestUdpServer | null = null
let client: UdpSocket | null = null
afterEach(async () => {
  await new Promise<void>((r) => (server ? void server.close().then(r) : r()))
  server = null
  await new Promise<void>((r) => (client ? client.close(() => r()) : r()))
  client = null
  await redis.flushall()
})

const record = (over: Partial<EncodableRecord> = {}): EncodableRecord => ({
  tsMs: Date.now() - 30_000,
  priority: 1,
  lat: 54.6872,
  lon: 25.2797,
  altitude: 100,
  angle: 90,
  satellites: 9,
  speed: 42,
  eventIoId: 0,
  io: new Map(),
  ...over,
})

/** Bare codec-8 AVL data (TCP frame minus preamble/length and CRC). */
function avlData(records: EncodableRecord[]): Buffer {
  const frame = encodeAvlPacket(8, records)
  return frame.subarray(8, frame.length - 4)
}

/** Wrap arbitrary AVL bytes in the UDP header (records → avlData, or pass raw command bytes). */
function wrap(avl: Buffer, opts: { packetId?: number; avlPacketId?: number; imei?: string } = {}): Buffer {
  const imei = Buffer.from(opts.imei ?? IMEI, 'ascii')
  const header = Buffer.alloc(6)
  header.writeUInt16BE(opts.packetId ?? 0x2222, 0)
  header.writeUInt8(0x01, 2)
  header.writeUInt8(opts.avlPacketId ?? 0x09, 3)
  header.writeUInt16BE(imei.length, 4)
  const afterLen = Buffer.concat([header, imei, avl])
  const out = Buffer.concat([Buffer.alloc(2), afterLen])
  out.writeUInt16BE(afterLen.length, 0)
  return out
}

function datagram(records: EncodableRecord[], opts: { packetId?: number; avlPacketId?: number; imei?: string } = {}): Buffer {
  return wrap(avlData(records), opts)
}

async function start(metrics: IngestMetrics, overrides: Partial<UdpConfig> = {}): Promise<number> {
  await redis.hset('registry:imei', IMEI, '42')
  server = createIngestUdpServer(redis, metrics, { ...DEFAULT_CONFIG, maxDatagramsPerIpPerMin: 6000, maxDatagramsPerSec: 50_000, depthCacheMs: 0, ...overrides })
  return new Promise((resolve) => server!.socket.bind(0, '127.0.0.1', () => resolve((server!.socket.address() as { port: number }).port)))
}

/** Send a datagram and wait (up to `timeoutMs`) for the ACK; null on timeout. */
function sendAndAwaitAck(port: number, dg: Buffer, timeoutMs = 1500): Promise<Buffer | null> {
  client ??= createSocket('udp4')
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    client!.once('message', (msg) => {
      clearTimeout(timer)
      resolve(msg)
    })
    client!.send(dg, port, '127.0.0.1')
  })
}

describe('UDP ingest channel (e2e vs real redis)', () => {
  it('happy path: 3 records → ACK echoes ids + count, XADDed on the right shard (I1)', async () => {
    const metrics = new IngestMetrics()
    const port = await start(metrics)
    const ack = await sendAndAwaitAck(port, datagram([record(), record({ speed: 60 }), record({ speed: 0 })], { packetId: 0xbeef, avlPacketId: 0x0a }))

    expect(ack).not.toBeNull()
    expect(ack!).toHaveLength(7)
    expect(ack!.readUInt16BE(2)).toBe(0xbeef) // echoed packet id
    expect(ack!.readUInt8(5)).toBe(0x0a) // echoed AVL packet id
    expect(ack!.readUInt8(6)).toBe(3) // accepted count

    expect(await redis.xlen(`raw:${SHARD}`)).toBe(3)
    const entries = await redis.xrangeBuffer(`raw:${SHARD}`, '-', '+')
    const payload = cbor.decode(entries[0]![1][1] as Buffer) as Record<string, unknown>
    expect(Number(payload['deviceId'])).toBe(42)
    expect(payload['imei']).toBe(IMEI)
    expect(Buffer.isBuffer(payload['raw'])).toBe(true)
    expect(metrics.ackedRecordsTotal).toBe(3)
    expect(metrics.udpDatagramsTotal).toBe(1)
  })

  it('unknown IMEI: no ACK, and the IMEI is quarantined for the claim flow', async () => {
    const metrics = new IngestMetrics()
    const port = await start(metrics)
    const ack = await sendAndAwaitAck(port, datagram([record()], { imei: '111111111111111' }), 700)
    expect(ack).toBeNull() // nothing persisted ⇒ nothing acked (rule 4)
    expect(await redis.zscore('quarantine:imei', '111111111111111')).not.toBeNull()
    expect(metrics.rejectedImeiTotal).toBe(1)
    expect(await redis.exists(`raw:${SHARD}`)).toBe(0)
  })

  it('sanity: an impossible timestamp goes to rejects but still counts toward the ACK', async () => {
    const metrics = new IngestMetrics()
    const port = await start(metrics)
    const ack = await sendAndAwaitAck(port, datagram([record(), record({ tsMs: Date.UTC(1999, 0, 1) })]))
    expect(ack!.readUInt8(6)).toBe(2) // both counted — resend is whole-packet (§3.2)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(1) // only the good one on the shard
    expect(await redis.xlen('rejects')).toBe(1)
    expect(metrics.sanityRejectsTotal).toBe(1)
  })

  it('backpressure: above the shard-depth threshold the datagram is shed with no ACK', async () => {
    const metrics = new IngestMetrics()
    const port = await start(metrics, { pauseAboveDepth: 2 })
    // pre-fill the shard past the threshold
    await redis.xadd(`raw:${SHARD}`, '*', 'p', 'x')
    await redis.xadd(`raw:${SHARD}`, '*', 'p', 'x')
    await redis.xadd(`raw:${SHARD}`, '*', 'p', 'x')
    const ack = await sendAndAwaitAck(port, datagram([record()]), 700)
    expect(ack).toBeNull()
    expect(metrics.udpBackpressureDropsTotal).toBe(1)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(3) // unchanged — nothing persisted
  })

  it('flood guard: datagrams past the per-IP/min cap are dropped without an ACK', async () => {
    const metrics = new IngestMetrics()
    const port = await start(metrics, { maxDatagramsPerIpPerMin: 1 })
    const ok = await sendAndAwaitAck(port, datagram([record()]))
    expect(ok).not.toBeNull() // first allowed
    const blocked = await sendAndAwaitAck(port, datagram([record()]), 700)
    expect(blocked).toBeNull() // second over the cap → dropped
    expect(metrics.udpRateLimitedTotal).toBe(1)
  })

  it('global ceiling: total datagrams/sec are shed regardless of source (spoof-flood defense)', async () => {
    const metrics = new IngestMetrics()
    const port = await start(metrics, { maxDatagramsPerSec: 1 })
    const ok = await sendAndAwaitAck(port, datagram([record()]))
    expect(ok).not.toBeNull()
    const blocked = await sendAndAwaitAck(port, datagram([record()]), 700)
    expect(blocked).toBeNull() // over the global cap for this second → dropped
    expect(metrics.udpRateLimitedTotal).toBe(1)
  })

  it('a command-codec datagram from a known device is ACKed zero-persisted (not parsed as AVL)', async () => {
    const metrics = new IngestMetrics()
    const port = await start(metrics)
    const cmd = encodeCodec12('getver')
    const payload = cmd.subarray(8, cmd.length - 4) // bare codec-12 data region
    const ack = await sendAndAwaitAck(port, wrap(payload, { packetId: 0x3131, avlPacketId: 0x04 }))
    expect(ack).not.toBeNull()
    expect(ack!.readUInt16BE(2)).toBe(0x3131)
    expect(ack!.readUInt8(6)).toBe(0) // nothing persisted
    expect(await redis.exists(`raw:${SHARD}`)).toBe(0)
  })
})
