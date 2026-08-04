import type { Redis } from 'ioredis'

import type { NormalizedRecord } from '@orbetra/shared'

import { isClockSkewed } from './normalize.js'

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

    const pending: Promise<void>[] = []
    for (const [deviceId, rec] of newestPerDevice) {
      // per-device chaining: concurrent apply() callers cannot interleave the
      // read-compare-write below (review HIGH defense-in-depth; the consumer also
      // awaits onBatch, so in the pipeline this is belt-and-suspenders).
      // Chain off the PRIOR promise with BOTH handlers so a rejected previous apply
      // (any Redis blip) never poisons this device's chain — otherwise every future
      // apply for the device would short-circuit on the still-rejected promise and the
      // live marker would freeze until worker restart (review HIGH).
      const prev = this.inflight.get(deviceId) ?? Promise.resolve()
      const tracked: Promise<void> = prev
        .then(
          () => this.applyOne(deviceId, rec),
          () => this.applyOne(deviceId, rec),
        )
        .finally(() => {
          // always clear the map slot when this is the tail — a rejected promise must
          // never be left cached as the chain head
          if (this.inflight.get(deviceId) === tracked) this.inflight.delete(deviceId)
        })
      this.inflight.set(deviceId, tracked)
      pending.push(tracked)
    }
    // await ALL devices before surfacing any failure: one device's Redis error must not
    // skip the remaining devices' updates for this batch (the consumer/main.ts logs it).
    const settled = await Promise.allSettled(pending)
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    if (failed !== undefined) throw failed.reason
  }

  private async applyOne(deviceId: string, rec: NormalizedRecord): Promise<void> {
    // A device clock running AHEAD is poison for a max-wins marker: one future-dated fix parks the
    // marker at that timestamp, and every REAL fix afterwards loses the `stored >= incoming` compare
    // until wall-clock catches up. The map marker, GET /v1/devices/last and the WS publish all
    // freeze for hours. The row is still in `positions` — this seam only decides what moves LIVE
    // state, exactly like I5 does for an invalid fix (audit high).
    const key = `device:${deviceId}:last`
    // SERVER contact time is written FIRST and UNCONDITIONALLY — before the skew gate and before
    // the max-wins compare. Both of those are about the DEVICE's opinion of time; presence is about
    // whether we heard from the vehicle at all. Writing it behind either gate reintroduced the bug
    // in two new shapes (review high): a device with a STUCK clock streams for hours while
    // `stored >= incoming` short-circuits, so contact time freezes at first sight and a live vehicle
    // is reported offline; and a device 6 min ahead never created the hash at all, so presence saw
    // `lastFixMs === null` ("never onboarded") and excluded it from alerting entirely — the vehicle
    // simply vanished, from the map AND from the alert that should have caught the vanishing.
    await this.redis.hset(key, 'serverTimeMs', String(rec.serverTime.getTime()))
    if (isClockSkewed(rec)) {
      // …and leave a per-device breadcrumb so this is diagnosable as "device clock invalid" rather
      // than as silence. The global counter says it is happening; this says WHICH device.
      await this.redis.hset(key, 'clockSkewedAt', String(rec.serverTime.getTime()))
      return
    }
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
