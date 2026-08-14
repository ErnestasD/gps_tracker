import type { AccountPreferences, DistanceUnit, SpeedUnit, VolumeUnit } from '@orbetra/shared'

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
  /** device SIM number (E.164) — the destination for config/command SMS. Null until set. */
  simMsisdn: string | null
  /** device SIM ICCID (audit/support only) — never used to send. Null until set. */
  simIccid: string | null
  retiredAt: string | null
}
export interface Account {
  id: string
  name: string
  /** IANA account timezone (day-boundary basis for reports/mileage) — the API returns it. */
  timezone?: string
  /** Language + units the SERVER renders this fleet's alert e-mails and reports in. Not the same as
   *  the device-local display prefs — see `settings.tsx`, DisplayPrefsSection. */
  locale?: string
  unitSpeed?: SpeedUnit
  unitDistance?: DistanceUnit
  unitVolume?: VolumeUnit
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
  simMsisdn?: string | null
  simIccid?: string | null
}
/** Fields the device PATCH accepts. All optional — send only what changed. */
export interface DeviceUpdateInput {
  odometerSource?: OdometerSource
  simMsisdn?: string | null
  simIccid?: string | null
  /** the device MODEL. Changing it changes how FUTURE positions are decoded; already-stored
   *  positions keep the attribute names they were decoded with. */
  profileId?: string
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
/** The account's REPORTING time zone — the server buckets report days by it (hard rule 7). This is
 *  NOT the display preference in Settings, which only changes how timestamps are rendered. */
export const updateAccountTimezone = (id: string, timezone: string) =>
  mutate<Account>('PATCH', `/v1/accounts/${encodeURIComponent(id)}`, { timezone })
/** The account's LANGUAGE + UNITS for server-rendered mail (alerts, scheduled reports). Its own
 *  endpoint because it answers to account_manager, while renaming an account and moving its
 *  reporting time zone stay with tenant admins. */
export const updateAccountPreferences = (id: string, prefs: AccountPreferences) =>
  mutate<Account>('PATCH', `/v1/accounts/${encodeURIComponent(id)}/preferences`, prefs)
export const listProfiles = () => getJson<Profile[]>('/v1/profiles')
export const listQuarantine = () => getJson<QuarantineEntry[]>('/v1/quarantine')
export const listTenants = () => getJson<Tenant[]>('/v1/tenants')
export const listTenantAccounts = (tenantId: string) => getJson<Account[]>(`/v1/tenants/${tenantId}/accounts`)
export const claimDevice = (imei: string, data: ClaimInput) => mutate<{ deviceId: string }>('POST', `/v1/quarantine/${imei}/claim`, data)
export const createDevice = (data: DeviceCreateInput) => mutate<Device>('POST', '/v1/devices', data)
export const updateDevice = (id: string, data: DeviceUpdateInput) => mutate<Device>('PATCH', `/v1/devices/${encodeURIComponent(id)}`, data)
export const retireDevice = (id: string) => mutate<Device>('DELETE', `/v1/devices/${id}`)
export const importPreview = (csv: string) => mutate<DryRunResult>('POST', '/v1/devices/import/preview', { csv })
export const importApply = (csv: string) => mutate<{ created: number; errors: ImportError[] }>('POST', '/v1/devices/import', { csv })
