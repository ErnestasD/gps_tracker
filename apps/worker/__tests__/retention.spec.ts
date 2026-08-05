import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@orbetra/db'

import { runRetentionSweep } from '../src/jobs/retentionWorker.js'

describe('retention sweep', () => {
  it('prunes the delivery log at now − retentionDays and returns rows deleted', async () => {
    const prune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(7))
    const rejectPrune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(0))
    const db = { webhookDeliveries: { pruneOlderThan: prune }, rawRejects: { pruneOlderThan: rejectPrune } } as unknown as Db
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    const deleted = await runRetentionSweep(db, 30, now)
    expect(deleted).toBe(7)
    expect(prune.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000) // exactly 30 days back
  })

  it('clamps a misconfigured 0/negative window to ≥ 1 day so today’s live log is never pruned', async () => {
    const prune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(0))
    const rejectPrune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(0))
    const db = { webhookDeliveries: { pruneOlderThan: prune }, rawRejects: { pruneOlderThan: rejectPrune } } as unknown as Db
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    await runRetentionSweep(db, 0, now)
    expect(prune.mock.calls[0]![0].getTime()).toBe(now - 24 * 3_600_000) // clamped to 1 day back
    await runRetentionSweep(db, -5, now)
    expect(prune.mock.calls[1]![0].getTime()).toBe(now - 24 * 3_600_000) // negative also clamped
  })

  it('also prunes raw_rejects, on its OWN window — the drain gave it a writer, not a horizon', async () => {
    // Without this the drain trades a self-trimming 100k Redis stream for a permanently growing
    // Postgres table of IMEIs and raw AVL bytes — and those bytes embed lat/lon (§3.4), which the
    // privacy policy and the DPA both promise to delete. 90 days is far past the point where anyone
    // is still investigating a rejected record.
    const prune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(3))
    const rejectPrune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(4))
    const db = { webhookDeliveries: { pruneOlderThan: prune }, rawRejects: { pruneOlderThan: rejectPrune } } as unknown as Db
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    expect(await runRetentionSweep(db, 30, now)).toBe(7) // both tables counted
    expect(rejectPrune.mock.calls[0]![0].getTime()).toBe(now - 90 * 24 * 3_600_000)
    expect(prune.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000) // separate windows
  })
})