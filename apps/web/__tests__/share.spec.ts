import { describe, expect, it } from 'vitest'

import { expiryLabel, shareUrl } from '../src/lib/share'

describe('V1-nice share helpers', () => {
  it('shareUrl composes the /s/<token> URL on the given origin (trailing slash tolerant)', () => {
    expect(shareUrl('abc123', 'https://dash.orbetra.com')).toBe('https://dash.orbetra.com/s/abc123')
    expect(shareUrl('abc123', 'https://dash.orbetra.com/')).toBe('https://dash.orbetra.com/s/abc123')
  })

  it('expiryLabel buckets to min/hour/day and flags expired', () => {
    const now = Date.parse('2026-07-14T12:00:00Z')
    expect(expiryLabel('2026-07-14T12:30:00Z', now)).toEqual({ expired: false, unit: 'min', value: 30 })
    expect(expiryLabel('2026-07-14T15:00:00Z', now)).toEqual({ expired: false, unit: 'hour', value: 3 })
    expect(expiryLabel('2026-07-17T12:00:00Z', now)).toEqual({ expired: false, unit: 'day', value: 3 })
    // past / equal / garbage → expired
    expect(expiryLabel('2026-07-14T11:59:00Z', now).expired).toBe(true)
    expect(expiryLabel('2026-07-14T12:00:00Z', now).expired).toBe(true)
    expect(expiryLabel('not-a-date', now).expired).toBe(true)
    // under a minute floors to at-least-1 min (never "0 min" while still valid)
    expect(expiryLabel('2026-07-14T12:00:30Z', now)).toEqual({ expired: false, unit: 'min', value: 1 })
  })
})
