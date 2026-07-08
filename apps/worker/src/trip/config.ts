import { DEFAULT_THRESHOLDS, type DeviceTripConfig, type TripThresholds } from './engine.js'

/** Odometer-distance preference stored per device (E04-5). */
export type OdometerSource = DeviceTripConfig['odometerSource']

// a threshold must be a finite, NON-NEGATIVE number; a garbage/negative rule (e.g.
// movingSustainS:-1 would open a trip on the first record) falls back to the default (M1).
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback)

/**
 * Map a profile's `presence_rules` jsonb (§6.4, device_profiles seed) onto the engine's
 * full TripThresholds, filling any key the profile omits from DEFAULT_THRESHOLDS. So an
 * asset profile `{ noIgnition:true, moveSpeedKmh:3, movingSustainS:300, parkedDisplaceM:100 }`
 * yields a complete threshold set with sane defaults for the rest.
 */
export function thresholdsFromRules(rules: Record<string, unknown> | null | undefined): TripThresholds {
  const r = rules ?? {}
  return {
    moveSpeedKmh: num(r['moveSpeedKmh'], DEFAULT_THRESHOLDS.moveSpeedKmh),
    movingSustainS: num(r['movingSustainS'], DEFAULT_THRESHOLDS.movingSustainS),
    movingDisplaceM: num(r['movingDisplaceM'], DEFAULT_THRESHOLDS.movingDisplaceM),
    parkedIgnitionOffS: num(r['parkedIgnitionOffS'], DEFAULT_THRESHOLDS.parkedIgnitionOffS),
    idleSpeedKmh: num(r['idleSpeedKmh'], DEFAULT_THRESHOLDS.idleSpeedKmh),
    idleSustainS: num(r['idleSustainS'], DEFAULT_THRESHOLDS.idleSustainS),
    noIgnition: r['noIgnition'] === true,
    parkedDisplaceM: num(r['parkedDisplaceM'], DEFAULT_THRESHOLDS.parkedDisplaceM),
    parkedStopS: num(r['parkedStopS'], DEFAULT_THRESHOLDS.parkedStopS),
  }
}

const ODO_SOURCES: readonly OdometerSource[] = ['auto', 'device', 'gps']
export const asOdometerSource = (s: unknown): OdometerSource => (ODO_SOURCES.includes(s as OdometerSource) ? (s as OdometerSource) : 'auto')

export function deviceTripConfig(presenceRules: Record<string, unknown> | null | undefined, odometerSource: unknown): DeviceTripConfig {
  return { thresholds: thresholdsFromRules(presenceRules), odometerSource: asOdometerSource(odometerSource) }
}
