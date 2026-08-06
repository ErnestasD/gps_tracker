import { describe, expect, it, vi } from 'vitest'

import type { Db } from '@orbetra/db'

import { assertLocationWindow, runRetentionSweep } from '../src/jobs/retentionWorker.js'

type Prune = (cutoff: Date, batchSize?: number) => Promise<number>

/** `billing_events` defaults to 0 here — the cases below are about the two data tables; its own
 *  window is asserted separately. */
const zero: Prune = () => Promise.resolve(0)

/** Everything the sweep touches. The location + token prunes default to 0 so the cases below stay
 *  about the table each is named for; their own windows are asserted separately. */
const fakeDb = (
  prune: Prune,
  rejectPrune: Prune,
  billingPrune: Prune = zero,
  over: { events?: Prune; trips?: Prune; refresh?: Prune; reset?: Prune; affiliate?: Prune; verification?: Prune; signups?: Prune } = {},
): Db =>
  ({
    webhookDeliveries: { pruneOlderThan: prune },
    rawRejects: { pruneOlderThan: rejectPrune },
    tenants: { pruneBillingEvents: billingPrune, pruneUnverifiedSignups: over.signups ?? zero },
    events: { pruneOlderThan: over.events ?? zero },
    trips: { stripCoordinatesOlderThan: over.trips ?? zero },
    auth: {
      tokenRetention: {
        pruneRefreshTokens: over.refresh ?? zero,
        pruneResetTokens: over.reset ?? zero,
        pruneAffiliateTokens: over.affiliate ?? zero,
        pruneVerificationTokens: over.verification ?? zero,
      },
    },
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

  it('prunes EVENTS and strips TRIP coordinates on the 13-month location horizon', async () => {
    // `add_retention_policy('positions', …)` was the only horizon in the codebase, so at month 14 the
    // raw chunks were dropped while events kept lat/lon for every geofence crossing and panic, and
    // trips kept exact start/end coordinates — after the privacy policy, Terms and DPA had all told
    // the customer that data was deleted.
    const events = vi.fn<Prune>(() => Promise.resolve(11))
    const trips = vi.fn<Prune>(() => Promise.resolve(7))
    const seen: [string, number][] = []
    const db = fakeDb(zero, zero, zero, { events, trips })
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    expect(await runRetentionSweep(db, 30, now, 90, (t, n) => seen.push([t, n]))).toBe(18)
    expect(events.mock.calls[0]![0].getTime()).toBe(now - 396 * 24 * 3_600_000) // 13 months
    expect(trips.mock.calls[0]![0].getTime()).toBe(now - 396 * 24 * 3_600_000) // the SAME horizon
    expect(seen).toContainEqual(['events', 11])
    expect(seen).toContainEqual(['trips_coords', 7])
  })

  it('the location window is floored at 30 days — a fat-fingered 1 must not erase a fleet’s history', async () => {
    // this prune DESTROYS customer location data; unlike the delivery log there is no re-deriving it
    const events = vi.fn<Prune>(() => Promise.resolve(0))
    const db = fakeDb(zero, zero, zero, { events })
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    await runRetentionSweep(db, 30, now, 90, undefined, 90, 1)
    expect(events.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000)
  })

  it('prunes the THREE token tables on their own window', async () => {
    // refresh_tokens grows by a row per login AND per rotation, forever, on the path every
    // authenticated request depends on
    const refresh = vi.fn<Prune>(() => Promise.resolve(400))
    const reset = vi.fn<Prune>(() => Promise.resolve(9))
    const affiliate = vi.fn<Prune>(() => Promise.resolve(2))
    const seen: [string, number][] = []
    const db = fakeDb(zero, zero, zero, { refresh, reset, affiliate })
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    expect(await runRetentionSweep(db, 30, now, 90, (t, n) => seen.push([t, n]), 90, 396, 30)).toBe(411)
    for (const fn of [refresh, reset, affiliate]) expect(fn.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000)
    expect(seen).toContainEqual(['refresh_tokens', 400])
    expect(seen).toContainEqual(['password_reset_tokens', 9])
    expect(seen).toContainEqual(['affiliate_password_tokens', 2])
  })

  it('deletes NEVER-ACTIVATED signups on their own window, floored at 2 days', async () => {
    // verification made signup safe to answer identically for a taken and a free address, but the
    // free branch still WRITES a tenant — so probing an address squats it. The floor matters: the
    // activation link lives 48 h, so a shorter window would delete accounts whose owner still holds
    // a valid link.
    const signups = vi.fn<Prune>(() => Promise.resolve(3))
    const seen: [string, number][] = []
    const db = fakeDb(zero, zero, zero, { signups })
    const now = Date.UTC(2026, 6, 16, 12, 0, 0)
    expect(await runRetentionSweep(db, 30, now, 90, (t, n) => seen.push([t, n]), 90, 396, 30, 30)).toBe(3)
    expect(signups.mock.calls[0]![0].getTime()).toBe(now - 30 * 24 * 3_600_000)
    expect(seen).toContainEqual(['unverified_signups', 3])
    await runRetentionSweep(db, 30, now, 90, undefined, 90, 396, 30, 1)
    expect(signups.mock.calls[1]![0].getTime()).toBe(now - 2 * 24 * 3_600_000)
  })

  it('one table failing still counts and reports what the others deleted', async () => {
    const seen: [string, number][] = []
    const db = fakeDb(() => Promise.resolve(1), () => Promise.reject(new Error('boom')), () => Promise.resolve(5))
    await expect(runRetentionSweep(db, 30, Date.now(), 90, (t, n) => seen.push([t, n]))).rejects.toThrow('boom')
    // every table EXCEPT the one that threw is still reported — those rows are already gone, so no
    // later run could ever count them
    expect(seen.filter(([, n]) => n > 0)).toEqual([
      ['webhook_deliveries', 1],
      ['billing_events', 5],
    ])
    expect(seen.map(([t]) => t)).not.toContain('raw_rejects')
  })
})
describe('assertLocationWindow', () => {
  it('refuses a window shorter than the PUBLISHED 13 months unless it is confirmed', () => {
    // the floor of 30 catches `1`, but 90 — the value one README row above, for raw_rejects — is a
    // perfectly legal number that silently deletes ten months of a customer's history on the next
    // tick. 13 months is not a preference: the privacy policy, Terms and DPA all state it.
    expect(() => assertLocationWindow(90, undefined)).toThrow(/shorter than the published 13-month/)
    expect(() => assertLocationWindow(90, '1')).not.toThrow()
    expect(() => assertLocationWindow(90, 'true')).not.toThrow()
  })

  it('a LONGER window needs no ceremony — it deletes strictly less', () => {
    expect(() => assertLocationWindow(396, undefined)).not.toThrow()
    expect(() => assertLocationWindow(1000, undefined)).not.toThrow()
  })

  it('names the variable and the consequence — the operator must not have to read the source', () => {
    expect(() => assertLocationWindow(30, undefined)).toThrow(/LOCATION_RETENTION_DAYS=30[\s\S]*RETENTION_CONFIRM_SHORT=1/)
  })
})
