import type { PrismaClient, ScheduledReport } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import { createGenericRepo, type Delegate, type GenericRepo } from './generic.js'

export interface ScheduledReportCreate {
  accountId: string
  reportType: string
  cadence: string
  hourUtc: number
  weekday?: number | null
  recipients: string[]
  timezone?: string
  enabled?: boolean
}
export interface ScheduledReportUpdate {
  reportType?: string
  cadence?: string
  hourUtc?: number
  weekday?: number | null
  recipients?: string[]
  timezone?: string
  enabled?: boolean
}

export type ScheduledReportRepo = GenericRepo<ScheduledReport, ScheduledReportCreate, ScheduledReportUpdate> & {
  /** UNSCOPED (worker cron): all enabled schedules across tenants, to evaluate for a due run. */
  listEnabled(): Promise<ScheduledReport[]>
  /** Stamp a successful run (worker), so `isDue` won't re-fire it within the cadence. */
  markRun(id: string, at: Date): Promise<void>
}

/** Scheduled reports: account-scoped CRUD (every report targets one account's data). */
export function createScheduledReportRepo(prisma: PrismaClient, audit: AuditRepo): ScheduledReportRepo {
  const base = createGenericRepo(prisma.scheduledReport as unknown as Delegate<ScheduledReport>, audit, {
    entity: 'scheduledReport',
    orderBy: { createdAt: 'desc' },
  })
  return {
    ...base,
    listEnabled: () => prisma.scheduledReport.findMany({ where: { enabled: true } }),
    markRun: async (id, at) => {
      await prisma.scheduledReport.update({ where: { id }, data: { lastRunAt: at } })
    },
  }
}
