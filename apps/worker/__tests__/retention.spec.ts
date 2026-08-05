import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@orbetra/db'

import { runRetentionSweep } from '../src/jobs/retentionWorker.js'

type Prune = (cutoff: Date, batchSize?: number) => Promise<number>

/** `billing_events` defaults to 0 here — the cases below are about the two data tables; its own
 *  window is asserted separately. */
const fakeDb = (prune: Prune, rejectPrune: Prune, billingPrune: Prune = () => Promise.resolve(0)): Db =>
  ({
    webhookDeliveries: { pruneOlderThan: prune },
    rawRejects: { pruneOlderThan: rejectPrune },
    tenants: { pruneBillingEvents: billingPrune },
  }) as unknown as Db

describe('retention sweep', () => {
  it('prunes the delivery log at now − retentionDays and returns rows deleted', async () => {
    const prune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(7))
    const rejectPrune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(0))
    const db = fakeDb(prune, rejectPrune)
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    const deleted = await runRetentionSweep(db, 30, now)
    expect(deleted).toBe(7)
    expect(prune.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000) // exactly 30 days back
  })

  it('clamps a misconfigured 0/negative window to ≥ 1 day so today’s live log is never pruned', async () => {
    const prune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(0))
    const rejectPrune = vi.fn<(cutoff: Date, batchSize?: number) => Promise<number>>(() => Promise.resolve(0))
    const db = fakeDb(prune, rejectPrune)
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
    const db = fakeDb(prune, rejectPrune)
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    expect(await runRetentionSweep(db, 30, now)).toBe(7) // both tables counted
    expect(rejectPrune.mock.calls[0]![0].getTime()).toBe(now - 90 * 24 * 3_600_000)
    expect(prune.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000) // separate windows
  })

  it('also prunes billing_events — the applied-event ledger is append-only on the billing path', async () => {
    // it exists to suppress a Stripe REDELIVERY, and Stripe retries for ~3 days, so a 90-day horizon
    // can never drop a row that would still dedupe anything
    const billingPrune = vi.fn<Prune>(() => Promise.resolve(5))
    const db = fakeDb(() => Promise.resolve(1), () => Promise.resolve(2), billingPrune)
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    expect(await runRetentionSweep(db, 30, now)).toBe(8) // all three tables counted
    expect(billingPrune.mock.calls[0]![0].getTime()).toBe(now - 90 * 24 * 3_600_000)
  })

  it('billing_events has its OWN window, floored at 7 days — never the raw_rejects dial', async () => {
    // RAW_REJECT_RETENTION_DAYS is documented as a personal-data minimisation knob (raw AVL bytes
    // embed lat/lon), so shortening it to 1–2 days is a reasonable privacy decision. Sharing it with
    // the applied-event ledger would prune inside Stripe's ~3-day retry horizon and silently reopen
    // webhook redelivery — the exact bug the ledger exists to close.
    const billingPrune = vi.fn<Prune>(() => Promise.resolve(0))
    const db = fakeDb(() => Promise.resolve(0), () => Promise.resolve(0), billingPrune)
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    await runRetentionSweep(db, 30, now, 1, undefined, 30) // raw_rejects shortened to 1 day
    expect(billingPrune.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000) // its own 30
    await runRetentionSweep(db, 30, now, 1, undefined, 2) // and a too-short ledger window is floored
    expect(billingPrune.mock.calls[1]![0].getTime()).toBe(now - 7 * 24 * 3_600_000)
  })

  it('one table failing still counts and reports what the others deleted', async () => {
    const seen: [string, number][] = []
    const db = fakeDb(() => Promise.resolve(1), () => Promise.reject(new Error('boom')), () => Promise.resolve(5))
    await expect(runRetentionSweep(db, 30, Date.now(), 90, (t, n) => seen.push([t, n]))).rejects.toThrow('boom')
    expect(seen).toEqual([
      ['webhook_deliveries', 1],
      ['billing_events', 5],
    ])
  })
})