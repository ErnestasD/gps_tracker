import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import xxhash from 'xxhash-wasm'

import { createDb, createPool, poolOptionsFromEnv, poolStats } from '@orbetra/db'
import { configureEmailPlatform } from '@orbetra/shared'

import { ShardConsumer } from './consumer.js'
import { LiveState } from './liveState.js'
import { MotionFeed } from './motion.js'
import { DEFAULT_THRESHOLDS, TripEngine } from './trip/engine.js'
import { isClockSkewed } from './normalize.js'
import { startWorkerProm } from './prom.js'

/** An open trip whose device has been silent this long is never going to be closed by an engine
 *  event — sweep it at startup rather than letting engineHours bill it to now(). 6 h ≫ any real
 *  stop threshold (the longest parked window is minutes). */
const ORPHAN_TRIP_MAX_IDLE_MS = Number(process.env['TRIP_ORPHAN_MAX_IDLE_MS'] ?? 6 * 3_600_000)
/** How long to wait for a consumer's in-flight batch before abandoning its connection. */
const SHARD_STOP_TIMEOUT_MS = Number(process.env['SHARD_STOP_TIMEOUT_MS'] ?? 15_000)
import { SHARD_COUNT, ShardLeaser, ownsShardLease } from './shards.js'
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
import { createRetentionQueue, scheduleRetentionSweep } from './jobs/retentionQueue.js'
import { LOCATION_RETENTION_DAYS, startRetentionWorker } from './jobs/retentionWorker.js'
import { createRejectDrainQueue, scheduleRejectDrain } from './jobs/rejectDrainQueue.js'
import { startRejectDrainWorker } from './jobs/rejectDrainWorker.js'
import { createStripeUsageQueue, scheduleStripeUsage } from './jobs/stripeUsageQueue.js'
import { backfillDaysFromEnv, createStripeUsageWorker } from './jobs/stripeUsageWorker.js'
import { createLapseSweepQueue, scheduleLapseSweep } from './jobs/lapseSweepQueue.js'
import { createLapseSweepWorker, graceDaysFromEnv } from './jobs/lapseSweepWorker.js'
import { stripeUsagePortFromEnv } from './billing/usageReporter.js'
import { createScheduledReportQueue, scheduleScheduledReports } from './jobs/scheduledReportQueue.js'
import { startScheduledReportWorker } from './jobs/scheduledReportWorker.js'
import { createWebhookQueue, enqueueWebhook } from './jobs/webhookQueue.js'
import { startWebhookWorker } from './jobs/webhookWorker.js'
import { startRecomputeWorker } from './jobs/recomputeWorker.js'
import { driversFromEnv } from './notify/drivers.js'
import { buildEmailTransport, suppressionLookup } from './notify/emailTransport.js'
import { startAuthEmailWorker } from './jobs/authEmailWorker.js'
import { createAuthEmailQueue, enqueueAuthEmail } from './jobs/authEmailQueue.js'
import { smsDriverFromEnv } from './sms/drivers.js'
import { startSmsWorker } from './jobs/smsWorker.js'
import { GeofenceCache } from './geofence/cache.js'
import type { GeofenceTransition } from './geofence/engine.js'
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
  // 24, not the shared default of 10: this ONE pool serves 16 shard consumers plus a dozen BullMQ
  // workers, so at the default every busy moment queued acquires invisibly (audit MED #30).
  const pool = createPool(databaseUrl, poolOptionsFromEnv(process.env, { max: 24 }))
  const db = createDb(databaseUrl) // scoped repos for the Stripe usage reporter (tenants + usage)
  const hasher = await xxhash()
  const hash = (data: Uint8Array): bigint => hasher.h64Raw(data)

  const consumersByShard = new Map<number, ShardConsumer>()
  /**
   * Per-shard transition queue (I2 / rule 5). Start and stop for one shard MUST be serialized:
   * `onLost` used to fire-and-forget `stop()` and delete the map slot immediately, so a re-acquire
   * arriving milliseconds later found no entry and started a SECOND consumer while the first was
   * still draining its batch — two live consumers on one shard, i.e. the same device processed
   * concurrently, which is exactly what the lease exists to prevent. Chaining also bounds the
   * duplicated Redis connections a flapping shard used to leak.
   */
  const shardOps = new Map<number, Promise<void>>()
  /** Devices already warned about a clock skew — one line per device, not per record. */
  const warnedSkew = new Set<string>()
  const runShardOp = (shard: number, op: () => Promise<void>): void => {
    const next = (shardOps.get(shard) ?? Promise.resolve())
      .then(op)
      .catch((err: unknown) => console.error(`shard ${shard} transition failed`, err))
    shardOps.set(shard, next)
    void next
  }
  const stopShardConsumer = (shard: number): void =>
    runShardOp(shard, async () => {
      const c = consumersByShard.get(shard)
      consumersByShard.delete(shard) // drop the slot INSIDE the queued op, never before the await
      // BOUNDED: every connection here is `maxRetriesPerRequest: null`, so during a Redis partition
      // an in-flight blocking XREADGROUP queues forever — `stop()` would never resolve, the shard's
      // op chain would block permanently, and the shard would stay dead even after Redis recovered.
      // Serializing transitions must not trade a double-consumer risk for a zero-consumer one.
      if (c !== undefined) {
        await Promise.race([c.stop(), new Promise<void>((r) => setTimeout(r, SHARD_STOP_TIMEOUT_MS))])
      }
      // …and only THEN forget this shard's open-trip ids. `stop()` is graceful — the in-flight batch
      // finishes and XACKs before it resolves — so clearing them first deleted the ids while the
      // consumer was still inside `tripPersister.apply()`, and every close in that batch was
      // silently dropped: the row stayed open, the device's NEXT journey force-closed it at 0 km
      // with an end time an hour or a day later, and the real mileage was gone. No peer required —
      // a ≥30 s event-loop stall expires the lease and the leaser fires onLost on its own, which is
      // the flap this codebase has already seen live (see the geofence engine's chunking comment).
      // Doing it after the drain is safe even in a genuine handoff: at worst both owners close, and
      // closeTrip's `WHERE status='open'` makes the loser a 0-row no-op.
      tripPersister.forgetShard(shard)
      // `disconnect()`, not `quit()`: quit() queues BEHIND the pending commands we just gave up on
      consumerConnByShard.get(shard)?.disconnect()
      consumerConnByShard.delete(shard)
    })
  const consumerConnByShard = new Map<number, Redis>()
  // wired below once the consumer factory + all its deps exist; the renew/reacquire timer only
  // fires ~10 s after startup, so the holder is always populated before onGained can call it.
  let startShardConsumer: (shard: number) => void = () => {}
  const leaser = new ShardLeaser(
    redis,
    workerId,
    30_000,
    (shard) => {
      // lease lost (stall/partition): stop the consumer NOW — another worker owns the
      // shard and concurrent processing would violate I2 (adversarial review, E02-3)
      console.error(`lease lost for shard ${shard} — stopping its consumer`)
      stopShardConsumer(shard)
    },
    (shard) => {
      // lease (re)acquired: a shard we lost to a stall, or a dead peer's expired lease, must
      // resume consumption — otherwise ingest's MAXLEN trim destroys the backlog unread (review HIGH)
      console.log(`shard ${shard} (re)acquired — starting its consumer`)
      startShardConsumer(shard)
    },
  )
  const shards = await leaser.claimAll()
  console.log(`${workerId} owns shards: ${[...shards].join(',') || '(none)'}`)

  // dedicated connection: scrape XLENs must not queue behind consumers' blocking reads
  const prom = startWorkerProm(redis.duplicate(), Number(process.env['PROMETHEUS_PORT'] ?? 9102), () => poolStats(pool))
  const liveState = new LiveState(redis)
  // I5 seam (E02-7): trip engine (E04-1) + geofence stub (E05-x). The trip engine reports when it
  // refuses an odometer delta the distance column cannot hold — substituting a distance source is a
  // correction the operator should see rather than infer from a customer's mileage complaint.
  const motionFeed = new MotionFeed(new TripEngine(DEFAULT_THRESHOLDS, () => prom.tripOdometerRejected.inc()))
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
  // persists trip open/close events. A row it has to finalize without engine events (restart sweep,
  // stale reopen) gets its distance/maxSpeed from the trip's own positions — NOT from a recompute:
  // recompute DELETEs closed rows in its window and rebuilds only what the engine re-emits, and an
  // orphan by definition has no ignition-off tail, so that would destroy the row, not repair it.
  const tripPersister = new TripPersister(pool, redis)
  const recomputeWorker = startRecomputeWorker({
    connection: recomputeConn,
    pool,
    redis,
    onOdometerRejected: () => prom.tripOdometerRejected.inc(),
    onDone: (r) => {
      prom.tripRecomputes.inc()
      prom.tripRecomputeDeleted.inc(r.deleted)
      // a device buffering for weeks is normal for asset trackers, and the window cap means its
      // tail was NOT rebuilt — visible so an operator backfill happens, rather than counted a success
      if (r.truncated === true) prom.tripRecomputeTruncated.inc()
      if (r.skipped !== undefined) console.warn(`trip recompute skipped: ${r.skipped}`)
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
  // Our own identity on mail that is NOT white-labelled. EMAIL_LOGO_URL must be a PUBLIC https URL
  // (apps/site serves /email-logo.png); unset ⇒ the header stays the product name as text, which is
  // the correct degradation — a broken image is worse than no image on the line that says who sent
  // this. Configured once here rather than passed through six templates.
  configureEmailPlatform({
    name: 'Orbetra',
    ...(process.env['EMAIL_LOGO_URL'] ? { logoUrl: process.env['EMAIL_LOGO_URL'] } : {}),
  })
  const emailTransport = buildEmailTransport(process.env, undefined, suppressionLookup(db.suppressions))
  const drivers = driversFromEnv(process.env, { emailTransport, subscriptions: db.pushSubscriptions })
  const notifyWorker = startNotifyWorker({
    connection: recomputeConn,
    pool,
    redis: offlineRedis,
    drivers,
    onSent: (ch) => prom.notificationSent.inc({ channel: ch }),
    onFailed: (ch) => prom.notificationFailed.inc({ channel: ch }),
    onSkipped: (reason) => prom.notificationSkipped.inc({ reason }),
  })
  // ADR-031: transactional auth emails (password-reset) — the API enqueues, the worker renders the
  // tenant-branded message and sends it via the SAME transport. Env-gated: no transport ⇒ no-op.
  const authEmailWorker = startAuthEmailWorker({
    connection: recomputeConn,
    pool,
    transport: emailTransport,
    // `auth_email` joins retention / scheduled_reports / stripe_usage / lapse_sweep on the one
    // alert that watches background jobs. Without it, a permanently failing activation mail was
    // invisible — and one dead-lettered job proved it by sitting unnoticed for three days.
    onFailed: (kind) => prom.jobFailed.inc({ job: `auth_email:${kind}` }),
    onSent: (kind) => prom.authEmailSent.inc({ kind }),
  })
  // the worker enqueues onto the SAME auth-email queue the api uses — the lapse ladder is the only
  // mail this process originates, and it must land in the same branded shell as the rest
  const authEmailQueue = createAuthEmailQueue(recomputeConn)
  // SMS gateway: send Teltonika config/command SMS to a device SIM via the env-gated Twilio driver
  // (TWILIO_ACCOUNT_SID + TWILIO_FROM + auth token OR API key pair). Absent creds ⇒ no driver ⇒ the
  // worker isn't started; the API returns 503 (shared smsConfigured is the single source of truth).
  const smsDriver = smsDriverFromEnv(process.env)
  const smsWorker = smsDriver !== undefined
    ? startSmsWorker({
        connection: recomputeConn,
        pool,
        redis: offlineRedis,
        driver: smsDriver,
        onSent: () => prom.smsSent.inc(),
        onFailed: () => prom.smsFailed.inc(),
      })
    : null
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
    ? createStripeUsageWorker({
        connection: recomputeConn,
        db,
        stripe: stripeUsagePort,
        backfillDays: backfillDaysFromEnv(),
        onReported: (r) => {
          prom.stripeOverageReported.inc(r.reported)
          prom.stripeOverageBackfilled.inc(r.backfilled)
          // a GAUGE, not a counter: the question is "is the config wrong right now", and it must
          // fall back to 0 by itself once STRIPE_INCLUDED is fixed. It is only written on a
          // SUCCESSFUL run and resets to 0 on restart, so it can read 0 for up to one tick after a
          // worker restart or a failing run — WorkerJobFailing covers that gap.
          prom.stripeUnmappedPrice.set(r.unmappedPrices)
          prom.stripeAllowanceSkips.set(r.allowanceSkips)
        },
        onFailed: () => prom.jobFailed.inc({ job: 'stripe_usage' }),
        onAllowanceSkip: (i) => console.warn('stripe overage: allowance changed under a reported day', JSON.stringify(i)),
      })
    : null
  if (stripeUsageQueue !== null) await scheduleStripeUsage(stripeUsageQueue)
  // Audit MED #22: count tenants still being served past their entitlement floor. Runs whether or
  // not Stripe is configured — an expired self-serve trial is a lapse too, and the whole point is
  // that nothing anywhere counted these.
  const lapseSweepQueue = createLapseSweepQueue(recomputeConn)
  // The lapse LADDER (audit MED #22, founder policy): warn at grace-end, +1, +2, suspend on +3, and
  // restore the moment a payment lands. Enforcement needs all three of redis, mail and a link the
  // customer can click — without any of them the sweep degrades to counting, because cutting a fleet
  // off with no email first is worse than another day of unpaid storage.
  const lapseMail = {
    enqueueLapseEmail: async (job: { kind: 'lapse'; email: string; tenantId: string; locale: string; billingUrl: string; daysLeft: number }): Promise<void> => {
      await enqueueAuthEmail(authEmailQueue, job)
    },
  }
  const lapseSweepWorker = createLapseSweepWorker({
    connection: recomputeConn,
    db,
    redis,
    graceDays: graceDaysFromEnv(),
    // Truthiness, not `!== undefined`. `docker-compose.apps.yml` writes `APP_BASE_URL: ${APP_BASE_URL:-}`,
    // which passes an EMPTY STRING when the variable is unset — so the old test admitted a config in
    // which the ladder mails a customer three notices whose billing button renders as `#` (safeHref
    // rejects a relative URL) and then disconnects their fleet, while the COUNT-ONLY boot warning
    // stays silent because it tests `=== undefined` too. `graceDaysFromEnv` in the sweep already
    // rejects '' explicitly for this reason, and apps/api's own main.ts already uses truthiness here.
    ...(process.env['APP_BASE_URL']?.trim() && emailTransport !== undefined ? { appBaseUrl: process.env['APP_BASE_URL'].trim(), mail: lapseMail } : {}),
    onSwept: (r) => {
      prom.billingLapsedTenants.set(r.tenants)
      prom.billingLapsedDevices.set(r.devices)
      prom.billingLapsedActionable.set(r.actionable)
      prom.billingLapseAction.inc({ action: 'warned' }, r.warned)
      prom.billingLapseAction.inc({ action: 'suspended' }, r.suspended)
      prom.billingLapseAction.inc({ action: 'restored' }, r.restored)
    },
    onFailed: () => prom.jobFailed.inc({ job: 'lapse_sweep' }),
    // a lapsed customer we CANNOT reach: the ladder is blocked for them and their fleet will never
    // be suspended, which is correct and also means nothing resolves without a human
    onUnreachable: () => prom.billingLapseUnreachable.inc(),
  })
  await scheduleLapseSweep(lapseSweepQueue)
  // V1-nice: scheduled emailed reports — hourly cron runs due schedules + e-mails them. Only when
  // email is configured (no transport ⇒ nothing to send); reuses the same SES SMTP as notifications.
  const scheduledReportQueue = emailTransport !== undefined ? createScheduledReportQueue(recomputeConn) : null
  const scheduledReportWorker = emailTransport !== undefined
    ? startScheduledReportWorker({ connection: recomputeConn, db, pool, transport: emailTransport, onRun: (r) => prom.scheduledReportsSent.inc(r.emailed), onFailed: () => prom.jobFailed.inc({ job: 'scheduled_reports' }) })
    : null
  if (scheduledReportQueue !== null) await scheduleScheduledReports(scheduledReportQueue)
  // Data retention: daily prune of the webhook delivery-log (operational, grows unbounded)
  const retentionQueue = createRetentionQueue(recomputeConn)
  // empty-string / garbage env → the documented 30-day default (?? only catches undefined; '' → 0)
  const retentionEnv = Number(process.env['WEBHOOK_DELIVERY_RETENTION_DAYS'])
  const retentionWorker = startRetentionWorker({
    connection: recomputeConn,
    db,
    retentionDays: Number.isFinite(retentionEnv) && retentionEnv > 0 ? retentionEnv : 30,
    rejectRetentionDays: Number(process.env['RAW_REJECT_RETENTION_DAYS']) || 90,
    billingEventRetentionDays: Number(process.env['BILLING_EVENT_RETENTION_DAYS']) || 90,
    // derived LOCATION data — must track the positions hypertable's 13-month policy and the privacy
    // text that promises it. `|| LOCATION_RETENTION_DAYS` also catches a 0, which would otherwise
    // mean "delete everything" on the next tick.
    locationRetentionDays: Number(process.env['LOCATION_RETENTION_DAYS']) || LOCATION_RETENTION_DAYS,
    tokenRetentionDays: Number(process.env['TOKEN_RETENTION_DAYS']) || 30,
    unverifiedSignupDays: Number(process.env['UNVERIFIED_SIGNUP_RETENTION_DAYS']) || 30,
    ...(process.env['RETENTION_CONFIRM_SHORT'] !== undefined ? { confirmShortWindow: process.env['RETENTION_CONFIRM_SHORT'] } : {}),
    onPruned: (table, n) => prom.retentionPruned.inc({ table }, n),
    // the hook existed and nothing wired it: a retention sweep that throws every hour was
    // completely invisible, while positions/webhook_deliveries grew past their policy (audit MED)
    onFailed: () => prom.jobFailed.inc({ job: 'retention' }),
  })
  await scheduleRetentionSweep(retentionQueue)
  // Reject drain: move §3.6 sanity failures from the `rejects` stream into `raw_rejects` so support
  // can name the device instead of reading one global counter (audit MED). Ingest cannot reach
  // Postgres (hard rule 3) and nothing was consuming the stream, so a rejection survived only until
  // MAXLEN rolled over it — while `raw_rejects` sat in the schema from day one with no writer.
  const rejectDrainQueue = createRejectDrainQueue(recomputeConn)
  const rejectDrainWorker = startRejectDrainWorker({
    connection: recomputeConn,
    redis: offlineRedis,
    db,
    onDrained: (n) => {
      if (n > 0) prom.rejectsDrained.inc(n)
    },
    onDropped: (n) => prom.rejectsDropped.inc(n),
    ...(process.env['RAW_REJECT_DRAIN_MAX_PER_TICK'] !== undefined
      ? { maxPerTick: Number(process.env['RAW_REJECT_DRAIN_MAX_PER_TICK']) }
      : {}),
    onFailed: () => prom.jobFailed.inc({ job: 'reject-drain' }),
  })
  await scheduleRejectDrain(rejectDrainQueue)
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
    // the sweep also removes abandoned .tmp exports — a deploy landing mid-export leaves a full
    // personal-data dump on the shared volume that nothing else would ever delete
    exportDir: process.env['EXPORT_DIR'] ?? 'var/exports',
    onSwept: (n) => console.log(`gdpr export sweep: removed ${n} file(s)`),
    onOrphanTmp: (n) => {
      prom.gdprOrphanTmp.inc(n)
      console.warn(`gdpr export sweep: reaped ${n} ABANDONED .tmp export(s) — a killed process left a full personal-data dump behind`)
    },
  })
  await scheduleExportSweep(gdprSweepQueue)
  // Create + start a consumer for ONE shard. Reused by the initial claim AND by the leaser's
  // onGained callback (a shard recovered after a lost lease / a dead peer's expired one).
  /**
   * Compensating recomputes whose enqueue failed, retried on the next batch WITH THEIR OWN WINDOW.
   *
   * Not folded into the trip engine's `late` set: that set is drained through a window capped at
   * `now − RECOMPUTE_GUARD_MS`, which is precisely the window that cannot rebuild a close that just
   * happened — so re-arming there would retry forever through the path the code already documents
   * as useless for this case. Keyed by device, widest window wins.
   */
  const pendingCompensation = new Map<string, { deviceId: bigint; from: Date; to: Date }>()

  const makeConsumer = (s: number, conn: Redis): ShardConsumer =>
    new ShardConsumer(s, {
      onDeadLetter: (reason, n) => prom.deadLettered.inc({ reason }, n),
      onPendingEvicted: (shard, n) => prom.pendingEvicted.inc({ shard: String(shard) }, n),
      onFieldNulled: (field) => prom.fieldNulled.inc({ field }),
      onAvlFallback: (reason) => prom.avlFallback.inc({ reason }),
      redis: conn,
      pool,
      hash,
      workerId,
      // fencing (I2 / rule 5): before applying each batch the consumer confirms it STILL owns the
      // shard's lease — a stall/partition that let a peer claim the shard stops this consumer instead
      // of double-processing the same device. Checked on the consumer's own conn (serial with its reads).
      ownsShard: () => ownsShardLease(conn, s, workerId),
      onLostOwnership: (shard) => {
        // fenced mid-flight: tear down through the SAME per-shard queue the leaser uses, so a later
        // re-acquire cannot start a second consumer while this one is still finishing its batch.
        stopShardConsumer(shard)
      },
      onBatch: async (records) => {
        prom.batchRows.observe(records.length)
        // `usable` = records the pipeline will actually ACT on. A clock-skewed record's fixTime is
        // in the FUTURE, so it must not feed anything derived from fix time — including the
        // device_data_age gauge below, which would otherwise read 0 and mask a genuinely stale fleet.
        const usable = records.filter((r) => !isClockSkewed(r))
        const skewed = records.length - usable.length
        if (skewed > 0) {
          prom.clockSkewed.inc(skewed)
          // WHICH device — the counter alone cannot answer the alert's own instruction, and a
          // skewed device is otherwise simply absent from the map with no per-device trace.
          // Once per device per process lifetime: an episode is a firmware/RTC fault, not an event.
          for (const r of records) {
            const dev = r.deviceId.toString()
            if (!isClockSkewed(r) || warnedSkew.has(dev)) continue
            warnedSkew.add(dev)
            console.warn(
              `device ${dev} clock is ahead of server time (fix ${r.fixTime.toISOString()} vs ${r.serverTime.toISOString()}) — excluded from live state, trips and geofences until its RTC is fixed`,
            )
          }
        }
        // PIPELINE lag is measured on server_time — the instant ingest accepted the frame — not on
        // fix_time (audit MED). fix_time is the DEVICE's clock plus however long it buffered, so a
        // truck returning from a weekend in a garage paged a false critical, and a device whose RTC
        // runs fast pinned the gauge at 0 and hid real lag. Both views are exported now; only this
        // one answers "is the pipeline keeping up".
        const newestServerMs = records.reduce((m, r) => Math.max(m, r.serverTime.getTime()), 0)
        if (newestServerMs > 0) prom.setLagMs(Math.max(0, Date.now() - newestServerMs))
        const newestMs = usable[usable.length - 1]?.fixTime.getTime()
        if (newestMs !== undefined) prom.setDataAgeMs(Math.max(0, Date.now() - newestMs))
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
            try {
              const { opened, closed, missed } = await tripPersister.apply(tripEvents, s)
              prom.tripsOpened.inc(opened)
              prom.tripsClosed.inc(closed)
              // A close the persister could not attribute to an open row. Not fatal on its own —
              // the id guard exists so a replay is idempotent — but never normal, and it is the
              // only outward sign of a whole class of bug (a forgotten or overwritten open-trip id)
              // that otherwise looks exactly like success.
              if (missed > 0) prom.tripCloseMissed.inc(missed)
            } catch (err) {
              // The engine has already emitted these events and dropped the trips from memory, so a
              // swallowed failure loses every CLOSE in the batch with nothing to notice — the trips
              // are simply absent from history (audit MED). The positions behind them ARE durable
              // (I1/I3), so ask for a rebuild.
              //
              // Enqueued DIRECTLY, not via the late-signal drain below, because that drain caps `to`
              // at `now − RECOMPUTE_GUARD_MS` and pads the read by only a stop-threshold margin — a
              // close that just happened sits INSIDE that gap, so the compensating job would read no
              // confirming records and rebuild nothing. Window: the batch's own span, out to the
              // newest end plus the settle guard, deferred until that edge has settled.
              // one job PER DEVICE — a batch spans a whole shard, and a window welded across
              // several devices would be both wrong and enormous
              const spans = new Map<string, { deviceId: bigint; first: Date; last: Date }>()
              for (const ev of tripEvents) {
                const end = ev.type === 'close' ? ev.endTime : ev.startTime
                const cur = spans.get(ev.deviceId.toString())
                if (cur === undefined) spans.set(ev.deviceId.toString(), { deviceId: ev.deviceId, first: ev.startTime, last: end })
                else {
                  if (ev.startTime < cur.first) cur.first = ev.startTime
                  if (end > cur.last) cur.last = end
                }
              }
              for (const sp of spans.values()) {
                const to = new Date(sp.last.getTime() + RECOMPUTE_GUARD_MS)
                try {
                  await enqueueRecompute(recomputeQueue, sp.deviceId, sp.first, to, { delayMs: RECOMPUTE_GUARD_MS })
                } catch {
                  // even the enqueue failed (Redis is down too) — park it and retry NEXT batch with
                  // this same window, widening if another failure lands first
                  const key = sp.deviceId.toString()
                  const prev = pendingCompensation.get(key)
                  pendingCompensation.set(key, {
                    deviceId: sp.deviceId,
                    from: prev !== undefined && prev.from < sp.first ? prev.from : sp.first,
                    to: prev !== undefined && prev.to > to ? prev.to : to,
                  })
                }
              }
              prom.tripPersistErrors.inc()
              console.error('tripPersist', err)
            }
          }
          if (transitions.length > 0) {
            // persist() dedups a redelivered/replayed crossing and returns ONLY the freshly-written
            // transitions — enqueue a webhook per returned one so a replay re-fires neither the event
            // row nor its webhook (E06-4). Geofence events carry no ruleId → no rule/notify path.
            // OWN try (audit C1): a persist failure must roll the engine's in-memory side-flip back
            // so a still-present crossing re-fires next batch — the outer swallow would instead lose
            // it forever AND skip the rule engine below. persist() already released its dedup claim.
            let persisted: GeofenceTransition[] | null = null
            try {
              persisted = await geofenceEvents.persist(transitions)
            } catch (err) {
              motionFeed.geofenceEngine.rollback(transitions)
              prom.enginePersistErrors.inc({ engine: 'geofence' })
              console.error('geofencePersist', err)
            }
            if (persisted !== null) {
              prom.geofenceEvents.inc(persisted.length)
              for (const tr of persisted) {
                await emitWebhook({ deviceId: tr.deviceId, kind: 'geofence', at: tr.at, payload: { geofenceId: tr.geofenceId, name: tr.geofenceName, transition: tr.type }, dedupe: `${tr.geofenceId}:${tr.type}` })
              }
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
              // capture pre-feed in-memory IO so a persist failure can roll the batch's advance back
              // (audit C1) — else the engine's last-IO advances past durable state and a SUSTAINED
              // edge is never re-detected. Captured BEFORE feed() mutates the engine.
              const preFeed = new Map<string, DeviceIo>()
              for (const key of ruleDevices) {
                const s = ruleEngine.snapshot(BigInt(key))
                if (s !== undefined) preFeed.set(key, s)
              }
              const ruleEvents = ruleEngine.feed(records, (id) => rules.get(id.toString()) ?? [], ioStateFor)
              // Persist events BEFORE saving IO state. If the worker crashes in the
              // ACK-replay window, un-saved IO state means the replay warm-starts the OLD
              // value and RE-FIRES the edge (non-bypass edges are then suppressed by the
              // already-set cooldown key ⇒ idempotent; panic/power_cut may double-fire —
              // "doubled beats missed", §6.5). Saving IO state first would instead SUPPRESS
              // the replay edge → a missed panic. Order matters (review HIGH-1).
              let persistOk = true
              if (ruleEvents.length > 0) {
                try {
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
                } catch (err) {
                  // persist failed → roll the in-memory IO advance back so a sustained edge re-fires
                  // next batch (audit C1). Skip saveIoState so durable state stays pre-batch too —
                  // else in-memory (rolled back) and durable (advanced) diverge and suppress re-fire.
                  persistOk = false
                  ruleEngine.rollbackIo(preFeed, ruleDevices)
                  prom.enginePersistErrors.inc({ engine: 'rule' })
                  console.error('rulePersist', err)
                }
              }
              // advance durable IO state so the NEXT batch / a clean restart warm-starts — but ONLY
              // when the batch's events were durably persisted (or there were none). On a persist
              // failure we rolled the in-memory advance back, so durable must NOT advance either.
              if (persistOk) {
                const snapshots = new Map<string, DeviceIo>()
                for (const key of ruleDevices) {
                  const snap = ruleEngine.snapshot(BigInt(key))
                  if (snap !== undefined) snapshots.set(key, snap)
                }
                await rulePersister.saveIoState(snapshots)
              }
            }
          } catch (err) {
            console.error('ruleEngine', err)
          }
          // retry any compensating recompute whose enqueue failed in an earlier batch, with the
          // window it actually needs (see pendingCompensation)
          for (const [key, pc] of [...pendingCompensation]) {
            try {
              await enqueueRecompute(recomputeQueue, pc.deviceId, pc.from, pc.to, { delayMs: RECOMPUTE_GUARD_MS })
              pendingCompensation.delete(key)
            } catch {
              /* still down — keep it parked */
            }
          }
          // any out-of-order (late) records the engine dropped → reconcile from durable
          // positions off the hot path (positions are already written by the consumer).
          // Bound recompute to SETTLED history (to = now − guard, guard > max stop window)
          // so it can never delete/clobber the live open trip the streaming persister owns.
          const nowMs = Date.now()
          const settledTo = new Date(nowMs - RECOMPUTE_GUARD_MS)
          for (const { deviceId, from } of motionFeed.tripEngine.takeLate()) {
            // per-item guard: one enqueue failure must not drop the other devices' signals
            try {
              if (from >= settledTo) {
                // late data still WITHIN the live edge: the streaming engine dropped it, so it
                // would otherwise be reconciled by nothing (takeLate cleared the signal). Defer a
                // recompute until its window settles (from+guard) instead of discarding it (review
                // MED). recompute rebuilds only CLOSED trips, so the delayed job never races the
                // live open trip the streaming persister owns.
                const settleAt = new Date(from.getTime() + RECOMPUTE_GUARD_MS)
                await enqueueRecompute(recomputeQueue, deviceId, from, settleAt, { delayMs: settleAt.getTime() - nowMs })
              } else {
                await enqueueRecompute(recomputeQueue, deviceId, from, settledTo)
              }
            } catch (e) {
              // takeLate() already CLEARED the signal, so dropping it here means nothing ever
              // reconciles that window. Put it back for the next batch (audit MED).
              motionFeed.tripEngine.markLate(deviceId, from)
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
  // dedicated connection PER consumer: XREADGROUP BLOCK serializes every queued command behind it
  // on a shared ioredis socket — 16 idle consumers made a full read round take ~16×blockMs (>30 s),
  // starving the leaser's renewal GETs on the same socket until every lease expired on an IDLE
  // worker (found live in E02-6; log signature: "lease lost" for shards 1..15 but never shard 0).
  startShardConsumer = (s: number): void =>
    runShardOp(s, async () => {
      // re-checked INSIDE the queued op: by the time a pending stop() has drained, another
      // onGained may already have started one (idempotent against a duplicate onGained)
      if (consumersByShard.has(s)) return
      const conn = redis.duplicate()
      const c = makeConsumer(s, conn)
      try {
        // ensureGroup FIRST, and only then claim the slot: mapping the consumer before it is
        // running meant a failed XGROUP CREATE (Redis blip, MISCONF) left the shard
        // mapped-but-never-started. Every later start short-circuits on `has(s)`, onGained only
        // fires on an unowned→owned TRANSITION, and the lease keeps renewing so onLost never
        // fires either — the shard is silently dead forever while MAXLEN trims its backlog unread.
        await c.ensureGroup()
      } catch (err) {
        conn.disconnect()
        // RELEASE the lease (not just the local Set): the Redis key still names us and would stop
        // being renewed, so neither we nor a peer could take the shard until the 30 s TTL expired.
        // giveUp() DELs it holder-checked, so the next tick re-claims and re-fires onGained.
        await leaser.giveUp(s)
        throw err
      }
      consumerConnByShard.set(s, conn)
      consumersByShard.set(s, c)
      // A shard ACQUIRED later (peer died, our lease recovered) carries open trips whose ids this
      // process does not hold — without this, every close for them is dropped ("no known open row")
      // and the rows are stranded exactly as they were on a cold restart (review high).
      await tripPersister.warmStart([s], SHARD_COUNT).catch((err: unknown) => {
        console.error(`shard ${s} trip warm-start failed (continuing)`, err)
        return 0
      })
      c.start()
    })
  // BEFORE any consumer runs: reload the open-trip ids this process is about to be responsible for,
  // and finalize the ones whose device never came back. Without the warm start a close arriving
  // after a restart finds no known id and is dropped, stranding the row; without the sweep, rows
  // from devices that never return stay open forever and `engineHours` bills them to now() (audit
  // high). Both are best-effort: a failure here must never stop the pipeline from starting.
  const ownedShards = [...shards]
  // WARM START before consuming: a close arriving for a trip this process did not open would
  // otherwise be dropped ("no known open row") and strand the row. Bounded and per-shard.
  try {
    const warmed = await tripPersister.warmStart(ownedShards, SHARD_COUNT)
    if (warmed > 0) console.log(`trips: warm-started ${warmed} open`)
  } catch (err) {
    console.error('trip warm-start failed (continuing)', err)
  }

  for (const s of shards) startShardConsumer(s)

  // …and sweep the rows whose device never came back AFTER the pipeline is running: the first
  // deploy carrying this sees every historically-stranded row at once, and nothing about it is
  // urgent enough to hold ingest's backlog while it runs (review MED).
  void (async () => {
    try {
      const swept = await tripPersister.closeOrphans(ORPHAN_TRIP_MAX_IDLE_MS, ownedShards, SHARD_COUNT)
      if (swept > 0) console.log(`trips: closed ${swept} orphaned`)
    } catch (err) {
      console.error('trip orphan sweep failed (continuing)', err)
    }
  })()

  // Graceful drain (§6.1 deploy protocol): finish current batch, XACK, release leases <5 s
  process.on('SIGTERM', () => {
    void (async () => {
      leaser.stopRenewing() // stop re-acquiring so this worker doesn't re-grab a shard mid-drain
      // settle any queued start/stop first — otherwise a start still sitting in the chain begins
      // AFTER releaseLeases() and consumes a shard a peer now owns (the consumer's ownsShard()
      // fencing catches it before any durable effect, but the drain contract should hold on its own)
      // bounded: a queued stop can be waiting out SHARD_STOP_TIMEOUT_MS, which is longer than the
      // §6.1 hard-exit budget — releasing the leases matters more than settling the queue
      await Promise.race([
        Promise.all([...shardOps.values()]),
        new Promise<unknown>((r) => setTimeout(r, 2_000)),
      ])
      await Promise.all([...consumersByShard.values()].map((c) => c.stop())) // drain in-flight batches
      await leaser.releaseLeases() // free leases AFTER draining — else a peer claims a shard we're
      // still persisting and processes the same device concurrently (rule 5 / I2, review HIGH)
      await recomputeWorker.close() // finish the in-flight recompute job, stop taking new
      await recomputeQueue.close()
      await offlineWorker.close() // finish the in-flight sweep, stop taking new
      await offlineQueue.close()
      await notifyWorker.close() // finish the in-flight notification, stop taking new
      await notifyQueue.close()
      await authEmailWorker.close() // finish the in-flight auth email, stop taking new (ADR-031)
      await smsWorker?.close() // finish the in-flight SMS send, stop taking new (SMS gateway)
      await webhookWorker.close() // finish the in-flight webhook delivery, stop taking new
      await webhookQueue.close()
      await usageWorker.close() // finish the in-flight usage sweep, stop taking new
      await usageQueue.close()
      await stripeUsageWorker?.close() // finish the in-flight overage report, stop taking new
      await stripeUsageQueue?.close()
      await lapseSweepWorker.close() // finish the in-flight lapse sweep, stop taking new
      await lapseSweepQueue.close()
      await authEmailQueue.close()
      await scheduledReportWorker?.close() // finish the in-flight scheduled-report run, stop taking new
      await scheduledReportQueue?.close()
      await rejectDrainWorker.close()
      await rejectDrainQueue.close()
      await retentionWorker.close() // finish the in-flight retention prune, stop taking new
      await retentionQueue.close()
      await commandWorker.close() // finish the in-flight command dispatch, stop taking new
      await commandQueue.close()
      await gdprEraseWorker.close() // finish the in-flight erase step, stop taking new
      await gdprExportWorker.close() // finish the in-flight export, stop taking new
      await gdprSweepWorker.close()
      await gdprSweepQueue.close()
      offlineRedis.disconnect()
      consumerConnByShard.forEach((c) => c.disconnect())
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
