import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { DeviceIo } from './engine.js'
import type { RuleEvent } from './types.js'
import { writeRuleEvents, type RuleEventRow } from './writer.js'

/**
 * Persists rule events (E05-4). Resolves each device's tenant/account from the registry
 * (device:tenant/device:account) — an event is never written with a guessed tenant; an
 * event for an unregistered device is skipped. Applies the per-rule cooldown as an atomic
 * `SET NX EX cooldownS` on `rule:cd:{ruleId}:{deviceId}` so event emission is idempotent
 * under the ACK-replay window (onBatch runs before XACK; a replayed batch re-emits, but the
 * cooldown key already exists ⇒ no duplicate row). panic + power_cut bypass the cooldown
 * (§6.5 priority-2) — a replay MAY re-fire those, which is the correct trade-off (a doubled
 * panic beats a missed one). IO edge state is persisted so a restart doesn't re-fire.
 */
export class RulePersister {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  /** Warm-start the last IO value per device → the engine's `ioStateFor` lookup. */
  async loadIoState(deviceIds: readonly bigint[]): Promise<(deviceId: bigint) => DeviceIo | undefined> {
    const ids = [...new Set(deviceIds.map((d) => d.toString()))]
    if (ids.length === 0) return () => undefined
    const pipe = this.redis.pipeline()
    for (const id of ids) pipe.hgetall(`rule:iostate:${id}`)
    const res = await pipe.exec()
    const map = new Map<string, DeviceIo>()
    ids.forEach((id, i) => {
      const h = (res?.[i]?.[1] ?? {}) as Record<string, string>
      if (Object.keys(h).length > 0) map.set(id, { ignition: bit(h['ignition']), din1: bit(h['din1']), unplug: bit(h['unplug']), alarm: bit(h['alarm']), fuelPct: numOrNull(h['fuelPct']), fuelL: numOrNull(h['fuelL']) })
    })
    return (deviceId) => map.get(deviceId.toString())
  }

  /** Persist the engine's current IO snapshot for each device it just processed. */
  async saveIoState(snapshots: Map<string, DeviceIo>): Promise<void> {
    if (snapshots.size === 0) return
    const pipe = this.redis.pipeline()
    for (const [id, io] of snapshots) {
      const fields: Record<string, string> = {}
      if (io.ignition !== null) fields['ignition'] = io.ignition ? '1' : '0'
      if (io.din1 !== null) fields['din1'] = io.din1 ? '1' : '0'
      if (io.unplug !== null) fields['unplug'] = io.unplug ? '1' : '0'
      if (io.alarm !== null) fields['alarm'] = io.alarm ? '1' : '0'
      if (io.fuelPct !== null) fields['fuelPct'] = String(io.fuelPct)
      if (io.fuelL !== null) fields['fuelL'] = String(io.fuelL)
      if (Object.keys(fields).length > 0) pipe.hset(`rule:iostate:${id}`, fields)
    }
    await pipe.exec()
  }

  /** Write events that pass scope resolution + cooldown gating. Returns the events actually
   * written (events has no dedup constraint, so rowCount === gated.length) — the caller uses
   * their kinds for the rule_events_total{kind} metric. */
  async persist(events: RuleEvent[]): Promise<RuleEvent[]> {
    if (events.length === 0) return []
    const devices = [...new Set(events.map((e) => e.deviceId.toString()))]
    const [tenants, accounts] = await Promise.all([this.redis.hmget('device:tenant', ...devices), this.redis.hmget('device:account', ...devices)])
    const scope = new Map<string, { tenantId: string; accountId: string }>()
    devices.forEach((id, i) => {
      const t = tenants[i]
      const a = accounts[i]
      if (t && a) scope.set(id, { tenantId: t, accountId: a })
    })

    // scope-resolvable events only; cooldown-gate the non-bypass ones atomically
    const scoped = events.filter((e) => scope.has(e.deviceId.toString()))
    const gated = await this.cooldownGate(scoped)
    const rows: RuleEventRow[] = gated.map((e) => {
      const s = scope.get(e.deviceId.toString())!
      return { tenantId: s.tenantId, accountId: s.accountId, deviceId: e.deviceId, ruleId: e.ruleId, kind: e.kind, at: e.at, lat: e.lat, lon: e.lon, payload: e.payload }
    })
    await writeRuleEvents(this.pool, rows)
    return gated
  }

  /** Keep bypass events always; for the rest, `SET NX EX` decides (returns the survivors). */
  private async cooldownGate(events: RuleEvent[]): Promise<RuleEvent[]> {
    const needsGate = events.filter((e) => !e.bypassCooldown && e.cooldownS > 0)
    if (needsGate.length === 0) return events
    const pipe = this.redis.pipeline()
    for (const e of needsGate) pipe.set(`rule:cd:${e.ruleId}:${e.deviceId.toString()}`, String(e.at.getTime()), 'EX', e.cooldownS, 'NX')
    const res = await pipe.exec()
    const passed = new Set<number>() // index into needsGate
    needsGate.forEach((_, i) => {
      if (res?.[i]?.[1] === 'OK') passed.add(i)
    })
    let gi = 0
    return events.filter((e) => {
      if (e.bypassCooldown || e.cooldownS <= 0) return true
      return passed.has(gi++)
    })
  }
}

function bit(v: string | undefined): boolean | null {
  return v === '1' ? true : v === '0' ? false : null
}

function numOrNull(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
