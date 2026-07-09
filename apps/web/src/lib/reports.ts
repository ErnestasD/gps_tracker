import { mutate } from './client'

/**
 * Reports client (E06-2). Runs a report via the E06-1 sync API and renders/exports the rows.
 * CSV export is client-side (Blob download) — no server round-trip, no R2. The async
 * server-side XLSX export (BullMQ → R2 signed URL) is a follow-up (needs R2 credentials).
 */
export const REPORT_TYPES = ['mileage', 'trips', 'stops', 'overspeed', 'geofence', 'engine_hours'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export interface ReportRequest {
  from: string
  to: string
  deviceId?: string
  accountId?: string
}
export interface ReportResult {
  type: ReportType
  rows: Record<string, unknown>[]
}

export interface Column {
  key: string
  /** i18n key suffix under reports.col.* */
  label: string
}

/** Column layout per report type — drives both the table and the CSV. */
export const COLUMNS: Record<ReportType, Column[]> = {
  mileage: [c('day'), c('deviceId'), c('trips'), c('distanceM')],
  stops: [c('day'), c('deviceId'), c('trips'), c('idleS')],
  engine_hours: [c('day'), c('deviceId'), c('seconds')],
  overspeed: [c('day'), c('deviceId'), c('count'), c('maxSpeedKmh')],
  geofence: [c('day'), c('deviceId'), c('enters'), c('exits')],
  trips: [c('day'), c('deviceId'), c('startTime'), c('endTime'), c('distanceM'), c('maxSpeed'), c('idleS')],
}
function c(key: string): Column {
  return { key, label: key }
}

export const runReport = (type: ReportType, req: ReportRequest) => mutate<ReportResult>('POST', `/v1/reports/${encodeURIComponent(type)}`, req)

/** Serialize rows to RFC-4180 CSV (quote fields containing "/,/CR/LF). Pure — unit-tested. */
export function toCsv(columns: Column[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map((col) => esc(col.key)).join(',')
  const body = rows.map((r) => columns.map((col) => esc(r[col.key])).join(',')).join('\r\n')
  return rows.length > 0 ? `${header}\r\n${body}` : header
}

/** Trigger a browser download of a CSV string (no server). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
