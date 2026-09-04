import { Worker, type ConnectionOptions } from 'bullmq'

import { runDueSchedules, type ScheduledReporterDeps } from '../reports/scheduledReporter.js'
import { SCHEDULED_REPORT_QUEUE } from './scheduledReportQueue.js'

export interface ScheduledReportWorkerDeps extends Omit<ScheduledReporterDeps, 'now'> {
  connection: ConnectionOptions
  onRun?: (r: { due: number; emailed: number }) => void
  /** the run THREW — without this a scheduled-report worker failing every hour is invisible */
  onFailed?: () => void
}

/** Hourly job: run every due schedule + e-mail it. concurrency 1 (one pass per tick). */
export function startScheduledReportWorker(deps: ScheduledReportWorkerDeps): Worker {
  return new Worker(
    SCHEDULED_REPORT_QUEUE,
    async () => {
      try {
        // Rebuilt field by field rather than spread, so `now` stays out — which means every field
        // added to ScheduledReporterDeps must be repeated HERE or it silently never arrives.
        const r = await runDueSchedules({
          db: deps.db,
          pool: deps.pool,
          transport: deps.transport,
          ...(deps.appBaseUrl !== undefined ? { appBaseUrl: deps.appBaseUrl } : {}),
        })
        deps.onRun?.(r)
      } catch (err) {
        // report the failure BEFORE rethrowing — BullMQ's own retry is invisible to Prometheus,
        // so a run that throws every hour looked identical to a quiet hour
        deps.onFailed?.()
        throw err
      }
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
