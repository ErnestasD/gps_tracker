import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import xxhash from 'xxhash-wasm'

import { createPool } from '@orbetra/db'

import { ShardConsumer } from './consumer.js'
import { ShardLeaser } from './shards.js'

// Env contract per PROJECT_PLAN §6.7.
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
const databaseUrl = process.env['DATABASE_URL'] ?? ''

async function main(): Promise<void> {
  if (!databaseUrl) {
    console.error('DATABASE_URL is required')
    process.exit(2)
  }
  const workerId = `worker-${randomUUID().slice(0, 8)}`
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const pool = createPool(databaseUrl)
  const hasher = await xxhash()
  const hash = (data: Uint8Array): bigint => hasher.h64Raw(data)

  const consumersByShard = new Map<number, ShardConsumer>()
  const leaser = new ShardLeaser(redis, workerId, 30_000, (shard) => {
    // lease lost (stall/partition): stop the consumer NOW — another worker owns the
    // shard and concurrent processing would violate I2 (adversarial review, E02-3)
    console.error(`lease lost for shard ${shard} — stopping its consumer`)
    void consumersByShard.get(shard)?.stop()
    consumersByShard.delete(shard)
  })
  const shards = await leaser.claimAll()
  console.log(`${workerId} owns shards: ${[...shards].join(',') || '(none)'}`)

  const consumers = [...shards].map((s) => {
    const c = new ShardConsumer(s, { redis, pool, hash, workerId })
    consumersByShard.set(s, c)
    return c
  })
  for (const c of consumers) {
    await c.ensureGroup()
    c.start()
  }

  // Graceful drain (§6.1 deploy protocol): finish current batch, XACK, release leases <5 s
  process.on('SIGTERM', () => {
    void (async () => {
      await Promise.all(consumers.map((c) => c.stop()))
      await leaser.release()
      await redis.quit()
      await pool.end()
      process.exit(0)
    })()
    setTimeout(() => process.exit(1), 5_000).unref()
  })
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
