import type { Redis } from 'ioredis'

/**
 * Device registry + quarantine (PROJECT_PLAN §6.1):
 * - `registry:imei` hash: imei → deviceId (written by device CRUD, E03-3)
 * - unknown IMEI ⇒ 0x00 reply, `quarantine:imei` zset (imei → last_seen ms) for the
 *   platform-admin claim flow (E03-4), reject counter with 1 h TTL — ≥3 rejects/hr
 *   per IMEI ⇒ caller closes the socket immediately on sight.
 */
export class DeviceRegistry {
  constructor(private readonly redis: Redis) {}

  async lookup(imei: string): Promise<bigint | null> {
    const id = await this.redis.hget('registry:imei', imei)
    return id === null ? null : BigInt(id)
  }

  /** Records the rejected attempt; returns the count within the last hour. */
  async quarantine(imei: string, nowMs: number): Promise<number> {
    const key = `quarantine:rejects:${imei}`
    const results = await this.redis
      .multi()
      .zadd('quarantine:imei', nowMs, imei)
      .zremrangebyrank('quarantine:imei', 0, -10_001) // keep newest 10k — spoof-flood cap
      .incr(key)
      .expire(key, 3600, 'NX')
      .exec()
    const count = results?.[2]?.[1]
    return typeof count === 'number' ? count : Number(count ?? 1)
  }
}
