/**
 * How tall the inspector's bottom sheet is, and where it settles when you let go.
 *
 * Below `xl` the inspector is a sheet over the map, and it was a fixed 60 % of the viewport: on a
 * laptop that is most of the screen, covering the very map the panel describes. Reading a
 * vehicle's parameters meant losing sight of where it is — the founder's "užstoja didžiąją dalį
 * ekrano". The sheet is dragged now, and it can be pushed almost all the way down to a header-only
 * strip and pulled back when needed.
 *
 * The arithmetic lives here rather than in the component because it is the part that can be wrong
 * in ways a screenshot will not show: a clamp that lets the sheet grow past the map, a peek
 * threshold that swallows a small drag, a stored height from a tall window applied to a short one.
 */

/**
 * Header-only: the grip plus the vehicle's name, status and close button.
 *
 * Sized against the taller of the two headers (the demo pads by 16, the dashboard by 12) rather
 * than the tighter one — at 52 the name was sliced through the middle in the demo, which reads as
 * a rendering fault rather than a collapsed panel.
 */
export const SHEET_PEEK_PX = 68

/** Below this a released drag means "put it away" rather than "make it small". */
export const SHEET_PEEK_THRESHOLD_PX = 108

/** Smallest useful open sheet — a header plus the metric tiles. */
export const SHEET_MIN_PX = 168

/** The sheet never covers the whole map: a strip of context always remains. */
export const SHEET_MAX_FRACTION = 0.9

/** What a freshly opened sheet takes, when the reader has expressed no preference. */
export const SHEET_DEFAULT_FRACTION = 0.55

export type SheetGeometry = { heightPx: number; peek: boolean }

/** The tallest the sheet may be in this container, never below the minimum it needs to be usable. */
export function maxSheetHeight(containerPx: number): number {
  return Math.max(SHEET_MIN_PX, Math.round(containerPx * SHEET_MAX_FRACTION))
}

/**
 * Where a dragged sheet comes to rest.
 *
 * Dragging DOWN past the threshold collapses to the peek strip rather than clamping at the
 * minimum: a drag that ends in a sheet you did not want, stuck at its smallest open size, is the
 * gesture failing to mean the obvious thing. Dragging back up from the peek re-opens it, so the
 * same gesture reverses itself.
 */
export function resolveSheet(rawPx: number, containerPx: number): SheetGeometry {
  if (!Number.isFinite(rawPx)) return { heightPx: SHEET_PEEK_PX, peek: true }
  if (rawPx <= SHEET_PEEK_THRESHOLD_PX) return { heightPx: SHEET_PEEK_PX, peek: true }
  const max = maxSheetHeight(containerPx)
  return { heightPx: Math.min(max, Math.max(SHEET_MIN_PX, Math.round(rawPx))), peek: false }
}

/** The opening height: the reader's remembered choice if it still fits, else the default share. */
export function initialSheetHeight(containerPx: number, storedPx: number | null): number {
  const max = maxSheetHeight(containerPx)
  if (storedPx !== null && Number.isFinite(storedPx) && storedPx > SHEET_PEEK_THRESHOLD_PX) {
    return Math.min(max, Math.max(SHEET_MIN_PX, Math.round(storedPx)))
  }
  // a remembered PEEK is honoured exactly — someone who put the sheet away meant it
  if (storedPx !== null && Number.isFinite(storedPx)) return SHEET_PEEK_PX
  return Math.min(max, Math.max(SHEET_MIN_PX, Math.round(containerPx * SHEET_DEFAULT_FRACTION)))
}

/**
 * Re-clamp on a container resize.
 *
 * A sheet sized on a tall window and restored on a short one would otherwise be taller than the
 * map it sits in — the panel would push its own close button off-screen. A peeked sheet stays
 * peeked: a resize is not a request to re-open it.
 */
export function refitSheet(current: SheetGeometry, containerPx: number): SheetGeometry {
  if (current.peek) return current
  const max = maxSheetHeight(containerPx)
  return current.heightPx <= max ? current : { heightPx: max, peek: false }
}

/** Keyboard nudge, in px per key press — the same grain as a small drag. */
export const SHEET_KEY_STEP_PX = 48

export const SHEET_STORAGE_KEY = 'orbetra.inspectorSheetPx'

/** The remembered height, or null when nothing usable is stored. */
export function readStoredSheet(store: Pick<Storage, 'getItem'> | undefined): number | null {
  if (store === undefined) return null
  try {
    const raw = store.getItem(SHEET_STORAGE_KEY)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    // private mode / disabled storage — a forgotten preference is not a failure worth reporting
    return null
  }
}

export function writeStoredSheet(store: Pick<Storage, 'setItem'> | undefined, px: number): void {
  if (store === undefined) return
  try {
    store.setItem(SHEET_STORAGE_KEY, String(Math.round(px)))
  } catch {
    /* ignore — see readStoredSheet */
  }
}
