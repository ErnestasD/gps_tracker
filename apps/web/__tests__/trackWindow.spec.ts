import { describe, expect, it } from 'vitest'

import type { TrackPoint } from '../src/lib/telemetry'
import { firstPlaceBack, quickJumps, spanMinutes, windowAt, WINDOW_BUCKET_MS } from '../src/lib/trackWindow'

const pt = (iso: string, fixValid = true): TrackPoint =>
  ({ fixTime: iso, lat: 54.7, lon: 25.3, speed: 0, course: 0, ignition: null, fixValid })

describe('the scrubber window', () => {
  it('buckets, so repeatedly asking for "the last 24 h" asks for the SAME window', () => {
    // Every distinct window is a distinct query key and therefore a cache miss. A window that moved
    // continuously re-downloaded up to 10 000 rows on every tick.
    const a = windowAt(Date.parse('2026-08-19T12:03:41.500Z'))
    const b = windowAt(Date.parse('2026-08-19T12:04:59.999Z'))
    expect(a).toEqual(b)
    expect(a.to % WINDOW_BUCKET_MS).toBe(0)
  })

  it('advances once the bucket turns over', () => {
    const a = windowAt(Date.parse('2026-08-19T12:04:59.999Z'))
    const b = windowAt(Date.parse('2026-08-19T12:05:00.000Z'))
    expect(b.to - a.to).toBe(WINDOW_BUCKET_MS)
  })

  it('spans exactly 24 hours, whatever the clock reads', () => {
    expect(spanMinutes(windowAt(Date.parse('2026-08-19T12:03:41Z')))).toBe(24 * 60)
  })
})

describe('where a replay begins', () => {
  const w = { from: Date.parse('2026-08-18T12:00:00Z'), to: Date.parse('2026-08-19T12:00:00Z') }

  it('starts at the first row we can PLACE, not the first row we hold (I6)', () => {
    // A vehicle that spent the small hours in a garage reports satellites=0 first. Starting there
    // means a frozen camera and "no GPS fix" — which reads as broken.
    const points = [pt('2026-08-18T12:30:00Z', false), pt('2026-08-18T14:00:00Z')]
    expect(firstPlaceBack(points, w)).toBe(22 * 60)
  })

  it('never lands BEFORE that row — floor, not round', () => {
    // 40 s past the minute: rounding away from now puts the moment before the point, `placeAt`
    // finds nothing, and the replay opens frozen. It was a coin flip on every press of Play.
    const points = [pt('2026-08-18T12:30:40Z')]
    const back = firstPlaceBack(points, w)
    expect(w.to - back * 60_000).toBeGreaterThanOrEqual(Date.parse('2026-08-18T12:30:40Z'))
  })

  it('an unparseable first row is skipped rather than taken as the start', () => {
    const points = [pt('not-a-date'), pt('2026-08-18T18:00:00Z')]
    expect(firstPlaceBack(points, w)).toBe(18 * 60)
  })

  it('a track with nothing placeable replays the whole window rather than nothing', () => {
    expect(firstPlaceBack([pt('2026-08-18T13:00:00Z', false)], w)).toBe(spanMinutes(w))
    expect(firstPlaceBack([], w)).toBe(spanMinutes(w))
  })
})

describe('quick jumps', () => {
  it('are derived from the span, so they can never point outside it', () => {
    expect(quickJumps(1440).map((q) => q.m)).toEqual([1440, 720, 360, 60, 0])
  })

  it('collapse rather than duplicate when the span is short', () => {
    // A 1-hour window would otherwise offer "-1 h" twice, one of which could never be the active one
    expect(quickJumps(60).map((q) => q.m)).toEqual([60, 30, 15, 0])
    expect(quickJumps(30).map((q) => q.m)).toEqual([30, 15, 8, 0])
  })

  it('always ends at "now"', () => {
    for (const span of [1, 12, 60, 720, 1440]) expect(quickJumps(span).at(-1)?.m).toBe(0)
  })
})
