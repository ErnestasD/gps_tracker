import type { NormalizedRecord } from '@orbetra/shared'

import { isClockSkewed } from '../normalize.js'

import { outsideBBox, pointInPolygon, type BBox, type GeoPolygon } from './point.js'

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
  /** Precomputed envelope (cache.ts). Optional so tests and older callers still work — absent
   *  simply means no prefilter, never a wrong answer. */
  bbox?: BBox
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
  /** deviceId → the fence ids it currently has state for. Without this, pruning one device meant
   *  scanning the GLOBAL pair map — see prune(). */
  private readonly pairsByDevice = new Map<string, Set<string>>()

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
    const lastFences = new Map<string, readonly GeofenceDef[]>()
    for (const r of records) {
      if (!r.fixValid) continue // I5 — invalid fixes never move geofence state
      // a forward-drifted device clock would park `lastSeen` in the future and make every real fix
      // afterwards look out-of-order, freezing transition state for the whole drift (audit high)
      if (isClockSkewed(r)) continue
      const dev = r.deviceId.toString()
      const seen = this.lastSeen.get(dev)
      if (seen !== undefined && r.fixTime.getTime() < seen) continue // out-of-order (I2)
      this.lastSeen.set(dev, r.fixTime.getTime())
      const fences = geofencesFor(r.deviceId)
      for (const gf of fences) this.step(r, gf, out, insideFor)
      lastFences.set(dev, fences)
    }
    // ONCE PER DEVICE, after the record loop — not once per record (audit high). prune() used to run
    // inside the loop and scan the GLOBAL pair map, so a 200-record batch against a 5 000-device
    // fleet with 5 fences each did 200 × 25 000 = 5 000 000 synchronous iterations on the shard
    // consumer's critical path, between writePositions and the XACK. This engine is a process-wide
    // singleton shared by all 16 consumers, so `state` grows with the whole fleet, not one shard —
    // and blocking it that long starves the ShardLeaser's renew timer, which expires leases and
    // makes shards flap. A device's fence set cannot change mid-batch, so once is enough.
    for (const [dev, fences] of lastFences) this.prune(dev, fences)
    return out
  }

  /**
   * Undo the in-memory side-flip for transitions whose durable persist FAILED (audit C1). Without
   * this, the engine's confirmed side has advanced past durable state, so the next batch sees the
   * device on the "already-confirmed" side and NEVER re-fires — the crossing is lost forever. The
   * device is physically still on the new side, so resetting to the PRE-transition side (+ clearing
   * any pending streak) makes the next batch's live fixes re-confirm and re-emit; the persister
   * released its dedup claim on the same failure, so the re-emitted event is written, not suppressed.
   */
  rollback(transitions: readonly GeofenceTransition[]): void {
    // Iterate in REVERSE so that when a pair flipped MORE THAN ONCE this batch (e.g. enter then exit
    // through a small fence), the EARLIEST transition writes LAST — its pre-side is the true PRE-BATCH
    // side. Forward order would leave the pair on the last transition's pre-side (wrong: a lost enter +
    // a spurious bare exit / a suppressed real re-enter). review HIGH.
    for (let i = transitions.length - 1; i >= 0; i--) {
      const t = transitions[i]!
      const st = this.state.get(`${t.deviceId.toString()}:${t.geofenceId}`)
      if (st === undefined) continue
      st.inside = t.type === 'exit' // pre-enter side = outside(false); pre-exit side = inside(true)
      st.pendingSide = null
      st.pendingCount = 0
    }
  }

  /**
   * Drop per-pair state for a device's geofences that are no longer in its set (bounds memory).
   * Walks only THIS device's pairs via the per-device index — the previous version iterated
   * `this.state.keys()`, i.e. every (device × fence) pair the process had ever seen.
   */
  private prune(dev: string, fences: readonly GeofenceDef[]): void {
    const mine = this.pairsByDevice.get(dev)
    if (mine === undefined) return
    const live = new Set(fences.map((g) => g.id))
    for (const gfId of mine) {
      if (live.has(gfId)) continue
      this.state.delete(`${dev}:${gfId}`)
      mine.delete(gfId)
    }
    if (mine.size === 0) this.pairsByDevice.delete(dev)
  }

  private step(r: NormalizedRecord, gf: GeofenceDef, out: GeofenceTransition[], insideFor?: (deviceId: bigint, geofenceId: string) => boolean): void {
    const key = `${r.deviceId.toString()}:${gf.id}`
    const st = this.state.get(key) ?? { inside: insideFor?.(r.deviceId, gf.id) ?? false, pendingSide: null, pendingCount: 0 }
    this.state.set(key, st)
    const dev = r.deviceId.toString()
    let mine = this.pairsByDevice.get(dev)
    if (mine === undefined) {
      mine = new Set()
      this.pairsByDevice.set(dev, mine)
    }
    mine.add(gf.id)
    // O(1) envelope rejection BEFORE the O(vertices) ray-cast. A vehicle is outside almost every
    // zone at any instant, so this answers nearly every test in four comparisons — and it is exact,
    // never a false negative, so containment semantics are unchanged (audit high).
    const side: 'in' | 'out' =
      gf.bbox !== undefined && outsideBBox(r.lon, r.lat, gf.bbox)
        ? 'out'
        : pointInPolygon(r.lon, r.lat, gf.geometry)
          ? 'in'
          : 'out'
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
