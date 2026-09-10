import { connect } from 'node:net'
import { Redis } from 'ioredis'
import { Decoder } from 'cbor-x'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { crc16ibm } from '@orbetra/codec'
import { runScenario, liveDrive, corruptCrc, oversize, slowLoris, bufferedFlood } from '@orbetra/simulator'

import { createIngestServer, DEFAULT_CONFIG, SHARD_COUNT, type IngestServer } from '../src/index.js'
import { UNSUPPORTED_STREAM } from '../src/persist.js'

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

/** every parse failure the server reported, WITH the imei it could not name before */
const parseFailures: { imei: string; reason: string }[] = []

async function startIngest(overrides: Partial<typeof DEFAULT_CONFIG> = {}): Promise<number> {
  await redis.hset('registry:imei', IMEI, '42')
  parseFailures.length = 0
  ingest = createIngestServer(redis, { ...DEFAULT_CONFIG, ...overrides }, undefined, (imei, reason) =>
    parseFailures.push({ imei, reason }),
  )
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
    // …and every one of them NAMES THE DEVICE. `ingest_parse_fail_total` carries no label, so a
    // spike alert tells an operator a rate and nothing else — while the failure that costs data is
    // one device stuck resending bytes we will never accept. Without the imei there is no capture
    // to pull and no device to configure.
    expect(parseFailures).toHaveLength(5)
    expect(new Set(parseFailures.map((f) => f.imei))).toEqual(new Set([IMEI]))
    // the REASON must be the decoder's own words, not a class name — an operator pulling a capture
    // needs to know it was the checksum and not, say, a record-count mismatch
    expect(parseFailures[0]?.reason).toMatch(/crc/i)
    expect(parseFailures[0]?.reason.length).toBeGreaterThan(10)
  }, 30_000)

  it('codec 16: DECODED and persisted — the FM63XX generation stops being invisible', async () => {
    // HISTORY, because the shape of this test changed and the reason matters. Codec 16 first returned
    // records:[] and the session ACKed 0; per the protocol the count is the acknowledged-record
    // cursor, so the device resent the identical packet forever while its records were dropped — no
    // reject row, no counter, completely invisible (audit high). The fix then PARKED the frame and
    // ACKed the declared count, which stopped the wedge but still showed the operator nothing: an
    // FM63XX (FMB630, FM6300, FM6320) sends Codec 16 for EVERY frame, so that hardware had no map.
    //
    // Now it decodes. The never-ACK-0 invariant this test used to carry is not lost — it is proven
    // where it actually applies, by the repeated-AVL-id test below, which uses a frame we genuinely
    // cannot decode.
    //
    // The frame is the wiki's own Codec 16 example (packages/codec/__fixtures__/wiki/codec16.hex.json),
    // re-stamped to now because `sanityFailure` rightly refuses a record dated 2019 and this is a test
    // of the codec, not of the age policy.
    const port = await startIngest()
    const beforeParked = await redis.xlen(UNSUPPORTED_STREAM)
    const beforeShard = await redis.xlen(`raw:${SHARD}`)
    const sock = connect(port, '127.0.0.1')
    await new Promise((r) => sock.once('connect', r))
    const imei = Buffer.from(IMEI, 'ascii')
    sock.write(Buffer.concat([Buffer.from([0x00, imei.length]), imei]))
    await new Promise((r) => sock.once('data', r)) // 0x01 accept

    const body = Buffer.from(
      '10020000016BDBC7833000000000000000000000000000000000000B05040200010000030002000B00270042563A' +
        '00000000016BDBC7871800000000000000000000000000000000000B05040200010000030002000B00260042563A' +
        '000002',
      'hex',
    )
    const now = Date.now()
    body.writeBigUInt64BE(BigInt(now), 2) // 8-byte timestamp at the head of record 1
    body.writeBigUInt64BE(BigInt(now + 1000), 2 + 46) // …and of record 2

    const frame = Buffer.concat([
      Buffer.from([0, 0, 0, 0]),
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(body.length); return b })(),
      body,
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(crc16ibm(body)); return b })(),
    ])
    sock.write(frame)
    const ack = await new Promise<Buffer>((r) => sock.once('data', (d: Buffer) => r(d)))
    sock.destroy()

    expect(ack.readUInt32BE(0)).toBe(2)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(beforeShard + 2) // decoded, not parked
    expect(await redis.xlen(UNSUPPORTED_STREAM)).toBe(beforeParked) // nothing unsupported any more
    expect(ingest!.metrics.unsupportedCodecTotal).toBe(0)
  }, 30_000)

  it('a repeated AVL id: the frame is parked and ACKed, NOT retried forever', async () => {
    // Reproduced live against staging before this change: a two-record frame whose second record
    // repeats IO id 1 answered `00000000` on every attempt, including a deliberate re-send. Teltonika
    // retransmits WHOLE packets, so that device's ACK cursor never moves and its own buffer
    // eventually overwrites its OLDEST unsent records — one poison packet costing everything queued
    // behind it, silently, plus the perfectly valid record sharing the frame.
    //
    // Structure, CRC and both NumberOfData bytes are sound here; only the CONTENT defeats the
    // decoder, and re-sending produces identical bytes. So it gets the codec-16 treatment: park the
    // evidence, ACK what the device declared, let the device move on.
    const port = await startIngest()
    const before = await redis.xlen(UNSUPPORTED_STREAM)
    const sock = connect(port, '127.0.0.1')
    await new Promise((r) => sock.once('connect', r))
    const imeiBuf = Buffer.from(IMEI, 'ascii')
    sock.write(Buffer.concat([Buffer.from([0x00, imeiBuf.length]), imeiBuf]))
    await new Promise((r) => sock.once('data', r))

    const rec = (repeat: boolean): Buffer => {
      const ts = Buffer.alloc(8); ts.writeBigUInt64BE(BigInt(1_560_161_086_000))
      const gps = Buffer.alloc(15)
      gps.writeInt32BE(252_797_000, 0); gps.writeInt32BE(546_872_000, 4)
      gps.writeUInt8(9, 12)
      const io = repeat
        ? Buffer.from([0x01, 0x02, 0x02, 0x01, 0x05, 0x01, 0x07, 0x00, 0x00, 0x00])
        : Buffer.from([0x01, 0x01, 0x01, 0x01, 0x05, 0x00, 0x00, 0x00])
      return Buffer.concat([ts, Buffer.from([0]), gps, io])
    }
    const records = Buffer.concat([rec(false), rec(true)])
    const body = Buffer.concat([Buffer.from([0x08, 0x02]), records, Buffer.from([0x02])])
    const frame = Buffer.concat([
      Buffer.from([0, 0, 0, 0]),
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(body.length); return b })(),
      body,
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(crc16ibm(body)); return b })(),
    ])
    sock.write(frame)
    const ack = await new Promise<Buffer>((r) => sock.once('data', (d: Buffer) => r(d)))
    sock.destroy()

    expect(ack.readUInt32BE(0)).toBe(2)                              // the DECLARED count, not 0
    expect(await redis.xlen(UNSUPPORTED_STREAM)).toBe(before + 1)    // …and the bytes are kept
    expect(parseFailures.at(-1)?.imei).toBe(IMEI)                    // …and the device is named
    expect(parseFailures.at(-1)?.reason).toMatch(/repeated id/i)
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

  it('mid-session de-registration (retire/GDPR): next frame kills the socket, no ACK (E08-4)', async () => {
    // retire only used to bar the NEXT connect — a live session kept streaming a retired
    // device's positions past a GDPR erase (review HIGH-1 residual). The per-frame registry
    // re-check must terminate the session as soon as the mapping is gone.
    const port = await startIngest()
    const run = runScenario(liveDrive, { ...base, count: 10, hz: 4, host: '127.0.0.1', port })
    await new Promise((r) => setTimeout(r, 600)) // let the handshake + first frames through
    await redis.hdel('registry:imei', IMEI) // retire happens mid-session
    const res = await run
    expect(res.socketClosedByServer).toBe(true)
    expect(res.ackedRecords).toBeLessThan(10) // the tail was refused, never acked
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(res.ackedRecords) // persisted == acked (rule 4)
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

  it('backpressure measures UNCONSUMED backlog, not stream length — a real consumer group unlatches it', async () => {
    // REGRESSION (audit critical #1): depth used to be XLEN. XACK does not delete stream entries and
    // nothing trims raw:{shard} (it is written MAXLEN ~100k), so XLEN only ever grew — once a shard
    // had cumulatively carried `pauseAboveDepth` records, ingest paused FOREVER against a perfectly
    // healthy worker. The old drain test hid this by calling `xtrim MAXLEN 0`, which no production
    // code does. Here the shard is drained the way the worker really drains it: XREADGROUP + XACK,
    // with every entry left in the stream.
    const GROUP = 'pipeline'
    await redis.xgroup('CREATE', `raw:${SHARD}`, GROUP, '0', 'MKSTREAM').catch(() => undefined)
    const port = await startIngest({ pauseAboveDepth: 10, depthCacheMs: 0 })
    const runPromise = runScenario(liveDrive, { ...base, count: 40, host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now()
      const tick = () => {
        if (ingest!.metrics.pausedSockets > 0) return resolve()
        if (Date.now() - t0 > 10_000) return reject(new Error('never paused'))
        setTimeout(tick, 50)
      }
      tick()
    })
    // consume like the worker: read as the group, ack, never trim
    const drain = setInterval(() => {
      void (async () => {
        const res = (await redis.xreadgroup('GROUP', GROUP, 'c1', 'COUNT', 100, 'STREAMS', `raw:${SHARD}`, '>')) as
          | [string, [string, string[]][]][]
          | null
        const ids = res?.[0]?.[1]?.map(([id]) => id) ?? []
        if (ids.length > 0) await redis.xack(`raw:${SHARD}`, GROUP, ...ids)
      })()
    }, 100)
    try {
      const res = await runPromise
      expect(res.ackedRecords).toBe(40) // would hang/fail under the XLEN signal
    } finally {
      clearInterval(drain)
    }
    // The gauge SETTLES rather than being 0 the instant the scenario returns: the drain poller runs
    // on a 500 ms timer, so a loaded runner can still be mid-poll here. Waiting is what makes the
    // assertion meaningful — under the old XLEN signal the counter never comes back down at all,
    // so this loop would time out rather than pass.
    const deadline = Date.now() + 5_000
    while (ingest!.metrics.pausedSockets !== 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(ingest!.metrics.pausedSockets).toBe(0)
    // the entries are all still IN the stream — proof the signal is backlog, not retention
    expect(await redis.xlen(`raw:${SHARD}`)).toBeGreaterThan(10)
  }, 30_000)

  it('sanity-rejected record still ACKed (durable in rejects stream) - no eternal resend loop', async () => {
    const port = await startIngest()
    // craft a liveDrive-style run whose middle record has an insane timestamp:
    // encode 3 records into one packet manually via the codec
    const { encodeAvlPacket } = await import('@orbetra/codec')
    const { driveRecords } = await import('@orbetra/simulator')
    const [a, b, c] = driveRecords({ seed: 5, count: 3, startMs: base.startMs })
    const badB = { ...b!, tsMs: Date.UTC(2010, 0, 1) } // < 2020 sanity floor (§3.6 cold boot)
    const pkt = encodeAvlPacket(8, [a!, badB, c!])
    const scenario = { name: 'oneBadClock', *packets() { yield pkt } }
    const res = await runScenario(scenario, { ...base, count: 3, host: '127.0.0.1', port })
    // ACK must equal NumberOfData (3) - the server took responsibility for all records
    expect(res.ackedRecords).toBe(3)
    expect(res.underAckedPackets).toBe(0)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(2)
    expect(await redis.xlen('rejects')).toBe(1)
    expect(ingest!.metrics.sanityRejectsTotal).toBe(1)
  }, 30_000)

  it('handshake rate limit: connects beyond the per-minute budget are destroyed pre-Redis', async () => {
    const port = await startIngest({ maxHandshakesPerIpPerMin: 3 })
    for (let i = 0; i < 3; i++) {
      const res = await runScenario(liveDrive, { ...base, count: 1, host: '127.0.0.1', port })
      expect(res.ackedRecords).toBe(1)
    }
    const fourth = await runScenario(liveDrive, { ...base, count: 1, host: '127.0.0.1', port })
    expect(fourth.socketClosedByServer).toBe(true)
    expect(fourth.ackedRecords).toBe(0)
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
