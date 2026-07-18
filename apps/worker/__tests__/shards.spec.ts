import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SHARD_COUNT, ShardLeaser } from '../src/shards.js'

/**
 * Shard-lease recovery + exclusivity (review HIGH/MED). Covers:
 *  - a shard the worker does NOT own is (re)acquired once its lease frees (onGained fires) — without
 *    this a shard lost to a stall / a dead peer stays unconsumed forever and ingest trims its backlog.
 *  - lease renewal is ATOMIC: a peer that grabbed the lease in the gap is never extended by us.
 */
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
  await redis.quit()
  await container.stop()
})

afterEach(async () => {
  await redis.flushall()
})

describe('ShardLeaser recovery + exclusivity', () => {
  it('reacquires a shard whose lease frees up, firing onGained (dead-peer / lost-lease recovery)', async () => {
    // a peer already holds shard 0 when we start
    await redis.set('shards:lease:0', 'peerX', 'PX', 60_000)
    const gained: number[] = []
    const leaser = new ShardLeaser(redis, 'w1', 30_000, undefined, (s) => gained.push(s))
    const owned = await leaser.claimAll()
    expect(owned.has(0)).toBe(false) // peer holds it
    expect(owned.size).toBe(SHARD_COUNT - 1)

    // peer dies → its lease is gone; a manual tick must pick shard 0 up and announce it
    await redis.del('shards:lease:0')
    await leaser.tick()
    expect(gained).toContain(0)
    expect(leaser.owned.has(0)).toBe(true)
    expect(await redis.get('shards:lease:0')).toBe('w1')

    await leaser.release()
  }, 30_000)

  it('atomic renewal never extends a lease a peer just took over (compare-and-extend)', async () => {
    const leaser = new ShardLeaser(redis, 'w1', 30_000, () => undefined)
    await leaser.claimAll()
    expect(leaser.owned.has(3)).toBe(true)

    // simulate the GC-pause window: our lease expired and a peer claimed shard 3
    await redis.set('shards:lease:3', 'peerB', 'PX', 60_000)

    await leaser.tick() // our renew tick runs late — must NOT re-extend peerB's lease
    expect(leaser.owned.has(3)).toBe(false) // we noticed the loss and dropped it
    expect(await redis.get('shards:lease:3')).toBe('peerB') // still the peer's — we never touched it

    await leaser.release()
  }, 30_000)

  it('onLost fires when a held lease is discovered stolen', async () => {
    const lost: number[] = []
    const leaser = new ShardLeaser(redis, 'w1', 30_000, (s) => lost.push(s))
    await leaser.claimAll()
    await redis.set('shards:lease:5', 'peerC', 'PX', 60_000) // stolen during a stall
    await leaser.tick()
    expect(lost).toContain(5)
    await leaser.release()
  }, 30_000)
})
