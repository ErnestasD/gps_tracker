import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { isRetryableCommand } from '@orbetra/shared'

import { reconcile, type CmdResponse, type Inflight } from './reconcile.js'

const KEY_TTL_S = 24 * 3_600 // bound cmd:* lists so an offline device can't leak Redis forever

/**
 * Codec-12 command dispatcher (E08-2, §3.5). The command queue/timeout/retry POLICY lives
 * here (NOT in ingest — rule 3). Redis is the transport seam written by ingest:
 *   cmd:active            SET of deviceIds with pending/in-flight/response activity
 *   cmd:pending:{dev}     LIST of {id,text,attempt} the api queued; ingest LPOPs + sends
 *   cmd:inflight:{dev}    LIST of {id,text,attempt,sentAtMs} ingest appended after sending
 *   cmd:resp:{dev}        LIST of {codec,text,nack} ingest appended from device responses
 * Every ~15 s this reconciles in-flight ↔ responses per active device and drives the DB
 * status machine (queued→sent→acked|failed|expired). Removals from cmd:inflight/resp use
 * value-precise LREM/LTRIM so a concurrent ingest append is never clobbered (no destructive
 * rebuild). DB expiry is authoritative (expiresAt 24 h, §3.5).
 */

export interface CommandDispatchDeps {
  connection: ConnectionOptions
  pool: Pool
  redis: Redis
  onResult?: (r: { acked: number; failed: number; expired: number }) => void
}

const parseInflight = (raw: string): Inflight | null => {
  try {
    const j = JSON.parse(raw) as Partial<Inflight>
    if (typeof j.id === 'string' && typeof j.text === 'string' && typeof j.attempt === 'number' && typeof j.sentAtMs === 'number') {
      return { id: j.id, text: j.text, attempt: j.attempt, sentAtMs: j.sentAtMs, ...(typeof j.expiresAtMs === 'number' ? { expiresAtMs: j.expiresAtMs } : {}) }
    }
  } catch {
    /* skip malformed */
  }
  return null
}
const parseResp = (raw: string): CmdResponse | null => {
  try {
    const j = JSON.parse(raw) as { text?: unknown; nack?: unknown }
    if (typeof j.text === 'string') return { text: j.text, nack: j.nack === true }
  } catch {
    /* skip */
  }
  return null
}

/** Reconcile one device. Returns per-outcome counts. */
interface PendingEntry {
  id: string
  text: string
  attempt: number
  expiresAtMs?: number
}
const parsePending = (raw: string): PendingEntry | null => {
  try {
    const j = JSON.parse(raw) as Partial<PendingEntry>
    if (typeof j.id === 'string' && typeof j.text === 'string') return { id: j.id, text: j.text, attempt: typeof j.attempt === 'number' ? j.attempt : 0, ...(typeof j.expiresAtMs === 'number' ? { expiresAtMs: j.expiresAtMs } : {}) }
  } catch {
    /* skip */
  }
  return null
}

async function processDevice(pool: Pool, redis: Redis, deviceId: string, nowMs: number): Promise<{ acked: number; failed: number }> {
  const [inflightRaw, respRaw, pendingRaw] = await Promise.all([
    redis.lrange(`cmd:inflight:${deviceId}`, 0, -1),
    redis.lrange(`cmd:resp:${deviceId}`, 0, -1),
    redis.lrange(`cmd:pending:${deviceId}`, 0, -1),
  ])
  const inflight = inflightRaw.map(parseInflight).filter((x): x is Inflight => x !== null)
  const responses = respRaw.map(parseResp).filter((x): x is CmdResponse => x !== null)

  // PURGE expired-but-still-queued pending entries BEFORE they can be drained + sent — a
  // destructive command (deleterecords/cpureset) queued while offline must NOT execute on a
  // reconnect after its 24 h expiry (review HIGH). DB-expire them and LREM from the queue.
  for (const raw of pendingRaw) {
    const p = parsePending(raw)
    if (p && p.expiresAtMs !== undefined && p.expiresAtMs <= nowMs) {
      await pool.query(`UPDATE commands SET status='expired' WHERE id=$1 AND status IN ('queued','sent')`, [p.id])
      await redis.lrem(`cmd:pending:${deviceId}`, 1, raw)
    }
  }

  // any in-flight command still 'queued' in the DB has just been sent by ingest → mark sent
  if (inflight.length > 0) {
    await pool.query(`UPDATE commands SET status='sent', "sentAt"=COALESCE("sentAt", now()) WHERE id = ANY($1::uuid[]) AND status='queued'`, [inflight.map((c) => c.id)])
  }

  const r = reconcile(inflight, responses, nowMs, { isRetryable: isRetryableCommand })

  for (const a of r.acked) await pool.query(`UPDATE commands SET status='acked', response=$2 WHERE id=$1 AND status IN ('queued','sent')`, [a.id, a.response])
  for (const f of r.failed) await pool.query(`UPDATE commands SET status='failed', response=$2 WHERE id=$1 AND status IN ('queued','sent')`, [f.id, f.reason])
  // re-queue timed-out retries: DB back to queued, and re-push for ingest to send again
  for (const s of r.resend) {
    await pool.query(`UPDATE commands SET status='queued' WHERE id=$1 AND status IN ('queued','sent')`, [s.id])
    // carry expiresAtMs so ingest's past-expiry send-guard still applies to the re-queued entry
    await redis.rpush(`cmd:pending:${deviceId}`, JSON.stringify({ id: s.id, text: s.text, attempt: s.attempt, ...(s.expiresAtMs !== undefined ? { expiresAtMs: s.expiresAtMs } : {}) }))
  }

  // value-precise cleanup (race-safe vs a concurrent ingest append):
  const keepIds = new Set(r.remaining.map((c) => c.id))
  //  - remove every in-flight entry no longer awaiting a response (acked/failed/resend)
  for (const raw of inflightRaw) {
    const c = parseInflight(raw)
    if (c && !keepIds.has(c.id)) await redis.lrem(`cmd:inflight:${deviceId}`, 1, raw)
  }
  //  - drop consumed responses. ALWAYS trim by a fixed HEAD count (never `del`): a `del`
  //    would also wipe any response ingest RPUSHed AFTER our LRANGE snapshot, causing a false
  //    timeout → double-send. With nothing left in flight, everything in the snapshot (consumed
  //    + orphan/extra late replies) can go — but ltrim by snapshot length keeps concurrent tail
  //    appends alive; with commands still in flight, keep the unconsumed tail for the next tick.
  const dropCount = r.remaining.length === 0 ? respRaw.length : r.consumedResponses
  if (dropCount > 0) await redis.ltrim(`cmd:resp:${deviceId}`, dropCount, -1)

  // bound the lists so an offline-commanded device can't leak Redis forever (review MED)
  await redis.expire(`cmd:pending:${deviceId}`, KEY_TTL_S)
  await redis.expire(`cmd:inflight:${deviceId}`, KEY_TTL_S)

  // drop this device from the active set once nothing is left to do
  const [pend, inflightLeft] = await Promise.all([redis.llen(`cmd:pending:${deviceId}`), redis.llen(`cmd:inflight:${deviceId}`)])
  if (pend === 0 && inflightLeft === 0 && r.remaining.length === 0) await redis.srem('cmd:active', deviceId)

  return { acked: r.acked.length, failed: r.failed.length }
}

/** One dispatch tick across all active devices. */
export async function runCommandDispatch(pool: Pool, redis: Redis, nowMs: number): Promise<{ acked: number; failed: number; expired: number }> {
  // GLOBAL expiry first — a command whose device never entered cmd:active (e.g. the create-time
  // sadd failed) must still expire at 24 h, so this runs independent of the active set.
  const exp = await pool.query(`UPDATE commands SET status='expired' WHERE status IN ('queued','sent') AND "expiresAt" < now() RETURNING id`)
  const total = { acked: 0, failed: 0, expired: exp.rowCount ?? 0 }

  const devices = await redis.smembers('cmd:active')
  for (const dev of devices) {
    const r = await processDevice(pool, redis, dev, nowMs)
    total.acked += r.acked
    total.failed += r.failed
  }
  return total
}

export const COMMAND_DISPATCH_QUEUE = 'command-dispatch'
export const DISPATCH_EVERY_MS = 15_000

export function createCommandDispatchQueue(connection: ConnectionOptions): Queue {
  return new Queue(COMMAND_DISPATCH_QUEUE, { connection })
}

/** Upsert the repeatable dispatch tick. */
export async function scheduleCommandDispatch(queue: Queue): Promise<void> {
  await queue.add('dispatch', {}, { repeat: { every: DISPATCH_EVERY_MS }, jobId: 'command-dispatch', removeOnComplete: true, removeOnFail: 100 })
}

export function startCommandDispatcher(deps: CommandDispatchDeps): Worker {
  return new Worker(
    COMMAND_DISPATCH_QUEUE,
    async () => {
      const r = await runCommandDispatch(deps.pool, deps.redis, Date.now())
      if (r.acked + r.failed + r.expired > 0) deps.onResult?.(r)
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
