import { WS_CLOSE } from '@orbetra/shared'

export type ConnState = 'connecting' | 'open' | 'closed'

export interface LiveSocketOpts {
  /** Fetch a FRESH single-use ticket. Called immediately before every connect —
   * tickets are GETDEL'd server-side and expire in 30 s, so caching one is a bug. */
  getTicket: () => Promise<string>
  buildUrl: (ticket: string) => string
  onMessage: (data: string) => void
  onStatus?: (state: ConnState) => void
  /** getTicket threw an auth error — token is bad, reconnecting would hammer 401s. */
  onAuthError?: () => void
  isAuthError?: (err: unknown) => boolean
  /** Injected for tests. */
  WebSocketImpl?: typeof WebSocket
  baseDelayMs?: number
  maxDelayMs?: number
  /** How long a connection must stay open before `attempts` resets. Default 30 s. */
  stableAfterMs?: number
  random?: () => number
}

/**
 * Reconnecting WS client for /v1/stream (E02-6). Owned by the liveStore singleton,
 * NOT a React effect — StrictMode double-mounts would burn two single-use tickets
 * and kill the first socket. Backoff: baseDelay·2^n, capped, ±20 % jitter, counter
 * resets on a successful open.
 */
/** Backoff exponent a slow-consumer cut starts from: base·2^4 ≈ 16 s at the default 1 s base. */
const SLOW_RETRY_FLOOR = 4
/** How long a socket must STAY open before the backoff counter is forgiven. */
const DEFAULT_STABLE_AFTER_MS = 30_000

export class LiveSocket {
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private stopped = true
  // Generation token (MED): a single `stopped` boolean can't cancel a connect() whose
  // getTicket is already in flight — start→stop→start (StrictMode; or leave+re-enter /app/map
  // within the ticket RTT) resets stopped=false so the OLD connect passes its re-check and opens
  // a SECOND, orphaned socket that keeps feeding onMessage and spawns its own reconnect loop.
  // Every start/stop bumps this; each connect captures its gen and bails the moment it's stale.
  private generation = 0

  constructor(private readonly opts: LiveSocketOpts) {}

  start(): void {
    if (!this.stopped) return // idempotent — guards StrictMode double-invoke
    this.stopped = false
    this.attempts = 0
    void this.connect(++this.generation)
  }

  private clearStable(): void {
    if (this.stableTimer !== null) clearTimeout(this.stableTimer)
    this.stableTimer = null
  }

  stop(): void {
    this.stopped = true
    this.generation++ // invalidate any in-flight connect() and any scheduled reconnect
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.clearStable()
    this.ws?.close()
    this.ws = null
  }

  private async connect(gen: number): Promise<void> {
    if (this.stopped || gen !== this.generation) return
    this.opts.onStatus?.('connecting')
    let ticket: string
    try {
      ticket = await this.opts.getTicket()
    } catch (err) {
      if (gen !== this.generation) return // superseded while the ticket was in flight
      if (this.opts.isAuthError?.(err) ?? false) {
        this.stopped = true
        this.generation++
        this.opts.onStatus?.('closed')
        this.opts.onAuthError?.()
        return
      }
      this.opts.onStatus?.('closed')
      this.scheduleReconnect(gen)
      return
    }
    if (this.stopped || gen !== this.generation) return
    const Ctor = this.opts.WebSocketImpl ?? WebSocket
    const ws = new Ctor(this.opts.buildUrl(ticket))
    this.ws = ws
    let settled = false // close fires after error — schedule exactly once
    ws.onopen = () => {
      if (gen !== this.generation) return
      // Backoff is forgiven only once the connection has PROVED itself, not the instant it opens.
      // Resetting on open makes every fast open→drop cycle retry at the base delay forever, which
      // is a ~1 Hz reconnect storm whenever the drop is immediate — a slow-consumer cut, a gateway
      // that rejects on subscribe, an upgrade that succeeds and dies. Those are exactly the cases
      // where hammering hurts most, and the close code they carry is not always deliverable (a
      // 4408 close frame queues BEHIND the megabyte of backlog that triggered it, so the client
      // usually sees a bare 1006). Requiring the socket to survive a while is the signal that
      // always arrives.
      this.clearStable()
      this.stableTimer = setTimeout(() => {
        if (this.ws === ws && gen === this.generation) this.attempts = 0
      }, this.opts.stableAfterMs ?? DEFAULT_STABLE_AFTER_MS)
      this.opts.onStatus?.('open')
    }
    ws.onmessage = (e: MessageEvent) => {
      if (gen !== this.generation) return // an orphaned socket must never feed the store
      this.opts.onMessage(typeof e.data === 'string' ? e.data : '')
    }
    ws.onclose = (e?: { code?: number }) => {
      if (settled) return
      settled = true
      this.clearStable()
      if (this.ws === ws) this.ws = null
      // a socket from a superseded generation closing must NOT flap the badge or start a
      // second reconnect loop — only the current generation drives status/reconnect
      if (gen !== this.generation) return
      this.opts.onStatus?.('closed')
      // A slow-consumer cut, WHEN the close frame does reach us, is a stronger signal than "the
      // socket did not last": reconnecting re-subscribes to the same feed and gets cut again, so
      // start from a long delay rather than growing into one.
      if (e?.code === WS_CLOSE.SLOW_CONSUMER) this.attempts = Math.max(this.attempts, SLOW_RETRY_FLOOR)
      if (!this.stopped) this.scheduleReconnect(gen)
    }
    ws.onerror = () => {
      ws.close()
    }
  }

  private scheduleReconnect(gen: number): void {
    const base = this.opts.baseDelayMs ?? 1_000
    const max = this.opts.maxDelayMs ?? 30_000
    const rnd = this.opts.random ?? Math.random
    const delay = Math.min(max, base * 2 ** this.attempts) * (0.8 + 0.4 * rnd())
    this.attempts++
    this.timer = setTimeout(() => void this.connect(gen), delay)
  }
}
