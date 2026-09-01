import { describe, expect, it } from 'vitest'

import type { TrackPoint } from '../src/lib/telemetry'
import { canScrub, firstPlaceBack, quickJumps, spanMinutes, windowAt, WINDOW_BUCKET_MS, viewWindow, panView, zoomView, dayView, zonedDayStart, isLive, panFloor } from '../src/lib/trackWindow'

const pt = (iso: string, fixValid = true): TrackPoint =>
  ({ fixTime: iso, lat: 54.7, lon: 25.3, speed: 0, course: 0, ignition: null, movement: null, fixValid })

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
    const back = firstPlaceBack(points, w)!
    expect(w.to - back * 60_000).toBeGreaterThanOrEqual(Date.parse('2026-08-18T12:30:40Z'))
  })

  it('a track with NOTHING placeable is null, not the full span', () => {
    // One value with two meanings, again: returning the span for both "the oldest placeable row is
    // at the far edge" and "there is no placeable row" left a vehicle that spent the whole day
    // underground with an enabled scrubber where every moment resolved to nowhere.
    expect(firstPlaceBack([pt('2026-08-18T13:00:00Z', false), pt('2026-08-19T01:00:00Z', false)], w)).toBeNull()
    expect(firstPlaceBack([], w)).toBeNull()
    expect(canScrub(null)).toBe(false)
    expect(canScrub(0)).toBe(false)
    expect(canScrub(1)).toBe(true)
  })

  it('a tracker installed minutes ago has nothing behind it to replay', () => {
    // The first placeable row sits inside the LAST minute of the window. Clamping that up to 1
    // minute put the moment before the row — `placeAt` then found nothing and Play opened on a
    // frozen camera reading "no report at …". Zero says "nothing behind us", and the button is
    // disabled rather than lying.
    for (const ageS of [0, 30, 59]) {
      const points = [pt(new Date(w.to - ageS * 1_000).toISOString())]
      expect(firstPlaceBack(points, w)).toBe(0)
    }
    // …and one minute is enough to have something
    expect(firstPlaceBack([pt(new Date(w.to - 61_000).toISOString())], w)).toBe(1)
  })

  it('every start it returns is at or before the row it chose — at every age', () => {
    // The property across the whole window. `continue`-ing on 0 would skip exactly the ages the
    // zero floor was introduced for, leaving the change covered by a literal and not by its rule.
    for (const ageS of [0, 30, 59, 61, 3_600, 86_000, 86_399]) {
      const iso = new Date(w.to - ageS * 1_000).toISOString()
      const ms = Date.parse(iso)
      const back = firstPlaceBack([pt(iso)], w)
      expect(back).not.toBeNull()
      if (back === 0) expect(w.to - ms).toBeLessThan(60_000) // "nothing behind us", and it is true
      else expect(w.to - back! * 60_000).toBeGreaterThanOrEqual(ms)
    }
  })

  it('an unparseable first row is skipped rather than taken as the start', () => {
    const points = [pt('not-a-date'), pt('2026-08-18T18:00:00Z')]
    expect(firstPlaceBack(points, w)).toBe(18 * 60)
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

  it('always run furthest-back first — clamping fixed the value, not the order', () => {
    // A 90-minute span used to render -1.5 h · -45 min · -23 min · -1 h · now, where the fourth
    // button jumped further back than the third.
    for (const span of [1, 12, 45, 61, 90, 180, 200, 720, 1440]) {
      const ms = quickJumps(span).map((q) => q.m)
      expect(ms, `span ${span}`).toEqual([...ms].sort((a, b) => b - a))
      expect(new Set(ms).size).toBe(ms.length)
      expect(Math.max(...ms)).toBeLessThanOrEqual(span)
    }
  })

  it('always ends at "now"', () => {
    for (const span of [1, 12, 60, 720, 1440]) expect(quickJumps(span).at(-1)?.m).toBe(0)
  })
})

describe('pairing points with pre-parsed timestamps', () => {
  const w = { from: Date.parse('2026-08-18T12:00:00Z'), to: Date.parse('2026-08-19T12:00:00Z') }

  it('a times array of the wrong LENGTH is refused, not partially believed', () => {
    // The realistic mismatch is a memo that has not caught up with a refetched track. Length is the
    // only mismatch detectable from here — a same-length array from another track is indetectable,
    // which is why the pairing is the caller's contract and both memos derive from the same
    // `points` in the same render. This guards the half that CAN be checked.
    const points = [pt('2026-08-18T13:00:00Z'), pt('2026-08-18T14:00:00Z')]
    const stale = [Date.parse('2000-01-01T00:00:00Z')] // one row short, wildly wrong value
    expect(firstPlaceBack(points, w, stale)).toBe(firstPlaceBack(points, w))
    expect(firstPlaceBack(points, w, [...stale, 0, 0])).toBe(firstPlaceBack(points, w))
  })

  it('a matching times array gives exactly the answer parsing would', () => {
    const points = [pt('2026-08-18T13:00:00Z'), pt('2026-08-18T14:00:00Z')]
    const times = points.map((p) => Date.parse(p.fixTime))
    expect(firstPlaceBack(points, w, times)).toBe(firstPlaceBack(points, w))
  })
})

describe('panning and days — travelling through history, not just watching its edge', () => {
  const NOW = Date.parse('2026-08-31T14:00:00Z')
  const H = 3_600_000

  it('a live view follows the present; an anchored one does not', () => {
    const live = viewWindow({ spanH: 24, anchorTo: null }, NOW)
    const later = viewWindow({ spanH: 24, anchorTo: null }, NOW + 2 * H)
    expect(later.to).toBeGreaterThan(live.to)

    const pinned = { spanH: 24, anchorTo: NOW - 12 * H }
    expect(viewWindow(pinned, NOW)).toEqual(viewWindow(pinned, NOW + 2 * H))
  })

  it('panning back moves the window; panning forward past now RETURNS to live', () => {
    // the defect this exists for: zoom narrowed onto the present and there was no way to travel
    const back = panView({ spanH: 6, anchorTo: null }, -12 * H, NOW)
    expect(back.anchorTo).toBe(NOW - 12 * H)
    expect(isLive(back)).toBe(false)

    // pinning the edge AT "now" would look live and silently stop advancing — so it snaps to live
    expect(isLive(panView(back, 999 * H, NOW))).toBe(true)
    expect(isLive(panView({ spanH: 6, anchorTo: NOW - H }, 2 * H, NOW))).toBe(true)
  })

  it('refuses to pan past the day floor — an unfetched window renders as a broken device', () => {
    const far = panView({ spanH: 24, anchorTo: null }, -60 * 24 * H, NOW)
    expect(far.anchorTo).not.toBeNull()
    expect(viewWindow(far, NOW).from).toBeGreaterThanOrEqual(panFloor(NOW) - 1)
  })

  it('zoom keeps the live edge live, and holds the CENTRE once panned', () => {
    // at the live edge, narrowing means "just now" — pressing + must not drag you off live
    expect(isLive(zoomView({ spanH: 24, anchorTo: null }, 1, NOW))).toBe(true)

    // panned: the stretch on screen stays on screen instead of teleporting
    const panned = { spanH: 24, anchorTo: NOW - 24 * H } // covers -48 h … -24 h, centre -36 h
    const zoomed = zoomView(panned, 6, NOW)
    const w = viewWindow(zoomed, NOW)
    const centre = (w.from + w.to) / 2
    expect(Math.abs(centre - (NOW - 36 * H))).toBeLessThanOrEqual(WINDOW_BUCKET_MS)
  })

  it('day boundaries are LOCAL midnights, and survive the clocks going back', () => {
    // Europe/Vilnius left DST on 2026-10-25: that local day is 25 hours long. Millisecond
    // arithmetic (`now - 86_400_000`) lands an hour off, which is the shortcut rule 7 bans.
    const afterDst = Date.parse('2026-10-26T12:00:00Z')
    const d0 = zonedDayStart(0, 'Europe/Vilnius', afterDst)
    const d1 = zonedDayStart(1, 'Europe/Vilnius', afterDst)
    expect(d0 - d1).toBe(25 * H)

    // and each boundary really is midnight in that zone, not 23:00 or 01:00
    for (const back of [0, 1, 2, 5]) {
      const ms = zonedDayStart(back, 'Europe/Vilnius', afterDst)
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
      expect(local).toBe('00:00')
    }
  })

  it('"today" is the live window, not an empty calendar day', () => {
    // at 09:00 a midnight-to-midnight "today" would be three quarters unlived
    expect(isLive(dayView(0, 'Europe/Vilnius', NOW))).toBe(true)
    const yesterday = dayView(1, 'Europe/Vilnius', NOW)
    expect(isLive(yesterday)).toBe(false)
    const w = viewWindow(yesterday, NOW)
    expect(w.to - w.from).toBe(24 * H)
    expect(w.to).toBeLessThanOrEqual(NOW)
  })
})
