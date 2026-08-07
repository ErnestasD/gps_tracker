import { distanceFromM, hoursFromS, kmhToMph, sanitizeUnits, speedFromKmh, volumeFromL, METRIC_UNITS, type DisplayUnits } from '@orbetra/shared'

/**
 * Self-contained worker-side formatting for USER-FACING text (scheduled report emails +
 * alert notifications). PURE — unit-tested. This is NOT a locale system and does not import
 * the web i18n bundle; the WORDS live in ./strings.ts, the NUMBERS here.
 *
 * What it does, with the data the worker has:
 *   - raw STORAGE units → the ACCOUNT's display units (metres→km or mi, km/h→km/h or mph, l→l/gal),
 *   - seconds → hours,
 *   - UTC instants → the ACCOUNT timezone (CLAUDE.md rule 7) via Intl (no new dep).
 *
 * Conversion factors come from `@orbetra/shared` and are the SAME ones the browser uses — see the
 * note there on why a second copy is not an option.
 *
 * The DATE format stays `YYYY-MM-DD HH:mm`, 24-hour, in every language. That is deliberate and is
 * not the debt this closes: the web's `timeFormat`/`dateFormat` prefs govern what a browser draws,
 * where a locale-shaped date is read in context. A line in an e-mail has no context, and `03/04`
 * means two different days depending on who opens it — an unambiguous ISO-shaped stamp with an
 * explicit zone is the right choice for a message that outlives its screen.
 */
export type { DisplayUnits }
export { METRIC_UNITS, sanitizeUnits }

/** Trust only a resolvable IANA zone; an unknown/garbage zone falls back to UTC (never throws). */
export function safeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/** UTC instant → "YYYY-MM-DD HH:mm" rendered in the account zone (24h, zero-padded, deterministic).
 *  Uses Intl parts so the output is engine-stable and carries no naive Date math (rule 7). */
export function formatInZone(d: Date, timezone: string | null | undefined): string {
  const zone = safeZone(timezone)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}

/** Timestamp with an explicit zone suffix, e.g. "2026-07-18 17:23 (Europe/Vilnius)". */
export function formatWithZone(d: Date, timezone: string | null | undefined): string {
  const zone = safeZone(timezone)
  return `${formatInZone(d, zone)} (${zone})`
}

// ── numbers in the account's units ──────────────────────────────────────────
// Each returns the VALUE only; the caller attaches the localized unit label (strings.ts unitLabels),
// because the label's position and wording differ per language and per sentence.

/** Raw stored metres → the account's distance unit, one decimal (15234 m, metric → "15.2"). */
export function distanceM(m: number, units: DisplayUnits = METRIC_UNITS): string {
  return distanceFromM(m, units.distance).toFixed(1)
}

/** km/h in → the account's speed unit, whole number ("95", or "59" for mph). */
export function speedKmh(kmh: number, units: DisplayUnits = METRIC_UNITS): string {
  return String(speedFromKmh(kmh, units.speed))
}

/**
 * The two speeds of an overspeed alert, formatted so the sentence can never contradict itself.
 *
 * A device reports an integer km/h, so the smallest real overspeed is limit + 1 km/h — which is
 * 0.62 mph, and collapses to ONE integer for 68 of the 181 integer limits between 20 and 200,
 * including 30, 80, 120 and 130. Rounded independently, the alert then read "Speed 50 mph over limit
 * 50 mph": a 3am message asserting a contradiction, about the one thing it exists to report. Metric
 * is not immune either — a rule configured at 90.5 km/h and a fix at 91 rounds to "91 over 91".
 *
 * Whole numbers stay the default, because a GPS speed is not accurate to a tenth and a decimal
 * implies it is. The tenth appears ONLY when the two would otherwise print the same, which is
 * exactly when the reader needs it: 0.62 mph apart is unambiguous at one decimal.
 */
export function speedPair(speed: number, limit: number, units: DisplayUnits = METRIC_UNITS): { speed: string; limit: string } {
  const s = convertSpeed(speed, units)
  const l = convertSpeed(limit, units)
  const collides = Math.round(s) === Math.round(l)
  const fmt = (v: number): string => (collides ? v.toFixed(1) : String(Math.round(v)))
  return { speed: fmt(s), limit: fmt(l) }
}

/** km/h → the account's speed unit, UNROUNDED — only speedPair needs the raw value. */
function convertSpeed(kmh: number, units: DisplayUnits): number {
  return units.speed === 'mph' ? kmhToMph(kmh) : kmh
}

/** Litres in → the account's volume unit, one decimal. */
export function volumeL(l: number, units: DisplayUnits = METRIC_UNITS): string {
  return volumeFromL(l, units.volume).toFixed(1)
}

/** Raw stored seconds → hours, one decimal (3600 → "1.0"). Hours are hours in every unit system. */
export function secondsToHours(s: number): string {
  return hoursFromS(s).toFixed(1)
}
