import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { TripEvent } from './engine.js'
import { closeTrip, openTrip } from './writer.js'

/**
 * Turns TripEngine events into trip rows (E04-1). Resolves each device's
 * tenant/account from the Redis registry (device:tenant / device:account, synced by
 * device CRUD in E03-3) — a trip is NEVER written with a guessed tenant. Tracks the
 * open trip id per device in memory so a close can finalize the right row.
 *
 * Crash posture: in-memory open ids are lost on restart, leaving `open` rows in the
 * DB; E04-2 trip-recompute reconciles those (and any late/out-of-order batches).
 * A close with no known open id (skipped open, or post-restart) is dropped here and
 * left to recompute — never a wrong-row update.
 */
export class TripPersister {
  private readonly openIds = new Map<string, { id: string; tenantId: string }>() // deviceId → open trip id + its tenant (for iButton→driver resolution at close)

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  /** Returns how many trips were actually opened/closed (for metrics). */
  async apply(events: TripEvent[]): Promise<{ opened: number; closed: number }> {
    let opened = 0
    let closed = 0
    for (const ev of events) {
      const key = ev.deviceId.toString()
      if (ev.type === 'open') {
        const scope = await this.resolveScope(key)
        if (scope === null) continue // unregistered device → cannot scope a trip; skip
        const id = await openTrip(this.pool, {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          deviceId: ev.deviceId,
          startTime: ev.startTime,
          startLat: ev.startLat,
          startLon: ev.startLon,
        })
        this.openIds.set(key, { id, tenantId: scope.tenantId })
        opened++
      } else {
        const open = this.openIds.get(key)
        if (open === undefined) continue // no known open row → leave to E04-2 recompute
        // V2 Part B: resolve the trip's iButton to a driver via the tenant's Redis map (best-effort;
        // a lookup miss/blip just leaves driverId null — closeTrip won't overwrite a manual assign)
        const driverId = ev.ibutton !== null ? await this.resolveDriver(open.tenantId, ev.ibutton) : null
        await closeTrip(this.pool, open.id, {
          endTime: ev.endTime,
          endLat: ev.endLat,
          endLon: ev.endLon,
          distanceM: ev.distanceM,
          distanceSource: ev.distanceSource,
          maxSpeed: ev.maxSpeed,
          idleS: ev.idleS,
          driverId,
        })
        this.openIds.delete(key)
        closed++
      }
    }
    return { opened, closed }
  }

  private async resolveScope(deviceId: string): Promise<{ tenantId: string; accountId: string } | null> {
    const [tenantId, accountId] = await Promise.all([
      this.redis.hget('device:tenant', deviceId),
      this.redis.hget('device:account', deviceId),
    ])
    return tenantId !== null && accountId !== null ? { tenantId, accountId } : null
  }

  /** iButton canonical key → driverId, via the tenant's Redis map (synced by driver CRUD in the API).
   *  Returns null on a miss or a Redis blip — auto-attribution is best-effort, never blocks the close. */
  private async resolveDriver(tenantId: string, ibuttonKey: string): Promise<string | null> {
    try {
      return await this.redis.hget(`driver:ibutton:${tenantId}`, ibuttonKey)
    } catch {
      return null
    }
  }
}
