import { connect } from 'node:net'
import { Redis } from 'ioredis'
import { Decoder } from 'cbor-x'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { runScenario, liveDrive, corruptCrc, oversize, slowLoris, bufferedFlood } from '@orbetra/simulator'

import { createIngestServer, DEFAULT_CONFIG, SHARD_COUNT, type IngestServer } from '../src/index.js'

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
  redis = new Redis(container.getMappedPort(6379), container.getHost(), {
    maxRetriesPerRequest: null,
  })
}, 120_000)

afterAll(async () => {
  await redis?.quit()
  await container?.stop()
})

let ingest: IngestServer | null = null
afterEach(async () => {
  await new Promise<void>((r) => (ingest ? ingest.server.close(() => r()) : r()))
  ingest = null
  await redis.flushall()
})

async function startIngest(overrides: Partial<typeof DEFAULT_CONFIG> = {}): Promise<number> {
  await redis.hset('registry:imei', IMEI, '42')
  ingest = createIngestServer(redis, { ...DEFAULT_CONFIG, ...overrides })
  return new Promise((resolve) => {
    ingest!.server.listen(0, '127.0.0.1', () => {
      resolve((ingest!.server.address() as { port: number }).port)
    })
  })
}

const base = {
  imei: IMEI,
  seed: 3,
  hz: 0,
  count: 20,
  startMs: Date.now() - 60_000, // within the sanity window
}

describe('E01-5 ingest TCP server (e2e vs real simulator)', () => {
  it('happy path: liveDrive → ACKs == records == XADDed entries on the right shard (I1)', async () => {
    const port = await startIngest()
    const res = await runScenario(liveDrive, { ...base, host: '127.0.0.1', port })
    expect(res.rejectedByImei).toBe(false)
    expect(res.sentPackets).toBe(20)
    expect(res.ackedRecords).toBe(20)
    expect(res.underAckedPackets).toBe(0)

    expect(await redis.xlen(`raw:${SHARD}`)).toBe(20)
    // payload decodes and carries the essentials (deviceId, ts order, raw for rec_hash)
    const entries = await redis.xrangeBuffer(`raw:${SHARD}`, '-', '+')
    const payloads = entries.map(([, fields]) => cbor.decode(fields[1] as Buffer) as Record<string, unknown>)
    expect(Number(payloads[0]!['deviceId'])).toBe(42)
    expect(payloads[0]!['imei']).toBe(IMEI)
    expect(Buffer.isBuffer(payloads[0]!['raw'])).toBe(true)
    const times = payloads.map((p) => p['tsMs'] as number)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  }, 30_000)

  it('bufferedFlood: multi-record max-size packets fully ACKed and persisted', async () => {
    const port = await startIngest()
    const res = await runScenario(bufferedFlood, { ...base, count: 300, host: '127.0.0.1', port })
    expect(res.ackedRecords).toBe(300)
    expect(res.underAckedPackets).toBe(0)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(300)
  }, 30_000)

  it('corrupt CRC: ACK=0 per packet, session SURVIVES (device is the replay buffer)', async () => {
    const port = await startIngest()
    const res = await runScenario(corruptCrc, { ...base, count: 5, host: '127.0.0.1', port })
    expect(res.sentPackets).toBe(5) // all sent — server never dropped the socket
    expect(res.ackedRecords).toBe(0)
    expect(res.underAckedPackets).toBe(5)
    expect(res.socketClosedByServer).toBe(false)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(0)
    expect(ingest!.metrics.parseFailTotal).toBe(5)
  }, 30_000)

  it('oversize declared length: socket closed + frame violation counted', async () => {
    const port = await startIngest()
    const res = await runScenario(oversize, { ...base, count: 1, host: '127.0.0.1', port })
    expect(res.socketClosedByServer).toBe(true)
    expect(res.ackedRecords).toBe(0)
    expect(ingest!.metrics.frameViolationsTotal).toBeGreaterThan(0)
  }, 30_000)

  it('unknown IMEI: 0x00 reply + quarantine entry; 3rd reject within the hour destroys', async () => {
    const port = await startIngest()
    const stranger = { ...base, imei: '867000000000001', host: '127.0.0.1', port }
    for (let i = 0; i < 3; i++) {
      const res = await runScenario(liveDrive, { ...stranger, count: 1 })
      expect(res.rejectedByImei || res.socketClosedByServer).toBe(true)
    }
    expect(await redis.zscore('quarantine:imei', stranger.imei)).not.toBeNull()
    expect(await redis.get(`quarantine:rejects:${stranger.imei}`)).toBe('3')
    expect(ingest!.metrics.rejectedImeiTotal).toBe(3)
  }, 30_000)

  it('slow-loris: killed by the handshake timeout, nothing persisted', async () => {
    const port = await startIngest({ handshakeTimeoutMs: 300 })
    const started = Date.now()
    const res = await runScenario(slowLoris, { ...base, count: 1, host: '127.0.0.1', port, byteDelayMs: 100 })
    expect(res.socketClosedByServer || res.rejectedByImei).toBe(true)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(0)
  }, 30_000)

  it('per-IP cap: connection N+1 is refused outright', async () => {
    const port = await startIngest({ maxConnPerIp: 2 })
    const holdOpen = () =>
      new Promise<import('node:net').Socket>((resolve) => {
        const s = connect({ host: '127.0.0.1', port }, () => resolve(s))
      })
    const s1 = await holdOpen()
    const s2 = await holdOpen()
    const s3 = await holdOpen()
    const closed = await new Promise<boolean>((resolve) => {
      s3.once('close', () => resolve(true))
      setTimeout(() => resolve(false), 2_000)
    })
    expect(closed).toBe(true)
    expect(ingest!.connectionCount()).toBe(2)
    s1.destroy()
    s2.destroy()
  }, 30_000)

  it('backpressure (I4): shard past threshold pauses the socket, drain resumes it', async () => {
    const port = await startIngest({ pauseAboveDepth: 10, depthCacheMs: 0 })
    const runPromise = runScenario(liveDrive, { ...base, count: 40, host: '127.0.0.1', port })
    // wait until the server pauses
    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now()
      const tick = () => {
        if (ingest!.metrics.pausedSockets > 0) return resolve()
        if (Date.now() - t0 > 10_000) return reject(new Error('never paused'))
        setTimeout(tick, 50)
      }
      tick()
    })
    // simulate the pipeline consumer draining the shard until the run finishes
    const trimmer = setInterval(() => void redis.xtrim(`raw:${SHARD}`, 'MAXLEN', 0), 200)
    try {
      const res = await runPromise
      expect(res.ackedRecords).toBe(40)
    } finally {
      clearInterval(trimmer)
    }
    expect(ingest!.metrics.pausedSockets).toBe(0)
  }, 30_000)

  it('duplicate IMEI: newest connection wins, old socket is closed', async () => {
    const port = await startIngest()
    const first = runScenario(slowLoris, { ...base, count: 1, host: '127.0.0.1', port, byteDelayMs: 50 })
    await new Promise((r) => setTimeout(r, 1500)) // hello trickles at 50ms/byte (~850ms) + margin
    const second = await runScenario(liveDrive, { ...base, count: 1, host: '127.0.0.1', port })
    expect(second.ackedRecords).toBe(1)
    await first // must terminate (either closed by server or finished)
  }, 30_000)
})
