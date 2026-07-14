import { getJson } from './client'

/** Latest CAN/OBD engine snapshot (V2). null response = the vehicle has no CAN adapter. */
export interface CanView {
  fixTime: string
  rpm: number | null
  coolantC: number | null
  engineLoadPct: number | null
  throttlePct: number | null
  speedKmh: number | null
  totalMileageKm: number | null
}

export const getCan = (deviceId: string) => getJson<CanView | null>(`/v1/devices/${encodeURIComponent(deviceId)}/can`)

/** true when the snapshot carries at least one engine value (else the panel hides — non-CAN vehicle). */
export function hasCanData(c: CanView | null | undefined): boolean {
  return c != null && (c.rpm != null || c.coolantC != null || c.engineLoadPct != null || c.throttlePct != null || c.speedKmh != null || c.totalMileageKm != null)
}
