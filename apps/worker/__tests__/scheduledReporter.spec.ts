import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import type { Db } from '@orbetra/db'

import type { EmailTransport } from '../src/notify/drivers.js'
import { formatReport, isDue, reportWindow, runDueSchedules, type Schedule } from '../src/reports/scheduledReporter.js'

// a Wednesday 06:00 UTC instant (2026-07-15T06:00:00Z; getUTCDay()===3)
const NOW = Date.UTC(2026, 6, 15, 6, 0, 0)

describe('isDue', () => {
  it('fires a daily schedule at its UTC hour, not other hours', () => {
    expect(isDue({ cadence: 'daily', hourUtc: 6, weekday: null }, NOW, null)).toBe(true)
    expect(isDue({ cadence: 'daily', hourUtc: 7, weekday: null }, NOW, null)).toBe(false)
  })
  it('a weekly schedule also requires the matching weekday', () => {
    expect(isDue({ cadence: 'weekly', hourUtc: 6, weekday: 3 }, NOW, null)).toBe(true) // Wed
    expect(isDue({ cadence: 'weekly', hourUtc: 6, weekday: 4 }, NOW, null)).toBe(false)
  })
  it('does not re-fire within the cadence (23h guard)', () => {
    expect(isDue({ cadence: 'daily', hourUtc: 6, weekday: null }, NOW, NOW - 3_600_000)).toBe(false) // ran 1h ago
    expect(isDue({ cadence: 'daily', hourUtc: 6, weekday: null }, NOW, NOW - 25 * 3_600_000)).toBe(true) // ran >23h ago
  })
  it('catches up a missed hour later the same day (hour ≥ hourUtc)', () => {
    const later = Date.UTC(2026, 6, 15, 9, 0, 0) // 09:00, schedule was for 06:00, never ran
    expect(isDue({ cadence: 'daily', hourUtc: 6, weekday: null }, later, null)).toBe(true)
  })
  it('a weekly schedule with no weekday never fires (would be silently dead)', () => {
    expect(isDue({ cadence: 'weekly', hourUtc: 6, weekday: null }, NOW, null)).toBe(false)
  })
})

describe('reportWindow', () => {
  it('is 1 day for daily, 7 for weekly', () => {
    expect(reportWindow('daily', NOW)).toEqual({ from: new Date(NOW - 86_400_000).toISOString(), to: new Date(NOW).toISOString() })
    expect(reportWindow('weekly', NOW)).toEqual({ from: new Date(NOW - 7 * 86_400_000).toISOString(), to: new Date(NOW).toISOString() })
  })
})

describe('formatReport', () => {
  it('renders one line per row + a header; empty is explicit', () => {
    const w = { from: '2026-07-14T06:00:00Z', to: '2026-07-15T06:00:00Z' }
    const r = formatReport({ type: 'mileage', rows: [{ day: '2026-07-14', deviceId: '5', distanceKm: 42 } as never] }, w)
    expect(r.subject).toContain('mileage')
    expect(r.text).toContain('distanceKm: 42')
    expect(formatReport({ type: 'trips', rows: [] }, w).text).toContain('(no data')
  })
})

// fake pool: every query returns no rows → runReport yields an empty result (orchestration test)
const fakePool = { query: () => Promise.resolve({ rows: [], rowCount: 0 }) } as unknown as Pool
const transport = (sent: { to: string; subject: string }[]): EmailTransport => ({
  send: (to, subject) => { sent.push({ to, subject }); return Promise.resolve() },
})
// claimed set models the atomic claim: the first claim for an id wins, later claims lose
function fakeDb(schedules: Schedule[], claimed: Set<string>): Db {
  return {
    scheduledReports: {
      listEnabled: () => Promise.resolve(schedules),
      claimRun: (id: string) => { if (claimed.has(id)) return Promise.resolve(false); claimed.add(id); return Promise.resolve(true) },
    },
  } as unknown as Db
}
const sched = (o: Partial<Schedule>): Schedule => ({
  id: 'sr-1', tenantId: 't', accountId: 'a', reportType: 'mileage', cadence: 'daily', hourUtc: 6, weekday: null,
  recipients: ['ops@x.test'], timezone: 'Europe/Vilnius', lastRunAt: null, ...o,
})

describe('runDueSchedules', () => {
  it('claims + emails a due schedule to each recipient', async () => {
    const sent: { to: string; subject: string }[] = []
    const claimed = new Set<string>()
    const db = fakeDb([sched({ recipients: ['a@x.test', 'b@x.test'] })], claimed)
    const r = await runDueSchedules({ db, pool: fakePool, transport: transport(sent), now: () => NOW })
    expect(r).toEqual({ due: 1, emailed: 2 })
    expect(sent.map((s) => s.to)).toEqual(['a@x.test', 'b@x.test'])
    expect(claimed.has('sr-1')).toBe(true)
  })

  it('skips a not-due schedule (before its hour) — no email, no claim', async () => {
    const sent: { to: string; subject: string }[] = []
    const claimed = new Set<string>()
    const r = await runDueSchedules({ db: fakeDb([sched({ hourUtc: 9 })], claimed), pool: fakePool, transport: transport(sent), now: () => NOW })
    expect(r).toEqual({ due: 0, emailed: 0 })
    expect(sent).toHaveLength(0)
    expect(claimed.size).toBe(0)
  })

  it('a lost claim (already run by an overlapping worker) sends nothing', async () => {
    const sent: { to: string; subject: string }[] = []
    const claimed = new Set<string>(['sr-1']) // already claimed
    const r = await runDueSchedules({ db: fakeDb([sched({})], claimed), pool: fakePool, transport: transport(sent), now: () => NOW })
    expect(r).toEqual({ due: 1, emailed: 0 }) // due, but claim lost → no send
    expect(sent).toHaveLength(0)
  })

  it('one bad recipient address does not suppress the others', async () => {
    const claimed = new Set<string>()
    const failing: EmailTransport = {
      send: (to) => (to === 'bad@x.test' ? Promise.reject(new Error('550 no such user')) : Promise.resolve()),
    }
    const db = fakeDb([sched({ recipients: ['ok1@x.test', 'bad@x.test', 'ok2@x.test'] })], claimed)
    const r = await runDueSchedules({ db, pool: fakePool, transport: failing, now: () => NOW })
    expect(r.emailed).toBe(2) // ok1 + ok2 delivered; bad one logged + skipped
  })
})
