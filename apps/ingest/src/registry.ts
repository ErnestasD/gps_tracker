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

  /**
   * Records the rejected attempt; returns the count within the last hour.
   *
   * `countRejects` gates the per-IMEI counter key (`quarantine:rejects:{imei}`, 1 h TTL). On TCP the
   * source IP is validated by the 3-way handshake + handshake-rate-limited, so the IMEI keyspace is
   * bounded by real peers and the counter drives the ≥3-rejects/hr socket-close (§6.1). On UDP the
   * source AND the IMEI are attacker-chosen and the count is unused (connectionless — no socket to
   * close), so creating one counter key per spoofed IMEI is an unbounded-cardinality DoS (~180M
   * keys/hr under the flood the zset cap already anticipates). UDP therefore passes false: the zset
   * membership (capped at 10k for the admin claim flow) is kept, the per-IMEI counter is skipped.
   */
  async quarantine(imei: string, nowMs: number, opts: { countRejects?: boolean } = {}): Promise<number> {
    const countRejects = opts.countRejects ?? true
    const key = `quarantine:rejects:${imei}`
    const multi = this.redis
      .multi()
      .zadd('quarantine:imei', nowMs, imei)
      .zremrangebyrank('quarantine:imei', 0, -10_001) // keep newest 10k — spoof-flood cap
    if (countRejects) multi.incr(key).expire(key, 3600, 'NX')
    const results = await multi.exec()
    if (!countRejects) return 0
    const count = results?.[2]?.[1]
    return typeof count === 'number' ? count : Number(count ?? 1)
  }
}
