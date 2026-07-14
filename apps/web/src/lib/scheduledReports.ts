import type { ScheduledReportView } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Scheduled emailed reports API client (V1-nice). */
export interface ScheduledReportInput {
  accountId?: string | null
  reportType: string
  cadence: 'daily' | 'weekly'
  hourUtc: number
  weekday?: number | null
  recipients: string[]
  timezone?: string
  enabled?: boolean
}

export const listScheduledReports = () => getJson<ScheduledReportView[]>('/v1/scheduled-reports')
export const createScheduledReport = (data: ScheduledReportInput) => mutate<ScheduledReportView>('POST', '/v1/scheduled-reports', data)
export const updateScheduledReport = (id: string, data: Partial<ScheduledReportInput>) => mutate<ScheduledReportView>('PATCH', `/v1/scheduled-reports/${encodeURIComponent(id)}`, data)
export const deleteScheduledReport = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/scheduled-reports/${encodeURIComponent(id)}`)

export const REPORT_TYPES = ['trips', 'mileage', 'stops', 'overspeed', 'geofence', 'engine_hours'] as const
