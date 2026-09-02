/**
 * Where the timeline's clock labels go.
 *
 * Split out of the component because it is arithmetic, and because the bug it fixes is arithmetic:
 * the cadence used to be chosen from the WINDOW'S LENGTH alone, which is only half the question.
 * Eight labels across a 24 h view sit comfortably on a wide workspace and print on top of each
 * other the moment the map panel narrows — "15:0018:0021:0000:00…" run together into one smear on
 * the dock of the product's most-used page.
 */

/** Minor tick marks in the axis strip. */
export const tickStepMin = (spanMin: number) => (spanMin >= 1440 ? 60 : spanMin >= 360 ? 30 : spanMin >= 180 ? 15 : 5)

/** The cadence the SPAN alone would like: coarse windows get coarse labels. */
export const labelStepMin = (spanMin: number) =>
  spanMin >= 1440 ? 180 : spanMin >= 720 ? 120 : spanMin >= 360 ? 60 : spanMin >= 180 ? 30 : 15

/** Room one "14:00" needs, including the gap to its neighbour. */
export const LABEL_PX = 46

/**
 * The coarsest cadence that FITS: keep doubling the span's own step until the labels stop
 * colliding, then snap back onto the tick grid so a label always sits on a mark.
 *
 * `widthPx === 0` means the strip has not been measured yet (first paint, or no ResizeObserver);
 * the span's cadence is the honest answer there, not a guess at a width.
 */
export function fittedLabelMs(spanMs: number, tickMs: number, widthPx: number): number {
  let labelMs = labelStepMin(spanMs / 60_000) * 60_000
  if (widthPx <= 0) return labelMs
  const room = Math.max(2, Math.floor(widthPx / LABEL_PX))
  while (spanMs / labelMs > room) labelMs *= 2
  return Math.max(tickMs, Math.round(labelMs / tickMs) * tickMs)
}

/**
 * How close to an edge a label may sit before it lands under the fixed "now" marker.
 *
 * The old guard was a flat `pct < 95`, and a percentage is the wrong unit for a fixed-width word:
 * 5 % of a wide strip clears "now" easily, and 5 % of a narrow one is barely twenty pixels, so the
 * last clock label printed straight through it.
 */
export function edgeGuardPct(widthPx: number): number {
  return widthPx > 0 ? (LABEL_PX / widthPx) * 100 : 5
}
