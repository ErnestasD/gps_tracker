import { describe, expect, it } from 'vitest'

import {
  SHEET_DEFAULT_FRACTION,
  SHEET_MAX_FRACTION,
  SHEET_MIN_PX,
  SHEET_PEEK_PX,
  SHEET_PEEK_THRESHOLD_PX,
  SHEET_STORAGE_KEY,
  initialSheetHeight,
  maxSheetHeight,
  readStoredSheet,
  refitSheet,
  resolveSheet,
  writeStoredSheet,
} from '@/lib/sheet'

/**
 * The inspector sheet's geometry.
 *
 * The demo's copy of the dashboard's geometry — tested here too, because a copy that silently
 * drifts is worse than no copy at all.
 *
 * It was a fixed 60 % of the viewport, which on a laptop covers the map the panel is describing.
 * Everything here is about the ways a draggable panel goes wrong out of sight: growing past its
 * container, swallowing a small drag, or restoring a height from a window that no longer exists.
 */
describe('sheet geometry', () => {
  const TALL = 900
  const SHORT = 300

  it('never lets the sheet cover the whole map', () => {
    for (const container of [SHORT, 500, TALL, 1400]) {
      expect(maxSheetHeight(container)).toBeLessThanOrEqual(container * SHEET_MAX_FRACTION + 1)
    }
  })

  it('keeps a usable minimum even in a container too short to honour the fraction', () => {
    // 0.9 * 120 = 108, below the minimum an open sheet needs; the minimum wins
    expect(maxSheetHeight(120)).toBe(SHEET_MIN_PX)
  })

  it('collapses to the peek strip when dragged below the threshold', () => {
    expect(resolveSheet(SHEET_PEEK_THRESHOLD_PX - 1, TALL)).toEqual({ heightPx: SHEET_PEEK_PX, peek: true })
    expect(resolveSheet(0, TALL)).toEqual({ heightPx: SHEET_PEEK_PX, peek: true })
    // a drag past the bottom of the screen is still just "put it away"
    expect(resolveSheet(-400, TALL)).toEqual({ heightPx: SHEET_PEEK_PX, peek: true })
  })

  it('opens rather than clamping when dragged just above the threshold', () => {
    const r = resolveSheet(SHEET_PEEK_THRESHOLD_PX + 1, TALL)
    expect(r.peek).toBe(false)
    expect(r.heightPx).toBe(SHEET_MIN_PX)
  })

  it('clamps an open sheet to the container, so it cannot push its own header off-screen', () => {
    const r = resolveSheet(5_000, TALL)
    expect(r.peek).toBe(false)
    expect(r.heightPx).toBe(maxSheetHeight(TALL))
    expect(r.heightPx).toBeLessThan(TALL)
  })

  it('treats a non-finite drag as "put it away" rather than sizing to NaN', () => {
    expect(resolveSheet(Number.NaN, TALL).peek).toBe(true)
  })

  it('opens at the default share when nothing is remembered', () => {
    expect(initialSheetHeight(TALL, null)).toBe(Math.round(TALL * SHEET_DEFAULT_FRACTION))
  })

  it('honours a remembered height, and a remembered peek', () => {
    expect(initialSheetHeight(TALL, 300)).toBe(300)
    expect(initialSheetHeight(TALL, SHEET_PEEK_PX)).toBe(SHEET_PEEK_PX)
  })

  it('shrinks a height remembered from a taller window', () => {
    // 700px was fine on a 900px map; on a 300px one it would cover everything
    expect(initialSheetHeight(SHORT, 700)).toBe(maxSheetHeight(SHORT))
  })

  it('re-clamps on resize but never re-opens a sheet that was put away', () => {
    expect(refitSheet({ heightPx: 700, peek: false }, SHORT)).toEqual({ heightPx: maxSheetHeight(SHORT), peek: false })
    expect(refitSheet({ heightPx: SHEET_PEEK_PX, peek: true }, SHORT)).toEqual({ heightPx: SHEET_PEEK_PX, peek: true })
    // a sheet that already fits is left exactly as the reader placed it
    expect(refitSheet({ heightPx: 240, peek: false }, TALL)).toEqual({ heightPx: 240, peek: false })
  })
})

describe('sheet persistence', () => {
  const store = (initial: Record<string, string>) => {
    const map = new Map(Object.entries(initial))
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      read: (k: string) => map.get(k) ?? null,
    }
  }

  it('round-trips a height', () => {
    const s = store({})
    writeStoredSheet(s, 312.7)
    expect(s.read(SHEET_STORAGE_KEY)).toBe('313')
    expect(readStoredSheet(s)).toBe(313)
  })

  it('ignores junk rather than sizing the panel from it', () => {
    expect(readStoredSheet(store({ [SHEET_STORAGE_KEY]: 'tall' }))).toBeNull()
    expect(readStoredSheet(store({ [SHEET_STORAGE_KEY]: '-5' }))).toBeNull()
    expect(readStoredSheet(store({}))).toBeNull()
  })

  it('survives storage that throws (private mode) without taking the page with it', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readStoredSheet(throwing)).toBeNull()
    expect(() => writeStoredSheet(throwing, 200)).not.toThrow()
  })

  it('is a no-op where there is no storage at all (SSR)', () => {
    expect(readStoredSheet(undefined)).toBeNull()
    expect(() => writeStoredSheet(undefined, 200)).not.toThrow()
  })
})
