import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import xxhash from 'xxhash-wasm'

import { createPool } from '@orbetra/db'

import { ShardConsumer } from './consumer.js'
import { LiveState } from './liveState.js'
import { MotionFeed } from './motion.js'
import { startWorkerProm } from './prom.js'
import { ShardLeaser } from './shards.js'
import { createRecomputeQueue, enqueueRecompute, redisConnection } from './jobs/queue.js'
import { startRecomputeWorker } from './jobs/recomputeWorker.js'
import { TripPersister } from './trip/persister.js'

// Env contract per PROJECT_PLAN §6.7.
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
const databaseUrl = process.env['DATABASE_URL'] ?? ''
// recompute only reconciles history older than this — comfortably past the largest stop
// window (300 s) + a reporting gap, so it never races the live streaming trip (ADR-020)
const RECOMPUTE_GUARD_MS = 15 * 60_000

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

  // dedicated connection: scrape XLENs must not queue behind consumers' blocking reads
  const prom = startWorkerProm(redis.duplicate(), Number(process.env['PROMETHEUS_PORT'] ?? 9102))
  const liveState = new LiveState(redis)
  const motionFeed = new MotionFeed() // I5 seam (E02-7): trip engine (E04-1) + geofence stub (E05-x)
  const tripPersister = new TripPersister(pool, redis) // persists trip open/close events
  // E04-2: late/buffered batches the streaming engine dropped are reconciled off the
  // hot path by trip-recompute jobs over durable positions (BullMQ, ADR-020).
  const recomputeConn = redisConnection(redisUrl)
  const recomputeQueue = createRecomputeQueue(recomputeConn)
  const recomputeWorker = startRecomputeWorker({
    connection: recomputeConn,
    pool,
    redis,
    onDone: (r) => {
      prom.tripRecomputes.inc()
      prom.tripRecomputeDeleted.inc(r.deleted)
    },
  })
  const consumerConns: Redis[] = []
  const consumers = [...shards].map((s) => {
    // dedicated connection PER consumer: XREADGROUP BLOCK serializes every queued
    // command behind it on a shared ioredis socket — 16 idle consumers made a full
    // read round take ~16×blockMs (>30 s), starving the leaser's renewal GETs on the
    // same socket until every lease expired on an IDLE worker (found live in E02-6;
    // log signature: "lease lost" for shards 1..15 but never shard 0, loss count
    // increasing with shard number = serial queue depth)
    const conn = redis.duplicate()
    consumerConns.push(conn)
    const c = new ShardConsumer(s, {
      redis: conn,
      pool,
      hash,
      workerId,
      onBatch: async (records) => {
        prom.batchRows.observe(records.length)
        const newestMs = records[records.length - 1]?.fixTime.getTime()
        if (newestMs !== undefined) prom.setLagMs(Math.max(0, Date.now() - newestMs))
        try {
          await liveState.apply(records) // live is best-effort: log, never stall the shard
        } catch (err) {
          console.error('liveState', err)
        }
        try {
          const tripEvents = motionFeed.feed(records) // I5-filtered inside; presence path above is NOT
          if (tripEvents.length > 0) {
            const { opened, closed } = await tripPersister.apply(tripEvents)
            prom.tripsOpened.inc(opened)
            prom.tripsClosed.inc(closed)
          }
          // any out-of-order (late) records the engine dropped → reconcile from durable
          // positions off the hot path (positions are already written by the consumer).
          // Bound recompute to SETTLED history (to = now − guard, guard > max stop window)
          // so it can never delete/clobber the live open trip the streaming persister owns.
          const settledTo = new Date(Date.now() - RECOMPUTE_GUARD_MS)
          for (const { deviceId, from } of motionFeed.tripEngine.takeLate()) {
            if (from >= settledTo) continue // late data is within the live edge → streaming owns it
            // per-item guard: one enqueue failure must not drop the other devices' signals
            try {
              await enqueueRecompute(recomputeQueue, deviceId, from, settledTo)
            } catch (e) {
              prom.tripPersistErrors.inc()
              console.error('enqueueRecompute', e)
            }
          }
        } catch (err) {
          // trips are advisory on the stream path — positions are already durable (I1/I3)
          // and E04-2 recompute rebuilds trips authoritatively from them. Never stall the
          // shard for a trip write; surface the drop via a metric instead of silence.
          prom.tripPersistErrors.inc()
          console.error('tripPersist', err)
        }
      },
    })
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
      await recomputeWorker.close() // finish the in-flight recompute job, stop taking new
      await recomputeQueue.close()
      consumerConns.forEach((c) => c.disconnect())
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
