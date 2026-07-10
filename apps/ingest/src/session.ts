import { Encoder } from 'cbor-x'
import type { Socket } from 'node:net'
import type { Redis } from 'ioredis'

import {
  createTeltonikaCodec,
  CrcError,
  encodeCodec12,
  FrameError,
  type AvlRecord,
  type TeltonikaCodec,
} from '@orbetra/codec'

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

const cbor = new Encoder()

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
    socket.on('close', () => this.clearTimer())
  }

  get authenticatedImei(): string {
    return this.imei
  }

  /** Old socket of the same IMEI is closed when a new one authenticates. */
  destroy(): void {
    this.clearTimer()
    if (this.paused) {
      this.paused = false
      this.deps.metrics.pausedSockets--
    }
    this.socket.destroy()
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

    const good: AvlRecord[] = []
    const insane: AvlRecord[] = []
    for (const rec of parsed.records) {
      if (this.sane(rec)) good.push(rec)
      else insane.push(rec)
    }

    // persist to the device's shard stream, THEN ack (rule 4 / I1). Sanity-rejected
    // records are written durably to the 'rejects' stream IN THE SAME pipeline and
    // COUNT toward the ACK — §3.2 resend is whole-packet, so under-ACKing a record
    // we have already taken responsibility for would wedge the device in an eternal
    // resend loop (adversarial review finding, E01-5).
    if (good.length > 0 || insane.length > 0) {
      const pipeline = this.deps.redis.pipeline()
      const serverTimeMs = this.now()
      for (const rec of insane) {
        this.deps.metrics.sanityRejectsTotal++
        pipeline.xadd(
          'rejects',
          'MAXLEN',
          '~',
          100_000,
          '*',
          'p',
          cbor.encode({ imei: this.imei, tsMs: rec.tsMs, raw: rec.raw, reason: 'sanity' }),
        )
      }
      for (const rec of good) {
        pipeline.xadd(
          `raw:${this.shard}`,
          'MAXLEN',
          '~',
          100_000, // §5 R8-4 hard cap per shard
          '*',
          'p',
          cbor.encode({
            deviceId: this.deviceId,
            imei: this.imei,
            serverTimeMs,
            tsMs: rec.tsMs,
            priority: rec.priority,
            lat: rec.lat,
            lon: rec.lon,
            altitude: rec.altitude,
            angle: rec.angle,
            satellites: rec.satellites,
            speed: rec.speed,
            eventIoId: rec.eventIoId,
            io: [...rec.io.entries()],
            raw: rec.raw,
          }),
        )
      }
      const results = await pipeline.exec()
      const persisted = results?.filter((r) => r[0] === null).length ?? 0
      this.deps.metrics.ackedRecordsTotal += persisted
      this.socket.write(this.codec.encodeAck(persisted))
    } else {
      this.socket.write(this.codec.encodeAck(0))
    }
    this.deps.observeAckLatencyMs?.(this.now() - t0)

    // depth check AFTER ack (§6.1 order: persist → ACK → depth-check → maybe pause)
    await this.maybeBackpressure()
    await this.drainPending() // deliver any commands queued since the last frame (E08-2)
  }

  private sane(rec: AvlRecord): boolean {
    const cfg = this.deps.config
    if (rec.tsMs < cfg.minTsMs || rec.tsMs > this.now() + cfg.maxFutureMs) return false
    if (Math.abs(rec.lat) > 90 || Math.abs(rec.lon) > 180) return false
    return true
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
      const depth = await getCachedShardDepth(this.deps.redis, this.shard, this.now(), true)
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

// per-shard XLEN cache, refreshed at most once per second (§6.1 "cached, refreshed 1 s")
const depthCache = new Map<number, { at: number; depth: number }>()

async function getCachedShardDepth(
  redis: Redis,
  shard: number,
  nowMs: number,
  force = false,
  ttlMs = 1000,
): Promise<number> {
  const cached = depthCache.get(shard)
  if (!force && cached && nowMs - cached.at < ttlMs) return cached.depth
  const depth = await redis.xlen(`raw:${shard}`)
  depthCache.set(shard, { at: nowMs, depth })
  return depth
}
