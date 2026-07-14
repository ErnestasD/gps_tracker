import type { MaintenanceStatus, MaintenanceView } from '@orbetra/shared'

import { getJson, mutate } from './client'

export type { MaintenanceView } from '@orbetra/shared'

export interface MaintenanceInput {
  deviceId: string
  accountId?: string
  title: string
  intervalKm?: number | null
  intervalDays?: number | null
  lastServiceOdoKm?: number | null
  lastServiceAt?: string | null
  active?: boolean
}

export const listMaintenance = () => getJson<MaintenanceView[]>('/v1/maintenance')
export const createMaintenance = (data: MaintenanceInput) => mutate<MaintenanceView>('POST', '/v1/maintenance', data)
export const updateMaintenance = (id: string, data: Partial<Omit<MaintenanceInput, 'deviceId' | 'accountId'>>) => mutate<MaintenanceView>('PATCH', `/v1/maintenance/${encodeURIComponent(id)}`, data)
export const deleteMaintenance = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/maintenance/${encodeURIComponent(id)}`)
/** Record a completed service now, optionally stamping the current odometer as the new baseline. */
export const markServiced = (id: string, odoKm: number | null) => mutate<MaintenanceView>('POST', `/v1/maintenance/${encodeURIComponent(id)}/serviced`, { odoKm })

/** Badge variant for a due status — pure, unit-tested. */
export function dueVariant(status: MaintenanceStatus): 'success' | 'warn' | 'danger' | 'outline' {
  switch (status) {
    case 'overdue': return 'danger'
    case 'due_soon': return 'warn'
    case 'ok': return 'success'
    default: return 'outline'
  }
}
