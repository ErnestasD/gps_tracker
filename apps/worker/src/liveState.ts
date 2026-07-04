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
  private readonly inflight = new Map<string, Promise<void>>()

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
      // per-device chaining: concurrent apply() callers cannot interleave the
      // read-compare-write below (review HIGH defense-in-depth; the consumer also
      // awaits onBatch, so in the pipeline this is belt-and-suspenders)
      const prev = this.inflight.get(deviceId) ?? Promise.resolve()
      const next = prev.then(() => this.applyOne(deviceId, rec))
      this.inflight.set(deviceId, next)
      await next
      if (this.inflight.get(deviceId) === next) this.inflight.delete(deviceId)
    }
  }

  private async applyOne(deviceId: string, rec: NormalizedRecord): Promise<void> {
    const key = `device:${deviceId}:last`
    const stored = await this.redis.hget(key, 'fixTimeMs')
    const incoming = rec.fixTime.getTime()
    if (stored !== null && Number(stored) >= incoming) return // max-wins

    const [tenantId, accountId] = await this.redis.hmget(
      'device:tenant',
      deviceId,
    ).then(async ([t]) => [t, await this.redis.hget('device:account', deviceId)] as const)

    const compact = {
      deviceId,
      // accountId travels IN the payload so the WS gateway filters in-memory
      // (review MED: no per-message redis lookup on the fanout hot path)
      accountId,
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
    if (tenantId !== null) {
      await this.redis.publish(`live:${tenantId}`, JSON.stringify(compact))
    }
  }
}
