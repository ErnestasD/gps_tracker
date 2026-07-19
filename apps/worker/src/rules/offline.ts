import type { RuleEventRow } from './writer.js'

/**
 * device_offline sweeper logic (E05-4b, §6.5). PURE + deterministic — the BullMQ worker
 * (offlineWorker.ts) gathers Redis state and calls this. A device is "offline" when its
 * last fix is older than the threshold: the matching `device_offline` rule's `config.afterH`,
 * else the device profile's presence `offlineAfterH`, else the platform default (26 h, the
 * TAT100 asset-tracker default, §6.5). A per-device fired-flag (`rule:offline:{deviceId}`)
 * makes it fire ONCE per offline episode and reset on recovery — no cooldown needed.
 *
 * A device is only considered if its account has an enabled `device_offline` rule; a device
 * that has never reported (no last fix) is skipped — we cannot distinguish "went offline"
 * from "never onboarded".
 */
export const DEFAULT_OFFLINE_H = 26

export interface OfflineRule {
  ruleId: string
  accountId: string
  afterH?: number // config.afterH override
}
export interface DeviceState {
  deviceId: string
  tenantId: string
  accountId: string
  lastFixMs: number | null
  profileOfflineAfterH?: number
}
export interface OfflineSweepResult {
  events: RuleEventRow[]
  toFlag: string[] // deviceIds to mark offline
  toClear: string[] // deviceIds whose flag to drop (recovered)
}

export function sweepOffline(
  devices: readonly DeviceState[],
  rulesByAccount: ReadonlyMap<string, readonly OfflineRule[]>,
  flagged: ReadonlySet<string>,
  nowMs: number,
): OfflineSweepResult {
  const out: OfflineSweepResult = { events: [], toFlag: [], toClear: [] }
  for (const d of devices) {
    const rules = rulesByAccount.get(d.accountId)
    if (rules === undefined || rules.length === 0) continue // no offline rule for this account
    if (d.lastFixMs === null) continue // never reported — cannot classify

    // the rule that trips first (smallest effective threshold) is the one that fires.
    // Rule config is `z.unknown` upstream (no numeric bound), and a device profile can carry any
    // value too — so sanitize here: a non-positive / non-finite afterH is IGNORED (falls back to
    // profile → default), never taken literally. afterH=0 would otherwise mark a device that
    // reported one second ago as offline, fire one bogus alert, then permanently suppress genuine
    // offline detection (isOffline stays true ⇒ the fired-flag never clears). Review LOW.
    const posH = (v: number | undefined): number | undefined => (v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined)
    const profileH = posH(d.profileOfflineAfterH)
    let firing: OfflineRule | undefined
    let thresholdH = Infinity
    for (const r of rules) {
      const th = posH(r.afterH) ?? profileH ?? DEFAULT_OFFLINE_H
      if (th < thresholdH) {
        thresholdH = th
        firing = r
      }
    }
    if (firing === undefined) continue

    const offlineMs = nowMs - d.lastFixMs
    const isOffline = offlineMs >= thresholdH * 3_600_000
    const wasFlagged = flagged.has(d.deviceId)

    if (isOffline && !wasFlagged) {
      out.events.push({
        tenantId: d.tenantId,
        accountId: d.accountId,
        deviceId: BigInt(d.deviceId),
        ruleId: firing.ruleId,
        kind: 'device_offline',
        at: new Date(nowMs),
        lat: null,
        lon: null,
        payload: { rule: 'device_offline', lastFixMs: d.lastFixMs, thresholdH, offlineH: Math.floor(offlineMs / 3_600_000) },
      })
      out.toFlag.push(d.deviceId)
    } else if (!isOffline && wasFlagged) {
      out.toClear.push(d.deviceId) // recovered → allow the next episode to fire
    }
  }
  return out
}
