import { distanceFromM, hoursFromS, sanitizeUnits, speedFromKmh, volumeFromL, METRIC_UNITS, type DisplayUnits } from '@orbetra/shared'

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

/** Litres in → the account's volume unit, one decimal. */
export function volumeL(l: number, units: DisplayUnits = METRIC_UNITS): string {
  return volumeFromL(l, units.volume).toFixed(1)
}

/** Raw stored seconds → hours, one decimal (3600 → "1.0"). Hours are hours in every unit system. */
export function secondsToHours(s: number): string {
  return hoursFromS(s).toFixed(1)
}
