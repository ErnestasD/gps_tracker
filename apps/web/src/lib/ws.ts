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
  random?: () => number
}

/**
 * Reconnecting WS client for /v1/stream (E02-6). Owned by the liveStore singleton,
 * NOT a React effect — StrictMode double-mounts would burn two single-use tickets
 * and kill the first socket. Backoff: baseDelay·2^n, capped, ±20 % jitter, counter
 * resets on a successful open.
 */
export class LiveSocket {
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private stopped = true

  constructor(private readonly opts: LiveSocketOpts) {}

  start(): void {
    if (!this.stopped) return // idempotent — guards StrictMode double-invoke
    this.stopped = false
    this.attempts = 0
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.ws?.close()
    this.ws = null
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    this.opts.onStatus?.('connecting')
    let ticket: string
    try {
      ticket = await this.opts.getTicket()
    } catch (err) {
      if (this.opts.isAuthError?.(err) ?? false) {
        this.stopped = true
        this.opts.onStatus?.('closed')
        this.opts.onAuthError?.()
        return
      }
      this.opts.onStatus?.('closed')
      this.scheduleReconnect()
      return
    }
    if (this.stopped) return
    const Ctor = this.opts.WebSocketImpl ?? WebSocket
    const ws = new Ctor(this.opts.buildUrl(ticket))
    this.ws = ws
    let settled = false // close fires after error — schedule exactly once
    ws.onopen = () => {
      this.attempts = 0
      this.opts.onStatus?.('open')
    }
    ws.onmessage = (e: MessageEvent) => {
      this.opts.onMessage(typeof e.data === 'string' ? e.data : '')
    }
    ws.onclose = () => {
      if (settled) return
      settled = true
      if (this.ws === ws) this.ws = null
      this.opts.onStatus?.('closed')
      if (!this.stopped) this.scheduleReconnect()
    }
    ws.onerror = () => {
      ws.close()
    }
  }

  private scheduleReconnect(): void {
    const base = this.opts.baseDelayMs ?? 1_000
    const max = this.opts.maxDelayMs ?? 30_000
    const rnd = this.opts.random ?? Math.random
    const delay = Math.min(max, base * 2 ** this.attempts) * (0.8 + 0.4 * rnd())
    this.attempts++
    this.timer = setTimeout(() => void this.connect(), delay)
  }
}
