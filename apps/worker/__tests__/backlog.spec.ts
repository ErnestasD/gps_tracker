import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { shardBacklog } from '../src/prom.js'
import { PIPELINE_GROUP } from '../src/shards.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

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

afterEach(async () => {
  await redis.flushall()
})

const STREAM = 'raw:0'
const fill = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await redis.xadd(STREAM, 'MAXLEN', '~', 100_000, '*', 'p', 'x')
}

describe('shardBacklog — the I4 backpressure signal', () => {
  it('reports UNCONSUMED entries, not stream length — the permanent-latch regression', async () => {
    // The original signal was XLEN. XACK does not delete stream entries and nothing trims
    // raw:{shard} (written MAXLEN ~ 100k), so XLEN only ever climbs: once a shard had cumulatively
    // carried pauseAboveDepth records, EVERY session paused forever against an idle worker.
    await redis.xgroup('CREATE', STREAM, PIPELINE_GROUP, '0', 'MKSTREAM')
    await fill(20)
    expect(await shardBacklog(redis, 0)).toBe(20) // nothing read yet

    const read = (await redis.xreadgroup(
      'GROUP', PIPELINE_GROUP, 'c1', 'COUNT', '20', 'STREAMS', STREAM, '>',
    )) as [string, [string, string[]][]][]
    const ids = read[0]![1].map(([id]) => id)
    expect(await shardBacklog(redis, 0)).toBe(20) // delivered but unacked is STILL backlog

    for (const id of ids) await redis.xack(STREAM, PIPELINE_GROUP, id)
    expect(await shardBacklog(redis, 0)).toBe(0) // consumed ⇒ drained…
    expect(await redis.xlen(STREAM)).toBe(20) // …while XLEN never came back down
  }, 60_000)

  it('no group yet ⇒ nothing is consuming ⇒ everything retained IS backlog', async () => {
    await fill(7)
    expect(await shardBacklog(redis, 0)).toBe(7)
  }, 60_000)

  it('missing stream ⇒ 0, but any OTHER redis error propagates (the guard must not fail open)', async () => {
    expect(await shardBacklog(redis, 0)).toBe(0)
    await redis.set(STREAM, 'not-a-stream')
    // WRONGTYPE previously read as "no backlog": ingest would keep accepting while the worker
    // fell behind, and MAXLEN would silently evict never-processed records (I1 loss).
    await expect(shardBacklog(redis, 0)).rejects.toThrow(/WRONGTYPE/)
  }, 60_000)

  it('lag uncomputable (XGROUP SETID / XDEL) ⇒ falls back to the CONSERVATIVE upper bound', async () => {
    // Skipping a wedged batch with XGROUP SETID is a normal on-call action. It makes Redis unable to
    // compute `lag`; returning `pending` alone would read ~0 — disabling backpressure and flattening
    // the dashboard exactly when the pipeline is in trouble.
    await redis.xgroup('CREATE', STREAM, PIPELINE_GROUP, '0', 'MKSTREAM')
    await fill(30)
    await redis.xgroup('SETID', STREAM, PIPELINE_GROUP, '0', 'ENTRIESREAD', '5')
    const ids = await redis.xrange(STREAM, '-', '+', 'COUNT', 3)
    await redis.xdel(STREAM, ...ids.map(([id]) => id))
    expect(await shardBacklog(redis, 0)).toBeGreaterThanOrEqual(27)
  }, 60_000)

  it('CONTRACT: ingest and worker probe the SAME consumer group name', () => {
    // Both copies fall through to XLEN when the group is not found, so a silent divergence here
    // reinstates the permanent-latch CRITICAL in both processes at once. ingest cannot import this
    // constant (it does not depend on @orbetra/worker), so the contract is asserted on the source.
    const ingestSrc = readFileSync(path.join(REPO, 'apps/ingest/src/session.ts'), 'utf8')
    const match = /const PIPELINE_GROUP = '([^']+)'/.exec(ingestSrc)
    expect(match?.[1]).toBe(PIPELINE_GROUP)
  })
})
