import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Scheduled emailed reports queue (V1-nice). One repeatable job fires hourly; it runs every schedule
 * that is DUE this hour and e-mails it. Repeatable jobs dedupe by scheduler key, so a fleet of workers
 * upsert one schedule and only one instance runs per tick.
 */
export const SCHEDULED_REPORT_QUEUE = 'scheduled-reports'
export const SCHEDULED_REPORT_EVERY_MS = 60 * 60_000 // hourly

export function createScheduledReportQueue(connection: ConnectionOptions): Queue {
  return new Queue(SCHEDULED_REPORT_QUEUE, { connection })
}

export async function scheduleScheduledReports(queue: Queue): Promise<void> {
  await queue.add(
    'run',
    {},
    { repeat: { every: SCHEDULED_REPORT_EVERY_MS }, jobId: 'scheduled-reports', removeOnComplete: true, removeOnFail: 100 },
  )
}
