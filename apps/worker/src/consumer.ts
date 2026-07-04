import { Decoder } from 'cbor-x'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { NormalizedRecord } from '@orbetra/shared'

import { normalize, type HashFn } from './normalize.js'
import { writePositions } from './writer.js'

const GROUP = 'pipeline' // PROJECT_PLAN §5: consumer group name
const cbor = new Decoder()

export interface ConsumerDeps {
  redis: Redis
  pool: Pool
  hash: HashFn
  workerId: string
  /** Downstream handoff (live state → rules → trips; stubs until E02-4+). Records are
   * fixTime-sorted WITHIN each batch; a late buffered batch can still carry older
   * fixTimes than an earlier batch — cross-batch disorder is reconciled by E04-2
   * recompute, and liveState must be order-tolerant (max-wins on fix_time, E02-4). */
  onBatch?: (records: NormalizedRecord[]) => void
  batchSize?: number
  blockMs?: number
  /** XAUTOCLAIM min-idle (§6.1: 60 s; tests shrink it). */
  autoclaimMinIdleMs?: number
}

export interface ShardStats {
  processed: number
  inserted: number
  deadLettered: number
}

/**
 * Strictly serial consumer for ONE shard (invariant I2: a shard is processed by
 * exactly one claimer; per-device order = arrival order within the shard, and each
 * batch is fixTime-sorted before downstream handoff).
 * Loop: XAUTOCLAIM stale pending (crashed peer recovery) → XREADGROUP → normalize
 * (malformed → raw:dead, never crash the shard) → batched INSERT…ON CONFLICT (I3)
 * → XACK (I1: ACKed-by-ingest count == stream entries == rows attempted).
 */
export class ShardConsumer {
  private running = false
  private stopped: Promise<void> = Promise.resolve()
  readonly stats: ShardStats = { processed: 0, inserted: 0, deadLettered: 0 }

  constructor(
    private readonly shard: number,
    private readonly deps: ConsumerDeps,
  ) {}

  get stream(): string {
    return `raw:${this.shard}`
  }

  async ensureGroup(): Promise<void> {
    try {
      await this.deps.redis.xgroup('CREATE', this.stream, GROUP, '0', 'MKSTREAM')
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err
    }
  }

  start(): void {
    this.running = true
    this.stopped = this.loop()
  }

  /** Graceful stop: current batch completes + XACKs before resolve (SIGTERM AC). */
  async stop(): Promise<void> {
    this.running = false
    await this.stopped
  }

  /** One full pass; exposed for deterministic tests. */
  async tick(): Promise<number> {
    const claimed = await this.autoclaim()
    const fresh = await this.read()
    const entries = [...claimed, ...fresh]
    if (entries.length === 0) return 0
    await this.process(entries)
    return entries.length
  }

  private async loop(): Promise<void> {
    await this.ensureGroup()
    let lastAutoclaim = 0
    while (this.running) {
      try {
        const now = Date.now()
        if (now - lastAutoclaim > 30_000) {
          // §6.1: XAUTOCLAIM on start + every 30 s to recover a crashed peer's pending
          const claimed = await this.autoclaim()
          if (claimed.length > 0) await this.process(claimed)
          lastAutoclaim = now
        }
        const entries = await this.read(this.deps.blockMs ?? 2_000)
        if (entries.length > 0) await this.process(entries)
      } catch (err) {
        console.error(`shard ${this.shard} consumer error`, err)
        await new Promise((r) => setTimeout(r, 1_000))
      }
    }
  }

  private async autoclaim(): Promise<[string, Buffer][]> {
    const minIdle = this.deps.autoclaimMinIdleMs ?? 60_000
    const res = (await this.deps.redis.callBuffer(
      'XAUTOCLAIM',
      this.stream,
      GROUP,
      this.deps.workerId,
      String(minIdle),
      '0-0',
      'COUNT',
      String(this.deps.batchSize ?? 200),
    )) as [Buffer, [Buffer, Buffer[]][], Buffer[]] | null
    if (!res) return []
    return (res[1] ?? []).map(([id, fields]) => [id.toString(), fields[1]!])
  }

  private async read(blockMs = 0): Promise<[string, Buffer][]> {
    const args = [
      'GROUP',
      GROUP,
      this.deps.workerId,
      'COUNT',
      String(this.deps.batchSize ?? 200),
      ...(blockMs > 0 ? ['BLOCK', String(blockMs)] : []),
      'STREAMS',
      this.stream,
      '>',
    ]
    const res = (await this.deps.redis.callBuffer('XREADGROUP', ...args)) as
      | [Buffer, [Buffer, Buffer[]][]][]
      | null
    if (!res || res.length === 0) return []
    return res[0]![1].map(([id, fields]) => [id.toString(), fields[1]!])
  }

  private async process(entries: [string, Buffer][]): Promise<void> {
    const records: NormalizedRecord[] = []
    const ids: string[] = []
    const dead: string[] = []
    for (const [id, payload] of entries) {
      try {
        records.push(normalize(cbor.decode(payload), this.deps.hash))
        ids.push(id)
      } catch {
        // malformed entry → dead-letter, continue (E02-3 edge case)
        dead.push(id)
      }
    }
    if (dead.length > 0) {
      const pipe = this.deps.redis.pipeline()
      for (const id of dead) {
        pipe.xadd('raw:dead', 'MAXLEN', '~', 10_000, '*', 'ref', `${this.stream}:${id}`)
        pipe.xack(this.stream, GROUP, id)
      }
      await pipe.exec()
      this.stats.deadLettered += dead.length
    }
    if (records.length === 0) return

    // Appendix A / R4: downstream handoff is fixTime-sorted (per shard batch)
    records.sort((a, b) => a.fixTime.getTime() - b.fixTime.getTime())

    const inserted = await writePositions(this.deps.pool, records)
    this.stats.inserted += inserted
    this.stats.processed += records.length

    this.deps.onBatch?.(records)

    // ACK only after durable insert (crash before this line ⇒ XAUTOCLAIM replays,
    // ON CONFLICT dedupes — zero loss, zero dupes)
    const pipe = this.deps.redis.pipeline()
    for (const id of ids) pipe.xack(this.stream, GROUP, id)
    await pipe.exec()
  }
}
