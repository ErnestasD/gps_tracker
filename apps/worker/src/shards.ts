import type { Redis } from 'ioredis'

export const SHARD_COUNT = 16 // CLAUDE.md rule 5

/** Atomic compare-and-extend: renew the lease ONLY if it is still ours. A non-atomic
 *  GET-then-PEXPIRE could extend a lease a peer just claimed in the gap → two consumers on
 *  one shard (rule 5 / I2 violation, review MED). Returns 1 when renewed, 0 when lost. */
const RENEW_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`

/**
 * Exclusive shard ownership via Redis TTL leases (`shards:lease:{n}`, PROJECT_PLAN §6.1).
 * A worker claims as many shards as it can; a renew loop keeps them AND continuously tries to
 * (re)acquire shards it does not own — so a lease lost to a stall/partition, or a dead peer's
 * expired lease, is picked up again instead of leaving the shard unconsumed forever (ingest's
 * MAXLEN trim would then destroy the backlog unread = data loss, review HIGH). A crashed peer's
 * PENDING entries are recovered by XAUTOCLAIM (consumer.ts).
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
    /** Fired when a previously-unowned shard is (re)acquired — the owner MUST START that
     * shard's consumer, or a recovered/orphaned shard would never resume consumption. */
    private readonly onGained?: (shard: number) => void,
  ) {}

  async claimAll(): Promise<Set<number>> {
    for (let shard = 0; shard < SHARD_COUNT; shard++) await this.tryClaim(shard)
    this.startRenewing()
    return this.owned
  }

  /** Attempt to grab a shard's lease with SET NX; records ownership on success. */
  private async tryClaim(shard: number): Promise<boolean> {
    const got = await this.redis.set(`shards:lease:${shard}`, this.workerId, 'PX', this.leaseTtlMs, 'NX')
    if (got === 'OK') {
      this.owned.add(shard)
      return true
    }
    return false
  }

  private startRenewing(): void {
    this.renewTimer = setInterval(() => {
      void this.tick()
    }, Math.floor(this.leaseTtlMs / 3))
    this.renewTimer.unref()
  }

  /** One renew-and-reacquire pass; exposed for deterministic tests. Per-shard try/catch so a
   *  transient Redis error on one shard neither drops a still-held lease nor blocks the others. */
  async tick(): Promise<void> {
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      try {
        if (this.owned.has(shard)) {
          const renewed = await this.redis.eval(RENEW_LUA, 1, `shards:lease:${shard}`, this.workerId, String(this.leaseTtlMs))
          if (renewed !== 1) {
            this.owned.delete(shard) // lost the lease — stop touching that shard
            this.onLost?.(shard)
          }
        } else if (await this.tryClaim(shard)) {
          this.onGained?.(shard) // recovered our own lost lease or picked up a dead peer's
        }
      } catch {
        // transient error: leave ownership as-is (don't fire onLost on a blip) — retry next tick
      }
    }
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
