import { describe, expect, it } from 'vitest'

import { fmtDate, fmtDateTime } from '../src/lib/datetime.js'

const ISO = '2026-07-14T17:03:00Z'

describe('datetime — locale-aware formatting (app language, not browser locale)', () => {
  it('fmtDateTime renders a valid ISO timestamp per locale (lt differs from en)', () => {
    const en = fmtDateTime(ISO, 'en')
    const lt = fmtDateTime(ISO, 'lt')
    expect(en).toContain('2026')
    expect(lt).toContain('2026')
    // the whole point of the sweep: output follows the requested locale
    expect(en).not.toBe(lt)
  })

  it('fmtDate renders the date only, per locale', () => {
    const en = fmtDate(ISO, 'en')
    const lt = fmtDate(ISO, 'lt')
    expect(en).toContain('2026')
    expect(en).not.toBe(lt)
    // date-only: no clock time in the output
    expect(en).not.toMatch(/\d{1,2}:\d{2}/)
    expect(lt).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('fmtDateTime includes a time component, fmtDate does not', () => {
    expect(fmtDateTime(ISO, 'en')).toMatch(/\d{1,2}:\d{2}/)
    expect(fmtDate(ISO, 'en')).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('garbage input renders — and never throws', () => {
    for (const bad of ['garbage', '', 'not-a-date', '2026-13-99T99:99:99Z']) {
      expect(fmtDateTime(bad, 'en')).toBe('—')
      expect(fmtDate(bad, 'lt')).toBe('—')
    }
  })
})

describe('display-pref options (timeFormat / timeZone / dateFormat)', () => {
  const utc = { timeZone: 'UTC' }

  it("timeFormat forces the hour cycle regardless of the locale's default", () => {
    expect(fmtDateTime(ISO, 'en', { ...utc, timeFormat: '24h' })).toContain('17:03')
    const h12 = fmtDateTime(ISO, 'en', { ...utc, timeFormat: '12h' })
    expect(h12).toContain('5:03')
    expect(h12).toMatch(/PM/i)
    // lt defaults to 24h — 12h must still win
    expect(fmtDateTime(ISO, 'lt', { ...utc, timeFormat: '12h' })).not.toContain('17:03')
  })

  it('timeZone renders the same instant in the requested zone', () => {
    expect(fmtDateTime(ISO, 'en', { timeZone: 'UTC', timeFormat: '24h' })).toContain('17:03')
    expect(fmtDateTime(ISO, 'en', { timeZone: 'Europe/Vilnius', timeFormat: '24h' })).toContain('20:03') // UTC+3 in July
    expect(fmtDateTime(ISO, 'en', { timeZone: 'America/New_York', timeFormat: '24h' })).toContain('13:03') // UTC-4 in July
  })

  it('an invalid timeZone falls back instead of throwing', () => {
    expect(fmtDateTime(ISO, 'en', { timeZone: 'Not/AZone' })).toContain('2026')
  })

  it('explicit dateFormat forces the pattern for date and date+time', () => {
    expect(fmtDate(ISO, 'en', { ...utc, dateFormat: 'ymd' })).toBe('2026-07-14')
    expect(fmtDate(ISO, 'en', { ...utc, dateFormat: 'dmy' })).toBe('14.07.2026')
    expect(fmtDate(ISO, 'en', { ...utc, dateFormat: 'mdy' })).toBe('07/14/2026')
    // the pattern is locale-independent — lt renders identically
    expect(fmtDate(ISO, 'lt', { ...utc, dateFormat: 'ymd' })).toBe('2026-07-14')
    expect(fmtDateTime(ISO, 'en', { ...utc, dateFormat: 'ymd', timeFormat: '24h' })).toBe('2026-07-14 17:03')
    const mdy12 = fmtDateTime(ISO, 'en', { ...utc, dateFormat: 'mdy', timeFormat: '12h' })
    expect(mdy12.startsWith('07/14/2026 5:03')).toBe(true)
    expect(mdy12).toMatch(/PM/i)
  })

  it("dateFormat 'auto' keeps the locale default shape", () => {
    expect(fmtDate(ISO, 'en', { ...utc, dateFormat: 'auto' })).toBe(fmtDate(ISO, 'en', utc))
  })

  it('garbage input renders — with opts too', () => {
    expect(fmtDateTime('nope', 'en', { timeZone: 'UTC', dateFormat: 'ymd', timeFormat: '12h' })).toBe('—')
  })
})
