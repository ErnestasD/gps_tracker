/**
 * Reader for a Teltonika `getparam` reply — how we learn what a device ACTUALLY holds.
 *
 * The platform never trusts its own setparam. A write that the device silently ignored looks
 * identical to one it applied, and on 2026-08-18 that difference was the whole investigation:
 * `getparam 121 → Value:15` and `getparam 11813 → Value:0` were the only facts that separated what
 * we had commanded from what the tracker was doing, after several hours of plausible theories about
 * antennas and window glass. Every settings write is therefore followed by a read, and this parses
 * the answer.
 *
 * Command syntax, per the model's own SMS/GPRS command list — `getparam <id1>;<id2>;…` and
 * `setparam <id>:<value>;<id>:<value>;…`, and GPRS commands carry no password and no leading space
 * (CLAUDE.md rule 8):
 *   https://wiki.teltonika-gps.com/view/FTC887_SMS/GPRS_Command_List
 *   https://wiki.teltonika-gps.com/view/FMB120_SMS/GPRS_Commands
 *
 * The REPLY format is not stated on either page — Teltonika documents what to send, not what comes
 * back — so the four shapes below are recorded from hardware rather than cited. They are marked as
 * evidence, not specification: a firmware that answers differently will read as "we do not know",
 * which is the safe direction, and `currentSettings` treats an unparseable newest reply as
 * unknown rather than letting an older reading stand.
 *
 * The four shapes observed on real hardware (FTC887, firmware 3.7.0), verbatim:
 *
 *   getparam 121            → "Param ID:121 Value:15"
 *   getparam 102;103;106;107 → "Param ID:102 Value:0;103:120;106:0;107:2"
 *   getparam 2001           → "Param ID:2001 Value:"          (set, but empty)
 *   getparam 2027           → "Param ID:2027 doesn't exist"    (not on this model)
 *
 * The multi-id form states `Value:` once and then continues as bare `id:value` pairs, which is why
 * this cannot be a single regex applied per pair.
 */

/** A parameter the device reported. `value` is null when the device says it holds nothing. */
export interface ReportedParam {
  id: string
  value: string | null
}

/**
 * Parse a reply into id → value. Unrecognised text yields an empty map rather than a guess: a
 * settings page that shows nothing is recoverable, one that shows a number the device never said
 * is not.
 */
export function parseGetparamReply(reply: string, requested: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const allowed = new Set(requested)
  if (allowed.size === 0) return out
  const head = /Param\s+ID:(\d{1,7})\s+Value:(.*)$/is.exec(reply.trim())
  if (head === null) return out

  const firstId = head[1]!
  if (!allowed.has(firstId)) return out // an answer about something we did not ask
  const rest = head[2] ?? ''

  /**
   * A single-id request is NOT split on `;`.
   *
   * Teltonika string parameters may legitimately contain a semicolon, and the continuation syntax
   * is indistinguishable from one. `getparam 2001` answered `Param ID:2001 Value:banga;10055:2`
   * would otherwise report a 2-second send period the device never held — and `confirmsValue`, the
   * oracle that decides whether a write took, would agree. This repo already rates exactly this
   * injection shape HIGH on the SMS path, where an APN containing `;2004:evil.com` is refused
   * end-to-end; the same separator deserves the same suspicion coming back.
   */
  if (allowed.size === 1) {
    // One trailing separator is dropped — the firmware emits it (`New value 2001:internet;` was
    // observed on hardware) and keeping it would turn a perfectly good `300;` into a value that
    // fails the integer check and reads as "we do not know". A value that genuinely ends in `;`
    // loses its last character, which is the cheaper mistake for a settings page.
    const only = rest.trim().replace(/;$/, '').trim()
    out.set(firstId, only === '' ? null : only)
    return out
  }

  const parts = rest.split(';')
  const firstValue = (parts.shift() ?? '').trim()
  out.set(firstId, firstValue === '' ? null : firstValue)

  for (const part of parts) {
    const pair = /^\s*(\d{1,7})\s*:\s*(.*)$/s.exec(part)
    if (pair === null) continue // trailing separator or prose we do not recognise
    const id = pair[1]!
    if (!allowed.has(id)) continue // only ids this very command asked about
    const value = (pair[2] ?? '').trim()
    out.set(id, value === '' ? null : value)
  }
  return out
}

/**
 * The ids a `getparam` command asked about — `getparam 10050;10051` ⇒ ['10050','10051'].
 *
 * The reply is only trusted for these, so this is the security boundary rather than a convenience.
 */
export function requestedIds(commandText: string): string[] {
  const m = /^\s*getparam\s+([\d;\s]+)$/i.exec(commandText.trim())
  if (m === null) return []
  return (m[1] ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^\d{1,7}$/.test(s))
}

/**
 * The numeric value the device reported for one id, or null.
 *
 * Null covers all three ways an answer can fail to be a number — the device said the id does not
 * exist, said it holds nothing, or said something non-numeric — and the caller must treat all three
 * the same way: we do not know, so do not display a value we cannot source.
 */
export function reportedNumber(reply: string, id: string, requested: readonly string[] = [id]): number | null {
  const raw = parseGetparamReply(reply, requested).get(id)
  if (raw === undefined || raw === null) return null
  if (!/^-?\d+$/.test(raw)) return null
  return Number(raw)
}

/** Did the device confirm this id holds exactly `expected`? The check that follows every write. */
export function confirmsValue(reply: string, id: string, expected: number, requested: readonly string[] = [id]): boolean {
  return reportedNumber(reply, id, requested) === expected
}
