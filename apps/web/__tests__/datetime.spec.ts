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
