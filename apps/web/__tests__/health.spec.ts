import { describe, expect, it } from 'vitest'

import { voltageSeries } from '../src/lib/health.js'

const s = (extV: number | null, battV: number | null) => ({ fixTime: '2026-07-01T12:00:00Z', gsm: 4, extV, battV })

describe('V1-nice voltageSeries (pure)', () => {
  it('prefers the external-voltage series when present', () => {
    const r = voltageSeries([s(12.4, 4.1), s(12.1, null), s(null, 4.0)])
    expect(r.label).toBe('ext')
    expect(r.values).toEqual([12.4, 12.1]) // null-ext samples dropped
  })
  it('falls back to battery when no external voltage', () => {
    const r = voltageSeries([s(null, 4.1), s(null, 4.0)])
    expect(r.label).toBe('batt')
    expect(r.values).toEqual([4.1, 4.0])
  })
  it('empty in → empty out', () => {
    expect(voltageSeries([]).values).toEqual([])
  })
})
