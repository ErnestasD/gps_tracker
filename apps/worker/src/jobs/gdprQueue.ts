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
  /**
   * The device's IMEI, carried in the payload rather than read from the row.
   *
   * `raw_rejects` keys on IMEI — its rows predate any device resolution — and the devices row is
   * deleted mid-erase, so a retried job (which finds no row and returns early) could otherwise
   * never reach them. Optional for jobs enqueued before this field existed; those fall back to the
   * row while it still exists.
   */
  imei?: string
  /**
   * The device's account. Like `imei`, carried in the payload rather than read from the row: the
   * devices row is this job's completion marker and is deleted mid-erase, so the retried job (which
   * finds no row and returns early) could otherwise not expire the account's produced exports —
   * leaving a downloadable dump of the erased device while BullMQ marked the erase complete.
   * Optional for jobs enqueued before this field existed.
   */
  accountId?: string
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
