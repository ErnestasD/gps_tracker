/**
 * Self-contained worker-side formatting for USER-FACING text (scheduled report emails +
 * alert notifications). PURE — unit-tested. This is NOT a locale system and does not import
 * the web i18n bundle.
 *
 * What it fixes server-side, with only the data the worker actually has:
 *   - human column LABELS instead of raw camelCase DB keys,
 *   - raw STORAGE units → display units (meters→km, seconds→hours),
 *   - UTC instants → the ACCOUNT timezone (CLAUDE.md rule 7) via Intl (no new dep).
 *
 * TODO(account-settings): text stays ENGLISH and distances/speeds stay canonical metric
 * (km, km/h). The per-user unit choice (km vs mi, km/h vs mph) and UI language are DEVICE-LOCAL
 * on the web (localStorage) — the server cannot know them. When accounts gain a locale + unit
 * preference, thread it in here (the account row already carries `timezone`, used below).
 */

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

/** Raw stored meters → km, one decimal (e.g. 15234 → "15.2"). */
export function metersToKm(m: number): string {
  return (m / 1000).toFixed(1)
}

/** Raw stored seconds → hours, one decimal (e.g. 3600 → "1.0"). */
export function secondsToHours(s: number): string {
  return (s / 3600).toFixed(1)
}
