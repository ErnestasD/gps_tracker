import { Worker, type ConnectionOptions } from 'bullmq'
import { Decoder } from 'cbor-x'
import type { Redis } from 'ioredis'

import type { Db, RawRejectRow } from '@orbetra/db'

import { REJECT_DRAIN_QUEUE } from './rejectDrainQueue.js'

/**
 * Drains the `rejects` Redis stream into `raw_rejects` (audit MED #46).
 *
 * Ingest cannot reach Postgres (hard rule 3), so a §3.6 sanity failure is XADDed to a stream and
 * something else has to move it. Nothing did: the stream is capped at MAXLEN ~100k with no consumer,
 * so a rejection survived only until the cap rolled over it, while `raw_rejects` sat in the schema
 * from day one with no writer. The record itself is correctly refused — it is not a data-loss bug —
 * but it left support with a single global counter and no way to answer "which device, and why".
 *
 * Deliberately NOT a consumer group: this is a diagnostic tail, not the pipeline. It reads from a
 * durable cursor kept in Redis, and if it falls behind far enough that MAXLEN trims past the cursor
 * it simply resumes at the oldest surviving entry. Losing a diagnostic row must never be able to
 * stall or crash the worker that also runs the ordered pipeline.
 */
export interface RejectDrainDeps {
  connection: ConnectionOptions
  redis: Redis
  db: Db
  /** rows per run; the stream is capped at 100k so a backlog drains over a few ticks */
  batchSize?: number
  onDrained?: (rows: number) => void
  onFailed?: () => void
}

/** Redis key holding the last drained stream id — a plain string, not a consumer group. */
export const REJECT_CURSOR_KEY = 'rejects:drain:cursor'
export const REJECTS_STREAM = 'rejects'

const cbor = new Decoder()

interface RejectPayload {
  imei?: unknown
  reason?: unknown
  raw?: unknown
}

/** One drain pass. Exported for unit testing without a live queue. */
export async function runRejectDrain(deps: RejectDrainDeps): Promise<number> {
  const count = Math.min(Math.max(Math.trunc(deps.batchSize ?? 1_000), 1), 10_000)
  const from = (await deps.redis.get(REJECT_CURSOR_KEY)) ?? '0-0'
  // callBuffer, not xrange: the entry value is CBOR, and the string API would mangle it exactly as
  // it would in the shard consumer (which reads via callBuffer for the same reason)
  const res = (await deps.redis.callBuffer(
    'XRANGE',
    REJECTS_STREAM,
    from === '0-0' ? '-' : `(${from}`,
    '+',
    'COUNT',
    String(count),
  )) as [Buffer, Buffer[]][] | null
  if (!res || res.length === 0) return 0

  const rows: RawRejectRow[] = []
  for (const [, fields] of res) {
    // flat [name, value, …] form; ingest writes exactly one field, `p`
    const value = fields[1]
    if (value === undefined) continue
    try {
      const decoded: unknown = cbor.decode(value)
      // CBOR is permissive — a corrupt entry often decodes to a STRING or a number rather than
      // throwing, and reading `.imei` off that yields undefined, i.e. a row that looks like an
      // ordinary sanity rejection with no device. Insist on an object.
      if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('not an object')
      const p = decoded as RejectPayload
      rows.push({
        imei: typeof p.imei === 'string' ? p.imei : null,
        reason: typeof p.reason === 'string' ? p.reason : 'sanity',
        payload: p.raw instanceof Uint8Array ? p.raw : null,
      })
    } catch {
      // an undecodable entry is itself worth recording, and must not stop the drain
      rows.push({ imei: null, reason: 'undecodable', payload: null })
    }
  }

  const written = await deps.db.rawRejects.insertMany(rows)
  // cursor advances ONLY after the insert commits — a crash in between re-reads the same window and
  // writes the rows twice, which for a diagnostic tail is the right way round
  await deps.redis.set(REJECT_CURSOR_KEY, res[res.length - 1]![0].toString())
  return written
}

/** BullMQ worker running the periodic drain. Caller must close() on shutdown. */
export function startRejectDrainWorker(deps: RejectDrainDeps): Worker {
  return new Worker(
    REJECT_DRAIN_QUEUE,
    async () => {
      try {
        deps.onDrained?.(await runRejectDrain(deps))
      } catch (err) {
        deps.onFailed?.()
        throw err // BullMQ records it; the next tick retries the same window (the cursor did not move)
      }
    },
    { connection: deps.connection },
  )
}
