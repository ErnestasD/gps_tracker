import type { Socket } from 'node:net'
import type { Redis } from 'ioredis'

import {
  createTeltonikaCodec,
  CrcError,
  encodeCodec12,
  FrameError,
  type TeltonikaCodec,
} from '@orbetra/codec'

import { parkUndecodableFrame, persistAvlBatch } from './persist.js'
import type { DeviceRegistry } from './registry.js'
import type { IngestMetrics } from './metrics.js'

export interface SessionConfig {
  /** Shard-depth backpressure threshold (I4; PROJECT_PLAN default 50_000). */
  pauseAboveDepth: number
  /** Handshake must complete within this window (§6.1: 10 s). */
  handshakeTimeoutMs: number
  /** Read-idle timeout while streaming (§6.1: profile-driven, default 40 min). */
  readIdleTimeoutMs: number
  /** Timestamp sanity window (§3.6): reject fix_time > now+48 h or < 2020-01-01. */
  maxFutureMs: number
  minTsMs: number
  /** Shard XLEN cache TTL (§6.1: refreshed 1 s); tests set 0 for immediacy. */
  depthCacheMs?: number
}

export const SHARD_COUNT = 16 // CLAUDE.md rule 5: imei % 16

interface SessionDeps {
  redis: Redis
  registry: DeviceRegistry
  metrics: IngestMetrics
  /** prom histogram hook (E02-5); undefined in unit tests */
  observeAckLatencyMs?: (ms: number) => void
  config: SessionConfig
  /** newest-wins duplicate-IMEI policy — server tracks live sessions per IMEI */
  onAuthenticated: (imei: string, session: Session) => void
  now?: () => number
}

/**
 * Per-socket protocol session (PROJECT_PLAN §3.2 + §6.1 top half). ZERO business
 * logic (rule 3): frame → verify → parse → sanity → XADD → ACK. Nothing else.
 */
export class Session {
  private readonly codec: TeltonikaCodec
  private state: 'AWAIT_IMEI' | 'STREAMING' = 'AWAIT_IMEI'
  private imei = ''
  private deviceId: bigint | null = null
  private shard = 0
  private paused = false
  private pendingChunks = 0
  private timer: NodeJS.Timeout | null = null
  private readonly now: () => number
  private processing: Promise<void> = Promise.resolve()

  constructor(
    private readonly socket: Socket,
    private readonly deps: SessionDeps,
  ) {
    this.codec = createTeltonikaCodec()
    this.now = deps.now ?? Date.now
    socket.setKeepAlive(true, 60_000) // §6.1 SO_KEEPALIVE
    this.armTimer(deps.config.handshakeTimeoutMs)
    socket.on('data', (chunk) => {
      // serialize async packet handling per socket — per-device ordering (rule 5).
      // Socket is paused while work is in flight so a fast sender + slow Redis can
      // never grow an unbounded chunk backlog (§10 failure #11).
      this.pendingChunks++
      socket.pause()
      this.processing = this.processing
        .then(() => this.onData(chunk))
        .catch((err: unknown) => {
          // never a silent catch (CLAUDE.md §9.6): surface, then drop the socket
          this.deps.metrics.sessionErrorsTotal++
          console.error('ingest session error', {
            imei: this.imei,
            err: err instanceof Error ? err.message : String(err),
          })
          this.destroy()
        })
        .finally(() => {
          this.pendingChunks--
          if (this.pendingChunks === 0 && !this.paused && !this.socket.destroyed) {
            this.socket.resume()
          }
        })
    })
    socket.on('error', () => this.destroy())
    // 'close' must release the paused accounting too, not just the timer. A GRACEFUL peer
    // disconnect — the ordinary way a GPRS device drops a session — emits no 'error', so
    // `destroy()` never ran, and `pollForDrain`'s tick returns early on `socket.destroyed`
    // without decrementing either. So every paused socket whose peer hung up leaked +1 on
    // `ingest_paused_sockets` forever. That gauge is the SOLE expression of the
    // BackpressureSustained alert, so the leak turns it into a permanent false page — and, worse,
    // hides a real one behind noise. Audit MED.
    socket.on('close', () => this.releasePaused())
  }

  get authenticatedImei(): string {
    return this.imei
  }

  /** Old socket of the same IMEI is closed when a new one authenticates. */
  destroy(): void {
    this.releasePaused()
    this.socket.destroy()
  }

  /** Drop the timer and give back the paused-socket count. Idempotent: 'close' fires after an
   *  explicit destroy() too, and double-decrementing would drive the gauge negative forever. */
  private releasePaused(): void {
    this.clearTimer()
    if (!this.paused) return
    this.paused = false
    this.deps.metrics.pausedSockets--
  }

  private armTimer(ms: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => this.destroy(), ms)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async onData(chunk: Buffer): Promise<void> {
    if (this.socket.destroyed) return
    let frames
    try {
      frames = this.codec.feed(chunk)
    } catch (err) {
      if (err instanceof FrameError) {
        // oversize / garbage framing = protocol attack → close (§3.3, E01-5 AC)
        this.deps.metrics.frameViolationsTotal++
        this.destroy()
        return
      }
      throw err
    }
    for (const frame of frames) {
      if (this.state === 'AWAIT_IMEI') await this.handleImei(frame)
      else await this.handleStreamFrame(frame)
      if (this.socket.destroyed) return
    }
    // any full frame resets the idle window
    if (frames.length > 0 && this.state === 'STREAMING') {
      this.armTimer(this.deps.config.readIdleTimeoutMs)
    }
  }

  private async handleImei(frame: ReturnType<TeltonikaCodec['feed']>[number]): Promise<void> {
    if (frame.kind !== 'imei') {
      this.deps.metrics.frameViolationsTotal++
      this.destroy()
      return
    }
    const parsed = this.codec.parse(frame)
    if (parsed.kind !== 'imei') return
    const deviceId = await this.deps.registry.lookup(parsed.imei)
    if (deviceId === null) {
      this.deps.metrics.rejectedImeiTotal++
      const rejects = await this.deps.registry.quarantine(parsed.imei, this.now())
      this.socket.write(this.codec.encodeImeiReply(false))
      // ≥3 rejected attempts/hr per IMEI ⇒ stop letting it retry (§6.1)
      if (rejects >= 3) this.destroy()
      else this.socket.end()
      return
    }
    this.imei = parsed.imei
    this.deviceId = deviceId
    this.shard = Number(BigInt(parsed.imei) % BigInt(SHARD_COUNT)) // rule 5: imei % 16
    this.state = 'STREAMING'
    // NOTE (review LOW): old-session in-flight XADDs may interleave with this socket
    // for ~one batch during handover; I2 (fix_time ordering) + I3 (dedupe) absorb it.
    this.deps.onAuthenticated(parsed.imei, this)
    this.socket.write(this.codec.encodeImeiReply(true))
    this.armTimer(this.deps.config.readIdleTimeoutMs)
    await this.drainPending() // a live socket may already have queued commands (E08-2)
  }

  /**
   * Send any queued Codec-12 commands to this live device (E08-2). TRANSPORT ONLY (rule 3):
   * LPOP the api-queued command, write it to the socket, and record it in-flight for the
   * worker's dispatcher — no queue/timeout/retry policy here. Best-effort: a send failure
   * leaves the command in-flight; the dispatcher times it out and re-queues it.
   */
  private async drainPending(): Promise<void> {
    if (this.deviceId === null) return
    const pendKey = `cmd:pending:${this.deviceId}`
    for (let i = 0; i < 16; i++) {
      // bound per drain
      const raw = await this.deps.redis.lpop(pendKey)
      if (raw === null) return
      let cmd: { id: string; text: string; attempt?: number; expiresAtMs?: number }
      try {
        cmd = JSON.parse(raw) as { id: string; text: string; attempt?: number; expiresAtMs?: number }
      } catch {
        continue // malformed queue entry — skip
      }
      // NEVER send a command past its 24 h expiry — a device that was offline for a day must not
      // execute a stale (possibly destructive) command on reconnect. Drop it; the dispatcher's
      // DB expiry sweep marks it 'expired' (E08-2 review HIGH).
      if (cmd.expiresAtMs !== undefined && cmd.expiresAtMs <= this.now()) continue
      try {
        this.socket.write(encodeCodec12(cmd.text))
      } catch {
        // encode failed (empty/oversize) — drop; the dispatcher will expire it in the DB
        continue
      }
      const inflightKey = `cmd:inflight:${this.deviceId}`
      await this.deps.redis
        .multi()
        // keep expiresAtMs so a dispatcher resend can re-stamp it onto the pending entry
        .rpush(inflightKey, JSON.stringify({ id: cmd.id, text: cmd.text, attempt: cmd.attempt ?? 0, sentAtMs: this.now(), ...(cmd.expiresAtMs !== undefined ? { expiresAtMs: cmd.expiresAtMs } : {}) }))
        .expire(inflightKey, 24 * 3_600) // bound the list (dispatcher reconciles + trims it)
        .sadd('cmd:active', String(this.deviceId))
        .exec()
    }
  }

  private async handleStreamFrame(
    frame: ReturnType<TeltonikaCodec['feed']>[number],
  ): Promise<void> {
    const t0 = this.now()
    this.deps.metrics.msgsTotal++
    let parsed
    try {
      parsed = this.codec.parse(frame)
    } catch (err) {
      if (err instanceof CrcError || err instanceof FrameError) {
        // corrupt packet: ACK the count actually persisted — zero (rule 4; device re-sends)
        this.deps.metrics.parseFailTotal++
        this.socket.write(this.codec.encodeAck(0))
        this.deps.observeAckLatencyMs?.(this.now() - t0) // error-ACKs count too
        return
      }
      throw err
    }

    if (parsed.kind === 'cmdResponse') {
      // Codec 12/13/14 responses: captured for the command dispatcher (E08-2)
      const key = `cmd:resp:${this.deviceId}`
      await this.deps.redis
        .multi()
        .rpush(key, JSON.stringify({ codec: parsed.codec, text: parsed.text, nack: parsed.nack ?? false }))
        .ltrim(key, -1000, -1)
        .expire(key, 24 * 3600)
        .sadd('cmd:active', String(this.deviceId)) // wake the dispatcher (E08-2)
        .exec()
      return
    }
    if (parsed.kind !== 'avl') return

    // registry RE-CHECK per data frame (E08-4 review): retire only prevents the NEXT
    // connect — a live session (or a profile with a long read-idle, e.g. tat-asset 26 h)
    // would keep streaming a retired device's positions past a GDPR erase. Same transport
    // lookup as the handshake (rule 3); a de-registered device's session dies here, before
    // anything is persisted and WITHOUT an ACK (rule 4: nothing persisted ⇒ nothing acked).
    const mapped = await this.deps.registry.lookup(this.imei ?? '')
    if (mapped === null || mapped !== this.deviceId) {
      this.deps.metrics.rejectedImeiTotal++
      this.socket.destroy()
      return
    }

    if (this.deviceId === null) return // unreachable while STREAMING; narrows the type for persist

    // codec 16: framing + CRC are verified but we cannot decode the records yet. ACKing 0 would make
    // the device resend the identical packet FOREVER (the count is the acknowledged-record cursor),
    // so the data never advances and nothing is observable. Park the frame for diagnosis, ACK what
    // the device claims to have sent, and count it. The UDP listener does the SAME — see udp.ts.
    if (parsed.rawFallback === true) {
      const declared = parsed.declaredCount ?? 0
      await parkUndecodableFrame(this.deps.redis, this.imei, frame.bytes, this.now())
      this.deps.metrics.unsupportedCodecTotal++
      // we told the device these records are accepted, so I1 reconciliation must see them too
      this.deps.metrics.ackedRecordsTotal += declared
      this.socket.write(this.codec.encodeAck(declared))
      this.deps.observeAckLatencyMs?.(this.now() - t0)
      await this.maybeBackpressure()
      // an FMB6xx sends codec 16 for EVERY frame and can hold one socket for hours — skipping this
      // would make Codec-12 command delivery (E08-2) silently dead for exactly that hardware
      await this.drainPending()
      return
    }
    // persist to the device's shard stream, THEN ack (rule 4 / I1). The shared helper writes the
    // SAME payload as the UDP listener (udp.ts) and durably records sanity rejects — see persist.ts.
    const persisted = await persistAvlBatch(
      this.deps.redis,
      { deviceId: this.deviceId, imei: this.imei, shard: this.shard },
      parsed.records,
      this.deps.config,
      this.deps.metrics,
      this.now(),
    )
    this.socket.write(this.codec.encodeAck(persisted))
    this.deps.observeAckLatencyMs?.(this.now() - t0)

    // depth check AFTER ack (§6.1 order: persist → ACK → depth-check → maybe pause)
    await this.maybeBackpressure()
    await this.drainPending() // deliver any commands queued since the last frame (E08-2)
  }

  private async maybeBackpressure(): Promise<void> {
    const depth = await getCachedShardDepth(
      this.deps.redis,
      this.shard,
      this.now(),
      false,
      this.deps.config.depthCacheMs,
    )
    if (depth > this.deps.config.pauseAboveDepth && !this.paused) {
      this.paused = true
      this.deps.metrics.pausedSockets++
      this.socket.pause()
      this.pollForDrain()
    }
  }

  private pollForDrain(): void {
    const tick = async (): Promise<void> => {
      if (this.socket.destroyed) return
      // a FAILED probe must never read as "drained" — that would resume a paused socket on a Redis
      // blip, which is exactly the congestion the pause exists for. Stay paused and keep polling.
      // CACHED, not forced (audit MED). Congestion pauses many sockets at once and they all poll
      // the same shard every 500 ms, so a forced probe meant N XINFO round trips per shard per tick
      // — piling load on the one Redis connection whose contention is the reason they are paused.
      //
      // The trade-off, stated honestly: the depth cache is shared across sockets, so a value another
      // socket refreshed below the threshold can resume this one while the shard has since climbed
      // back over it. I4 therefore holds to within one cache TTL rather than at probe time. The TTL
      // comes from config, not a literal, so a deployment that wants the old always-fresh behaviour
      // sets `depthCacheMs: 0` — which is exactly what the I4 tests do.
      const depth = await getCachedShardDepth(this.deps.redis, this.shard, this.now(), false, this.deps.config.depthCacheMs).catch(
        () => Number.POSITIVE_INFINITY,
      )
      // re-check AFTER the await: a destroy() landing during the XLEN roundtrip already decremented
      // the paused gauge + cleared this.paused, so proceeding would double-decrement it (gauge drifts
      // negative forever) and resume() a destroyed socket (review LOW).
      if (this.socket.destroyed || !this.paused) return
      if (depth <= this.deps.config.pauseAboveDepth) {
        this.paused = false
        this.deps.metrics.pausedSockets--
        this.socket.resume()
      } else {
        setTimeout(() => void tick(), 500)
      }
    }
    setTimeout(() => void tick(), 500)
  }
}

// per-shard BACKLOG cache, refreshed at most once per second (§6.1 "cached, refreshed 1 s")
const depthCache = new Map<number, { at: number; depth: number }>()

/** The consumer group the worker reads with (apps/worker/src/consumer.ts). */
const PIPELINE_GROUP = 'pipeline'

/**
 * The backlog for a shard = entries the pipeline has NOT consumed yet.
 *
 * This must NOT be XLEN. XACK removes an entry from the group's pending list, it does NOT delete it
 * from the stream, and nothing trims `raw:{shard}` — it is written with `MAXLEN ~ 100_000`, so XLEN
 * climbs to that plateau and never comes back down. Using XLEN as the backpressure signal therefore
 * latches PERMANENTLY the first time a shard has cumulatively carried `pauseAboveDepth` records
 * (hours into a real fleet's life), after which every session pauses forever and UDP is dropped
 * wholesale against a completely healthy, idle worker.
 *
 * `XINFO GROUPS` reports `lag` = entries added but not yet delivered to the group, which is the real
 * queue depth and returns to 0 when the worker keeps up. Fallbacks, in order:
 *   - group missing (no worker has ever run) → XLEN is the honest backlog, nothing is consuming
 *   - `lag` null (Redis cannot compute it after XDEL / XGROUP SETID) → max(pending, XLEN)
 *
 * Every fallback deliberately errs HIGH. Under-reporting is the mirror-image outage: ingest keeps
 * accepting while the worker falls behind, `raw:{shard}` hits `MAXLEN ~ 100_000` and silently evicts
 * records that were never processed — I1 data loss with a green dashboard. Pausing a healthy socket
 * costs a few seconds; evicting unprocessed positions is unrecoverable.
 */
export async function getCachedShardDepth(
  redis: Redis,
  shard: number,
  nowMs: number,
  force = false,
  ttlMs = 1000,
): Promise<number> {
  const cached = depthCache.get(shard)
  if (!force && cached && nowMs - cached.at < ttlMs) return cached.depth
  const depth = await shardBacklog(redis, shard)
  depthCache.set(shard, { at: nowMs, depth })
  return depth
}

/** Uncached backlog probe — exported so the worker's stream_depth gauge reports the SAME number. */
export async function shardBacklog(redis: Redis, shard: number): Promise<number> {
  const stream = `raw:${shard}`
  let groups: unknown[]
  try {
    groups = (await redis.xinfo('GROUPS', stream)) as unknown[]
  } catch (err) {
    // ONLY "the stream does not exist yet" is a real zero. Everything else — WRONGTYPE, an ACL
    // denial, MISCONF, a dropped connection — must propagate: swallowing it would make the I4 guard
    // fail OPEN, and pollForDrain would read 0 and resume an already-paused socket.
    if (err instanceof Error && /no such key/i.test(err.message)) return 0
    throw err
  }
  for (const g of groups) {
    // ioredis returns a flat [key, value, key, value, …] array per group. Walk PAIRS: indexOf would
    // also match a VALUE, so a group literally named `lag` would make the lookup return a field name.
    const flat = g as unknown[]
    const at = (k: string): unknown => {
      for (let i = 0; i + 1 < flat.length; i += 2) if (flat[i] === k) return flat[i + 1]
      return undefined
    }
    if (at('name') !== PIPELINE_GROUP) continue
    const lagRaw = at('lag')
    const pendingRaw = Number(at('pending') ?? 0)
    const pending = Number.isFinite(pendingRaw) ? pendingRaw : 0
    // lag counts undelivered entries; pending counts delivered-but-unacked — both are backlog
    if (lagRaw !== null && lagRaw !== undefined) return Number(lagRaw) + pending
    // Redis cannot compute lag after XDEL or XGROUP SETID — both are on-call actions for skipping a
    // wedged batch. `pending` alone is ~0 exactly when the pipeline is stalled, so fall back to the
    // conservative upper bound instead of silently disabling backpressure right when it is needed.
    return Math.max(pending, await redis.xlen(stream))
  }
  // no `pipeline` group yet ⇒ nothing is consuming ⇒ everything retained is genuinely backlog
  return await redis.xlen(stream)
}
