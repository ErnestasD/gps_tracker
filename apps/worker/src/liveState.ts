import type { Redis } from 'ioredis'

import type { NormalizedRecord } from '@orbetra/shared'

/**
 * Live-state maintainer (PROJECT_PLAN §6.1 live path, E02-4):
 * - `device:{id}:last` hash updated ONLY when the incoming fix_time is newer than the
 *   stored one (max-wins — buffered floods with old timestamps must never regress the
 *   marker; consumer handoff is only batch-sorted, see consumer.ts note).
 * - publishes compact JSON to `live:{tenantId}` for the WS gateway.
 * Tenant lookup: `device:tenant` Redis hash (deviceId → tenantId), synced by device
 * CRUD in E03-3; entries absent → update stored, publish skipped (no tenant channel yet).
 */
export class LiveState {
  constructor(private readonly redis: Redis) {}

  async apply(records: NormalizedRecord[]): Promise<void> {
    // newest record per device by fixTime — robust even if a caller passes an
    // unsorted batch (consumer sorts, but this API must not depend on it)
    const newestPerDevice = new Map<string, NormalizedRecord>()
    for (const rec of records) {
      const key = rec.deviceId.toString()
      const current = newestPerDevice.get(key)
      if (!current || rec.fixTime > current.fixTime) newestPerDevice.set(key, rec)
    }

    for (const [deviceId, rec] of newestPerDevice) {
      const key = `device:${deviceId}:last`
      const stored = await this.redis.hget(key, 'fixTimeMs')
      const incoming = rec.fixTime.getTime()
      if (stored !== null && Number(stored) >= incoming) continue // max-wins

      const compact = {
        deviceId,
        fixTimeMs: incoming,
        lat: rec.lat,
        lon: rec.lon,
        speed: rec.speed,
        course: rec.course,
        satellites: rec.satellites,
        fixValid: rec.fixValid,
        ignition: rec.ignition,
        priority: rec.priority,
      }
      await this.redis.hset(key, {
        fixTimeMs: String(incoming),
        json: JSON.stringify(compact),
      })
      const tenantId = await this.redis.hget('device:tenant', deviceId)
      if (tenantId !== null) {
        await this.redis.publish(`live:${tenantId}`, JSON.stringify(compact))
      }
    }
  }
}
