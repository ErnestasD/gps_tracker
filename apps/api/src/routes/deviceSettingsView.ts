import { parseGetparamReply, requestedIds } from '@orbetra/shared'

/**
 * What a device ACTUALLY holds, derived from its own `getparam` replies.
 *
 * There is no stored copy of the settings, on purpose. A second source of truth drifts the moment a
 * write is silently ignored — and that is not hypothetical: on 2026-08-18 a `setparam` was accepted,
 * queued, delivered and had no effect, and only the device's own answer distinguished the two. The
 * command rows already carry every reply we have ever received, so they ARE the record; this reads
 * it rather than duplicating it.
 *
 * A value we cannot source from a reply is reported as `null` — "we do not know" — never as the
 * factory default and never as the number we last commanded. Those would both be guesses presented
 * as device state, which is the specific lie this feature exists to stop telling.
 */

/**
 * What this reconstruction needs to know about a parameter: the id the device answers about, and
 * the key to file the answer under.
 *
 * Deliberately structural rather than `AvailableSetting`. Nothing below reads a bound, a unit or a
 * factory value, and the CAN route has none of those to offer — its "key" IS the parameter id. Two
 * copies of this walk over the command history would be two places for the newest-reply-wins and
 * first-read-after-a-write rules to drift, and those rules were bought with a day of hardware time.
 */
export interface ReadableParam {
  /** Teltonika parameter id, as it appears in `getparam`/`setparam`. */
  param: string
  /** The name this parameter is reported under. */
  key: string
}

export interface CommandRow {
  text: string
  status: string
  response: string | null
  createdAt: string
  sentAt: string | null
}

/**
 * Where a requested change has got to. The API must be able to say all of these, because a customer
 * who changed a slider and sees nothing has no way to tell "the truck is parked" from "the device
 * refused it" — and the second one is the failure that cost a day of hardware time.
 */
export type ChangeState =
  | 'waiting' // queued; the device has not connected yet
  | 'sent' // transmitted, no verification back yet
  | 'confirmed' // the device reported exactly this value
  | 'rejected' // the device answered, and it holds something ELSE
  | 'undelivered' // the command failed or expired without ever reaching the device

export interface CurrentSetting {
  /** The value the device stated, or null when no reply has ever mentioned this parameter. */
  value: number | null
  /** When we asked — the verifying command's own timestamp, so the UI can age it honestly. */
  checkedAt: string | null
  /** The value a customer asked for that the device has not confirmed, with where it has got to. */
  requested: number | null
  state: ChangeState | null
}

/** Anchored to the argument list: `setparam 2004:host10055:9` must not read as a 10055 write. */
const setparamPairs = (text: string): [string, number][] => {
  const m = /^\s*setparam\s+(.*)$/i.exec(text.trim())
  if (m === null) return []
  const out: [string, number][] = []
  for (const part of (m[1] ?? '').split(';')) {
    const pair = /^\s*(\d{1,7})\s*:\s*(-?\d+)\s*$/.exec(part)
    if (pair !== null) out.push([pair[1]!, Number(pair[2])])
  }
  return out
}

const TERMINAL_UNDELIVERED = new Set(['failed', 'expired'])
const IN_FLIGHT = new Set(['queued', 'sent'])

export function currentSettings(
  available: readonly ReadableParam[],
  history: readonly CommandRow[],
): { current: Record<string, CurrentSetting> } {
  const wanted = new Map(available.map((s) => [s.param, s.key]))
  const current: Record<string, CurrentSetting> = {}
  for (const s of available) current[s.key] = { value: null, checkedAt: null, requested: null, state: null }

  /**
   * Sorted here rather than trusting the caller. The repo's `listForDevice` happens to order
   * newest-first today, and every "the newest reply wins" property below silently inverts if that
   * ORDER BY is ever changed — a route that then reports a superseded value as current, with no
   * test failing.
   */
  const rows = [...history].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

  /** When the settling reply was ASKED — a reading older than a write proves nothing about it. */
  const readAt = new Map<string, string>()

  // Pass 1 — the device's own answers. The FIRST reply that ASKED about a parameter settles it,
  // even if that reply could not be read: "we asked and the device did not tell us" is a different
  // fact from "we never asked", and letting an older reading survive an unreadable newer one
  // freezes the page on pre-upgrade values after a firmware change.
  const settled = new Set<string>()
  for (const row of rows) {
    if (row.response === null) continue // still waiting on the device; it has told us nothing
    const asked = requestedIds(row.text)
    if (asked.length === 0) continue
    const reported = parseGetparamReply(row.response, asked)
    for (const param of asked) {
      const key = wanted.get(param)
      if (key === undefined || settled.has(param)) continue
      settled.add(param)
      readAt.set(param, row.createdAt)
      const raw = reported.get(param)
      const slot = current[key]!
      slot.checkedAt = row.sentAt ?? row.createdAt
      slot.value = raw !== undefined && raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : null
    }
  }

  /**
   * The FIRST reading after a write is the one that judges it — later ones only report the present.
   *
   * Seen live on 2026-08-18: a write asked for 0, the verification that followed confirmed 0, and
   * hours later the value was changed to 2 by SMS. Judging the old write against the newest reading
   * then declared it `rejected` — the loudest badge on the screen — for a command that had been
   * applied exactly as asked and merely superseded since. The platform cannot see an SMS, so
   * "the device holds something else NOW" is not evidence about what it did with a write hours ago.
   */
  const oldestFirst = [...rows].reverse()
  const firstReadAfter = (param: string, writeAt: string): { value: number | null } | undefined => {
    for (const row of oldestFirst) {
      if (row.response === null || row.createdAt <= writeAt) continue
      const asked = requestedIds(row.text)
      if (!asked.includes(param)) continue
      const raw = parseGetparamReply(row.response, asked).get(param)
      return { value: raw !== undefined && raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : null }
    }
    return undefined
  }

  // Pass 2 — what the customer asked for, and whether it got there. Only the most recent write per
  // parameter matters; older ones are history.
  const claimed = new Set<string>()
  for (const row of rows) {
    for (const [param, value] of setparamPairs(row.text)) {
      const key = wanted.get(param)
      if (key === undefined || claimed.has(param)) continue
      claimed.add(param)
      const slot = current[key]!
      slot.requested = value
      if (IN_FLIGHT.has(row.status)) {
        slot.state = row.status === 'queued' ? 'waiting' : 'sent'
      } else if (TERMINAL_UNDELIVERED.has(row.status)) {
        slot.state = 'undelivered'
      } else if (slot.value === null || (readAt.get(param) ?? '') < row.createdAt) {
        /**
         * Delivered and acked, but nothing has come back SINCE. A reading taken before the write
         * says nothing about it — and comparing them anyway turned the ordinary "re-read, then
         * change" sequence into the loudest badge on the screen: `rejected`, meaning the device
         * answered and kept something else, when in truth it had not spoken since. On a parked
         * vehicle the verification is hours away, so this is the common case, not the edge.
         */
        slot.state = 'sent'
      } else {
        // THE case this whole feature exists for: the device answered AFTER the write, and it
        // disagrees with what was asked for. Judged by the FIRST reading that followed the write,
        // never by a later one that may be reporting a change made somewhere we cannot see.
        const verdict = firstReadAfter(param, row.createdAt)
        slot.state = verdict === undefined || verdict.value === null ? 'sent' : verdict.value === value ? 'confirmed' : 'rejected'
      }
    }
  }
  return { current }
}
