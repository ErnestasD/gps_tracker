import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { DeviceIo } from './engine.js'
import type { RuleEvent } from './types.js'
import { writeRuleEvents, type RuleEventRow } from './writer.js'

/**
 * How long a replay-dedup key lives. It only has to outlast the stream's redelivery window
 * (`onBatch` → `XACK`, plus any XAUTOCLAIM of a stalled consumer's pending entries); an hour is
 * generous for both. Keyed per event, so the ceiling is one key per alert per hour.
 */
const REPLAY_TTL_S = 3_600

/**
 * Extra wall-clock life for a cooldown key beyond its own window. The comparison is in FIX time, so
 * the TTL is purely about reclaiming memory — but it must outlive a buffered device's flush, or a
 * fleet coming back from a weekend outage would find every marker expired and re-alert on history
 * it already alerted on. 48 h matches ingest's §3.6 fix-time sanity bound.
 */
const LATE_FLUSH_S = 48 * 3_600

/**
 * Cooldown decision, in the events' own clock. KEYS[1] holds the last EMITTED event's fix time.
 * ARGV: [atMs, cooldownMs, ttlS]. Returns 1 to emit, 0 to suppress.
 *
 * The window is SYMMETRIC (`math.abs`): a buffered flush arrives out of order, so an event just
 * BEFORE the marker is as much part of the same burst as one just after. The marker always moves to
 * the emitted event — including backwards — because the rule is "not twice within N of each other",
 * not "not twice within N of the newest thing we have seen".
 */
/** Short stable tag for an event's payload — enough to separate two same-millisecond events of one
 *  rule, small enough to keep the key short. Collisions cost a dropped duplicate, never a wrong row. */
function payloadTag(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload, Object.keys(payload).sort())
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

const COOLDOWN_SCRIPT = `local prev = redis.call('GET', KEYS[1])
local at = tonumber(ARGV[1])
if prev and math.abs(at - tonumber(prev)) < tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
return 1`

/**
 * Persists rule events (E05-4). Resolves each device's tenant/account from the registry
 * (device:tenant/device:account) — an event is never written with a guessed tenant; an
 * event for an unregistered device is skipped. IO edge state is persisted so a restart
 * doesn't re-fire.
 *
 * TWO SEPARATE GUARDS, because one key was doing both jobs and doing each badly (audit MED):
 *
 * 1. REPLAY DEDUP — `rule:seen:{ruleId}:{deviceId}:{kind}:{atMs}`, `SET NX`. `onBatch` runs
 *    BEFORE `XACK`, so a redelivered batch re-emits the same events; without a key they become
 *    duplicate rows. This used to be the cooldown key's second job, which meant a rule configured
 *    with `cooldownS: 0` — a perfectly ordinary "alert on every occurrence" setting — had NO dedup
 *    at all and wrote a duplicate alert per redelivery. It is keyed on the event's own IDENTITY, so
 *    it can never suppress a genuinely different event, and it now covers panic/power_cut too: the
 *    old "a doubled panic beats a missed one" trade-off existed because a claimed key plus a failed
 *    INSERT lost the alert, and the release path below removes that risk.
 *
 * 2. COOLDOWN — `rule:cd:{ruleId}:{deviceId}`, holding the last emitted event's FIX time and
 *    compared against the incoming event's fix time. It used to be a wall-clock `EX cooldownS` TTL,
 *    which measures the wrong clock: a device that buffered six hours offline flushes all of it in
 *    one wall-clock second, so the first event claimed the key and every genuinely distinct
 *    historical event behind it was silently swallowed — the buffered-flood scenario is a stated
 *    V1 case, not a corner. The window is symmetric because a flush arrives out of order.
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

    // scope-resolvable events only; then replay-dedup ALL of them and cooldown-gate the rest
    const scoped = events.filter((e) => scope.has(e.deviceId.toString()))
    const { survivors: gated, claimedKeys } = await this.gate(scoped)
    const rows: RuleEventRow[] = gated.map((e) => {
      const s = scope.get(e.deviceId.toString())!
      return { tenantId: s.tenantId, accountId: s.accountId, deviceId: e.deviceId, ruleId: e.ruleId, kind: e.kind, at: e.at, lat: e.lat, lon: e.lon, payload: e.payload }
    })
    try {
      await writeRuleEvents(this.pool, rows)
    } catch (err) {
      // Both keys are claimed BEFORE this INSERT (so an ACK-replay finds them set ⇒ no duplicate
      // row). If the INSERT itself fails they would suppress the re-emission and the alert would be
      // lost — so RELEASE everything claimed on this call and let the replay/retry re-emit. The
      // cooldown key is DELETED rather than restored to its previous fix time: one weakened cooldown
      // window is a far cheaper mistake than a dropped alert (§6.5 "doubled beats missed").
      if (claimedKeys.length > 0) await this.redis.del(...claimedKeys).catch(() => undefined)
      throw err
    }
    return gated
  }

  /**
   * Replay-dedup every event, then cooldown-gate the ones that ask for it. Returns the survivors
   * AND every key claimed on THIS call, so a failed insert can release exactly those.
   */
  private async gate(events: RuleEvent[]): Promise<{ survivors: RuleEvent[]; claimedKeys: string[] }> {
    if (events.length === 0) return { survivors: events, claimedKeys: [] }
    const claimedKeys: string[] = []

    // ── 1. replay dedup, on the event's own identity ──────────────────────────────────────────
    // The payload discriminator is not decoration: `positions` is keyed (device_id, fix_time,
    // rec_hash), so two records CAN share a fix_time, and an ignition/din rule fires on any
    // transition — a 1→0 and a 0→1 at the same millisecond are two genuine events that would
    // otherwise share one key and lose the second. Exactly the `cooldownS: 0` case this dedup was
    // added to protect; with a cooldown the second would be gated anyway.
    const seenKeys = events.map(
      (e) => `rule:seen:${e.ruleId}:${e.deviceId.toString()}:${e.kind}:${e.at.getTime()}:${payloadTag(e.payload)}`,
    )
    const seenPipe = this.redis.pipeline()
    for (const k of seenKeys) seenPipe.set(k, '1', 'EX', REPLAY_TTL_S, 'NX')
    const seenRes = await seenPipe.exec()
    const fresh = events.filter((_, i) => {
      const entry = seenRes?.[i]
      // A Redis COMMAND error ([Error, undefined] — OOM / LOADING / READONLY after a failover) is
      // NOT a nil reply. Emit rather than drop: a duplicate alert beats a missing one, and nothing
      // was claimed, so a later retry re-fires. Same posture as the cooldown below.
      if (entry?.[0]) return true
      if (entry?.[1] !== 'OK') return false // key already existed ⇒ this batch is a redelivery
      claimedKeys.push(seenKeys[i]!)
      return true
    })

    // ── 2. cooldown, measured in FIX time ─────────────────────────────────────────────────────
    const needsGate = fresh.filter((e) => !e.bypassCooldown && e.cooldownS > 0)
    if (needsGate.length === 0) return { survivors: fresh, claimedKeys }
    const cdKeys = needsGate.map((e) => `rule:cd:${e.ruleId}:${e.deviceId.toString()}`)
    const cdPipe = this.redis.pipeline()
    needsGate.forEach((e, i) =>
      cdPipe.eval(COOLDOWN_SCRIPT, 1, cdKeys[i]!, String(e.at.getTime()), String(e.cooldownS * 1000), String(e.cooldownS + LATE_FLUSH_S)),
    )
    const cdRes = await cdPipe.exec()
    const passed = new Set<number>()
    needsGate.forEach((_, i) => {
      const entry = cdRes?.[i]
      if (entry?.[0]) {
        passed.add(i) // command error — emit, claim nothing (see the note above)
        return
      }
      if (entry?.[1] === 1) {
        passed.add(i)
        claimedKeys.push(cdKeys[i]!)
      }
      // else 0 → within the cooldown window of an already-emitted event → drop
    })
    let gi = 0
    const survivors = fresh.filter((e) => (e.bypassCooldown || e.cooldownS <= 0 ? true : passed.has(gi++)))
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
