import { getJson } from './client'

/**
 * Usage metering client (E07-4). Device-day = the device reported at least once during that
 * UTC day (billing semantics, §6.9). Platform summary is platform_admin-only server-side.
 */
export interface PlatformUsageRow {
  tenantId: string
  deviceDays: number
  activeDevices: number
}
export interface TenantUsageRow {
  day: string
  deviceDays: number
}

const range = (from?: string, to?: string): string => {
  const p = new URLSearchParams()
  if (from) p.set('from', from)
  if (to) p.set('to', to)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const platformUsage = (from?: string, to?: string) => getJson<PlatformUsageRow[]>(`/v1/platform/usage${range(from, to)}`)
export const tenantUsage = (from?: string, to?: string) => getJson<TenantUsageRow[]>(`/v1/usage${range(from, to)}`)

/** First day of the current UTC month, YYYY-MM-DD — the default billing window start. */
export function monthStartUtc(now = new Date()): string {
  return `${now.toISOString().slice(0, 8)}01`
}
