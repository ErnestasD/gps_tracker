/**
 * Shared query-date sanitizer (E04-3 review MED; consolidation of 9 copy-pasted `validDate`
 * helpers that had drifted into three different semantics — the drift produced the unbounded-date
 * 500 in events/audit/trips). A JS `Date` spans far wider than Postgres `timestamptz`
 * (4713 BC … 294276 AD), so a JS-VALID but pg-INVALID expanded-year ISO date (e.g.
 * '-100000-01-01T00:00:00Z') passes `!isNaN` yet makes pg raise "time zone displacement out of
 * range" → an uncaught 500. Bounds are kept well inside both ranges.
 */
export const PG_MIN_MS = Date.parse('0001-01-01T00:00:00Z')
export const PG_MAX_MS = Date.parse('9999-12-31T23:59:59Z')
const MIN_MS = PG_MIN_MS
const MAX_MS = PG_MAX_MS

/** True only for a string that parses to a date pg can store. Undefined/NaN/out-of-range → false. */
export function isPgSafeDate(s: string | undefined): boolean {
  if (s === undefined) return false
  const t = new Date(s).getTime()
  return !Number.isNaN(t) && t >= MIN_MS && t <= MAX_MS
}

/** The parsed Date when pg-safe, else null — for repos that pass a Date straight into a filter. */
export function pgSafeDate(s: string | undefined): Date | null {
  return isPgSafeDate(s) ? new Date(s!) : null
}
