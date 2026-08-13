import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Encoder } from 'cbor-x'
import { Redis } from 'ioredis'
import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import xxhash from 'xxhash-wasm'

import { createIngestServer, DEFAULT_CONFIG, SHARD_COUNT } from '@orbetra/ingest'
import { runScenario, liveDrive, bufferedFlood } from '@orbetra/simulator'
import { migrate } from '@orbetra/db/sql/migrate.js'

import { ShardConsumer } from '../src/consumer.js'
import { ShardLeaser, leaseKey, ownsShardLease } from '../src/shards.js'

const IMEI = '356307042441013'
const SHARD = Number(BigInt(IMEI) % BigInt(SHARD_COUNT))
const DB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/db')

const hasher = await xxhash()
const hash = (d: Uint8Array): bigint => hasher.h64Raw(d)

let redisC: StartedTestContainer
let pgC: StartedTestContainer
let redis: Redis
let pool: pg.Pool

beforeAll(async () => {
  ;[redisC, pgC] = await Promise.all([
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer('timescale/timescaledb-ha:pg16')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'pipe' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start(),
  ])
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  const url = `postgresql://postgres:test@${pgC.getHost()}:${pgC.getMappedPort(5432)}/pipe`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: DB_DIR,
    env: { ...process.env, DATABASE_URL: url },
  })
  await migrate(url)
  pool = new pg.Pool({ connectionString: url, max: 5 })
}, 300_000)

afterAll(async () => {
  await pool?.end()
  await redis?.quit()
  await Promise.all([redisC?.stop(), pgC?.stop()])
})

afterEach(async () => {
  await redis.flushall()
  await pool.query('TRUNCATE positions')
})

async function ingestRecords(count: number, scenario = liveDrive, startMs = Date.now() - 7_200_000) {
  await redis.hset('registry:imei', IMEI, '42')
  const { server } = createIngestServer(redis, DEFAULT_CONFIG)
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })
  const res = await runScenario(scenario, {
    imei: IMEI,
    seed: 9,
    hz: 0,
    count,
    startMs,
    host: '127.0.0.1',
    port,
  })
  await new Promise<void>((r) => server.close(() => r()))
  return res
}

const consumerFor = (workerId: string, extra: Partial<ConstructorParameters<typeof ShardConsumer>[1]> = {}) =>
  new ShardConsumer(SHARD, { redis, pool, hash, workerId, autoclaimMinIdleMs: 100, ...extra })

const cborEnc = new Encoder()

/** XADD one synthetic record per spec, run the shard, and hand back each device's decoded attrs. */
async function decodeBatch(
  specs: { deviceId: bigint; io: [number, bigint][] }[],
  extra: Partial<ConstructorParameters<typeof ShardConsumer>[1]> = {},
): Promise<Map<string, Record<string, unknown>>> {
  let t = Date.now() - 600_000
  for (const spec of specs) {
    await redis.xadd(
      `raw:${SHARD}`, '*', 'p',
      cborEnc.encode({
        deviceId: spec.deviceId, imei: IMEI, serverTimeMs: Date.now(), tsMs: (t += 1_000), priority: 0,
        lat: 54.6872, lon: 25.2797, altitude: 100, angle: 0, satellites: 9, speed: 10, eventIoId: 0,
        io: spec.io, raw: new Uint8Array([1]),
      }),
    )
  }
  const out = new Map<string, Record<string, unknown>>()
  const c = consumerFor('w-dict', { onBatch: (records) => { for (const r of records) out.set(r.deviceId.toString(), r.attrs) }, ...extra })
  await c.ensureGroup()
  while ((await c.tick()) > 0) void 0
  return out
}

const decodeOne = async (io: [number, bigint][]): Promise<Record<string, unknown>> =>
  (await decodeBatch([{ deviceId: 42n, io }])).get('42') ?? {}

/** Same as decodeOne, but hands back WHY the fallback was used (empty ⇒ the profile's table won). */
async function fallbackReasons(io: [number, bigint][]): Promise<string[]> {
  const reasons: string[] = []
  await decodeBatch([{ deviceId: 42n, io }], { onAvlFallback: (r) => reasons.push(r) })
  return reasons
}

describe('E02-3 worker pipeline (I1–I3 against real ingest + simulator)', () => {
  it('I1: ingest-ACKed count == stream entries == rows inserted', async () => {
    const res = await ingestRecords(50)
    expect(res.ackedRecords).toBe(50)
    expect(await redis.xlen(`raw:${SHARD}`)).toBe(50)

    const c = consumerFor('w1')
    await c.ensureGroup()
    while ((await c.tick()) > 0) void 0
    expect(c.stats.inserted).toBe(50)
    const rows = await pool.query<{ n: string }>('SELECT count(*) n FROM positions')
    expect(Number(rows.rows[0]!.n)).toBe(50)
  }, 60_000)

  it('I2: bufferedFlood interleaved with live records → downstream handoff strictly fixTime-ordered', async () => {
    const now = Date.now()
    await ingestRecords(60, bufferedFlood, now) // old records, oldest-first
    await ingestRecords(10, liveDrive, now - 30_000) // "live" tail

    const seen: number[] = []
    const c = consumerFor('w1', {
      onBatch: (records) => {
        seen.push(...records.map((r) => r.fixTime.getTime()))
      },
    })
    await c.ensureGroup()
    while ((await c.tick()) > 0) void 0
    expect(seen.length).toBe(70)
    // per-batch sort + serial shard processing ⇒ non-decreasing within each batch;
    // whole-run monotonicity holds here because flood precedes live in the stream
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!)
    }
  }, 60_000)

  it('I3: identical batch replayed twice → row count unchanged', async () => {
    const fixedStart = Date.now() - 3_600_000 // identical timestamps across both runs
    await ingestRecords(30, liveDrive, fixedStart)
    const c = consumerFor('w1')
    await c.ensureGroup()
    while ((await c.tick()) > 0) void 0
    expect(c.stats.inserted).toBe(30)

    // replay: same 30 records ingested again (device resend semantics)
    await ingestRecords(30, liveDrive, fixedStart)
    while ((await c.tick()) > 0) void 0
    expect(c.stats.processed).toBe(60)
    expect(c.stats.inserted).toBe(30) // ON CONFLICT swallowed all 30 dupes
    const rows = await pool.query<{ n: string }>('SELECT count(*) n FROM positions')
    expect(Number(rows.rows[0]!.n)).toBe(30)
  }, 60_000)

  it('chaos: worker "crashes" after insert but BEFORE XACK → peer XAUTOCLAIMs → zero loss, zero dupes', async () => {
    await ingestRecords(40)

    // worker A: reads + inserts, then dies before ACK (we simulate by never ACKing)
    const a = consumerFor('workerA')
    await a.ensureGroup()
    const entries = await (a as unknown as { read(b?: number): Promise<[string, Buffer][]> }).read()
    expect(entries.length).toBe(40)
    // A inserts (duplicating what process() would do, minus the ACK) — crash point
    const { Decoder } = await import('cbor-x')
    const { normalize } = await import('../src/normalize.js')
    const { writePositions } = await import('../src/writer.js')
    const dec = new Decoder()
    const recs = entries.map(([, p]) => normalize(dec.decode(p), hash))
    await writePositions(pool, recs)

    // worker B recovers the pending entries after min-idle and reprocesses
    await new Promise((r) => setTimeout(r, 150))
    const b = consumerFor('workerB')
    while ((await b.tick()) > 0) void 0
    expect(b.stats.processed).toBe(40) // recovered everything
    expect(b.stats.inserted).toBe(0) // all deduped — zero dupes
    const rows = await pool.query<{ n: string }>('SELECT count(*) n FROM positions')
    expect(Number(rows.rows[0]!.n)).toBe(40) // zero loss

    const pending = await redis.xpending(`raw:${SHARD}`, 'pipeline')
    expect((pending as [number, ...unknown[]])[0]).toBe(0) // B ACKed them
  }, 60_000)

  it('COUNTS pending entries the stream trimmed away — the only post-hoc proof of real loss', async () => {
    /**
     * The loss this pipeline can actually suffer, and the one it could not prove afterwards.
     *
     * Entries are ACKed to their device the moment they are XADDed, so the device drops its copies.
     * If a consumer then stalls long enough for `XADD ... MAXLEN` to trim past its pending entries,
     * those positions are gone — no retry, no re-derivation, nothing. XAUTOCLAIM reports exactly
     * which ids it dropped from the group for that reason, in its third element, and the code typed
     * that element and discarded it.
     *
     * This is deliberately NOT a general loss detector: entries evicted before any consumer took
     * delivery were never in a PEL and can never appear here. `stream_depth` is the leading
     * indicator; this is the receipt.
     */
    // SEVEN, not five, and the number matters. `onPendingEvicted` is `(shard, count)`, and this test
    // used to declare a ONE-argument callback — which binds `shard`, not the count. This IMEI shards
    // to 5, the test ingested 5 records, and the assertion summed to 5 either way: it passed on a
    // coincidence, and stayed green with the production count wired to a literal 999 (verified).
    // Seven records on shard 5 makes the two numbers un-confusable, and both are now asserted.
    const RECORDS = 7
    await ingestRecords(RECORDS)
    const a = consumerFor('workerA')
    await a.ensureGroup()
    // A takes delivery and never ACKs — the crash point, exactly as the chaos test above
    const entries = await (a as unknown as { read(b?: number): Promise<[string, Buffer][]> }).read()
    expect(entries.length).toBe(RECORDS)

    // …and while A is away, the stream is trimmed past everything it held
    await redis.xtrim(`raw:${SHARD}`, 'MAXLEN', 0)
    // NOT for min-idle: Redis checks "does this entry still exist" BEFORE the idle threshold, so a
    // deleted PEL entry is reported at any age. The wait is only so worker A's claim is genuinely
    // stale, matching how the chaos test above sequences the same handoff.
    await new Promise((r) => setTimeout(r, 150))

    const evicted: { shard: number; count: number }[] = []
    const b = consumerFor('workerB', { onPendingEvicted: (shard: number, count: number) => evicted.push({ shard, count }) })
    await b.tick()

    expect(evicted.reduce((x, e) => x + e.count, 0)).toBe(RECORDS) // all seven reported as destroyed
    expect(evicted.every((e) => e.shard === SHARD)).toBe(true) // …attributed to the right shard, which is what the alert pages on
  }, 60_000)

  it('malformed CBOR entry → raw:dead, shard keeps flowing', async () => {
    await ingestRecords(5)
    await redis.xadd(`raw:${SHARD}`, '*', 'p', Buffer.from('not-cbor-at-all'))
    await ingestRecords(0) // registry only
    const c = consumerFor('w1')
    await c.ensureGroup()
    while ((await c.tick()) > 0) void 0
    expect(c.stats.inserted).toBe(5)
    expect(c.stats.deadLettered).toBe(1)
    expect(await redis.xlen('raw:dead')).toBe(1)
  }, 60_000)

  it('poison row: quarantined to raw:dead, the REST of the batch is written, everything ACKed', async () => {
    // REGRESSION (audit critical #2): a multi-row INSERT is ONE statement, so a single value the
    // column refuses failed all 200 rows. The batch was then never ACKed, XAUTOCLAIM re-delivered it
    // every 60 s forever, and the other ~199 records — OTHER tenants on the same shard, already ACKed
    // to their devices and dropped from their buffers — were never written. Nulling the known
    // overflow fields is not enough; the isolation mechanism is what bounds the class.
    await ingestRecords(5)
    // A deviceId beyond int64 passes the schema and normalize (it comes from OUR registry, not the
    // device, so normalize deliberately does not bound it) and `device_id bigint` rejects it 22003.
    // Picked precisely because normalize does not clamp it: the point of the bisect is that it
    // bounds the CLASS, including whatever the next firmware or schema change invents, not just the
    // fields we already thought of.
    await redis.xadd(
      `raw:${SHARD}`,
      '*',
      'p',
      new Encoder().encode({
        deviceId: 2n ** 63n, imei: IMEI, serverTimeMs: Date.now(), tsMs: Date.now() - 60_000, priority: 0,
        lat: 54.7, lon: 25.3, altitude: 100, angle: 90, satellites: 9, speed: 40,
        eventIoId: 0, io: [], raw: new Uint8Array([1, 2, 3]),
      }),
    )
    const deadLetters: [string, number][] = []
    const c = consumerFor('w1', { onDeadLetter: (reason, n) => deadLetters.push([reason, n]) })
    await c.ensureGroup()
    while ((await c.tick()) > 0) void 0

    expect(c.stats.inserted).toBe(5) // the healthy records got through
    expect(c.stats.deadLettered).toBe(1)
    expect(deadLetters).toEqual([['rejected_by_db', 1]])
    expect(await redis.xlen('raw:dead')).toBe(1) // quarantined WITH its original bytes
    const pending = await redis.xpending(`raw:${SHARD}`, 'pipeline')
    expect((pending as [number, ...unknown[]])[0]).toBe(0) // ACKed — no infinite redelivery
  }, 60_000)

  it('a TRANSIENT db error is retried, never quarantined', async () => {
    // the mirror-image failure: treating a connection blip as poison would throw away good
    // positions that ingest already ACKed. Only SQLSTATE classes 22/23 mean "this row is bad".
    await ingestRecords(3)
    let calls = 0
    const flaky = {
      query: (...args: unknown[]) => {
        calls++
        if (calls === 1) return Promise.reject(Object.assign(new Error('terminating connection'), { code: '57P01' }))
        return (pool.query as (...a: unknown[]) => Promise<unknown>)(...args)
      },
    } as unknown as pg.Pool
    const c = new ShardConsumer(SHARD, { redis, pool: flaky, hash, workerId: 'flaky-w', autoclaimMinIdleMs: 100 })
    await c.ensureGroup()
    await expect(c.tick()).rejects.toThrow(/terminating connection/)
    expect(c.stats.deadLettered).toBe(0) // nothing thrown away
    expect(await redis.xlen('raw:dead')).toBe(0)

    await new Promise((r) => setTimeout(r, 150)) // let the pending entries pass autoclaim min-idle
    while ((await c.tick()) > 0) void 0 // XAUTOCLAIM replays the still-pending batch
    expect(c.stats.inserted).toBe(3)
  }, 60_000)

  it('SIGTERM path: stop() finishes the in-flight batch, XACKs, lease released < 5 s', async () => {
    await ingestRecords(25)
    const leaser = new ShardLeaser(redis, 'graceful-w', 5_000)
    const owned = await leaser.claimAll()
    expect(owned.has(SHARD)).toBe(true)

    const c = consumerFor('graceful-w', { blockMs: 200 })
    await c.ensureGroup()
    c.start()
    await new Promise((r) => setTimeout(r, 1_000)) // let it drain the stream

    const t0 = Date.now()
    await c.stop()
    await leaser.release()
    expect(Date.now() - t0).toBeLessThan(5_000)

    expect(c.stats.inserted).toBe(25)
    const pending = await redis.xpending(`raw:${SHARD}`, 'pipeline')
    expect((pending as [number, ...unknown[]])[0]).toBe(0)
    expect(await redis.exists(`shards:lease:${SHARD}`)).toBe(0)
  }, 60_000)

  it('fencing (I2/rule 5): a consumer that lost its lease processes NOTHING; records stay claimable by the owner', async () => {
    await ingestRecords(20)
    // a peer holds the shard's lease — our worker "stalledA" lost it during a stall/partition
    await redis.set(leaseKey(SHARD), 'ownerB', 'PX', 60_000)

    const a = consumerFor('stalledA', { ownsShard: () => ownsShardLease(redis, SHARD, 'stalledA') })
    await a.ensureGroup()
    expect(await a.tick()).toBe(0) // fenced: it must NOT apply the batch's durable effects
    expect(a.stats.processed).toBe(0)
    expect(Number((await pool.query<{ n: string }>('SELECT count(*) n FROM positions')).rows[0]!.n)).toBe(0) // no double-effect

    // no lost-effect: the rightful owner B reclaims the pending entries (XAUTOCLAIM) and processes them
    await new Promise((r) => setTimeout(r, 150)) // exceed autoclaimMinIdleMs (100)
    const b = consumerFor('ownerB', { ownsShard: () => ownsShardLease(redis, SHARD, 'ownerB') })
    while ((await b.tick()) > 0) void 0
    expect(Number((await pool.query<{ n: string }>('SELECT count(*) n FROM positions')).rows[0]!.n)).toBe(20)
  }, 60_000)

  it('fencing (loop): a running consumer that discovers a lost lease fires onLostOwnership and stops', async () => {
    await ingestRecords(10)
    await redis.set(leaseKey(SHARD), 'peer', 'PX', 60_000) // someone else owns it
    const dropped: number[] = []
    const c = consumerFor('meNotOwner', {
      blockMs: 100,
      ownsShard: () => ownsShardLease(redis, SHARD, 'meNotOwner'),
      onLostOwnership: (s) => dropped.push(s),
    })
    await c.ensureGroup()
    c.start()
    await new Promise((r) => setTimeout(r, 500))
    expect(dropped).toContain(SHARD) // the consumer fenced itself and told the owner to drop it
    expect(c.stats.processed).toBe(0) // never processed a record while not the owner
    await c.stop()
  }, 30_000)

  it('lease loss fires onLost so the owner can stop its consumer (split-brain guard)', async () => {
    const lost: number[] = []
    const short = new ShardLeaser(redis, 'w-stall', 400, (s) => lost.push(s))
    await short.claimAll()
    // simulate: leases expire during a stall, another worker takes shard 0
    await new Promise((r) => setTimeout(r, 500))
    await redis.set('shards:lease:0', 'w-thief', 'PX', 10_000)
    await new Promise((r) => setTimeout(r, 400)) // next renew tick discovers the theft
    expect(lost).toContain(0)
    expect(short.owned.has(0)).toBe(false)
    await short.release()
    await redis.del('shards:lease:0')
  }, 30_000)

  /**
   * THE DEVICE'S OWN DICTIONARY DECODES IT — not FMB120's.
   *
   * `normalize()` has taken a table since the catalogue landed, and until now nothing passed one:
   * every model in the fleet was decoded with the FMB120 fallback. That is not "unnamed", it is
   * MISLABELLED, which is worse, because a wrong name looks like data. AVL id 141 is the cleanest
   * proof: 2 bytes on the wire either way, "Driver 1 Cumulative Break Time" and UNSIGNED on
   * fmb120, "Battery Temperature" and SIGNED (min −600 = −60.0 °C) on the FMx6xx tables. So the
   * same 0xFFFF is 65535 minutes on one reading and −0.1 °C on the other — a difference a customer
   * sees in a column, with nothing to tell them which one they are looking at.
   */
  it('a device decodes with the AVL table its PROFILE names, not the fallback', async () => {
    await redis.hset('device:config', '42', JSON.stringify({ presenceRules: {}, odometerSource: 'device', avlTable: 'fmc650' }))
    const seen = await decodeOne([[141, 0xffffn]])
    expect(seen['Battery Temperature']).toBe(-1)
    expect(seen['Driver 1 Cumulative Break Time']).toBeUndefined()
  }, 60_000)

  it('…and falls back rather than refusing when the config cannot say', async () => {
    // Four ways the answer is missing, and none of them may cost a position: no config row at all
    // (a device activated before this field existed), a config written without it, a corrupt value,
    // and a table name the codec does not ship (a profile row edited by hand). Dropping the record
    // would turn a labelling problem into data loss.
    for (const cfg of [null, JSON.stringify({ presenceRules: {}, odometerSource: 'device' }), 'not json', JSON.stringify({ avlTable: 'fmb999' })]) {
      await redis.del('device:config')
      if (cfg !== null) await redis.hset('device:config', '42', cfg)
      const seen = await decodeOne([[141, 0xffffn]])
      expect(seen['Driver 1 Cumulative Break Time'], String(cfg)).toBe(65535)
    }
  }, 60_000)

  it('every fallback is COUNTED, with the reason — otherwise it is indistinguishable from real data', async () => {
    // The fallback names and SIGNS every IO element and the result goes durably into
    // positions.attrs, where nothing recomputes it. A Redis blip therefore produces minutes of
    // positions whose "Battery Temperature" column is really a break-time counter — plausible,
    // wrong and permanent. The reasons are separate because the responses are: `redis_error` is an
    // incident, `no_config` is a device the rehydrate has not reached, `unknown_table` is a bad
    // profile row someone has to correct.
    await redis.del('device:config')
    expect(await fallbackReasons([[141, 1n]])).toEqual(['no_config'])

    await redis.hset('device:config', '42', JSON.stringify({ presenceRules: {}, odometerSource: 'device' }))
    expect(await fallbackReasons([[141, 1n]])).toEqual(['no_field'])

    await redis.hset('device:config', '42', 'not json')
    expect(await fallbackReasons([[141, 1n]])).toEqual(['malformed'])

    await redis.hset('device:config', '42', JSON.stringify({ avlTable: 'fmb999' }))
    expect(await fallbackReasons([[141, 1n]])).toEqual(['unknown_table'])

    // …and the device's own table fires NOTHING. Without this the counter could be a constant.
    await redis.hset('device:config', '42', JSON.stringify({ presenceRules: {}, odometerSource: 'device', avlTable: 'fmc650' }))
    expect(await fallbackReasons([[141, 1n]])).toEqual([])
  }, 60_000)

  it('the table is resolved per DEVICE, so one batch can carry two models', async () => {
    // The cache is keyed by device id and the resolve is one HMGET for the whole batch; a bug that
    // resolved once per batch and reused it would be invisible in a single-device test and wrong
    // for every real shard, which carries every model a tenant owns.
    await redis
      .multi()
      .hset('device:config', '42', JSON.stringify({ presenceRules: {}, odometerSource: 'device', avlTable: 'fmc650' }))
      .hset('device:config', '43', JSON.stringify({ presenceRules: {}, odometerSource: 'device', avlTable: 'fmb120' }))
      .exec()
    const byDevice = await decodeBatch([
      { deviceId: 42n, io: [[141, 0xffffn]] },
      { deviceId: 43n, io: [[141, 0xffffn]] },
    ])
    expect(byDevice.get('42')?.['Battery Temperature']).toBe(-1)
    expect(byDevice.get('43')?.['Driver 1 Cumulative Break Time']).toBe(65535)
  }, 60_000)

  it('shard leases are exclusive: second worker cannot claim an owned shard', async () => {
    const l1 = new ShardLeaser(redis, 'w-one', 10_000)
    const l2 = new ShardLeaser(redis, 'w-two', 10_000)
    const first = await l1.claimAll()
    const second = await l2.claimAll()
    expect(first.size).toBe(16)
    expect(second.size).toBe(0)
    await l1.release()
    const third = await l2.claimAll()
    expect(third.size).toBe(16)
    await l2.release()
  }, 30_000)
})
