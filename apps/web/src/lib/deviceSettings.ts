import {
  estimateDataUsage,
  type AvailableSetting,
  type SettingKey,
} from '@orbetra/shared'

import { getJson, mutate } from './client'

/**
 * Tracking-settings client. The bounds, the units and the data estimate all come from
 * `@orbetra/shared` so the slider cannot offer a value the API would refuse — the same catalogue
 * validates the write server-side.
 */

/** Where a requested change has got to, as the API reports it. */
export type ChangeState = 'waiting' | 'sent' | 'confirmed' | 'rejected' | 'undelivered'

export interface CurrentSetting {
  value: number | null
  checkedAt: string | null
  requested: number | null
  state: ChangeState | null
}

export interface SettingsResponse {
  available: AvailableSetting[]
  current: Record<string, CurrentSetting>
  profile: 'home'
}

export const getDeviceSettings = (deviceId: string) =>
  getJson<SettingsResponse>(`/v1/devices/${encodeURIComponent(deviceId)}/settings`)

/**
 * Ask the device what it currently holds.
 *
 * The page reports only what the DEVICE last told us, so a change made anywhere else — an SMS, the
 * command console, a technician with a laptop — stays invisible until someone asks again. Reads are
 * free over GPRS and cannot misconfigure anything, so this is always available, even to a viewer.
 */
export const refreshDeviceSettings = (deviceId: string) =>
  mutate<{ queued: boolean; commandId: string }>(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/settings/refresh`,
    {},
  )

export const saveDeviceSettings = (deviceId: string, changes: Record<string, number>) =>
  mutate<{ queued: boolean; commandId: string; verifyCommandId: string; text: string }>(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/settings`,
    { changes },
  )

/**
 * The value to show for a setting: what the DEVICE last reported, falling back to what the customer
 * asked for while that is still in flight.
 *
 * Never the factory default. A slider parked on a number nobody has confirmed is the same lie as a
 * marker at 0,0 — it looks like knowledge and is not.
 */
export const displayValue = (c: CurrentSetting | undefined): number | null =>
  c?.value ?? (c?.state === 'waiting' || c?.state === 'sent' ? c.requested : null)

/** True while the device has not yet had its say about a change the customer made. */
export const isInFlight = (c: CurrentSetting | undefined): boolean =>
  c?.state === 'waiting' || c?.state === 'sent'

/** True when the device answered and holds something OTHER than what was asked for. */
export const isRejected = (c: CurrentSetting | undefined): boolean => c?.state === 'rejected'

/**
 * Mobile data the CURRENT slider positions cost, recomputed as they move.
 *
 * `avgSpeedKmh` is a stated assumption, not a measurement: the distance trigger's record rate
 * depends on how fast the vehicle goes, and 50 km/h is a mixed urban figure. The UI says so rather
 * than presenting the number as exact.
 */
export const ASSUMED_SPEED_KMH = 50
export const ASSUMED_DRIVING_HOURS = 8

export function estimateFor(values: Partial<Record<SettingKey, number>>): { perDrivingDayMB: number; perMonthMB: number } {
  const send = values.movingSendPeriod
  if (send === undefined) return { perDrivingDayMB: 0, perMonthMB: 0 }
  return estimateDataUsage(
    {
      ...(values.movingByTime !== undefined ? { byTimeSeconds: values.movingByTime } : {}),
      ...(values.movingByDistance !== undefined ? { byDistanceMetres: values.movingByDistance } : {}),
      avgSpeedKmh: ASSUMED_SPEED_KMH,
      sendEverySeconds: send,
    },
    ASSUMED_DRIVING_HOURS,
  )
}

/**
 * What to send: ONLY settings the customer physically moved.
 *
 * This takes the DRAFT — the record of what they actually touched — and never the slider positions,
 * which fall back to the factory value so the thumb has somewhere to sit. Iterating positions meant
 * that on a device that had never answered a `getparam`, opening the card armed Save with six
 * factory values nobody had chosen, and one click overwrote whatever the installer had configured.
 * On FMB640/FMC650/FMM650 that would have cut a truck's record period from 3600 s to 300 s — a 12×
 * traffic increase — which is precisely the scenario the catalogue's own docstring warns about.
 *
 * The rule is the same one the whole feature turns on: a number nobody confirmed is not a number we
 * act on. It applies to what we display AND to what we transmit.
 */
export function changedOnly(
  draft: Partial<Record<SettingKey, number>>,
  current: Record<string, CurrentSetting>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined) continue
    const known = current[key]
    // Re-sending a value the device already holds is a wasted command and, on a parked device,
    // 24 h of a "waiting" badge for a change that changes nothing. This applies to a REJECTED
    // setting too: after a rejection the slider shows what the device kept, so an "retry" that
    // re-sent that number would be a guaranteed no-op returning `confirmed` and looking like
    // success. The customer has to choose a different value, and the badge tells them so.
    if (known?.value === value) continue
    // …and re-sending one that is already on its way duplicates a command still in the queue.
    if (known !== undefined && isInFlight(known) && known.requested === value) continue
    out[key] = value
  }
  return out
}

/**
 * Everything the settings card needs, computed in ONE place.
 *
 * `positions` and `pending` are derived together and returned together because keeping them apart
 * is what caused the worst defect this screen has had: the card passed slider POSITIONS to the save
 * path, and positions fall back to the factory value, so an untouched card armed Save with six
 * numbers nobody had chosen. Two similarly-shaped records and one call site is all it takes.
 *
 * With one function there is no second argument to confuse: `pending` is always derived from the
 * draft, and a caller cannot ask for it any other way.
 */
export function settingsView(
  available: readonly AvailableSetting[],
  current: Record<string, CurrentSetting>,
  draft: Partial<Record<SettingKey, number>>,
): {
  positions: Partial<Record<SettingKey, number>>
  pending: Record<string, number>
  dirty: boolean
} {
  const positions: Partial<Record<SettingKey, number>> = {}
  for (const s of available) {
    // the customer's unsaved edit, else what the DEVICE said, else the factory value as a resting
    // place for the thumb — that last one is a position only, never a value we would transmit
    positions[s.key] = draft[s.key] ?? displayValue(current[s.key]) ?? s.factory
  }
  const pending = changedOnly(draft, current)
  return { positions, pending, dirty: Object.keys(pending).length > 0 }
}
