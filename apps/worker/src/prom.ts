import { createServer, type Server } from 'node:http'
import type { Redis } from 'ioredis'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'

import { PIPELINE_GROUP, SHARD_COUNT } from './shards.js'

/**
 * Prometheus exposition for the worker (E02-5). Frozen names per Appendix A:
 * stream_depth{shard}, pipeline_lag_ms, pipeline_batch_rows. E04-1 adds
 * trips_opened_total / trips_closed_total.
 */
export interface WorkerProm {
  registry: Registry
  batchRows: Histogram
  /** Call per processed batch with now − max(fix_time) of the batch. */
  setLagMs: (ms: number) => void
  tripsOpened: Counter
  tripsClosed: Counter
  tripPersistErrors: Counter
  tripRecomputes: Counter
  tripRecomputeDeleted: Counter
  /** Recomputes whose requested window exceeded the width cap — the tail was not rebuilt. */
  tripRecomputeTruncated: Counter
  geofenceEvents: Counter
  ruleEvents: Counter
  /** geofence/rule transition writes that failed → in-memory engine state rolled back so a
   *  sustained crossing/edge re-fires from the next batch (audit C1). Non-zero rate ⇒ alert. */
  enginePersistErrors: Counter
  notificationSent: Counter
  notificationFailed: Counter
  notificationSkipped: Counter
  smsSent: Counter
  smsFailed: Counter
  webhookDelivered: Counter
  webhookFailed: Counter
  usageDeviceDays: Counter
  usageSweepFailed: Counter
  /** Entries moved to `raw:dead` by reason. A poison row is otherwise indistinguishable from a
   *  quiet fleet — the audit's "catch-and-continue with no signal" pattern. Non-zero ⇒ alert. */
  deadLettered: Counter
  /** Background jobs that THREW, by job name. Several workers exposed an onFailed hook that
   *  nothing wired, and several exposed none at all — a job failing every run was invisible. */
  jobFailed: Counter
  /** Fields normalization had to null because the value did not fit its column. Non-zero ⇒ a
   *  firmware quirk or spoofed frames; the position is kept, the field is not. */
  fieldNulled: Counter
  /** Records excluded from LIVE state / the motion engines because the device clock runs ahead of
   *  the server's. The row is still written; it just does not move state. Non-zero ⇒ a fleet with a
   *  drifting RTC, whose live map and offline alerts would otherwise be silently wrong. */
  clockSkewed: Counter
  stripeOverageReported: Counter
  scheduledReportsSent: Counter
  retentionPruned: Counter
  /** §3.6 sanity failures moved from the `rejects` stream into `raw_rejects` (audit MED #46). */
  rejectsDrained: Counter
  /** Windows the drain could not read because the stream was trimmed past its cursor. */
  rejectsDropped: Counter
  /** Abandoned `.tmp` export dumps reaped — never a routine expiry. */
  gdprOrphanTmp: Counter
  commandsResolved: Counter
  gdprErased: Counter
  gdprExported: Counter
  gdprFailed: Counter
  server: Server
}

/**
 * Unconsumed backlog for a shard: `lag` (added but not yet delivered) + `pending` (delivered, not yet
 * acked). Deliberately NOT XLEN — see the gauge comment. This mirrors `shardBacklog` in
 * apps/ingest/src/session.ts, which drives backpressure; the two MUST agree or ingest will pause on a
 * number the dashboard never shows. Duplicated rather than imported: the worker does not depend on
 * the ingest package and a metric is not worth creating that coupling. `backlog.spec.ts` asserts the
 * two copies and consumer.ts's GROUP stay identical — if the group name ever diverges BOTH fall
 * through to XLEN, silently reinstating the permanent-latch bug this replaced.
 */
export async function shardBacklog(redis: Redis, shard: number): Promise<number> {
  const stream = `raw:${shard}`
  let groups: unknown[]
  try {
    groups = (await redis.xinfo('GROUPS', stream)) as unknown[]
  } catch (err) {
    if (err instanceof Error && /no such key/i.test(err.message)) return 0 // stream not created yet
    throw err // WRONGTYPE / ACL / MISCONF must surface, not read as "no backlog"
  }
  for (const g of groups) {
    const flat = g as unknown[]
    // walk PAIRS — indexOf would also match a value (a group named `lag` breaks the lookup)
    const at = (k: string): unknown => {
      for (let i = 0; i + 1 < flat.length; i += 2) if (flat[i] === k) return flat[i + 1]
      return undefined
    }
    if (at('name') !== PIPELINE_GROUP) continue
    const lagRaw = at('lag')
    const pendingRaw = Number(at('pending') ?? 0)
    const pend = Number.isFinite(pendingRaw) ? pendingRaw : 0
    if (lagRaw !== null && lagRaw !== undefined) return Number(lagRaw) + pend
    return Math.max(pend, await redis.xlen(stream)) // lag uncomputable after XDEL / XGROUP SETID
  }
  return await redis.xlen(stream) // no group yet ⇒ nothing consuming ⇒ all retained is backlog
}

export function startWorkerProm(redis: Redis, port: number): WorkerProm {
  const registry = new Registry()

  new Gauge({
    name: 'stream_depth',
    // NOT XLEN: XACK does not delete stream entries and nothing trims raw:{shard} (it is written with
    // MAXLEN ~100k), so XLEN climbs to that plateau and never returns — it measures retention, not
    // backlog, and made both this alert and ingest's backpressure latch permanently. `lag` + pending
    // is the real queue depth and returns to 0 when the worker keeps up. Same probe ingest uses.
    help: 'raw:{shard} unconsumed backlog (consumer-group lag + pending)',
    labelNames: ['shard'],
    registers: [registry],
    async collect() {
      const depths = await Promise.all(
        Array.from({ length: SHARD_COUNT }, (_, s) => shardBacklog(redis, s).catch(() => null)),
      )
      depths.forEach((d, s) => {
        if (d !== null) this.set({ shard: String(s) }, d)
      })
    },
  })

  const lag = new Gauge({
    name: 'pipeline_lag_ms',
    help: 'now − max(fix_time) of the last processed batch (Grafana derives p95)',
    registers: [registry],
  })

  const batchRows = new Histogram({
    name: 'pipeline_batch_rows',
    help: 'rows per INSERT batch',
    buckets: [1, 10, 50, 100, 200, 500],
    registers: [registry],
  })

  const tripsOpened = new Counter({ name: 'trips_opened_total', help: 'trips opened by the state machine (E04-1)', registers: [registry] })
  const tripsClosed = new Counter({ name: 'trips_closed_total', help: 'trips closed by the state machine (E04-1)', registers: [registry] })
  // streaming trip persistence is advisory (E04-2 recompute is authoritative); a
  // non-zero rate here means trips are being dropped from the stream path → alert.
  const tripPersistErrors = new Counter({ name: 'trip_persist_errors_total', help: 'trip open/close DB writes that failed (advisory; E04-2 recompute reconciles)', registers: [registry] })
  const tripRecomputes = new Counter({ name: 'trip_recompute_total', help: 'trip-recompute jobs applied (E04-2 late-batch reconciliation)', registers: [registry] })
  const tripRecomputeDeleted = new Counter({ name: 'trip_recompute_deleted_total', help: 'trip rows deleted-and-replayed by recompute', registers: [registry] })
  const tripRecomputeTruncated = new Counter({ name: 'trip_recompute_truncated_total', help: 'recomputes whose window exceeded the width cap — the older tail was NOT rebuilt (operator backfill needed)', registers: [registry] })
  const geofenceEvents = new Counter({ name: 'geofence_events_total', help: 'geofence enter/exit transition events written (E05-2)', registers: [registry] })
  const ruleEvents = new Counter({ name: 'rule_events_total', help: 'rule events written by kind (E05-4)', labelNames: ['kind'], registers: [registry] })
  // a transient DB error persisting a geofence/rule transition rolls back in-memory engine state so
  // a SUSTAINED crossing/edge re-fires next batch (audit C1). Non-zero rate ⇒ investigate the DB.
  const enginePersistErrors = new Counter({ name: 'engine_persist_errors_total', help: 'geofence/rule transition writes that failed → engine state rolled back for re-fire (audit C1)', labelNames: ['engine'], registers: [registry] })
  const notificationSent = new Counter({ name: 'notification_sent_total', help: 'notifications delivered by channel (E05-5)', labelNames: ['channel'], registers: [registry] })
  const notificationFailed = new Counter({ name: 'notification_failed_total', help: 'notification delivery failures by channel (retried by BullMQ)', labelNames: ['channel'], registers: [registry] })
  const notificationSkipped = new Counter({ name: 'notification_skipped_total', help: 'notifications skipped by reason (e.g. unconfigured channel)', labelNames: ['reason'], registers: [registry] })
  const smsSent = new Counter({ name: 'sms_sent_total', help: 'config/command SMS delivered to the provider (SMS gateway)', registers: [registry] })
  const smsFailed = new Counter({ name: 'sms_failed_total', help: 'SMS sends that failed (transient → retried by BullMQ; permanent → terminal)', registers: [registry] })
  const webhookDelivered = new Counter({ name: 'webhook_delivered_total', help: 'webhook deliveries that returned 2xx (E06-4)', registers: [registry] })
  const webhookFailed = new Counter({ name: 'webhook_failed_total', help: 'webhook delivery attempts that failed (retried by BullMQ)', registers: [registry] })
  const usageDeviceDays = new Counter({ name: 'usage_device_days_total', help: 'billable device-day rows written by the usage sweep (E07-4)', registers: [registry] })
  // a stalled metering pipeline is silent under-billing — alert on any non-zero rate
  const deadLettered = new Counter({ name: 'pipeline_dead_lettered_total', help: 'stream entries quarantined to raw:dead by reason (malformed payload | rejected by postgres)', labelNames: ['reason'], registers: [registry] })
  const fieldNulled = new Counter({ name: 'positions_field_nulled_total', help: 'position fields nulled because the value did not fit its column (firmware quirk / spoof)', labelNames: ['field'], registers: [registry] })
  const jobFailed = new Counter({ name: 'worker_job_failed_total', help: 'background job runs that threw, by job (retention | scheduled_reports | stripe_usage | …)', labelNames: ['job'], registers: [registry] })
  const clockSkewed = new Counter({ name: 'positions_clock_skewed_total', help: 'records whose device clock ran ahead of server time — kept in positions, excluded from live state and the motion engines', registers: [registry] })
  const usageSweepFailed = new Counter({ name: 'usage_sweep_failed_total', help: 'usage sweeps that threw (billing pipeline stalled — investigate)', registers: [registry] })
  const stripeOverageReported = new Counter({ name: 'stripe_overage_reported_total', help: 'tenants for which device overage was reported to the Stripe meter (ADR-024 PR B2)', registers: [registry] })
  const scheduledReportsSent = new Counter({ name: 'scheduled_reports_sent_total', help: 'scheduled report emails sent (V1-nice)', registers: [registry] })
  const retentionPruned = new Counter({ name: 'retention_pruned_total', help: 'rows pruned by the daily retention sweep, by table', labelNames: ['table'], registers: [registry] })
  const rejectsDrained = new Counter({ name: 'rejects_drained_total', help: 'sanity-rejected records persisted from the rejects stream into raw_rejects', registers: [registry] })
  const gdprOrphanTmp = new Counter({ name: 'gdpr_orphan_tmp_removed_total', help: 'abandoned .tmp export dumps reaped by the sweep (a killed process left a full personal-data export behind)', registers: [registry] })
  const rejectsDropped = new Counter({ name: 'rejects_dropped_total', help: 'reject-stream windows lost because MAXLEN trimmed past the drain cursor', registers: [registry] })
  const commandsResolved = new Counter({ name: 'commands_resolved_total', help: 'Codec-12 commands resolved by the dispatcher (E08-2)', labelNames: ['outcome'], registers: [registry] })
  const gdprErased = new Counter({ name: 'gdpr_erase_total', help: 'GDPR device-erase cascades completed (E08-4)', registers: [registry] })
  const gdprExported = new Counter({ name: 'gdpr_export_total', help: 'GDPR account exports completed (E08-4)', registers: [registry] })
  const gdprFailed = new Counter({ name: 'gdpr_job_failed_total', help: 'GDPR jobs that threw (retried by BullMQ)', labelNames: ['job'], registers: [registry] })

  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end()
      return
    }
    registry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'content-type': registry.contentType }).end(body)
      })
      .catch(() => res.writeHead(500).end())
  })
  server.on('error', (err) => {
    // metrics must NEVER take down the data plane (e.g. EADDRINUSE on co-located workers)
    console.error('metrics listener failed', err)
  })
  server.listen(port)
  return { registry, batchRows, setLagMs: (ms) => lag.set(ms), tripsOpened, tripsClosed, tripPersistErrors, tripRecomputes, tripRecomputeDeleted, tripRecomputeTruncated, geofenceEvents, ruleEvents, enginePersistErrors, notificationSent, notificationFailed, notificationSkipped, smsSent, smsFailed, webhookDelivered, webhookFailed, usageDeviceDays, usageSweepFailed, deadLettered, fieldNulled, clockSkewed, jobFailed, stripeOverageReported, scheduledReportsSent, retentionPruned, rejectsDrained, rejectsDropped, gdprOrphanTmp, commandsResolved, gdprErased, gdprExported, gdprFailed, server }
}
