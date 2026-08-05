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
  return sanityFailure(rec, config, nowMs) === null
}

/**
 * WHICH §3.6 check failed, or null when the record is sane. The rejection is recorded with this
 * (audit MED follow-up): a flat 'sanity' told support the device but not the fault, and the two
 * cases need opposite responses — a fix-time failure is almost always a flat RTC backup battery,
 * an out-of-range coordinate is a corrupt frame or a firmware bug.
 */
export function sanityFailure(rec: AvlRecord, config: SessionConfig, nowMs: number): 'fix_time' | 'coords' | null {
  if (rec.tsMs < config.minTsMs || rec.tsMs > nowMs + config.maxFutureMs) return 'fix_time'
  if (Math.abs(rec.lat) > 90 || Math.abs(rec.lon) > 180) return 'coords'
  return null
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
  const insane: [AvlRecord, 'fix_time' | 'coords'][] = []
  for (const rec of records) {
    const why = sanityFailure(rec, config, nowMs)
    if (why === null) good.push(rec)
    else insane.push([rec, why])
  }
  if (good.length === 0 && insane.length === 0) return 0

  const pipeline = redis.pipeline()
  for (const [rec, reason] of insane) {
    metrics.sanityRejectsTotal++
    pipeline.xadd('rejects', 'MAXLEN', '~', 100_000, '*', 'p', cbor.encode({ imei: target.imei, tsMs: rec.tsMs, raw: rec.raw, reason }))
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

/**
 * Stream for frames we framed and CRC-verified but cannot DECODE yet. SEPARATE from `rejects` on
 * purpose: an FMB6xx sends codec 16 for EVERY frame, and each entry is a whole frame (up to the
 * framer's 4 KiB cap) versus ~45-100 B for a sanity reject's single record — parking these next to
 * §3.6 sanity rejects would evict that audit trail within minutes and grow the stream ~40×.
 * Sized like `raw:dead`: a bounded operator sample, NOT an archive. Nothing consumes it yet, so a
 * parked frame is diagnostic evidence only — do not describe it as replayable until a reader exists.
 */
export const UNSUPPORTED_STREAM = 'raw:unsupported'
const UNSUPPORTED_MAXLEN = 10_000

/**
 * Park an undecodable frame (codec 16) so the operator can see WHAT arrived. The caller then ACKs
 * the count the device declared — ACKing 0 would make it resend the same frame forever.
 * Shared by the TCP session and the UDP listener: both transports funnel through the same parser,
 * so both must park + ACK identically or the wedge simply moves to the quieter channel.
 */
export async function parkUndecodableFrame(
  redis: Redis,
  imei: string,
  raw: Uint8Array,
  nowMs: number,
  reason = 'codec16',
): Promise<void> {
  await redis.xadd(
    UNSUPPORTED_STREAM,
    'MAXLEN',
    '~',
    UNSUPPORTED_MAXLEN,
    '*',
    'p',
    cbor.encode({ imei, tsMs: nowMs, raw, reason }),
  )
}
