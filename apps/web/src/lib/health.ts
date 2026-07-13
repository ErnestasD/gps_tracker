import { getJson } from './client'

export interface HealthSample {
  fixTime: string
  gsm: number | null
  extV: number | null
  battV: number | null
}
export interface HealthResponse {
  series: HealthSample[]
  latest: HealthSample | null
  firmware: string | null
  lastSeen: string | null
}

export const getHealth = (deviceId: string) => getJson<HealthResponse>(`/v1/devices/${encodeURIComponent(deviceId)}/health`)

/** Pick a voltage series to chart (external preferred; battery fallback). Pure. */
export function voltageSeries(samples: readonly HealthSample[]): { label: 'ext' | 'batt'; values: number[] } {
  const hasExt = samples.some((s) => s.extV !== null)
  const label = hasExt ? 'ext' : 'batt'
  const values = samples.map((s) => (hasExt ? s.extV : s.battV)).filter((v): v is number => v !== null)
  return { label, values }
}
