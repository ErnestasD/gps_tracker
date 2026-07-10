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

export interface UsageWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  onSwept?: (rowsWritten: number) => void
  onFailed?: () => void
}

/** Run one sweep. Returns rows written (new device-days only). */
export async function runUsageSweep(pool: Pool, nowMs: number, lookbackMs = LOOKBACK_MS): Promise<number> {
  const since = new Date(nowMs - lookbackMs)
  const until = new Date(nowMs + 3_600_000) // clamp absurd-future fix_time (clock skew ≤1 h tolerated)
  const res = await pool.query(
    `INSERT INTO usage_daily ("tenantId","accountId","deviceId",day)
     SELECT d."tenantId", d."accountId", p.device_id, p.day
     FROM (SELECT DISTINCT device_id, (fix_time AT TIME ZONE 'UTC')::date AS day
           FROM positions WHERE fix_time >= $1 AND fix_time < $2) p
     JOIN devices d ON d.id = p.device_id
     ON CONFLICT ("deviceId",day) DO NOTHING`,
    [since, until],
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
