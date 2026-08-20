import { Decoder } from 'cbor-x'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { NormalizedRecord } from '@orbetra/shared'

import { AvlTableCache, type AvlFallbackReason } from './avlTableCache.js'
import { normalize, type HashFn } from './normalize.js'
import { PIPELINE_GROUP } from './shards.js'
import { writePositions } from './writer.js'

const GROUP = PIPELINE_GROUP // PROJECT_PLAN §5: consumer group name
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
  onBatch?: (records: NormalizedRecord[]) => void | Promise<void>
  batchSize?: number
  blockMs?: number
  /** XAUTOCLAIM min-idle (§6.1: 60 s; tests shrink it). */
  autoclaimMinIdleMs?: number
  /** Fencing (I2 / rule 5): returns true while this worker still holds the shard's lease. Consulted
   *  BEFORE applying each batch's durable effects — a stalled worker that lost its lease to a peer
   *  stops instead of double-processing the same device concurrently with the new owner. Omitted ⇒
   *  always-owned (deterministic tests that drive tick() directly without a leaser). */
  ownsShard?: () => Promise<boolean>
  /** Fired when ownsShard() reports the lease lost mid-flight — the owner drops this consumer so a
   *  later re-acquire (leaser onGained) starts a fresh one. Coordinated with ShardLeaser.onLost. */
  onLostOwnership?: (shard: number) => void
  /** Fired per entry moved to `raw:dead`, with WHY. Without a counter a poison row looks exactly
   *  like a quiet fleet — the audit's recurring "catch-and-continue with no signal" pattern. */
  onDeadLetter?: (reason: 'malformed' | 'rejected_by_db', count: number) => void
  /** Fired per field normalization had to null (out of column range). Non-zero ⇒ firmware quirk or
   *  spoofed frames; without it a nulled speed is indistinguishable from a device that reports none. */
  onFieldNulled?: (field: string) => void
  /** A fix the device called good and normalize refused — see NormalizedRecord.rejectReason. */
  onFixRejected?: (reason: string) => void
  /** pending entries Redis deleted because the stream had already trimmed past them — the only
   *  post-hoc proof that a stalled consumer's backlog was destroyed rather than merely delayed */
  onPendingEvicted?: (shard: number, count: number) => void
  /** Fired per device decoded with the FALLBACK dictionary instead of its profile's own table.
   *  The records still land, with every IO element named and SIGNED by the wrong table, and the
   *  result is written durably to `positions.attrs` where nothing recomputes it — so without this
   *  a Redis blip is indistinguishable from a fleet that simply reports different parameters. */
  onAvlFallback?: (reason: AvlFallbackReason) => void
}

/**
 * Postgres SQLSTATE classes that mean "this ROW is bad", not "the database is unhappy":
 * 22 = data exception (22003 numeric_value_out_of_range, 22P02 invalid_text_representation, …),
 * 23 = integrity constraint violation. Anything else — connection loss, deadlock, MISCONF,
 * 57P01 admin shutdown — is TRANSIENT and must be retried, never quarantined: quarantining on a
 * blip would throw away perfectly good positions that ingest already ACKed to the devices.
 */
const isRowRejection = (err: unknown): boolean => {
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' && (code.startsWith('22') || code.startsWith('23'))
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

  /** Per-shard, because rule 5 pins a device to one shard: the entries never overlap. */
  private readonly tables: AvlTableCache

  constructor(
    private readonly shard: number,
    private readonly deps: ConsumerDeps,
  ) {
    this.tables = new AvlTableCache(deps.redis, undefined, (reason) => deps.onAvlFallback?.(reason))
  }

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

  /** The consumer's OWN un-ACKed entries. Exposed so a test can prove the drain path exists at all;
   *  the loop uses the same call before it reads anything new. */
  async readOwnPendingForTest(): Promise<[string, Buffer][]> {
    return this.read(0, '0')
  }

  /** One full pass; exposed for deterministic tests. */
  async tick(): Promise<number> {
    const claimed = await this.autoclaim()
    const fresh = await this.read()
    const entries = [...claimed, ...fresh]
    if (entries.length === 0) return 0
    // fencing (I2 / rule 5): never apply a batch's durable effects if we've lost the lease. The
    // already-read entries stay PENDING to us and are reclaimed by the new owner via XAUTOCLAIM
    // (no lost effect); we simply don't process them here (no double effect).
    if (!(await this.ownsShard())) return 0
    await this.process(entries)
    return entries.length
  }

  /** Fencing check (I2 / rule 5). Omitted dep ⇒ assumed owned (tests driving tick() with no leaser). */
  private async ownsShard(): Promise<boolean> {
    return this.deps.ownsShard ? this.deps.ownsShard() : true
  }

  /** Lost the lease mid-flight: stop this consumer's loop and tell the owner to drop it (so a later
   *  re-acquire starts a fresh consumer instead of skipping a still-mapped, dead one). */
  private fence(): void {
    this.running = false
    console.error(`shard ${this.shard} fenced — lease lost, stopping consumer`)
    this.deps.onLostOwnership?.(this.shard)
  }

  private async loop(): Promise<void> {
    await this.ensureGroup()
    let lastAutoclaim = 0
    // Our own PEL is drained BEFORE any new entry is read, and stays the priority until it is
    // empty. Set on start too: a worker that crashed mid-batch owns those entries by name, and
    // XAUTOCLAIM will not hand them back to it until they have been idle a minute.
    let ownPending = true
    while (this.running) {
      try {
        const now = Date.now()
        if (ownPending) {
          // `read` ACKs and reports tombstones itself, so an empty result here genuinely means the
          // PEL is drained — it is no longer possible for this to spin on an entry it cannot take.
          const mine = await this.read(0, '0')
          if (mine.length === 0) ownPending = false
          else {
            if (!(await this.ownsShard())) return void this.fence()
            await this.process(mine)
            continue // keep draining before touching '>' again
          }
        }
        if (now - lastAutoclaim > 30_000) {
          // §6.1: XAUTOCLAIM on start + every 30 s to recover a crashed peer's pending
          const claimed = await this.autoclaim()
          if (claimed.length > 0) {
            if (!(await this.ownsShard())) return void this.fence()
            await this.process(claimed)
          }
          lastAutoclaim = now
        }
        const entries = await this.read(this.deps.blockMs ?? 2_000)
        if (entries.length > 0) {
          // fencing BEFORE process(): a lease lost during a stall/partition must not let this worker
          // run the downstream engines concurrently with the peer that already claimed the shard.
          if (!(await this.ownsShard())) return void this.fence()
          await this.process(entries)
        }
      } catch (err) {
        console.error(`shard ${this.shard} consumer error`, err)
        // Whatever failed, assume it left entries un-ACKed under our name and re-drain before
        // reading anything new. Without this the failure is silently converted into a backlog that
        // only MAXLEN resolves.
        ownPending = true
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
    /**
     * `res[2]` is the list of pending ids Redis DELETED from the group because the entries no
     * longer exist in the stream — trimmed away by `MAXLEN` before this consumer got back to them.
     * It was typed here and thrown away, which made it the one loss the pipeline could suffer with
     * nothing to point at afterwards.
     *
     * It is NOT a complete loss signal and must not be read as one: entries evicted before any
     * consumer took delivery were never in a PEL, so they can never appear here.
     *
     * And it is a LOWER BOUND — the autoclaim COUNT caps the deleted-id list per call, so a shard
     * that trimmed past a large PEL reports it 200 at a time across successive cycles.
     *
     * `stream_depth` is NOT a reliable precursor to this, contrary to the obvious assumption:
     * depth is lag + pending, while MAXLEN trims on total XLEN (acked included). A batch that
     * `process()` threw on stays pending while the loop reads and ACKs newer ones, so it can be
     * trimmed away with depth in the low hundreds and StreamDepthCritical (90 k) never close. That
     * is exactly why this counter is the only signal for the stalled-consumer case, and why the
     * alert must not send a responder to look at depth first.
     */
    const evicted = res[2] ?? []
    if (evicted.length > 0) {
      this.deps.onPendingEvicted?.(this.shard, evicted.length)
      console.error('pipeline: pending entries were TRIMMED from the stream before this consumer claimed them', {
        stream: this.stream,
        count: evicted.length,
      })
    }
    return (res[1] ?? []).map(([id, fields]) => [id.toString(), fields[1]!])
  }

  /**
   * `from = '>'` delivers NEW entries; `from = '0'` re-delivers OUR OWN un-ACKed ones.
   *
   * The loop used to read `'>'` unconditionally, which meant a consumer never retried its own
   * failures. A transient Postgres error makes `process()` throw before the XACK, so those entries
   * stay in this consumer's PEL — and the only thing that touched them again was XAUTOCLAIM, gated
   * at once per 30 s, `COUNT` 200, and a 60 s minimum idle. Meanwhile the loop kept consuming NEW
   * entries at full rate. At shard rates the PEL grows far faster than that drains, ingest keeps
   * XADDing under `MAXLEN ~100000`, and Redis deletes the stranded entries out from under the PEL —
   * records ingest had ALREADY ACKed to the tracker (rule 4), so the device dropped them from its
   * buffer. Permanent, silent history loss, with `pipeline_pending_evicted` as the only trace.
   */
  private async read(blockMs = 0, from: '>' | '0' = '>'): Promise<[string, Buffer][]> {
    const args = [
      'GROUP',
      GROUP,
      this.deps.workerId,
      'COUNT',
      String(this.deps.batchSize ?? 200),
      // BLOCK is meaningless for a '0' read — it returns immediately with whatever is pending —
      // and passing it would stall the drain for no reason.
      ...(blockMs > 0 && from === '>' ? ['BLOCK', String(blockMs)] : []),
      'STREAMS',
      this.stream,
      from,
    ]
    const res = (await this.deps.redis.callBuffer('XREADGROUP', ...args)) as
      | [Buffer, ([Buffer, Buffer[] | null] | null)[]][]
      | null
    if (!res || res.length === 0) return []
    // TOMBSTONES. A '0' read returns every id still in this consumer's PEL, INCLUDING ones whose
    // stream data MAXLEN already deleted — Redis answers those with a nil field array. Dereferencing
    // it (`fields[1]!`) threw a TypeError out of the drain, the loop re-armed the drain and retried
    // the same read a second later, forever, and because the drain runs BEFORE the autoclaim block
    // the one thing that removes a tombstone from a PEL was never reached. The shard stopped
    // consuming entirely while its lease kept renewing, so no peer took over and nothing detected
    // it. That is strictly worse than the silent loss the drain was added to prevent, and it was
    // introduced by that fix — so the entries are separated here and dealt with by the caller.
    const out: [string, Buffer][] = []
    const trimmed: string[] = []
    for (const row of res[0]![1]) {
      if (row === null) continue
      const [id, fields] = row
      const payload = fields?.[1]
      if (payload === undefined) trimmed.push(id.toString())
      else out.push([id.toString(), payload])
    }
    if (trimmed.length > 0) {
      // The data is GONE — there is nothing to decode and nothing to quarantine. ACK them so the
      // PEL can drain, and count them, because `pipeline_pending_evicted` is documented as the only
      // post-hoc proof that a backlog was destroyed rather than merely delayed.
      await this.deps.redis.xack(this.stream, GROUP, ...trimmed)
      this.deps.onPendingEvicted?.(this.shard, trimmed.length)
      console.error('pipeline: PEL entries had already been TRIMMED from the stream — acked, data unrecoverable', {
        stream: this.stream,
        count: trimmed.length,
      })
    }
    return out
  }

  private async process(entries: [string, Buffer][]): Promise<void> {
    const records: NormalizedRecord[] = []
    const ids: string[] = []
    const dead: [string, Buffer][] = []
    // record → its stream entry, so a row Postgres rejects can be quarantined WITH its original
    // bytes; `records` is sorted below, so positional correspondence with `ids` does not survive.
    const entryOf = new Map<NormalizedRecord, [string, Buffer]>()

    // DECODE FIRST, then resolve each device's AVL dictionary, then normalize. normalize() is
    // synchronous and the table lookup is a Redis read, so the two cannot be interleaved per entry
    // without a round-trip per record. Splitting the loop costs one HMGET per batch (cached 60 s)
    // and is what stops every model in the fleet being decoded as an FMB120 — see AvlTableCache.
    // A payload that fails CBOR decode or has no usable deviceId is dead-lettered exactly as before.
    const decoded: [string, Buffer, unknown, bigint | undefined][] = []
    for (const [id, payload] of entries) {
      try {
        const p = cbor.decode(payload) as { deviceId?: unknown }
        const d = p.deviceId
        decoded.push([id, payload, p, typeof d === 'bigint' ? d : typeof d === 'number' ? BigInt(d) : undefined])
      } catch {
        dead.push([id, payload])
      }
    }
    const tables = await this.tables.resolveBatch(
      decoded.map(([, , , d]) => d).filter((d): d is bigint => d !== undefined),
      Date.now(),
    )
    for (const [id, payload, p, deviceId] of decoded) {
      try {
        const table = deviceId === undefined ? undefined : tables.get(deviceId.toString())
        const rec = normalize(p, this.deps.hash, table, this.deps.onFieldNulled)
        if (rec.rejectReason !== null) this.deps.onFixRejected?.(rec.rejectReason)
        records.push(rec)
        entryOf.set(rec, [id, payload])
        ids.push(id)
      } catch {
        // malformed entry → dead-letter, continue (E02-3 edge case)
        dead.push([id, payload])
      }
    }
    if (dead.length > 0) {
      const pipe = this.deps.redis.pipeline()
      for (const [id, payload] of dead) {
        // carry the ORIGINAL payload bytes, not just a ref: ingest trims raw:{shard} with
        // MAXLEN ~100k, so a ref would dangle within minutes and the poison payload be
        // unrecoverable/undiagnosable (review MED). Keep the ref too for provenance.
        pipe.xadd('raw:dead', 'MAXLEN', '~', 10_000, '*', 'ref', `${this.stream}:${id}`, 'payload', payload)
        pipe.xack(this.stream, GROUP, id)
      }
      await pipe.exec()
      this.stats.deadLettered += dead.length
      this.deps.onDeadLetter?.('malformed', dead.length)
    }
    if (records.length === 0) return

    // Appendix A / R4: downstream handoff is fixTime-sorted (per shard batch)
    records.sort((a, b) => a.fixTime.getTime() - b.fixTime.getTime())

    const { inserted, kept, rejected } = await this.writeIsolatingBadRows(records, entryOf)
    this.stats.inserted += inserted
    this.stats.processed += kept.records.length

    if (rejected.length > 0) {
      // the rejected rows are quarantined AND acked below: leaving them un-acked is what made a
      // single bad row replay forever, and it is the batch's other ~199 records that pay for it
      const pipe = this.deps.redis.pipeline()
      for (const [id, payload] of rejected) {
        pipe.xadd('raw:dead', 'MAXLEN', '~', 10_000, '*', 'ref', `${this.stream}:${id}`, 'payload', payload)
      }
      await pipe.exec()
      this.stats.deadLettered += rejected.length
      this.deps.onDeadLetter?.('rejected_by_db', rejected.length)
    }

    // awaited BEFORE XACK: shard serialization then serializes downstream applies per
    // device (review HIGH: fire-and-forget allowed two applies to race and regress the
    // live marker); crash before XACK replays the batch — apply is idempotent max-wins
    if (kept.records.length > 0) await this.deps.onBatch?.(kept.records)

    // ACK only after durable insert (crash before this line ⇒ XAUTOCLAIM replays,
    // ON CONFLICT dedupes — zero loss, zero dupes)
    const pipe = this.deps.redis.pipeline()
    for (const id of ids) pipe.xack(this.stream, GROUP, id)
    await pipe.exec()
  }

  /**
   * Insert the batch, isolating any row Postgres REJECTS on its own merits.
   *
   * A multi-row INSERT is one statement: one bad value (a uint16 speed into `smallint`, a ≥2^63
   * odometer into `bigint`) fails all 200 rows. Without this the batch is never ACKed, XAUTOCLAIM
   * re-delivers it every 60 s forever, and the ~199 records beside it — belonging to OTHER tenants
   * on the same shard, already ACKed to their devices and dropped from their buffers — are never
   * written. normalize() bounds the fields we know overflow; this bounds the whole class, including
   * whatever the next firmware invents. Audit critical #2.
   *
   * Binary search: zero cost on the happy path, O(log n) extra statements when a row is poison.
   * Transient errors are re-thrown untouched so the batch retries intact (see isRowRejection).
   */
  private async writeIsolatingBadRows(
    records: NormalizedRecord[],
    entryOf: Map<NormalizedRecord, [string, Buffer]>,
  ): Promise<{ inserted: number; kept: { records: NormalizedRecord[] }; rejected: [string, Buffer][] }> {
    const rejected: [string, Buffer][] = []
    const bad = new Set<NormalizedRecord>()

    const write = async (recs: NormalizedRecord[]): Promise<number> => {
      if (recs.length === 0) return 0
      try {
        return await writePositions(this.deps.pool, recs)
      } catch (err) {
        if (!isRowRejection(err)) throw err
        if (recs.length === 1) {
          bad.add(recs[0]!)
          console.error('worker: row rejected by postgres, quarantining', {
            shard: this.shard,
            deviceId: String(recs[0]!.deviceId),
            code: (err as { code?: string }).code,
          })
          return 0
        }
        const mid = Math.floor(recs.length / 2)
        return (await write(recs.slice(0, mid))) + (await write(recs.slice(mid)))
      }
    }

    const inserted = await write(records)
    if (bad.size === 0) return { inserted, kept: { records }, rejected }

    for (const r of bad) {
      const entry = entryOf.get(r)
      if (entry !== undefined) rejected.push(entry)
    }
    return { inserted, kept: { records: records.filter((r) => !bad.has(r)) }, rejected }
  }
}
