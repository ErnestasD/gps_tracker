import { getJson, mutate } from './client'

/** Device shapes returned by the API (ids are stringified BigInt). */
export interface Device {
  id: string
  accountId: string
  profileId: string
  imei: string
  name: string
  plate: string | null
  groupName: string | null
  odometerSource: string
  retiredAt: string | null
}
export interface Account {
  id: string
  name: string
  /** IANA account timezone (day-boundary basis for reports/mileage) — the API returns it. */
  timezone?: string
}
export interface Profile {
  id: string
  key: string
  name: string
}
export type OdometerSource = 'auto' | 'device' | 'gps'
export const ODOMETER_SOURCES: readonly OdometerSource[] = ['auto', 'device', 'gps']
export interface DeviceCreateInput {
  accountId: string
  profileId: string
  imei: string
  name: string
  plate?: string | null
  odometerSource?: OdometerSource
}
export interface ImportError {
  row: number
  imei: string
  reason: string
}
export interface DryRunResult {
  create: unknown[]
  update: { row: number; imei: string; deviceId: string }[]
  errors: ImportError[]
}

export interface QuarantineEntry {
  imei: string
  lastSeenMs: number
  rejects: number
}
export interface Tenant {
  id: string
  name: string
}
export interface ClaimInput {
  tenantId: string
  accountId: string
  profileId: string
  name: string
}

export const listDevices = () => getJson<Device[]>('/v1/devices')
export const listAccounts = () => getJson<Account[]>('/v1/accounts')
export const listProfiles = () => getJson<Profile[]>('/v1/profiles')
export const listQuarantine = () => getJson<QuarantineEntry[]>('/v1/quarantine')
export const listTenants = () => getJson<Tenant[]>('/v1/tenants')
export const listTenantAccounts = (tenantId: string) => getJson<Account[]>(`/v1/tenants/${tenantId}/accounts`)
export const claimDevice = (imei: string, data: ClaimInput) => mutate<{ deviceId: string }>('POST', `/v1/quarantine/${imei}/claim`, data)
export const createDevice = (data: DeviceCreateInput) => mutate<Device>('POST', '/v1/devices', data)
export const updateDevice = (id: string, data: { odometerSource?: OdometerSource }) => mutate<Device>('PATCH', `/v1/devices/${encodeURIComponent(id)}`, data)
export const retireDevice = (id: string) => mutate<Device>('DELETE', `/v1/devices/${id}`)
export const importPreview = (csv: string) => mutate<DryRunResult>('POST', '/v1/devices/import/preview', { csv })
export const importApply = (csv: string) => mutate<{ created: number; errors: ImportError[] }>('POST', '/v1/devices/import', { csv })
