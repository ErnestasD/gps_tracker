import type { NormalizedRecord } from '@orbetra/shared'

import { pointInPolygon, type GeoPolygon } from './point.js'

/**
 * Geofence transition engine (E05-2, §6.1). PURE + deterministic. For each fix_valid
 * record (invalid fixes are filtered at the I5 seam AND self-guarded here — an invalid
 * fix must never move geofence state) it tests containment against the device's geofences
 * and emits enter/exit transitions with HYSTERESIS: a side flip is only confirmed after N
 * consecutive observations on the new side (default 2), so GPS jitter on a boundary can't
 * flap. Out-of-order records are dropped per device (I2); late reconciliation is not in
 * scope for the stream path.
 */
export interface GeofenceDef {
  id: string
  name: string
  geometry: GeoPolygon
}
export interface GeofenceTransition {
  deviceId: bigint
  geofenceId: string
  geofenceName: string
  type: 'enter' | 'exit'
  at: Date
  lat: number
  lon: number
}

interface PairState {
  inside: boolean // confirmed side
  pendingSide: 'in' | 'out' | null
  pendingCount: number
}

export class GeofenceEngine {
  private readonly state = new Map<string, PairState>() // "deviceId:geofenceId" → state
  private readonly lastSeen = new Map<string, number>() // deviceId → newest fixTime ms

  constructor(
    private readonly enterStreak = 2,
    private readonly exitStreak = 2,
  ) {}

  /**
   * Feed fix_valid, fixTime-sorted records. `geofencesFor` supplies the device's
   * (tenant/account-scoped) geofences. `insideFor` warm-starts a pair's confirmed side
   * from durable state on FIRST sight (E05-2 review MED-1) so a worker restart — with a
   * device already inside a fence — does not re-fire a spurious enter.
   */
  feed(
    records: NormalizedRecord[],
    geofencesFor: (deviceId: bigint) => readonly GeofenceDef[],
    insideFor?: (deviceId: bigint, geofenceId: string) => boolean,
  ): GeofenceTransition[] {
    const out: GeofenceTransition[] = []
    for (const r of records) {
      if (!r.fixValid) continue // I5 — invalid fixes never move geofence state
      const dev = r.deviceId.toString()
      const seen = this.lastSeen.get(dev)
      if (seen !== undefined && r.fixTime.getTime() < seen) continue // out-of-order (I2)
      this.lastSeen.set(dev, r.fixTime.getTime())
      const fences = geofencesFor(r.deviceId)
      for (const gf of fences) this.step(r, gf, out, insideFor)
      this.prune(dev, fences) // MED-2: drop state for fences no longer applicable (deleted/re-scoped)
    }
    return out
  }

  /** Drop per-pair state for a device's geofences that are no longer in its set (bounds memory). */
  private prune(dev: string, fences: readonly GeofenceDef[]): void {
    const live = new Set(fences.map((g) => g.id))
    const prefix = `${dev}:`
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix) && !live.has(key.slice(prefix.length))) this.state.delete(key)
    }
  }

  private step(r: NormalizedRecord, gf: GeofenceDef, out: GeofenceTransition[], insideFor?: (deviceId: bigint, geofenceId: string) => boolean): void {
    const key = `${r.deviceId.toString()}:${gf.id}`
    const st = this.state.get(key) ?? { inside: insideFor?.(r.deviceId, gf.id) ?? false, pendingSide: null, pendingCount: 0 }
    this.state.set(key, st)
    const side: 'in' | 'out' = pointInPolygon(r.lon, r.lat, gf.geometry) ? 'in' : 'out'
    const confirmed: 'in' | 'out' = st.inside ? 'in' : 'out'
    if (side === confirmed) {
      st.pendingSide = null
      st.pendingCount = 0
      return
    }
    if (st.pendingSide === side) st.pendingCount++
    else {
      st.pendingSide = side
      st.pendingCount = 1
    }
    const threshold = side === 'in' ? this.enterStreak : this.exitStreak
    if (st.pendingCount >= threshold) {
      st.inside = side === 'in'
      st.pendingSide = null
      st.pendingCount = 0
      out.push({ deviceId: r.deviceId, geofenceId: gf.id, geofenceName: gf.name, type: side === 'in' ? 'enter' : 'exit', at: r.fixTime, lat: r.lat, lon: r.lon })
    }
  }
}
