import { Worker, type ConnectionOptions } from 'bullmq'

import { runDueSchedules, type ScheduledReporterDeps } from '../reports/scheduledReporter.js'
import { SCHEDULED_REPORT_QUEUE } from './scheduledReportQueue.js'

export interface ScheduledReportWorkerDeps extends Omit<ScheduledReporterDeps, 'now'> {
  connection: ConnectionOptions
  onRun?: (r: { due: number; emailed: number }) => void
}

/** Hourly job: run every due schedule + e-mail it. concurrency 1 (one pass per tick). */
export function startScheduledReportWorker(deps: ScheduledReportWorkerDeps): Worker {
  return new Worker(
    SCHEDULED_REPORT_QUEUE,
    async () => {
      const r = await runDueSchedules({ db: deps.db, pool: deps.pool, transport: deps.transport })
      deps.onRun?.(r)
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
