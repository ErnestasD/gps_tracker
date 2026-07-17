import { useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { getDisplayPrefs, onPrefsChange, type DisplayPrefs, type DistanceUnit, type SpeedUnit, type VolumeUnit } from './prefs'

/**
 * Unit conversion + display formatting driven by the global display preferences
 * (settings → Rodymo nustatymai). Converters and fmt* are PURE (unit-tested);
 * useUnits() binds them to the live prefs + i18n unit labels for components.
 * Storage stays metric everywhere (km/h, metres, litres) — conversion happens at render only.
 */

export const KM_PER_MI = 1.609344
export const L_PER_GAL = 3.785411784 // US gallon

export const kmToMi = (km: number): number => km / KM_PER_MI
export const kmhToMph = (kmh: number): number => kmh / KM_PER_MI
export const lToGal = (l: number): number => l / L_PER_GAL

/** Round to 1 decimal, dropping a trailing .0 → '12', '12.3'. Pure. */
export const round1 = (v: number): number => Math.round(v * 10) / 10

/** Translator shape we need from react-i18next's t (structural — the lib stays UI-free). */
export type TFn = (key: string, options?: Record<string, unknown>) => string

/** '72 km/h' / '45 mph' (localized unit label, integer value). Pure. */
export function fmtSpeed(kmh: number, unit: SpeedUnit, t: TFn): string {
  return unit === 'mph' ? `${Math.round(kmhToMph(kmh))} ${t('units.mph')}` : `${Math.round(kmh)} ${t('units.kmh')}`
}

/** '12.3 km' / '7.6 mi' (1 decimal, trailing .0 dropped). Pure. */
export function fmtDistanceKm(km: number, unit: DistanceUnit, t: TFn): string {
  return unit === 'mi' ? `${round1(kmToMi(km))} ${t('units.mi')}` : t('units.km', { n: round1(km) })
}

/** '41.5 l' / '11.0 gal' (litres in, 1 decimal out). Pure. */
export function fmtVolumeL(l: number, unit: VolumeUnit, t: TFn): string {
  return unit === 'gal' ? `${lToGal(l).toFixed(1)} ${t('units.gal')}` : `${l.toFixed(1)} ${t('units.l')}`
}

export interface Units {
  prefs: DisplayPrefs
  /** km/h in → '72 km/h' / '45 mph'. */
  speed: (kmh: number) => string
  /** km in → '12.3 km' / '7.6 mi'. */
  distanceKm: (km: number) => string
  /** metres in → '12.3 km' / '7.6 mi'. */
  distanceM: (m: number) => string
  /** litres in → '41.5 l' / '11.0 gal'. */
  volumeL: (l: number) => string
  /** km in → the numeric value in the preferred unit (1 decimal) — for charts/tables. */
  toDistance: (km: number) => number
  /** bare unit label for axis/suffix use: 'km' / 'mi'. */
  distanceLabel: string
}

/** Formatters bound to the live display prefs + current language; re-renders on either change. */
export function useUnits(): Units {
  const { t } = useTranslation()
  const prefs = useSyncExternalStore(onPrefsChange, getDisplayPrefs)
  return useMemo(
    () => ({
      prefs,
      speed: (kmh: number) => fmtSpeed(kmh, prefs.unitSpeed, t),
      distanceKm: (km: number) => fmtDistanceKm(km, prefs.unitDistance, t),
      distanceM: (m: number) => fmtDistanceKm(m / 1000, prefs.unitDistance, t),
      volumeL: (l: number) => fmtVolumeL(l, prefs.unitVolume, t),
      toDistance: (km: number) => round1(prefs.unitDistance === 'mi' ? kmToMi(km) : km),
      distanceLabel: prefs.unitDistance === 'mi' ? t('units.mi') : t('units.kmLabel'),
    }),
    [prefs, t],
  )
}
