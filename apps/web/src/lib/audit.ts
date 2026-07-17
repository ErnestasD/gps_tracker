import { getJson } from './client'

/**
 * Audit log read client (E03-6). Read-only + tenant-admin-gated on the server.
 * Rows are the tenant's mutation trail: who (userId), what (action/entity/entityId),
 * before/after snapshots (secrets already redacted server-side), when (`at`).
 */
export interface AuditRow {
  id: string // BigInt serialized as string
  tenantId: string | null
  userId: string | null
  action: string
  entity: string
  entityId: string
  before: unknown
  after: unknown
  at: string // ISO
}

export interface AuditFilters {
  entity?: string
  action?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

/** The entities/actions the UI offers as filter options — the full set the server's repos write
 * via audit.record (packages/db/src/repos), each with an audit.e.* label in all locales. */
export const AUDIT_ENTITIES = [
  'account', 'user', 'device', 'rule', 'webhook', 'domain', 'branding', 'tenant',
  'geofence', 'trip', 'apiKey', 'command', 'driver', 'export', 'maintenance', 'scheduledReport', 'shareLink',
] as const
export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const

/** Build the /v1/audit query string from filters (drops empty values). Pure — unit-tested. */
export function auditQuery(f: AuditFilters): string {
  const p = new URLSearchParams()
  if (f.entity) p.set('entity', f.entity)
  if (f.action) p.set('action', f.action)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.cursor) p.set('cursor', f.cursor)
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const listAudit = (f: AuditFilters = {}) => getJson<AuditRow[]>(`/v1/audit${auditQuery(f)}`)
