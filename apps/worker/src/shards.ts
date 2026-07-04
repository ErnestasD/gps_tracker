import type { Redis } from 'ioredis'

export const SHARD_COUNT = 16 // CLAUDE.md rule 5

/**
 * Exclusive shard ownership via Redis TTL leases (`shards:lease:{n}`, PROJECT_PLAN §6.1).
 * A worker claims as many shards as it can; a renew loop keeps them; a crashed peer's
 * leases expire and its PENDING entries are recovered by XAUTOCLAIM (consumer.ts).
 */
export class ShardLeaser {
  private renewTimer: NodeJS.Timeout | null = null
  readonly owned = new Set<number>()

  constructor(
    private readonly redis: Redis,
    private readonly workerId: string,
    private readonly leaseTtlMs = 30_000,
    /** Fired when a lease is discovered lost (GC pause/partition) — the owner MUST
     * stop that shard's consumer immediately or I2 exclusivity is violated. */
    private readonly onLost?: (shard: number) => void,
  ) {}

  async claimAll(): Promise<Set<number>> {
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      const got = await this.redis.set(
        `shards:lease:${shard}`,
        this.workerId,
        'PX',
        this.leaseTtlMs,
        'NX',
      )
      if (got === 'OK') this.owned.add(shard)
    }
    this.startRenewing()
    return this.owned
  }

  private startRenewing(): void {
    this.renewTimer = setInterval(() => {
      void (async () => {
        for (const shard of this.owned) {
          // renew only if still ours (compare-and-extend)
          const holder = await this.redis.get(`shards:lease:${shard}`)
          if (holder === this.workerId) {
            await this.redis.pexpire(`shards:lease:${shard}`, this.leaseTtlMs)
          } else {
            this.owned.delete(shard) // lost the lease — stop touching that shard
            this.onLost?.(shard)
          }
        }
      })().catch(() => undefined)
    }, Math.floor(this.leaseTtlMs / 3))
    this.renewTimer.unref()
  }

  /** Graceful release (SIGTERM path — E02-3 AC: lease released < 5 s). */
  async release(): Promise<void> {
    if (this.renewTimer) clearInterval(this.renewTimer)
    for (const shard of this.owned) {
      const holder = await this.redis.get(`shards:lease:${shard}`)
      if (holder === this.workerId) await this.redis.del(`shards:lease:${shard}`)
    }
    this.owned.clear()
  }
}
