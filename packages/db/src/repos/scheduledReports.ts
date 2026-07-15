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
  /** ATOMICALLY claim a schedule for this run: set lastRunAt=`at` only if it hasn't run within the
   *  cadence guard. Returns true iff THIS caller won the claim — so two overlapping cron runs (BullMQ
   *  stall/overlap) can't both send. Claim BEFORE sending ⇒ at-most-once (no duplicate report emails). */
  claimRun(id: string, at: Date, guardMs: number): Promise<boolean>
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
    claimRun: async (id, at, guardMs) => {
      // atomic: only the run whose UPDATE matches (lastRunAt still older than the guard) wins
      const res = await prisma.scheduledReport.updateMany({
        where: { id, OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(at.getTime() - guardMs) } }] },
        data: { lastRunAt: at },
      })
      return res.count > 0
    },
  }
}
