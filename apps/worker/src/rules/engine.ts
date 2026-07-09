import type { NormalizedRecord } from '@orbetra/shared'

import { alarmOf, batteryVoltsOf, din1Of, ignitionOf, unplugOf } from './io.js'
import type { EngineRuleKind, RuleDef, RuleEvent } from './types.js'

/**
 * Rule engine (E05-4, §6.5). PURE + deterministic. Evaluates the position/IO rule kinds
 * against a fixTime-sorted batch and emits RuleEvents (cooldown gating + persistence live
 * in the persister). Unlike the trip/geofence engines it receives the FULL batch, NOT the
 * I5-filtered motion records: IO events (ignition/din/power_cut/low_battery/panic) are
 * allowed on invalid-fix records (§3.4), while overspeed self-guards on `fixValid` (rule 6).
 *
 * Edge kinds (ignition/din_change/power_cut/panic) fire on a value TRANSITION, so the
 * engine tracks the last IO value per device and warm-starts it from durable state on
 * first sight (via `ioStateFor`) — a worker restart with a device already unplugged must
 * not re-fire power_cut. Level kinds (overspeed/low_battery) fire while the condition
 * holds and are de-duplicated to at most one event per rule+device per batch (the Redis
 * cooldown then spaces them across batches).
 */
export interface DeviceIo {
  ignition: boolean | null
  din1: boolean | null
  unplug: boolean | null
  alarm: boolean | null
}

const EMPTY_IO: DeviceIo = { ignition: null, din1: null, unplug: null, alarm: null }

/** Rules whose event bypasses cooldown (§6.5 priority-2 / power_cut). */
const BYPASS: ReadonlySet<EngineRuleKind> = new Set<EngineRuleKind>(['panic', 'power_cut'])

export class RuleEngine {
  private readonly io = new Map<string, DeviceIo>() // deviceId → last-seen IO (edge detection)
  private readonly lastSeen = new Map<string, number>() // deviceId → newest fixTime ms (I2)

  /**
   * Feed a fixTime-sorted batch. `rulesFor` supplies the device's enabled, engine-handled
   * rules (account-scoped, resolved by RuleCache). `ioStateFor` warm-starts the last IO
   * value per device on first sight from durable state (persister), so a restart doesn't
   * re-fire an edge that already fired.
   */
  feed(
    records: NormalizedRecord[],
    rulesFor: (deviceId: bigint) => readonly RuleDef[],
    ioStateFor?: (deviceId: bigint) => DeviceIo | undefined,
  ): RuleEvent[] {
    const out: RuleEvent[] = []
    const firedLevel = new Set<string>() // `${ruleId}:${deviceId}` — level kinds fire ≤1× per batch
    for (const r of records) {
      const dev = r.deviceId.toString()
      const seen = this.lastSeen.get(dev)
      if (seen !== undefined && r.fixTime.getTime() < seen) continue // out-of-order (I2)
      this.lastSeen.set(dev, r.fixTime.getTime())

      const rules = rulesFor(r.deviceId)
      if (rules.length === 0) continue

      // previous IO for edge detection (warm-start once from durable state)
      const prev = this.io.get(dev) ?? ioStateFor?.(r.deviceId) ?? EMPTY_IO
      const cur: DeviceIo = {
        ignition: ignitionOf(r),
        din1: din1Of(r),
        unplug: unplugOf(r),
        alarm: alarmOf(r),
      }

      for (const rule of rules) {
        const ev = this.evaluate(rule, r, prev, cur, firedLevel, dev)
        if (ev !== null) out.push(ev)
      }

      // carry forward: a null current reading keeps the previous value so a rule added
      // later, or a packet that omits the id, doesn't fabricate an edge
      this.io.set(dev, {
        ignition: cur.ignition ?? prev.ignition,
        din1: cur.din1 ?? prev.din1,
        unplug: cur.unplug ?? prev.unplug,
        alarm: cur.alarm ?? prev.alarm,
      })
    }
    return out
  }

  /** Current IO snapshot for a device (persister writes these to durable state). */
  snapshot(deviceId: bigint): DeviceIo | undefined {
    return this.io.get(deviceId.toString())
  }

  private evaluate(rule: RuleDef, r: NormalizedRecord, prev: DeviceIo, cur: DeviceIo, firedLevel: Set<string>, dev: string): RuleEvent | null {
    const levelKey = `${rule.id}:${dev}`
    switch (rule.kind) {
      case 'overspeed': {
        if (!r.fixValid) return null // rule 6 / §3.4 — invalid fix never affects overspeed
        if (firedLevel.has(levelKey)) return null
        const limit = num(rule.config['speedKmh'], 90)
        if (r.speed !== null && r.speed > limit) {
          firedLevel.add(levelKey)
          return this.emit(rule, r, { speedKmh: r.speed, limitKmh: limit })
        }
        return null
      }
      case 'low_battery': {
        if (firedLevel.has(levelKey)) return null
        const threshold = num(rule.config['thresholdV'], 11)
        const volts = batteryVoltsOf(r)
        if (volts !== null && volts < threshold) {
          firedLevel.add(levelKey)
          return this.emit(rule, r, { volts, thresholdV: threshold })
        }
        return null
      }
      case 'ignition':
        // fire on any confirmed transition (on↔off); payload carries the new state
        return prev.ignition !== null && cur.ignition !== null && cur.ignition !== prev.ignition
          ? this.emit(rule, r, { ignition: cur.ignition })
          : null
      case 'din_change':
        return prev.din1 !== null && cur.din1 !== null && cur.din1 !== prev.din1
          ? this.emit(rule, r, { din1: cur.din1 })
          : null
      case 'power_cut':
        // rising edge only: external power lost (Unplug 0→1)
        return prev.unplug === false && cur.unplug === true ? this.emit(rule, r, { unplug: true }) : null
      case 'panic':
        // rising edge only: Alarm 0→1
        return prev.alarm === false && cur.alarm === true ? this.emit(rule, r, { alarm: true }) : null
    }
  }

  private emit(rule: RuleDef, r: NormalizedRecord, payload: Record<string, unknown>): RuleEvent {
    return {
      deviceId: r.deviceId,
      ruleId: rule.id,
      kind: rule.kind,
      at: r.fixTime,
      lat: r.lat,
      lon: r.lon,
      cooldownS: rule.cooldownS,
      bypassCooldown: BYPASS.has(rule.kind),
      payload: { rule: rule.name, ...payload },
    }
  }
}

/** Coerce a JSON config value to a finite number, else the default. */
function num(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : dflt
}
