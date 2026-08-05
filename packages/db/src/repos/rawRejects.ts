import type { PrismaClient } from '@prisma/client'

/**
 * Sanity-rejected raw records (§3.6). Ingest cannot reach Postgres (hard rule 3), so it XADDs each
 * rejection to the `rejects` Redis stream and the worker drains that stream into this table.
 *
 * That drain did not exist (audit MED): the stream was capped at MAXLEN ~100k and had no consumer,
 * so a rejection survived only until the cap rolled over it — and `raw_rejects` sat in the schema
 * from day one with nothing ever writing to it. The consequence is not lost telemetry (the record
 * genuinely failed §3.6 and must not enter the pipeline) but a support blind spot: a customer
 * reporting "my tracker's data is missing" could only be answered with a global counter, never with
 * "device X sent 4,000 records stamped 2019 — its RTC battery is flat".
 *
 * UNSCOPED by design and by necessity: a rejected record has no resolved tenant. Reads therefore
 * belong on a platform-admin surface only, never on a tenant-scoped route.
 */
export interface RawRejectRow {
  imei: string | null
  /** resolved by the drain from the IMEI. GDPR erase keys on THIS — by IMEI it would reach a
   *  different device's rows, since an IMEI is unique among ACTIVE devices only. */
  deviceId: bigint | null
  reason: string
  /** the raw AVL record bytes, so the offending frame can be replayed against the parser */
  payload: Uint8Array | null
}

export interface RawRejectRepo {
  /** Batch-insert drained rejections. Returns rows written. */
  insertMany(rows: RawRejectRow[]): Promise<number>
  /** Retention prune (worker cron), batched so a large first pass never holds one long lock. */
  pruneOlderThan(cutoff: Date, batchSize?: number): Promise<number>
}

export function createRawRejectRepo(prisma: PrismaClient): RawRejectRepo {
  return {
    insertMany: async (rows) => {
      if (rows.length === 0) return 0
      const res = await prisma.rawReject.createMany({
        data: rows.map((r) => ({ imei: r.imei, deviceId: r.deviceId, reason: r.reason, payload: r.payload === null ? null : new Uint8Array(r.payload) })),
      })
      return res.count
    },
    pruneOlderThan: async (cutoff, batchSize = 5_000) => {
      const size = Math.min(Math.max(Math.trunc(batchSize), 1), 50_000)
      let total = 0
      for (;;) {
        const deleted = await prisma.$executeRaw`
          DELETE FROM "raw_rejects"
           WHERE id IN (SELECT id FROM "raw_rejects" WHERE "createdAt" < ${cutoff} ORDER BY id LIMIT ${size})`
        total += deleted
        if (deleted < size) return total
      }
    },
  }
}
