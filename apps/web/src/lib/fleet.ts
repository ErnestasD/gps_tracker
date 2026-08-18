import type { DocumentDueStatus, ServiceLogView, VehicleDocumentView } from '@orbetra/shared'

import { getJson, mutate } from './client'

export type { ServiceLogView, VehicleDocumentView } from '@orbetra/shared'

/** FLEET-1 client: service log (F2), vehicle documents (F3) and maintenance plans (F2). */

// ── service log ────────────────────────────────────────────────────────────────
export interface ServiceLogInput {
  title: string
  at?: string
  odoKm?: number | null
  engineH?: number | null
  costCents?: number | null
  vendor?: string | null
  notes?: string | null
}
export const listServiceLog = (deviceId: string) =>
  getJson<ServiceLogView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/service-log`)
export const createServiceLog = (deviceId: string, data: ServiceLogInput) =>
  mutate<ServiceLogView>('POST', `/v1/devices/${encodeURIComponent(deviceId)}/service-log`, data)
export const deleteServiceLog = (id: string) =>
  mutate<{ ok: boolean }>('DELETE', `/v1/service-log/${encodeURIComponent(id)}`)

// ── vehicle documents ──────────────────────────────────────────────────────────
export type DocumentKind = 'insurance' | 'inspection' | 'tachograph' | 'permit' | 'leasing' | 'other'
export const DOCUMENT_KINDS: readonly DocumentKind[] = ['insurance', 'inspection', 'tachograph', 'permit', 'leasing', 'other']
export interface DocumentInput {
  kind: DocumentKind
  title: string
  number?: string | null
  validFrom?: string | null
  validTo: string
  note?: string | null
}
export const listDeviceDocuments = (deviceId: string) =>
  getJson<VehicleDocumentView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/documents`)
/** Fleet-wide, soonest expiry first; due='soon' narrows to due_soon+overdue (the reminder list). */
export const listDocuments = (due?: 'soon') =>
  getJson<VehicleDocumentView[]>(`/v1/documents${due !== undefined ? `?due=${due}` : ''}`)
export const createDocument = (deviceId: string, data: DocumentInput) =>
  mutate<VehicleDocumentView>('POST', `/v1/devices/${encodeURIComponent(deviceId)}/documents`, data)
export const updateDocument = (id: string, data: Partial<DocumentInput>) =>
  mutate<VehicleDocumentView>('PATCH', `/v1/documents/${encodeURIComponent(id)}`, data)
export const deleteDocument = (id: string) =>
  mutate<{ ok: boolean }>('DELETE', `/v1/documents/${encodeURIComponent(id)}`)

/** Badge variant for a document due status (maintenance dueVariant sibling). */
export function docVariant(status: DocumentDueStatus): 'success' | 'warn' | 'danger' {
  return status === 'overdue' ? 'danger' : status === 'due_soon' ? 'warn' : 'success'
}

// ── maintenance plans ──────────────────────────────────────────────────────────
export interface PlanItemInput {
  title: string
  intervalKm?: number | null
  intervalDays?: number | null
  intervalEngineH?: number | null
}
export interface MaintenancePlanView {
  id: string
  name: string
  items: PlanItemInput[]
  createdAt: string
}
export const listPlans = () => getJson<MaintenancePlanView[]>('/v1/maintenance-plans')
export const createPlan = (data: { name: string; items: PlanItemInput[] }) =>
  mutate<MaintenancePlanView>('POST', '/v1/maintenance-plans', data)
export const deletePlan = (id: string) =>
  mutate<{ ok: boolean }>('DELETE', `/v1/maintenance-plans/${encodeURIComponent(id)}`)
export const applyPlan = (id: string, deviceIds: string[]) =>
  mutate<{ created: number; skipped: number; missingDevices: string[] }>('POST', `/v1/maintenance-plans/${encodeURIComponent(id)}/apply`, { deviceIds })
