import { Worker, type ConnectionOptions } from 'bullmq'

import type { Db } from '@orbetra/db'

import { RETENTION_QUEUE } from './retentionQueue.js'

/**
 * Data-retention sweep. Deletes rows older than their window via the scoped repos' batched,
 * unscoped prunes (packages/db — rule 2). Daily cadence keeps each prune small after the first
 * pass; the batched DELETE bounds lock time even on that first run.
 *
 * Two tables:
 *  - `webhook_deliveries` — a pure operational record (never billing/compliance evidence), so a
 *    rolling window is safe.
 *  - `raw_rejects` — §3.6 sanity failures, now that a drain actually writes them. Without a sweep
 *    the drain would trade a self-trimming 100k Redis stream for a permanently growing Postgres
 *    table of IMEIs and raw AVL bytes, and those bytes embed lat/lon (§3.4) — personal data the
 *    privacy policy and the DPA both promise to delete at 13 months. A diagnostic tail does not
 *    need a year: 90 days is far past the point where anyone is still investigating.
 */
export interface RetentionWorkerDeps {
  connection: ConnectionOptions
  db: Db
  retentionDays: number
  /** window for `raw_rejects` (default 90). Diagnostics, not evidence — see the note above. */
  rejectRetentionDays?: number
  onPruned?: (rows: number) => void
  onFailed?: () => void
}

/** Run one sweep. Returns rows deleted. `retentionDays` is clamped to ≥ 1 so a misconfigured
 *  negative/zero value can never prune today's live delivery log (footgun guard). */
export async function runRetentionSweep(db: Db, retentionDays: number, nowMs: number, rejectRetentionDays = 90): Promise<number> {
  const days = Number.isFinite(retentionDays) ? Math.max(1, retentionDays) : 30
  const cutoff = new Date(nowMs - days * 24 * 3_600_000)
  const rejectDays = Number.isFinite(rejectRetentionDays) ? Math.max(1, rejectRetentionDays) : 90
  const rejectCutoff = new Date(nowMs - rejectDays * 24 * 3_600_000)
  const [deliveries, rejects] = await Promise.all([
    db.webhookDeliveries.pruneOlderThan(cutoff),
    db.rawRejects.pruneOlderThan(rejectCutoff),
  ])
  return deliveries + rejects
}

/** BullMQ worker running the daily retention sweep. Caller must close() on shutdown. */
export function startRetentionWorker(deps: RetentionWorkerDeps): Worker {
  return new Worker(
    RETENTION_QUEUE,
    async () => {
      try {
        const rows = await runRetentionSweep(deps.db, deps.retentionDays, Date.now(), deps.rejectRetentionDays)
        deps.onPruned?.(rows)
      } catch (err) {
        deps.onFailed?.()
        throw err // let BullMQ record the failure; the next daily run retries the window
      }
    },
    { connection: deps.connection },
  )
}
