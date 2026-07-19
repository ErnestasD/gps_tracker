import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { GeofenceTransition } from './engine.js'
import { writeGeofenceEvents, type GeofenceEventRow } from './writer.js'

/**
 * Persists geofence transitions as `events` rows (E05-2). Resolves each device's
 * tenant/account from the registry (device:tenant/device:account) — an event is never
 * written with a guessed tenant; a transition for an unregistered device is skipped.
 */
/** Dedup-claim TTL for a geofence crossing. Comfortably exceeds the ACK-replay / crash-restart
 *  window (XAUTOCLAIM min-idle + restart, and a whole-day outage) so a redelivered batch still
 *  finds the claim set. Safe to be generous: the key encodes the crossing INSTANT (at ms), so a
 *  DISTINCT future crossing of the same fence never collides and is never suppressed. */
const DEDUP_TTL_S = 24 * 3_600

export class GeofenceEventPersister {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  /** Load the durable confirmed-inside state for a batch's devices → the engine's warm-start
   * lookup (E05-2 MED-1). Only needed for the geofence engine's first sight of each pair; the
   * worker calls it per batch for devices that have geofences. */
  async loadInside(deviceIds: readonly string[]): Promise<(deviceId: bigint, geofenceId: string) => boolean> {
    if (deviceIds.length === 0) return () => false
    const pipe = this.redis.pipeline()
    for (const id of deviceIds) pipe.hgetall(`geofence:state:${id}`)
    const res = await pipe.exec()
    const map = new Map<string, Set<string>>()
    deviceIds.forEach((id, i) => {
      const h = (res?.[i]?.[1] ?? {}) as Record<string, string>
      map.set(id, new Set(Object.entries(h).filter(([, v]) => v === '1').map(([g]) => g)))
    })
    return (deviceId, geofenceId) => map.get(deviceId.toString())?.has(geofenceId) ?? false
  }

  /** Persist the freshly-crossed transitions as `events` rows and return the ones actually written
   *  (the caller enqueues a webhook per RETURNED transition, so a deduped replay fires none).
   *
   *  Replay-idempotency (parity with the rule/offline paths): `events` has no ON CONFLICT dedup, so
   *  onBatch running BEFORE XACK means an ACK-replay (crash-before-XACK → XAUTOCLAIM) or an
   *  at-least-once redelivery would re-INSERT the same crossing (and re-enqueue its webhook). We
   *  claim a per-crossing key `geofence:evt:{deviceId}:{geofenceId}:{type}:{atMs}` with SET NX EX
   *  BEFORE the insert; a duplicate crossing finds the key set and is skipped. The key encodes the
   *  crossing instant, so a genuinely DISTINCT crossing (necessarily a later `at`) is never
   *  suppressed. On insert failure the just-claimed keys are ROLLED BACK (audit1 invariant) so a
   *  retry/replay can re-emit rather than being permanently suppressed by a stranded claim. */
  async persist(transitions: GeofenceTransition[]): Promise<GeofenceTransition[]> {
    if (transitions.length === 0) return []
    // resolve tenant/account once per unique device
    const devices = [...new Set(transitions.map((t) => t.deviceId.toString()))]
    const [tenants, accounts] = await Promise.all([
      this.redis.hmget('device:tenant', ...devices),
      this.redis.hmget('device:account', ...devices),
    ])
    const scope = new Map<string, { tenantId: string; accountId: string }>()
    devices.forEach((id, i) => {
      const t = tenants[i]
      const a = accounts[i]
      if (t && a) scope.set(id, { tenantId: t, accountId: a })
    })
    // scope-resolvable transitions only (an unregistered device can't be scoped → skip)
    const scoped = transitions.filter((tr) => scope.has(tr.deviceId.toString()))
    if (scoped.length === 0) return []

    // claim-before-insert: SET NX per crossing so a redelivered/replayed transition doesn't double-insert
    const dedupKey = (tr: GeofenceTransition): string => `geofence:evt:${tr.deviceId.toString()}:${tr.geofenceId}:${tr.type}:${tr.at.getTime()}`
    const claim = this.redis.pipeline()
    for (const tr of scoped) claim.set(dedupKey(tr), '1', 'EX', DEDUP_TTL_S, 'NX')
    const claimRes = await claim.exec()

    const fresh: GeofenceTransition[] = []
    const rows: GeofenceEventRow[] = []
    const claimedKeys: string[] = []
    const statePipe = this.redis.pipeline()
    scoped.forEach((tr, i) => {
      const reply = claimRes?.[i]?.[1]
      if (reply === null) return // nil reply = key already existed → duplicate crossing → skip (idempotent)
      // reply === 'OK' → freshly claimed. reply === undefined → a Redis COMMAND error (OOM/READONLY
      // after failover), NOT a nil: emit anyway ("doubled beats missed", §6.5) with no key to roll back.
      const s = scope.get(tr.deviceId.toString())!
      fresh.push(tr)
      rows.push({ tenantId: s.tenantId, accountId: s.accountId, deviceId: tr.deviceId, at: tr.at, lat: tr.lat, lon: tr.lon, payload: { geofenceId: tr.geofenceId, name: tr.geofenceName, transition: tr.type } })
      if (reply === 'OK') claimedKeys.push(dedupKey(tr))
      // durable confirmed side (E05-2 MED-1): the engine warm-starts from this on restart,
      // so a device already inside a fence doesn't re-fire an enter
      statePipe.hset(`geofence:state:${tr.deviceId.toString()}`, tr.geofenceId, tr.type === 'enter' ? '1' : '0')
    })
    if (rows.length === 0) return []

    try {
      await writeGeofenceEvents(this.pool, rows)
    } catch (err) {
      // insert failed AFTER the claim: leaving the keys set would suppress the ACK-replay/retry
      // re-emission and the crossing would be lost. Release the just-claimed keys so it re-fires.
      if (claimedKeys.length > 0) await this.redis.del(...claimedKeys).catch(() => undefined)
      throw err
    }
    await statePipe.exec()
    return fresh
  }
}
