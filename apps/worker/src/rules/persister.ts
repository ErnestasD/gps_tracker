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
      if (Object.keys(h).length > 0) map.set(id, { ignition: bit(h['ignition']), din1: bit(h['din1']), unplug: bit(h['unplug']), alarm: bit(h['alarm']), fuelPct: numOrNull(h['fuelPct']), fuelL: numOrNull(h['fuelL']), fuelBasePct: numOrNull(h['fuelBasePct']), fuelBaseL: numOrNull(h['fuelBaseL']) })
    })
    return (deviceId) => map.get(deviceId.toString())
  }

  /** Persist the engine's current IO snapshot for each device it just processed. */
  async saveIoState(snapshots: Map<string, DeviceIo>): Promise<void> {
    if (snapshots.size === 0) return
    const pipe = this.redis.pipeline()
    for (const [id, io] of snapshots) {
      const key = `rule:iostate:${id}`
      const fields: Record<string, string> = {}
      const del: string[] = []
      // A field that became null in the snapshot must be DELETED, not merely skipped — otherwise a
      // stale value lingers. Critically, fuelBasePct/fuelBaseL are set to null WHILE DRIVING; if the
      // old parked baseline is left in Redis, a restart/rebalance warm-starts it and fires a false
      // fuel_theft for fuel legitimately burned while driving (review MED).
      const bit = (name: string, v: boolean | null): void => {
        if (v === null) del.push(name)
        else fields[name] = v ? '1' : '0'
      }
      const numf = (name: string, v: number | null): void => {
        if (v === null) del.push(name)
        else fields[name] = String(v)
      }
      bit('ignition', io.ignition)
      bit('din1', io.din1)
      bit('unplug', io.unplug)
      bit('alarm', io.alarm)
      numf('fuelPct', io.fuelPct)
      numf('fuelL', io.fuelL)
      numf('fuelBasePct', io.fuelBasePct)
      numf('fuelBaseL', io.fuelBaseL)
      if (Object.keys(fields).length > 0) pipe.hset(key, fields)
      if (del.length > 0) pipe.hdel(key, ...del)
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
    const { survivors: gated, claimedKeys } = await this.cooldownGate(scoped)
    const rows: RuleEventRow[] = gated.map((e) => {
      const s = scope.get(e.deviceId.toString())!
      return { tenantId: s.tenantId, accountId: s.accountId, deviceId: e.deviceId, ruleId: e.ruleId, kind: e.kind, at: e.at, lat: e.lat, lon: e.lon, payload: e.payload }
    })
    try {
      await writeRuleEvents(this.pool, rows)
    } catch (err) {
      // the cooldown key is claimed BEFORE this INSERT (so an ACK-replay of the same batch finds
      // the key set ⇒ no duplicate row). But if the INSERT itself fails, that key would suppress
      // the ACK-replay re-emission and the alert would be lost — so RELEASE the keys we just
      // claimed here, letting the replay/retry re-emit (review MED). Bypass events claim no key.
      if (claimedKeys.length > 0) await this.redis.del(...claimedKeys).catch(() => undefined)
      throw err
    }
    return gated
  }

  /** Keep bypass events always; for the rest, `SET NX EX` decides. Returns the survivors AND the
   *  cooldown keys actually claimed on THIS call (so a failed insert can release them). */
  private async cooldownGate(events: RuleEvent[]): Promise<{ survivors: RuleEvent[]; claimedKeys: string[] }> {
    const needsGate = events.filter((e) => !e.bypassCooldown && e.cooldownS > 0)
    if (needsGate.length === 0) return { survivors: events, claimedKeys: [] }
    const keys = needsGate.map((e) => `rule:cd:${e.ruleId}:${e.deviceId.toString()}`)
    const pipe = this.redis.pipeline()
    needsGate.forEach((e, i) => pipe.set(keys[i]!, String(e.at.getTime()), 'EX', e.cooldownS, 'NX'))
    const res = await pipe.exec()
    const passed = new Set<number>() // index into needsGate
    const claimedKeys: string[] = []
    needsGate.forEach((_, i) => {
      const entry = res?.[i]
      const cmdErr = entry?.[0]
      const reply = entry?.[1]
      if (reply === 'OK') {
        passed.add(i) // freshly claimed → emit + remember the key for possible rollback
        claimedKeys.push(keys[i]!)
      } else if (cmdErr) {
        // a Redis COMMAND error (OOM/LOADING/READONLY after failover) resolves as [Error, undefined]
        // — it is NOT the same as a nil reply (key already existed). Do NOT silently drop the alert:
        // emit it (no key claimed; a later retry may re-fire — "doubled beats missed", §6.5, review LOW).
        passed.add(i)
      }
      // else: reply is null → the key already existed → genuinely gated → drop
    })
    let gi = 0
    const survivors = events.filter((e) => {
      if (e.bypassCooldown || e.cooldownS <= 0) return true
      return passed.has(gi++)
    })
    return { survivors, claimedKeys }
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
