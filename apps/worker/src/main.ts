import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import xxhash from 'xxhash-wasm'

import { createDb, createPool } from '@orbetra/db'

import { ShardConsumer } from './consumer.js'
import { LiveState } from './liveState.js'
import { MotionFeed } from './motion.js'
import { startWorkerProm } from './prom.js'
import { ShardLeaser } from './shards.js'
import { createRecomputeQueue, enqueueRecompute, redisConnection } from './jobs/queue.js'
import { createOfflineQueue, scheduleOfflineSweep } from './jobs/offlineQueue.js'
import { startOfflineWorker } from './jobs/offlineWorker.js'
import { createNotifyQueue, enqueueNotify } from './jobs/notifyQueue.js'
import { startNotifyWorker } from './jobs/notifyWorker.js'
import { createCommandDispatchQueue, scheduleCommandDispatch, startCommandDispatcher } from './commands/dispatcher.js'
import { startGdprEraseWorker } from './jobs/gdprEraseWorker.js'
import { startGdprExportWorker, startGdprSweepWorker } from './jobs/gdprExportWorker.js'
import { createGdprSweepQueue, scheduleExportSweep } from './jobs/gdprQueue.js'
import { createUsageQueue, scheduleUsageSweep } from './jobs/usageQueue.js'
import { startUsageWorker } from './jobs/usageWorker.js'
import { createStripeUsageQueue, scheduleStripeUsage } from './jobs/stripeUsageQueue.js'
import { createStripeUsageWorker } from './jobs/stripeUsageWorker.js'
import { stripeUsagePortFromEnv } from './billing/usageReporter.js'
import { createScheduledReportQueue, scheduleScheduledReports } from './jobs/scheduledReportQueue.js'
import { startScheduledReportWorker } from './jobs/scheduledReportWorker.js'
import { createWebhookQueue, enqueueWebhook } from './jobs/webhookQueue.js'
import { startWebhookWorker } from './jobs/webhookWorker.js'
import { startRecomputeWorker } from './jobs/recomputeWorker.js'
import { driversFromEnv } from './notify/drivers.js'
import { buildEmailTransport } from './notify/emailTransport.js'
import { GeofenceCache } from './geofence/cache.js'
import { GeofenceEventPersister } from './geofence/persister.js'
import { RuleCache } from './rules/cache.js'
import { RuleEngine, type DeviceIo } from './rules/engine.js'
import { RulePersister } from './rules/persister.js'
import { DeviceConfigCache } from './trip/configCache.js'
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
  const db = createDb(databaseUrl) // scoped repos for the Stripe usage reporter (tenants + usage)
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
  const configCache = new DeviceConfigCache(redis) // per-device trip thresholds/odometerSource (E04-5)
  const geofenceCache = new GeofenceCache(redis) // per-tenant geofence geoms (E05-2)
  const geofenceEvents = new GeofenceEventPersister(pool, redis) // geofence transitions → events
  const ruleCache = new RuleCache(redis) // per-tenant enabled engine rules (E05-4)
  const ruleEngine = new RuleEngine() // overspeed/ignition/din/power_cut/low_battery/panic
  const rulePersister = new RulePersister(pool, redis) // rule events + cooldown + IO warm-start
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
  // E05-4b: device_offline sweeper — a repeatable 60 s job scans presence against each
  // account's device_offline rules (evaluated off the hot path, not per position).
  const offlineQueue = createOfflineQueue(recomputeConn)
  // dedicated connection: the sweep HGETALLs the whole device registry every 60 s — on the
  // shared socket that would queue behind (and stall) the leaser's renewal, the E02-6
  // lease-loss class of bug (review MED). Same rationale as the prom scraper's duplicate.
  const offlineRedis = redis.duplicate()
  // E05-5: notification dispatch — persisted rule events are enqueued here and delivered to
  // the rule's channels (email/telegram) with BullMQ retry. Drivers are env-gated: a channel
  // whose credentials are absent is skipped (metric), not failed. Email = SES SMTP (ADR-023,
  // SMTP_URL+MAIL_FROM); Telegram = TELEGRAM_BOT_TOKEN. Absent env ⇒ that channel is skipped.
  const notifyQueue = createNotifyQueue(recomputeConn)
  const emailTransport = buildEmailTransport(process.env)
  const drivers = driversFromEnv(process.env, emailTransport)
  const notifyWorker = startNotifyWorker({
    connection: recomputeConn,
    pool,
    redis: offlineRedis,
    drivers,
    onSent: (ch) => prom.notificationSent.inc({ channel: ch }),
    onFailed: (ch) => prom.notificationFailed.inc({ channel: ch }),
    onSkipped: (reason) => prom.notificationSkipped.inc({ reason }),
  })
  // E06-4: webhook delivery — every persisted event (rule/geofence/offline) is POSTed,
  // HMAC-signed, to the account's subscribed webhooks with BullMQ retry.
  const webhookQueue = createWebhookQueue(recomputeConn)
  const webhookWorker = startWebhookWorker({
    connection: recomputeConn,
    pool,
    redis: offlineRedis,
    onDelivered: () => prom.webhookDelivered.inc(),
    onFailed: () => prom.webhookFailed.inc(),
  })
  // enqueue an event to BOTH notification + webhook delivery, best-effort (a queue blip must
  // not stall the shard; the event is already durably persisted).
  const emitWebhook = (ev: { deviceId: bigint; kind: string; at: Date; payload: Record<string, unknown>; dedupe: string }): Promise<void> =>
    enqueueWebhook(webhookQueue, ev).catch((err: unknown) => {
      prom.webhookFailed.inc()
      console.error('enqueueWebhook', err)
    })
  const offlineWorker = startOfflineWorker({
    connection: recomputeConn,
    pool,
    redis: offlineRedis,
    onFired: (n) => prom.ruleEvents.inc({ kind: 'device_offline' }, n),
    // best-effort per item: a Redis blip must not fail the sweep (the fired-flag is already
    // set with a 30-day TTL, so a thrown sweep would strand the notification for ~30 days).
    // Surface a dropped enqueue via a metric instead (review MED-1).
    onEvents: (events) =>
      Promise.allSettled(
        events.flatMap((e) => [
          enqueueNotify(notifyQueue, { ruleId: e.ruleId, deviceId: e.deviceId, kind: e.kind, at: e.at, payload: e.payload }).catch((err: unknown) => {
            prom.notificationFailed.inc({ channel: 'enqueue' })
            console.error('enqueueNotify(offline)', err)
          }),
          emitWebhook({ deviceId: e.deviceId, kind: e.kind, at: e.at, payload: e.payload, dedupe: e.ruleId }),
        ]),
      ).then(() => undefined),
  })
  await scheduleOfflineSweep(offlineQueue)
  // E07-4: usage metering — an hourly repeatable sweep derives billable device-days from
  // POSITIONS (authoritative; idempotent ON CONFLICT; UTC day semantics, §6.9).
  const usageQueue = createUsageQueue(recomputeConn)
  const usageWorker = startUsageWorker({
    connection: recomputeConn,
    pool,
    onSwept: (n) => prom.usageDeviceDays.inc(n),
    onFailed: () => prom.usageSweepFailed.inc(),
  })
  await scheduleUsageSweep(usageQueue)
  // ADR-024 PR B2: daily Stripe overage reporter — reports yesterday's per-tenant device overage
  // to the meter. Only runs when Stripe is configured (STRIPE_SECRET_KEY); otherwise skipped.
  const stripeUsagePort = stripeUsagePortFromEnv()
  const stripeUsageQueue = stripeUsagePort !== null ? createStripeUsageQueue(recomputeConn) : null
  const stripeUsageWorker = stripeUsagePort !== null
    ? createStripeUsageWorker({ connection: recomputeConn, db, stripe: stripeUsagePort, onReported: (r) => prom.stripeOverageReported.inc(r.reported) })
    : null
  if (stripeUsageQueue !== null) await scheduleStripeUsage(stripeUsageQueue)
  // V1-nice: scheduled emailed reports — hourly cron runs due schedules + e-mails them. Only when
  // email is configured (no transport ⇒ nothing to send); reuses the same SES SMTP as notifications.
  const scheduledReportQueue = emailTransport !== undefined ? createScheduledReportQueue(recomputeConn) : null
  const scheduledReportWorker = emailTransport !== undefined
    ? startScheduledReportWorker({ connection: recomputeConn, db, pool, transport: emailTransport, onRun: (r) => prom.scheduledReportsSent.inc(r.emailed) })
    : null
  if (scheduledReportQueue !== null) await scheduleScheduledReports(scheduledReportQueue)
  // E08-2: Codec-12 command dispatcher — ~15s reconcile of in-flight commands vs device
  // responses (transport seam written by ingest); drives the DB status machine.
  const commandQueue = createCommandDispatchQueue(recomputeConn)
  const commandWorker = startCommandDispatcher({
    connection: recomputeConn,
    pool,
    redis: offlineRedis,
    onResult: (r) => {
      prom.commandsResolved.inc({ outcome: 'acked' }, r.acked)
      prom.commandsResolved.inc({ outcome: 'failed' }, r.failed)
      prom.commandsResolved.inc({ outcome: 'expired' }, r.expired)
    },
  })
  await scheduleCommandDispatch(commandQueue)
  // E08-4: GDPR jobs — device-erase cascade + account export (api enqueues one-shots)
  const gdprEraseWorker = startGdprEraseWorker({
    connection: recomputeConn,
    pool,
    redis: offlineRedis,
    onErased: (r) => {
      prom.gdprErased.inc()
      console.log(`gdpr erase complete: device ${r.deviceId}, ${r.positions} positions`)
    },
    onFailed: () => prom.gdprFailed.inc({ job: 'erase' }),
  })
  const gdprExportWorker = startGdprExportWorker({
    connection: recomputeConn,
    pool,
    exportDir: process.env['EXPORT_DIR'] ?? 'var/exports',
    onDone: (r) => {
      prom.gdprExported.inc()
      console.log(`gdpr export complete: ${r.exportId}, ${r.bytes} bytes`)
    },
    onFailed: () => prom.gdprFailed.inc({ job: 'export' }),
  })
  // hourly sweep: unlink expired export files + mark rows (the 7-day expiry is real)
  const gdprSweepQueue = createGdprSweepQueue(recomputeConn)
  const gdprSweepWorker = startGdprSweepWorker({
    connection: recomputeConn,
    pool,
    onSwept: (n) => console.log(`gdpr export sweep: removed ${n} expired file(s)`),
  })
  await scheduleExportSweep(gdprSweepQueue)
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
          // E04-5 + E05-2: pre-resolve per-device trip config + geofences (async Redis)
          // before the synchronous engine feed — both cached with a short TTL
          const now = Date.now()
          const deviceIds = records.map((r) => r.deviceId)
          const [cfg, gf] = await Promise.all([configCache.resolveBatch(deviceIds, now), geofenceCache.resolveBatch(deviceIds, now)])
          // warm-start geofence engine from durable state for devices that have fences (MED-1)
          const insideFor = await geofenceEvents.loadInside([...gf.keys()])
          const { tripEvents, transitions } = motionFeed.feed(
            records,
            (id) => cfg.get(id.toString()),
            (id) => gf.get(id.toString()) ?? [],
            insideFor,
          )
          if (tripEvents.length > 0) {
            const { opened, closed } = await tripPersister.apply(tripEvents)
            prom.tripsOpened.inc(opened)
            prom.tripsClosed.inc(closed)
          }
          if (transitions.length > 0) {
            const written = await geofenceEvents.persist(transitions)
            prom.geofenceEvents.inc(written)
            // E06-4: geofence transitions are webhook-deliverable events too (no rule/notify
            // path — geofence events carry no ruleId). Enqueue after they're persisted.
            for (const tr of transitions) {
              await emitWebhook({ deviceId: tr.deviceId, kind: 'geofence', at: tr.at, payload: { geofenceId: tr.geofenceId, name: tr.geofenceName, transition: tr.type }, dedupe: `${tr.geofenceId}:${tr.type}` })
            }
          }
          // E05-4: rule engine (overspeed + IO). Fed the FULL batch, NOT the motion-filtered
          // records — IO events (ignition/din/power_cut/low_battery/panic) must fire on
          // invalid-fix records too (§3.4); overspeed self-guards on fixValid inside the engine.
          // Isolated try: a rule-write failure must not stall the shard or drop trips/geofences.
          try {
            const rules = await ruleCache.resolveBatch(deviceIds, now)
            if (rules.size > 0) {
              const ruleDevices = [...rules.keys()]
              const ioStateFor = await rulePersister.loadIoState(ruleDevices.map(BigInt)) // warm-start (no restart re-fire)
              const ruleEvents = ruleEngine.feed(records, (id) => rules.get(id.toString()) ?? [], ioStateFor)
              // Persist events BEFORE saving IO state. If the worker crashes in the
              // ACK-replay window, un-saved IO state means the replay warm-starts the OLD
              // value and RE-FIRES the edge (non-bypass edges are then suppressed by the
              // already-set cooldown key ⇒ idempotent; panic/power_cut may double-fire —
              // "doubled beats missed", §6.5). Saving IO state first would instead SUPPRESS
              // the replay edge → a missed panic. Order matters (review HIGH-1).
              if (ruleEvents.length > 0) {
                const persisted = await rulePersister.persist(ruleEvents)
                for (const e of persisted) {
                  prom.ruleEvents.inc({ kind: e.kind })
                  // E05-5: enqueue notification AFTER the event is durably persisted (§6.5).
                  // Best-effort per event — a notify-enqueue failure must not stall the shard,
                  // but it IS a silent-alert-drop, so surface it via a metric (review MED-2).
                  try {
                    await enqueueNotify(notifyQueue, { ruleId: e.ruleId, deviceId: e.deviceId, kind: e.kind, at: e.at, payload: e.payload })
                  } catch (err) {
                    prom.notificationFailed.inc({ channel: 'enqueue' })
                    console.error('enqueueNotify', err)
                  }
                  await emitWebhook({ deviceId: e.deviceId, kind: e.kind, at: e.at, payload: e.payload, dedupe: e.ruleId })
                }
              }
              // now advance durable IO state so the NEXT batch / a clean restart warm-starts
              const snapshots = new Map<string, DeviceIo>()
              for (const key of ruleDevices) {
                const snap = ruleEngine.snapshot(BigInt(key))
                if (snap !== undefined) snapshots.set(key, snap)
              }
              await rulePersister.saveIoState(snapshots)
            }
          } catch (err) {
            console.error('ruleEngine', err)
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
      await offlineWorker.close() // finish the in-flight sweep, stop taking new
      await offlineQueue.close()
      await notifyWorker.close() // finish the in-flight notification, stop taking new
      await notifyQueue.close()
      await webhookWorker.close() // finish the in-flight webhook delivery, stop taking new
      await webhookQueue.close()
      await usageWorker.close() // finish the in-flight usage sweep, stop taking new
      await usageQueue.close()
      await stripeUsageWorker?.close() // finish the in-flight overage report, stop taking new
      await stripeUsageQueue?.close()
      await scheduledReportWorker?.close() // finish the in-flight scheduled-report run, stop taking new
      await scheduledReportQueue?.close()
      await commandWorker.close() // finish the in-flight command dispatch, stop taking new
      await commandQueue.close()
      await gdprEraseWorker.close() // finish the in-flight erase step, stop taking new
      await gdprExportWorker.close() // finish the in-flight export, stop taking new
      await gdprSweepWorker.close()
      await gdprSweepQueue.close()
      offlineRedis.disconnect()
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
