import { Queue, type ConnectionOptions } from 'bullmq'

import { EXPORT_SWEEP_EVERY_MS } from './gdprExportWorker.js'

/**
 * GDPR queues (E08-4). PRODUCTION of erase/export one-shots lives in apps/api (ADR-020
 * addendum, apps/api/src/main.ts — keep jobId/attempts/removeOnFail in sync there); this
 * module owns the queue NAMES + job data contracts the worker consumes, and the repeatable
 * expired-export sweep schedule.
 */
export const GDPR_ERASE_QUEUE = 'gdpr-erase'
export const GDPR_EXPORT_QUEUE = 'gdpr-export'
export const GDPR_SWEEP_QUEUE = 'gdpr-export-sweep'

export interface EraseJobData {
  deviceId: string // bigint as string
  tenantId: string
}
export interface ExportJobData {
  exportId: string // ExportJob row uuid
}

export function createGdprSweepQueue(connection: ConnectionOptions): Queue {
  return new Queue(GDPR_SWEEP_QUEUE, { connection })
}

/** Upsert the repeatable expired-export sweep (unlink files + mark rows expired). */
export async function scheduleExportSweep(queue: Queue): Promise<void> {
  await queue.add('sweep', {}, { repeat: { every: EXPORT_SWEEP_EVERY_MS }, jobId: 'gdpr-export-sweep', removeOnComplete: true, removeOnFail: 100 })
}
