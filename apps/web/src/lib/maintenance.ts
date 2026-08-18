import type { MaintenanceStatus, MaintenanceView } from '@orbetra/shared'

import { getJson, mutate } from './client'

export type { MaintenanceView } from '@orbetra/shared'

export interface MaintenanceInput {
  deviceId: string
  accountId?: string
  title: string
  intervalKm?: number | null
  intervalDays?: number | null
  intervalEngineH?: number | null
  lastServiceOdoKm?: number | null
  lastServiceAt?: string | null
  lastServiceEngineH?: number | null
  active?: boolean
}

/** Optional extras "mark serviced" records into the service log (FLEET-1 F2). */
export interface ServicedExtras {
  costCents?: number | null
  vendor?: string | null
  notes?: string | null
}

export const listMaintenance = () => getJson<MaintenanceView[]>('/v1/maintenance')
export const createMaintenance = (data: MaintenanceInput) => mutate<MaintenanceView>('POST', '/v1/maintenance', data)
export const updateMaintenance = (id: string, data: Partial<Omit<MaintenanceInput, 'deviceId' | 'accountId'>>) => mutate<MaintenanceView>('PATCH', `/v1/maintenance/${encodeURIComponent(id)}`, data)
export const deleteMaintenance = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/maintenance/${encodeURIComponent(id)}`)
/**
 * Record a completed service now, stamping the current odometer as the new baseline.
 *
 * The odometer arrives as metres/1000, so it is FRACTIONAL for any reading that is not a whole
 * kilometre — and `markServicedSchema` requires an integer. Every device that actually reports an
 * odometer therefore made this button answer 400; the ones it worked for were the ones with no
 * reading, where it then cleared the baseline. Round here, and when there is no reading OMIT the key
 * entirely rather than sending an explicit null: the API reads absence as "re-base on the device's
 * current odometer" and an explicit null as "clear it", which are different instructions.
 */
export const markServiced = (id: string, odoKm: number | null, extras: ServicedExtras = {}) =>
  mutate<MaintenanceView>('POST', `/v1/maintenance/${encodeURIComponent(id)}/serviced`, {
    ...(odoKm === null ? {} : { odoKm: Math.round(odoKm) }),
    ...(extras.costCents != null ? { costCents: extras.costCents } : {}),
    ...(extras.vendor != null && extras.vendor !== '' ? { vendor: extras.vendor } : {}),
    ...(extras.notes != null && extras.notes !== '' ? { notes: extras.notes } : {}),
  })

/** Badge variant for a due status — pure, unit-tested. */
export function dueVariant(status: MaintenanceStatus): 'success' | 'warn' | 'danger' | 'outline' {
  switch (status) {
    case 'overdue': return 'danger'
    case 'due_soon': return 'warn'
    case 'ok': return 'success'
    default: return 'outline'
  }
}
