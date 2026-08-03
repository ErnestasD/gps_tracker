import { Worker, type ConnectionOptions } from 'bullmq'
import type { Pool } from 'pg'

import { USAGE_QUEUE } from './usageQueue.js'

/**
 * Usage-metering sweep (E07-4). Sources billable device-days from POSITIONS — the
 * authoritative record — not from the live registry's last-fix (review HIGH: a last-fix
 * snapshot loses days deterministically, e.g. a trip crossing UTC midnight overwrites the
 * old day's fix before the next sweep sees it, and a worker outage spanning midnight drops
 * the whole fleet's day). One INSERT…SELECT:
 *
 *   every UTC day a device has ≥1 position row in the lookback window → a usage_daily row,
 *   scoped from the devices table (tenant/account at insert time).
 *
 * Semantics (billing, §6.9): device-day = "the device reported at least once during that
 * UTC day" — including invalid fixes (§3.4: presence), which is why this reads raw positions
 * and NOT the fix_valid-filtered daily_device_stats cagg. UTC on purpose: billing periods
 * are timezone-stable; account-TZ is a display concern (§7.7).
 *
 * Idempotent: PK (deviceId, day) + ON CONFLICT DO NOTHING — hourly re-sweeps, replicas, and
 * overlapping windows can never double-count. The 48 h lookback also BACKFILLS a worker
 * outage up to that long; a longer outage needs a manual sweep with a wider lookback (the
 * param exists for exactly that — month-close reconciliation can run lookback=35 d).
 * Attribution rule: the day bills to the tenant/account owning the device AT SWEEP TIME;
 * a physical tracker re-claimed cross-tenant mid-day is a NEW device row, so both tenants
 * are billed their own device-day for that date (each used it — documented, §6.9).
 */
const LOOKBACK_MS = 48 * 3_600_000
// How much OLDER than the server_time (receive) window a buffered fix may reach. A record received in
// the lookback window can carry a fix_time up to this much earlier (the device's on-board buffer), so
// the fix_time floor = serverSince − this. It scales WITH the lookback: a wider month-close lookback
// widens BOTH windows, so reconciliation of old months (and >35d buffered flushes via that sweep) is
// recoverable. Also bounds the chunk scan + rejects garbage device clocks (e.g. epoch 1970).
const FIX_TIME_BUFFER_MS = 35 * 24 * 3_600_000
// The erase-time capture must reach the whole retained history (positions are dropped at ~13 months),
// so its fix_time clamp is wider — still bounded to reject an epoch-clock garbage day.
const RETENTION_CLAMP_MS = 400 * 24 * 3_600_000

export interface UsageWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  onSwept?: (rowsWritten: number) => void
  onFailed?: () => void
}

/** Run one sweep. Returns rows written (new device-days only). */
export async function runUsageSweep(pool: Pool, nowMs: number, lookbackMs = LOOKBACK_MS): Promise<number> {
  // Window on server_time (ingest RECEIVE time) — a device that buffered while offline flushes
  // old-fix_time records on reconnect; windowing on fix_time (audit P4) missed those beyond the
  // lookback → silent under-billing. server_time is always ≈ ingestion time, so a recent flush is
  // caught regardless of how old the fix is (BRIN-indexed: migration 003). The DAY still buckets by
  // fix_time — the day the device was actually USED — so a multi-day buffer correctly bills each
  // distinct day, not one lump. fix_time is clamped to a sane window (chunk exclusion + garbage-clock
  // rejection); an event with an absurd fix_time never fabricates a device-day.
  const serverSince = new Date(nowMs - lookbackMs)
  const serverUntil = new Date(nowMs + 3_600_000) // tolerate ≤1h ingest-host clock skew
  // scale the fix_time floor with the lookback so a wider (month-close) sweep reaches proportionally
  // further back — a record received in [serverSince, now] can carry a fix up to FIX_TIME_BUFFER_MS older
  const fixFloor = new Date(nowMs - lookbackMs - FIX_TIME_BUFFER_MS)
  const fixCeil = new Date(nowMs + 3_600_000) // reject a future device clock fabricating tomorrow's day
  const res = await pool.query(
    `INSERT INTO usage_daily ("tenantId","accountId","deviceId",day)
     SELECT d."tenantId", d."accountId", p.device_id, p.day
     FROM (SELECT DISTINCT device_id, (fix_time AT TIME ZONE 'UTC')::date AS day
           FROM positions
           WHERE server_time >= $1 AND server_time < $2
             AND fix_time >= $3 AND fix_time < $4) p
     JOIN devices d ON d.id = p.device_id
     ON CONFLICT ("deviceId",day) DO NOTHING`,
    [serverSince, serverUntil, fixFloor, fixCeil],
  )
  return res.rowCount ?? 0
}

/**
 * Capture ALL of one device's billable days BEFORE its positions are erased (audit P4 / GDPR). The
 * hourly sweep sources from positions, so a device erased between sweeps would lose any day not yet
 * swept — under-billing. usage_daily is intentionally KEPT past erase (legitimate-interest billing
 * record, plain deviceId, no FK) and device ids are never reused, so this is safe + final. Idempotent
 * (ON CONFLICT) and bounded by a retention-wide fix_time clamp (rejects an epoch-clock garbage day).
 * MUST run while the devices row still exists (the JOIN resolves tenant/account).
 */
export async function captureDeviceUsage(pool: Pool, deviceId: bigint, nowMs: number): Promise<number> {
  const fixFloor = new Date(nowMs - RETENTION_CLAMP_MS)
  const fixCeil = new Date(nowMs + 3_600_000)
  const res = await pool.query(
    `INSERT INTO usage_daily ("tenantId","accountId","deviceId",day)
     SELECT d."tenantId", d."accountId", p.device_id, p.day
     FROM (SELECT DISTINCT device_id, (fix_time AT TIME ZONE 'UTC')::date AS day
           FROM positions WHERE device_id = $1 AND fix_time >= $2 AND fix_time < $3) p
     JOIN devices d ON d.id = p.device_id
     ON CONFLICT ("deviceId",day) DO NOTHING`,
    [deviceId, fixFloor, fixCeil],
  )
  return res.rowCount ?? 0
}

/** BullMQ worker running the repeatable usage sweep. Caller must close() on shutdown. */
export function startUsageWorker(deps: UsageWorkerDeps): Worker {
  return new Worker(
    USAGE_QUEUE,
    async () => {
      try {
        const n = await runUsageSweep(deps.pool, Date.now())
        if (n > 0) deps.onSwept?.(n)
      } catch (err) {
        // surface a stalled metering pipeline (billing silently stopping is the worst
        // failure mode) — then rethrow so BullMQ marks the tick failed
        deps.onFailed?.()
        throw err
      }
    },
    { connection: deps.connection, concurrency: 1 }, // never overlap sweeps within a worker
  )
}
