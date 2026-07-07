import { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ShardConsumer } from '../src/consumer.js'
import { SHARD_COUNT, ShardLeaser } from '../src/shards.js'

/**
 * Regression for a live-found E02-6 defect: all 16 consumers shared ONE ioredis
 * connection with the leaser. XREADGROUP BLOCK serializes everything queued behind
 * it on that socket, so an IDLE worker's renewal GETs waited ~16×blockMs (> lease
 * TTL) and every lease expired. Fix: dedicated connection per consumer (main.ts).
 * This test wires consumers the FIXED way at aggressive timings — if anyone reverts
 * to a shared connection, renewal starves and it fails.
 */

let container: StartedTestContainer
let redis: Redis
const extraConns: Redis[] = []

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
  extraConns.forEach((c) => c.disconnect())
  await redis.quit()
  await container.stop()
})

describe('lease renewal vs idle blocking consumers', () => {
  it('16 idle BLOCK-reading consumers on dedicated connections never starve the leaser', async () => {
    const lost: number[] = []
    // TTL 1000 ms / renew every ~333 ms: far tighter than prod (30 s), so any
    // renewal starvation shows up within a couple of seconds
    const leaser = new ShardLeaser(redis, 'w1', 1_000, (s) => lost.push(s))
    const owned = await leaser.claimAll()
    expect(owned.size).toBe(SHARD_COUNT)

    const consumers = Array.from({ length: SHARD_COUNT }, (_, shard) => {
      const conn = redis.duplicate() // the fix under test
      extraConns.push(conn)
      return new ShardConsumer(shard, {
        redis: conn,
        pool: {} as Pool, // streams stay empty — pool is never touched
        hash: () => 0n,
        workerId: 'w1',
        blockMs: 300, // 16×300 ms ≈ 4.8 s serial round — deadly if shared, harmless here
      })
    })
    for (const c of consumers) {
      await c.ensureGroup()
      c.start()
    }

    // several full TTL windows of pure idle blocking
    await new Promise((r) => setTimeout(r, 3_500))

    expect(lost).toEqual([])
    expect(leaser.owned.size).toBe(SHARD_COUNT)

    await Promise.all(consumers.map((c) => c.stop()))
    await leaser.release()
  }, 30_000)
})
