import { Encoder } from 'cbor-x'
import type { Redis } from 'ioredis'

import type { AvlRecord } from '@orbetra/codec'

import type { IngestMetrics } from './metrics.js'
import type { SessionConfig } from './session.js'

const cbor = new Encoder()

/**
 * §3.6 timestamp/coordinate sanity. NOTE this is NOT the invalid-fix rule (satellites==0, rule 6) —
 * that is decided downstream in the worker; here we only drop physically impossible records.
 */
export function isSaneRecord(rec: AvlRecord, config: SessionConfig, nowMs: number): boolean {
  if (rec.tsMs < config.minTsMs || rec.tsMs > nowMs + config.maxFutureMs) return false
  if (Math.abs(rec.lat) > 90 || Math.abs(rec.lon) > 180) return false
  return true
}

export interface PersistTarget {
  deviceId: bigint
  imei: string
  shard: number
}

/**
 * XADD a parsed AVL batch to the device's shard (good records) + the durable `rejects` stream
 * (sanity failures), returning the number of records actually persisted. Shared by the TCP session
 * (session.ts) and the UDP listener (udp.ts) so BOTH transports write byte-identical stream payloads
 * (rule 4 / I1) with one source of truth — no second serializer to drift.
 *
 * Sanity-rejected records are persisted to `rejects` AND counted toward the returned total: §3.2
 * resend is whole-packet, so under-ACKing a record we took responsibility for would wedge the device
 * in an eternal resend loop (E01-5 adversarial finding).
 */
export async function persistAvlBatch(
  redis: Redis,
  target: PersistTarget,
  records: AvlRecord[],
  config: SessionConfig,
  metrics: IngestMetrics,
  nowMs: number,
): Promise<number> {
  const good: AvlRecord[] = []
  const insane: AvlRecord[] = []
  for (const rec of records) (isSaneRecord(rec, config, nowMs) ? good : insane).push(rec)
  if (good.length === 0 && insane.length === 0) return 0

  const pipeline = redis.pipeline()
  for (const rec of insane) {
    metrics.sanityRejectsTotal++
    pipeline.xadd('rejects', 'MAXLEN', '~', 100_000, '*', 'p', cbor.encode({ imei: target.imei, tsMs: rec.tsMs, raw: rec.raw, reason: 'sanity' }))
  }
  for (const rec of good) {
    pipeline.xadd(
      `raw:${target.shard}`,
      'MAXLEN',
      '~',
      100_000, // §5 R8-4 hard cap per shard
      '*',
      'p',
      cbor.encode({
        deviceId: target.deviceId,
        imei: target.imei,
        serverTimeMs: nowMs,
        tsMs: rec.tsMs,
        priority: rec.priority,
        lat: rec.lat,
        lon: rec.lon,
        altitude: rec.altitude,
        angle: rec.angle,
        satellites: rec.satellites,
        speed: rec.speed,
        eventIoId: rec.eventIoId,
        io: [...rec.io.entries()],
        raw: rec.raw,
      }),
    )
  }
  const results = await pipeline.exec()
  const persisted = results?.filter((r) => r[0] === null).length ?? 0
  metrics.ackedRecordsTotal += persisted
  return persisted
}
