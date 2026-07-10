/**
 * Codec-12 command reconciliation (E08-2, §3.5). PURE + deterministic. A device answers
 * commands SEQUENTIALLY in the order it received them, so responses pair with in-flight
 * commands head-to-head (FIFO). This function takes the current in-flight queue + the
 * received-but-unmatched responses and decides, for one device:
 *  - acked: the response paired to an in-flight command (nack ⇒ failed instead)
 *  - failed: a command that timed out with no retries left, or a nack
 *  - resend: a timed-out command with retries remaining (attempt+1, re-queued)
 *  - remaining: in-flight commands still awaiting a response (not yet timed out)
 * plus how many responses were consumed (so the caller can LTRIM them).
 *
 * KNOWN LIMITATION (v1, §3.5 accepted risk): if a command times out and the device LATER
 * answers it, that late response desyncs the FIFO (pairs to the next command). Real devices
 * answer within the 30 s window; a longer silence usually means the socket dropped (the
 * in-flight is re-queued and re-sent on the next live connection). Documented, not fixed.
 */
export interface Inflight {
  id: string
  text: string
  attempt: number
  sentAtMs: number
  /** original 24 h expiry (epoch ms). Carried through a resend so the re-queued pending entry
   * keeps its expiry — otherwise ingest's past-expiry send-guard (which is `!== undefined`)
   * would be bypassed and a stale command could execute on a late reconnect. */
  expiresAtMs?: number
}
export interface CmdResponse {
  text: string
  nack: boolean
}
export interface ReconcileResult {
  acked: { id: string; response: string }[]
  failed: { id: string; reason: string }[]
  resend: Inflight[]
  remaining: Inflight[]
  consumedResponses: number
}

const TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 3

export interface ReconcileOpts {
  timeoutMs?: number
  maxAttempts?: number
  /** false ⇒ this command fails on timeout instead of being resent (destructive/non-idempotent). */
  isRetryable?: (text: string) => boolean
}

export function reconcile(inflight: readonly Inflight[], responses: readonly CmdResponse[], nowMs: number, opts: ReconcileOpts = {}): ReconcileResult {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS
  const isRetryable = opts.isRetryable ?? (() => true)
  const acked: ReconcileResult['acked'] = []
  const failed: ReconcileResult['failed'] = []
  const resend: Inflight[] = []

  // 1) pair responses to the FIFO head (device answers in order)
  let ri = 0
  let qi = 0
  while (ri < responses.length && qi < inflight.length) {
    const cmd = inflight[qi]!
    const res = responses[ri]!
    if (res.nack) failed.push({ id: cmd.id, reason: 'device rejected (nack)' })
    else acked.push({ id: cmd.id, response: res.text })
    ri++
    qi++
  }
  const consumedResponses = ri

  // 2) the still-unanswered tail: time out the ones past the window
  const remaining: Inflight[] = []
  for (let i = qi; i < inflight.length; i++) {
    const cmd = inflight[i]!
    if (nowMs - cmd.sentAtMs < timeoutMs) {
      remaining.push(cmd) // still within its response window
    } else if (isRetryable(cmd.text) && cmd.attempt + 1 < maxAttempts) {
      resend.push({ ...cmd, attempt: cmd.attempt + 1 }) // retry (§3.5 max 3)
    } else {
      failed.push({ id: cmd.id, reason: isRetryable(cmd.text) ? 'timeout (max retries)' : 'timeout (non-retryable command)' })
    }
  }

  return { acked, failed, resend, remaining, consumedResponses }
}
