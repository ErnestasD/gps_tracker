import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
