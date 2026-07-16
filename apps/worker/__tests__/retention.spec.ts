import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@orbetra/db'

import { runRetentionSweep } from '../src/jobs/retentionWorker.js'

describe('retention sweep', () => {
  it('prunes the delivery log at now − retentionDays and returns rows deleted', async () => {
    const prune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(7))
    const db = { webhookDeliveries: { pruneOlderThan: prune } } as unknown as Db
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    const deleted = await runRetentionSweep(db, 30, now)
    expect(deleted).toBe(7)
    expect(prune.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000) // exactly 30 days back
  })

  it('clamps a misconfigured 0/negative window to ≥ 1 day so today’s live log is never pruned', async () => {
    const prune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(0))
    const db = { webhookDeliveries: { pruneOlderThan: prune } } as unknown as Db
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    await runRetentionSweep(db, 0, now)
    expect(prune.mock.calls[0]![0].getTime()).toBe(now - 24 * 3_600_000) // clamped to 1 day back
    await runRetentionSweep(db, -5, now)
    expect(prune.mock.calls[1]![0].getTime()).toBe(now - 24 * 3_600_000) // negative also clamped
  })
})
