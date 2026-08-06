import { z } from 'zod'

/**
 * Display UNITS — the one definition of what "mph" means, shared by the browser and the server.
 *
 * Storage is metric everywhere (metres, km/h, litres, seconds); conversion happens at RENDER, and
 * until now it happened in exactly one place: `apps/web/src/lib/units.ts`. That was fine while the
 * browser was the only renderer. It no longer is — alert emails, Telegram messages and scheduled
 * report tables are rendered by the WORKER, which cannot import the web bundle, so closing the
 * account-settings debt meant either a second copy of these constants or one shared module.
 *
 * A second copy is how a dashboard that says 62.1 mi and a report that says 62.2 mi come to exist:
 * nobody writes `1.609` on purpose, they write it once correctly and then again from memory. The
 * conversion factors here are exact by definition (the international mile is 1609.344 m; the US
 * liquid gallon is 3.785411784 L), so a drift between the two renderers can only ever be a bug.
 */

export const SPEED_UNITS = ['kmh', 'mph'] as const
export const DISTANCE_UNITS = ['km', 'mi'] as const
export const VOLUME_UNITS = ['l', 'gal'] as const

export type SpeedUnit = (typeof SPEED_UNITS)[number]
export type DistanceUnit = (typeof DISTANCE_UNITS)[number]
export type VolumeUnit = (typeof VOLUME_UNITS)[number]

export const speedUnitSchema = z.enum(SPEED_UNITS)
export const distanceUnitSchema = z.enum(DISTANCE_UNITS)
export const volumeUnitSchema = z.enum(VOLUME_UNITS)

/** The three unit choices as one value — what a renderer needs to format anything we measure. */
export interface DisplayUnits {
  speed: SpeedUnit
  distance: DistanceUnit
  volume: VolumeUnit
}

/** The default, and what STORAGE always is. An account that never touches Settings gets this. */
export const METRIC_UNITS: DisplayUnits = { speed: 'kmh', distance: 'km', volume: 'l' }

/** Exact by definition — international mile, US liquid gallon. */
export const KM_PER_MI = 1.609344
export const L_PER_GAL = 3.785411784

export const kmToMi = (km: number): number => km / KM_PER_MI
export const miToKm = (mi: number): number => mi * KM_PER_MI
export const kmhToMph = (kmh: number): number => kmh / KM_PER_MI
export const lToGal = (l: number): number => l / L_PER_GAL

/** Round to 1 decimal, dropping a trailing .0 → 12, 12.3. */
export const round1 = (v: number): number => Math.round(v * 10) / 10

/**
 * Unknown input → a valid DisplayUnits, each field falling back INDEPENDENTLY.
 *
 * The input is a DB row or parsed JSON: a column added by a later migration reads `undefined` on an
 * old row, and a value written by a future version reads as a string this build has never heard of.
 * Neither may throw inside an email renderer — a formatting fault must never drop a notification.
 */
export function sanitizeUnits(v: unknown): DisplayUnits {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  const valid = <T extends string>(raw: unknown, allowed: readonly T[]): T | undefined =>
    typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined
  // Both spellings are accepted — `speed` from a DisplayUnits value, `unitSpeed` from a DB row — and
  // the first VALID one wins, not the first PRESENT one. With `??` an object carrying both (a row
  // merged into a partial DisplayUnits) would let a junk `speed` shadow a perfectly good
  // `unitSpeed` and silently fall back to metric.
  const pick = <T extends string>(a: unknown, b: unknown, allowed: readonly T[], fallback: T): T =>
    valid(a, allowed) ?? valid(b, allowed) ?? fallback
  return {
    speed: pick(o['speed'], o['unitSpeed'], SPEED_UNITS, METRIC_UNITS.speed),
    distance: pick(o['distance'], o['unitDistance'], DISTANCE_UNITS, METRIC_UNITS.distance),
    volume: pick(o['volume'], o['unitVolume'], VOLUME_UNITS, METRIC_UNITS.volume),
  }
}

// ── numeric conversion, no labels ────────────────────────────────────────────
// Callers attach their own (localized) unit label; these return the NUMBER only, so the same
// function serves a chart axis, a table cell and an email sentence.

/** metres → the value in the preferred distance unit, 1 decimal. */
export const distanceFromM = (m: number, u: DistanceUnit): number => round1(u === 'mi' ? kmToMi(m / 1000) : m / 1000)

/** km/h → the value in the preferred speed unit, rounded to a whole number (speeds are not precise
 *  to a tenth — a GPS speed is ±1 km/h at best, and a decimal implies accuracy that is not there). */
export const speedFromKmh = (kmh: number, u: SpeedUnit): number => Math.round(u === 'mph' ? kmhToMph(kmh) : kmh)

/** litres → the value in the preferred volume unit, 1 decimal. */
export const volumeFromL = (l: number, u: VolumeUnit): number => round1(u === 'gal' ? lToGal(l) : l)

/** seconds → hours, 1 decimal. Hours are hours in every locale — no unit choice, listed here so the
 *  duration rounding matches everything else rather than being reinvented per renderer. */
export const hoursFromS = (s: number): number => round1(s / 3600)
