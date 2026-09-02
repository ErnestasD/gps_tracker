import { describe, expect, it } from 'vitest'

import { LABEL_PX, edgeGuardPct, fittedLabelMs, tickStepMin } from '../src/lib/timelineAxis'

const H = 3_600_000

/**
 * Axis labels must be chosen from the ROOM THERE IS, not from the span alone.
 *
 * The cadence was picked from the window's length only, so a 24 h view always asked for eight
 * clock labels — comfortable on a wide workspace and a smear once the map panel narrowed. The
 * founder's screenshot shows "15:0018:0021:0000:00…" printed on top of itself, on the dock of the
 * product's most-used page.
 */
describe('timeline axis cadence', () => {
  const widths = [220, 300, 420, 640, 900, 1400]

  for (const span of [1 * H, 6 * H, 12 * H, 24 * H]) {
    for (const width of widths) {
      it(`fits ${span / H} h into ${width}px without overlapping labels`, () => {
        const tickMs = tickStepMin(span / 60_000) * 60_000
        const labelMs = fittedLabelMs(span, tickMs, width)
        const labels = span / labelMs
        // every label needs LABEL_PX of room; one more than fits is one that overprints
        expect(labels).toBeLessThanOrEqual(Math.max(2, Math.floor(width / LABEL_PX)))
      })
    }
  }

  it('keeps labels on the tick grid, so a label always sits on a mark', () => {
    for (const span of [1 * H, 6 * H, 24 * H]) {
      const tickMs = tickStepMin(span / 60_000) * 60_000
      for (const width of widths) {
        expect(fittedLabelMs(span, tickMs, width) % tickMs).toBe(0)
      }
    }
  })

  it('never asks for fewer than two labels, however narrow', () => {
    const tickMs = tickStepMin(24 * 60) * 60_000
    expect(24 * H / fittedLabelMs(24 * H, tickMs, 40)).toBeGreaterThanOrEqual(2)
  })

  it('leaves the span-derived cadence alone when it already fits', () => {
    const tickMs = tickStepMin(24 * 60) * 60_000
    // 24 h wants a label every 3 h = 8 labels; 1400px holds 30
    expect(fittedLabelMs(24 * H, tickMs, 1400)).toBe(3 * H)
  })

  it('falls back to the span cadence when the width is unknown (first paint)', () => {
    const tickMs = tickStepMin(24 * 60) * 60_000
    expect(fittedLabelMs(24 * H, tickMs, 0)).toBe(3 * H)
  })
})

describe('timeline edge guard', () => {
  it('keeps a fixed-width word clear of the "now" marker at any strip width', () => {
    for (const width of [180, 300, 640, 1400]) {
      // the guard, converted back to pixels, must always be at least one label wide
      expect((edgeGuardPct(width) / 100) * width).toBeCloseTo(LABEL_PX, 5)
    }
  })

  it('falls back to a percentage before the strip is measured', () => {
    expect(edgeGuardPct(0)).toBe(5)
  })
})
