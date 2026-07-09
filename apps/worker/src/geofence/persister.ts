import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { GeofenceTransition } from './engine.js'
import { writeGeofenceEvents, type GeofenceEventRow } from './writer.js'

/**
 * Persists geofence transitions as `events` rows (E05-2). Resolves each device's
 * tenant/account from the registry (device:tenant/device:account) — an event is never
 * written with a guessed tenant; a transition for an unregistered device is skipped.
 */
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

  /** Returns how many event rows were written. */
  async persist(transitions: GeofenceTransition[]): Promise<number> {
    if (transitions.length === 0) return 0
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
    const rows: GeofenceEventRow[] = []
    const statePipe = this.redis.pipeline()
    for (const tr of transitions) {
      const s = scope.get(tr.deviceId.toString())
      if (s === undefined) continue // unregistered device → cannot scope the event; skip
      rows.push({
        tenantId: s.tenantId,
        accountId: s.accountId,
        deviceId: tr.deviceId,
        at: tr.at,
        lat: tr.lat,
        lon: tr.lon,
        payload: { geofenceId: tr.geofenceId, name: tr.geofenceName, transition: tr.type },
      })
      // durable confirmed side (E05-2 MED-1): the engine warm-starts from this on restart,
      // so a device already inside a fence doesn't re-fire an enter
      statePipe.hset(`geofence:state:${tr.deviceId.toString()}`, tr.geofenceId, tr.type === 'enter' ? '1' : '0')
    }
    const n = await writeGeofenceEvents(this.pool, rows)
    await statePipe.exec()
    return n
  }
}
