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
  /** rows per XRANGE; the tick loops until the stream is drained or `maxPerTick` is reached */
  batchSize?: number
  /** ceiling on one tick's work, so a backlog cannot monopolise the worker (default 25k) */
  maxPerTick?: number
  onDrained?: (rows: number) => void
  onFailed?: () => void
}

/** Redis key holding the last drained stream id — a plain string, not a consumer group. */
export const REJECT_CURSOR_KEY = 'rejects:drain:cursor'
export const REJECTS_STREAM = 'rejects'

const cbor = new Decoder()

/** Move the cursor forward only. Stream ids sort lexicographically within equal length, so compare
 *  on (ms, seq) numerically — a plain string compare would put '9-0' after '10-0'. */
const ADVANCE_CURSOR_SCRIPT = `local cur = redis.call('GET', KEYS[1])
if cur then
  local cms, cseq = string.match(cur, '(%d+)-(%d+)')
  local nms, nseq = string.match(ARGV[1], '(%d+)-(%d+)')
  if cms and nms then
    cms, cseq, nms, nseq = tonumber(cms), tonumber(cseq), tonumber(nms), tonumber(nseq)
    if nms < cms or (nms == cms and nseq <= cseq) then return 0 end
  end
end
redis.call('SET', KEYS[1], ARGV[1])
return 1`

interface RejectPayload {
  imei?: unknown
  reason?: unknown
  raw?: unknown
}

/**
 * One drain TICK: repeats the read/insert until the stream is caught up or `maxPerTick` rows have
 * been moved.
 *
 * A single fixed batch per tick was a rate limit, not a drain: 1000 rows a minute is 17/s against a
 * 100k-deep stream fed by a §5 envelope of 1500 msg/s, so during exactly the flood the table exists
 * to explain, MAXLEN would trim past the cursor and the rows would be gone — while the counter
 * reported a healthy constant 1000/min. Looping catches up in a few ticks; the ceiling keeps a
 * backlog from monopolising the process that also runs the ordered pipeline.
 */
export async function runRejectDrain(deps: RejectDrainDeps): Promise<number> {
  const maxPerTick = Math.min(Math.max(Math.trunc(deps.maxPerTick ?? 25_000), 1), 200_000)
  let moved = 0
  for (;;) {
    const n = await drainOnce(deps)
    moved += n
    if (n === 0 || moved >= maxPerTick) return moved
  }
}

/** One read/insert/advance window. */
async function drainOnce(deps: RejectDrainDeps): Promise<number> {
  const count = Math.min(Math.max(Math.trunc(deps.batchSize ?? 1_000), 1), 10_000)
  const from = (await deps.redis.get(REJECT_CURSOR_KEY)) ?? '0-0'
  // callBuffer, not xrange: the entry value is CBOR, and the string API would mangle it exactly as
  // it would in the shard consumer (which reads via callBuffer for the same reason)
  let res: [Buffer, Buffer[]][] | null
  try {
    res = (await deps.redis.callBuffer(
      'XRANGE',
      REJECTS_STREAM,
      from === '0-0' ? '-' : `(${from}`,
      '+',
      'COUNT',
      String(count),
    )) as [Buffer, Buffer[]][] | null
  } catch (err) {
    // A cursor that is not a stream id makes XRANGE throw on EVERY tick, forever, with nothing to
    // self-heal it — the drain would be permanently wedged by one bad write. Start over from the
    // oldest surviving entry: re-reading a diagnostic window is free, staying wedged is not.
    if (!(err instanceof Error) || !/invalid stream id/i.test(err.message)) throw err
    await deps.redis.del(REJECT_CURSOR_KEY)
    return 0
  }
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
  // The cursor advances ONLY after the insert commits — a crash in between re-reads the same window
  // and writes the rows twice, which for a diagnostic tail is the right way round.
  //
  // Compare-and-set, not SET: the repeatable job's jobId keeps the SCHEDULE single, not the
  // EXECUTION. A stalled BullMQ lock (this process also runs the ordered pipeline) lets a second
  // replica overlap, and an unconditional write from the slower pass would drag the cursor
  // BACKWARDS — re-reading a window already drained, forever, every tick.
  await deps.redis.eval(ADVANCE_CURSOR_SCRIPT, 1, REJECT_CURSOR_KEY, res[res.length - 1]![0].toString())
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
