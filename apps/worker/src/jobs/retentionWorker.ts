import { Worker, type ConnectionOptions } from 'bullmq'

import type { Db } from '@orbetra/db'

import { RETENTION_QUEUE } from './retentionQueue.js'

/**
 * Data-retention sweep. Deletes webhook delivery-log rows older than `retentionDays` via the scoped
 * repo's batched, unscoped prune (packages/db — rule 2). The delivery log is a pure operational
 * record (never billing/compliance evidence), so a rolling window is safe. Daily cadence keeps each
 * prune small after the first pass; the batched DELETE bounds lock time even on that first run.
 */
export interface RetentionWorkerDeps {
  connection: ConnectionOptions
  db: Db
  retentionDays: number
  onPruned?: (rows: number) => void
  onFailed?: () => void
}

/** Run one sweep. Returns rows deleted. `retentionDays` is clamped to ≥ 1 so a misconfigured
 *  negative/zero value can never prune today's live delivery log (footgun guard). */
export async function runRetentionSweep(db: Db, retentionDays: number, nowMs: number): Promise<number> {
  const days = Number.isFinite(retentionDays) ? Math.max(1, retentionDays) : 30
  const cutoff = new Date(nowMs - days * 24 * 3_600_000)
  return db.webhookDeliveries.pruneOlderThan(cutoff)
}

/** BullMQ worker running the daily retention sweep. Caller must close() on shutdown. */
export function startRetentionWorker(deps: RetentionWorkerDeps): Worker {
  return new Worker(
    RETENTION_QUEUE,
    async () => {
      try {
        const rows = await runRetentionSweep(deps.db, deps.retentionDays, Date.now())
        deps.onPruned?.(rows)
      } catch (err) {
        deps.onFailed?.()
        throw err // let BullMQ record the failure; the next daily run retries the window
      }
    },
    { connection: deps.connection },
  )
}
