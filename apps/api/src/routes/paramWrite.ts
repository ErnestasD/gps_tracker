import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'

/**
 * Queue a parameter write and the read that will verify it — the one place that does this.
 *
 * Two routes now write Teltonika parameters (the tracking-settings sliders and the CAN element
 * priorities) and both sell the same three guarantees, every one of which was bought with hardware
 * time on 2026-08-18:
 *
 *   1. ONE `setparam` carrying every change, so the device applies them together or not at all. A
 *      half-applied change is worse than a rejected one: the customer sees some controls move and
 *      has no way to tell which reached the device.
 *   2. A `getparam` for the same ids right behind it. The platform never trusts its own setparam —
 *      a write the tracker silently ignored looks identical to one it applied, and only the
 *      device's own answer separates them.
 *   3. Both queued atomically, and a queued write for the same parameters dropped first.
 *
 * A second copy of this would be a second place for those to drift, and the drift would be silent:
 * the failure it guards against is a command that looks fine in every log we keep.
 */

/** One parameter change: the Teltonika id and the whole number to write to it. */
export interface ParamWrite {
  param: string
  value: number
}

export interface QueuedParamWrite {
  /** The `setparam` row. */
  commandId: string
  /** The `getparam` queued behind it, whose reply decides whether the write took. */
  verifyCommandId: string
  /** The exact `setparam` text, so the caller can echo what was actually sent. */
  text: string
}

/**
 * Our own ceiling on a generated command's length, not a protocol claim.
 *
 * Teltonika documents no maximum for a `setparam` argument list, so this is the bound this repo
 * already lives with everywhere else: `commandCreateSchema` caps an operator-typed command at 512
 * printable ASCII characters, and the same column and the same dispatcher carry both. A CAN model
 * offers up to 83 elements, which would overrun it, so a caller changing everything at once splits
 * the request — a refusal that names the limit, never a truncated command the device half-applies.
 */
export const MAX_COMMAND_TEXT = 512

export const setparamText = (writes: readonly ParamWrite[]): string =>
  `setparam ${writes.map((w) => `${w.param}:${w.value}`).join(';')}`
export const getparamText = (writes: readonly ParamWrite[]): string =>
  `getparam ${writes.map((w) => w.param).join(';')}`

/** True when this batch would produce a command longer than we are willing to send. */
export const exceedsCommandLimit = (writes: readonly ParamWrite[]): boolean =>
  setparamText(writes).length > MAX_COMMAND_TEXT || getparamText(writes).length > MAX_COMMAND_TEXT

/**
 * A superseded write must NOT still execute.
 *
 * Commands sit in the pending list until the device connects, which on a parked vehicle is measured
 * in hours — long enough for the customer to change their mind, or for someone to fix the same
 * parameter another way. Live proof, 2026-08-18: a settings command queued at 14:17 was corrected
 * at 14:53 by another route, and when the tracker finally connected at 14:54 the STALE command
 * drained and re-applied the value that had just been undone. The vehicle went silent for five
 * hours and the platform showed no fault at all.
 *
 * So a new write drops any queued setparam that touches the same parameters — last instruction
 * wins, which is what a customer clicking a control twice already believes. Verification getparams
 * are left alone: an extra read costs nothing and never harms.
 */
const supersedes = (text: string, touched: ReadonlySet<string>): boolean =>
  /^\s*setparam\s/i.test(text) && [...text.matchAll(/(\d{1,7}):-?\d+/g)].some((m) => touched.has(m[1]!))

/**
 * Create both command rows, drop anything they supersede, and push them to the device's queue.
 *
 * Returns null when Redis would not take them — the caller answers 503. Deliberately NOT
 * best-effort: two sequential rpush calls can leave the write queued with no verification behind
 * it, and a swallowed Redis error would report `queued: true` for a command no device will ever
 * receive while the rows sit "waiting" for 24 h. Success reported for something the hardware has
 * not seen is the exact failure these routes are shaped around avoiding.
 */
export async function queueParamWrite(
  deps: { redis: Redis; db: Db },
  scope: Parameters<Db['commands']['create']>[0],
  actor: { userId: string },
  device: { id: bigint; accountId: string },
  writes: readonly ParamWrite[],
): Promise<QueuedParamWrite | null> {
  const { redis, db } = deps
  const setText = setparamText(writes)
  const getText = getparamText(writes)
  const set = await db.commands.create(scope, actor, { deviceId: device.id, accountId: device.accountId, text: setText })
  const verify = await db.commands.create(scope, actor, { deviceId: device.id, accountId: device.accountId, text: getText })

  const pendKey = `cmd:pending:${device.id.toString()}`
  const payload = (cmd: typeof set) => JSON.stringify({ id: cmd.id, text: cmd.text, attempt: 0, expiresAtMs: Date.parse(cmd.expiresAt) })
  const touched = new Set(writes.map((w) => w.param))
  try {
    const queued = await redis.lrange(pendKey, 0, -1)
    const stale = queued.filter((raw) => {
      try {
        return supersedes((JSON.parse(raw) as { text?: string }).text ?? '', touched)
      } catch {
        return false // not ours to judge; leave anything unparseable in place
      }
    })
    const tx = redis.multi()
    for (const raw of stale) tx.lrem(pendKey, 0, raw)
    // ordering holds because the pending list is FIFO: the write drains before its verification
    await tx
      .rpush(pendKey, payload(set), payload(verify))
      .expire(pendKey, 24 * 3_600) // bound the list if the device never connects
      .sadd('cmd:active', device.id.toString())
      .exec()
    // the DB rows for the dropped commands must not sit "waiting" forever either
    for (const raw of stale) {
      const id = (JSON.parse(raw) as { id?: string }).id
      if (id !== undefined) await db.commands.markSuperseded(scope, id)
    }
  } catch (err) {
    console.error('param write enqueue failed', err)
    return null
  }
  return { commandId: set.id, verifyCommandId: verify.id, text: setText }
}
