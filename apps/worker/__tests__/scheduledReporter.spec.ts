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
  it('is 1 day for daily, 7 for weekly, anchored to the scheduled UTC hour', () => {
    // NOW is exactly 06:00 UTC and hourUtc=6, so the anchored `to` equals NOW here
    expect(reportWindow({ cadence: 'daily', hourUtc: 6 }, NOW, null)).toEqual({ from: new Date(NOW - 86_400_000).toISOString(), to: new Date(NOW).toISOString() })
    expect(reportWindow({ cadence: 'weekly', hourUtc: 6 }, NOW, null)).toEqual({ from: new Date(NOW - 7 * 86_400_000).toISOString(), to: new Date(NOW).toISOString() })
  })
  it('anchors `to` to the scheduled hour on a CATCH-UP tick — no boundary drift (review MED)', () => {
    const anchor = NOW // 06:00 UTC scheduled boundary
    for (const lateHour of [7, 9, 11]) {
      const late = anchor + lateHour * 3_600_000 - 6 * 3_600_000 // same day, later than 06:00
      const w = reportWindow({ cadence: 'daily', hourUtc: 6 }, late, null)
      expect(w.to).toBe(new Date(anchor).toISOString()) // to stays pinned to 06:00, not the fire instant
      expect(w.from).toBe(new Date(anchor - 86_400_000).toISOString())
    }
  })
  it('extends `from` to the SCHEDULED boundary covering a missed period — not the raw fire instant (review MED)', () => {
    // lastRunAt is a catch-up fire ~47h ago at 07:00 (an unaligned hour, NOT the 06:00 boundary).
    // Anchoring to lastRunAt verbatim would drop the [06:00, 07:00] hour that the prior window
    // (to-aligned at 06:00) never covered. The fix steps whole days back → from = 06:00 two days ago.
    const twoDaysAgo = NOW - 2 * 86_400_000 + 3_600_000 // 07:00 two days ago
    const w = reportWindow({ cadence: 'daily', hourUtc: 6 }, NOW, twoDaysAgo)
    expect(w.from).toBe(new Date(NOW - 2 * 86_400_000).toISOString()) // 06:00 boundary, covers the FULL missed day
    expect(w.to).toBe(new Date(NOW).toISOString())
  })

  it('catch-up window math: a delayed run after an outage tiles at the hourUtc boundary, dropping no slice (review MED)', () => {
    // hourUtc=6. A prior CATCH-UP fired at 18:00 on DayA (lastRunAt), then the worker was down for
    // days; the next fire is DayA+4 06:00. Anchoring `from` to lastRunAt (18:00) would silently drop
    // the [DayA 06:00, DayA 18:00] slice. The boundary-aligned window must start at DayA 06:00.
    const dayA6 = Date.UTC(2026, 6, 10, 6, 0, 0)
    const lastRun = dayA6 + 12 * 3_600_000 // DayA 18:00 — a catch-up fire instant
    const now = dayA6 + 4 * 86_400_000 // DayA+4 06:00
    const w = reportWindow({ cadence: 'daily', hourUtc: 6 }, now, lastRun)
    expect(w.to).toBe(new Date(now).toISOString())
    expect(w.from).toBe(new Date(dayA6).toISOString()) // aligned back to DayA 06:00, no dropped 12h
  })
  it('does NOT extend `from` on a normal on-time run (last run ~1 span ago)', () => {
    const oneDayAgo = NOW - 86_400_000 // exactly a span ago → not < defaultFrom
    const w = reportWindow({ cadence: 'daily', hourUtc: 6 }, NOW, oneDayAgo)
    expect(w.from).toBe(new Date(NOW - 86_400_000).toISOString())
  })
})

describe('formatReport', () => {
  const w = { from: '2026-07-14T06:00:00Z', to: '2026-07-15T06:00:00Z' }
  const opts = { timezone: 'Europe/Vilnius', brand: 'Acme Fleet' }

  it('renders a labelled table with the tenant brand, device name, and km (not raw keys/meters)', () => {
    const r = formatReport(
      { type: 'mileage', rows: [{ day: '2026-07-14', deviceId: '5', deviceName: 'Vilnius Van 1', devicePlate: 'ABC-123', trips: 3, distanceM: 15234 }] },
      w,
      opts,
    )
    // branded subject with a human report title (not the raw slug, not hardcoded 'Orbetra')
    expect(r.subject).toBe('Acme Fleet — Mileage report (2026-07-14 to 2026-07-15)')
    // human column labels, not raw camelCase keys
    expect(r.text).toContain('Distance (km)')
    expect(r.text).not.toContain('distanceM')
    // meters → km (1dp) and the device NAME, not the raw id
    expect(r.text).toContain('15.2')
    expect(r.text).toContain('Vilnius Van 1')
  })

  it('formats trip timestamps in the account timezone, not UTC ISO', () => {
    const r = formatReport(
      { type: 'trips', rows: [{ id: 't1', deviceId: '5', deviceName: 'Van', devicePlate: null, day: '2026-07-14', startTime: '2026-07-14T09:30:00.000Z', endTime: '2026-07-14T10:00:00.000Z', distanceM: 8000, distanceSource: 'gps', maxSpeed: 92, idleS: 600 }] },
      w,
      opts,
    )
    // 09:30 UTC → 12:30 in Europe/Vilnius (UTC+3 in July); no raw ...Z string
    expect(r.text).toContain('2026-07-14 12:30')
    expect(r.text).not.toContain('T09:30:00.000Z')
  })

  it('empty result is explicit', () => {
    expect(formatReport({ type: 'trips', rows: [] }, w, opts).text).toContain('(no data')
  })

  it('emits a branded HTML report (logo/accent/productName + an HTML <table>) plus the plain-text fallback', () => {
    const branding = { productName: 'Acme Fleet', primary: '#ff8800', logoUrl: 'https://cdn.acme.test/logo.png', supportEmail: 'help@acme.test' }
    const r = formatReport(
      { type: 'mileage', rows: [{ day: '2026-07-14', deviceId: '5', deviceName: 'Vilnius Van 1', devicePlate: 'ABC-123', trips: 3, distanceM: 15234 }] },
      w,
      { ...opts, branding, tenantName: 'Acme' },
    )
    // plain-text fallback still present
    expect(r.text).toContain('Distance (km)')
    // branded HTML shell + an HTML table with the human column + km value
    expect(r.html).toBeDefined()
    expect(r.html!).toContain('Acme Fleet')
    expect(r.html!).toContain('https://cdn.acme.test/logo.png')
    expect(r.html!).toContain('#ff8800')
    expect(r.html!).toContain('<table')
    expect(r.html!).toContain('Distance (km)')
    expect(r.html!).toContain('15.2')
    expect(r.html!).toContain('Vilnius Van 1')
  })

  it('FAIL SAFE: no branding still yields HTML from the brand name + default accent', () => {
    const r = formatReport({ type: 'mileage', rows: [] }, w, opts) // opts has brand but no branding
    expect(r.html).toBeDefined()
    expect(r.html!).toContain('Acme Fleet') // brand used as the shell name fallback
    expect(r.html!).toContain('#4DA3FF') // default accent
    expect(r.html!).toContain('(no data in this period)')
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
