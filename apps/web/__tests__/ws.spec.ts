import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LiveSocket } from '../src/lib/ws.js'

/** Controllable WebSocket double. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e?: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  close(code?: number): void {
    this.closed = true
    this.onclose?.({ code })
  }
  open(): void {
    this.onopen?.()
  }
  /** The server hung up. `code` mirrors what the gateway sends (see WS_CLOSE in @orbetra/shared). */
  serverDrop(code?: number): void {
    this.onclose?.({ code })
  }
}

const flushMicrotasks = async () => {
  // getTicket resolves through the microtask queue before the socket is constructed
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

let tickets: string[]
let ticketCalls: number

const makeSocket = (over: Partial<ConstructorParameters<typeof LiveSocket>[0]> = {}) => {
  ticketCalls = 0
  tickets = []
  return new LiveSocket({
    getTicket: () => {
      ticketCalls++
      const t = `ticket-${ticketCalls}`
      tickets.push(t)
      return Promise.resolve(t)
    },
    buildUrl: (t) => `ws://x/v1/stream?ticket=${t}`,
    onMessage: () => undefined,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    random: () => 0.5, // jitter factor exactly 1.0
    ...over,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LiveSocket', () => {
  it('fetches a FRESH single-use ticket for every connect attempt', async () => {
    const s = makeSocket()
    s.start()
    await flushMicrotasks()
    expect(FakeWebSocket.instances[0]!.url).toContain('ticket-1')
    FakeWebSocket.instances[0]!.serverDrop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ticketCalls).toBe(2)
    expect(FakeWebSocket.instances[1]!.url).toContain('ticket-2')
    s.stop()
  })

  it('backs off exponentially (1s·2^n, ±20% jitter, cap 30s) and resets after open', async () => {
    const s = makeSocket()
    s.start()
    await flushMicrotasks()
    // three consecutive failures: delays 1s, 2s, 4s (jitter factor 1.0)
    for (const delay of [1_000, 2_000, 4_000]) {
      FakeWebSocket.instances.at(-1)!.serverDrop()
      await vi.advanceTimersByTimeAsync(delay - 1)
      const before = FakeWebSocket.instances.length
      await vi.advanceTimersByTimeAsync(1)
      await flushMicrotasks()
      expect(FakeWebSocket.instances.length).toBe(before + 1)
    }
    // a connection that STAYS open resets the counter → the next failure waits the base delay
    // again. The reset is deliberately not on `open`: a socket that opens and dies immediately has
    // proved nothing, and forgiving it there turns every fast open→drop cycle into a ~1 Hz storm.
    FakeWebSocket.instances.at(-1)!.open()
    await vi.advanceTimersByTimeAsync(30_000) // the stability window
    FakeWebSocket.instances.at(-1)!.serverDrop()
    const count = FakeWebSocket.instances.length
    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    expect(FakeWebSocket.instances.length).toBe(count + 1)
    s.stop()
  })

  it('an open→drop cycle that does not last keeps growing the backoff (the storm guard)', async () => {
    // The signal that always arrives. A slow-consumer cut sends close code 4408, but that frame
    // queues BEHIND the megabyte of backlog that caused it, so a genuinely stalled peer sees a bare
    // 1006 — the code-based floor is unreachable exactly when it is needed. "It did not last" is
    // observable without any cooperation from the server.
    const s = makeSocket()
    s.start()
    await flushMicrotasks()
    // three open-then-immediately-drop cycles: delays must keep doubling, not stay at the base
    for (const delay of [1_000, 2_000, 4_000]) {
      FakeWebSocket.instances.at(-1)!.open()
      FakeWebSocket.instances.at(-1)!.serverDrop() // never reaches the stability window
      const before = FakeWebSocket.instances.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(FakeWebSocket.instances.length).toBe(before)
      await vi.advanceTimersByTimeAsync(1)
      await flushMicrotasks()
      expect(FakeWebSocket.instances.length).toBe(before + 1)
    }
    s.stop()
  })

  it('a slow-consumer cut (4408) does NOT retry at the base delay — that would be a reconnect storm', async () => {
    // The gateway cuts a socket whose server-side send buffer ran away. `attempts` was zeroed by
    // the successful open, so without this the client reconnects ~1 s later, re-subscribes to the
    // same feed, re-buffers and gets cut again — a ~1 Hz loop of ticket + upgrade + fanout, aimed
    // at an API that is already under memory pressure. The accrued backoff must survive the cut.
    const s = makeSocket()
    s.start()
    await flushMicrotasks()
    FakeWebSocket.instances.at(-1)!.open() // a genuinely successful connection…
    FakeWebSocket.instances.at(-1)!.serverDrop(4408) // …then cut as a slow consumer
    const count = FakeWebSocket.instances.length
    await vi.advanceTimersByTimeAsync(2_000) // well past the 1 s base delay
    await flushMicrotasks()
    expect(FakeWebSocket.instances.length).toBe(count) // still waiting
    await vi.advanceTimersByTimeAsync(16_000) // 1s·2^4 floor
    await flushMicrotasks()
    expect(FakeWebSocket.instances.length).toBe(count + 1)
    s.stop()
  })

  it('an ordinary drop still retries fast — only 4408 keeps the accrued backoff', async () => {
    const s = makeSocket()
    s.start()
    await flushMicrotasks()
    FakeWebSocket.instances.at(-1)!.open()
    FakeWebSocket.instances.at(-1)!.serverDrop(1006) // abnormal closure: a network blip
    const count = FakeWebSocket.instances.length
    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    expect(FakeWebSocket.instances.length).toBe(count + 1)
    s.stop()
  })

  it('caps the delay at maxDelayMs', async () => {
    const s = makeSocket({ baseDelayMs: 1_000, maxDelayMs: 4_000 })
    s.start()
    await flushMicrotasks()
    for (const delay of [1_000, 2_000, 4_000, 4_000, 4_000]) {
      FakeWebSocket.instances.at(-1)!.serverDrop()
      await vi.advanceTimersByTimeAsync(delay)
      await flushMicrotasks()
    }
    expect(FakeWebSocket.instances.length).toBe(6)
    s.stop()
  })

  it('jitter stays within ±20%', async () => {
    const sLow = makeSocket({ random: () => 0 }) // factor 0.8
    sLow.start()
    await flushMicrotasks()
    FakeWebSocket.instances.at(-1)!.serverDrop()
    await vi.advanceTimersByTimeAsync(799)
    expect(FakeWebSocket.instances.length).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushMicrotasks()
    expect(FakeWebSocket.instances.length).toBe(2)
    sLow.stop()
  })

  it('stop() closes an open socket and never reconnects', async () => {
    const s = makeSocket()
    s.start()
    await flushMicrotasks()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    s.stop()
    expect(ws.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances.length).toBe(1)
  })

  it('stop() during the backoff wait cancels the pending reconnect', async () => {
    const s = makeSocket()
    s.start()
    await flushMicrotasks()
    FakeWebSocket.instances[0]!.serverDrop() // schedules reconnect in 1 s
    s.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances.length).toBe(1)
  })

  it('auth error from getTicket stops reconnecting and fires onAuthError', async () => {
    const onAuthError = vi.fn()
    const statuses: string[] = []
    const s = makeSocket({
      getTicket: () => Promise.reject(new Error('unauthorized')),
      isAuthError: () => true,
      onAuthError,
      onStatus: (st) => statuses.push(st),
    })
    s.start()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onAuthError).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances.length).toBe(0)
    expect(statuses.at(-1)).toBe('closed')
  })

  it('start→stop→start while a ticket is in flight opens no orphan socket (generation token)', async () => {
    const resolvers: Array<(t: string) => void> = []
    let calls = 0
    const s = new LiveSocket({
      getTicket: () => new Promise<string>((res) => { calls++; resolvers.push(res) }),
      buildUrl: (t) => `ws://x/v1/stream?ticket=${t}`,
      onMessage: () => undefined,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      random: () => 0.5,
    })
    s.start() // gen 1 — getTicket #1 in flight
    await flushMicrotasks()
    s.stop() // supersedes gen 1
    s.start() // gen 3 — getTicket #2 in flight
    await flushMicrotasks()
    expect(calls).toBe(2)
    // the STALE (superseded) ticket resolves first — it must NOT construct a socket
    resolvers[0]!('ticket-stale')
    await flushMicrotasks()
    expect(FakeWebSocket.instances.length).toBe(0)
    // the current-generation ticket resolves — exactly one live socket, no orphan
    resolvers[1]!('ticket-live')
    await flushMicrotasks()
    expect(FakeWebSocket.instances.length).toBe(1)
    expect(FakeWebSocket.instances[0]!.url).toContain('ticket-live')
    // the stale path scheduled no reconnect loop
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances.length).toBe(1)
    s.stop()
  })

  it('an orphaned socket from a superseded generation neither reconnects nor flaps status', async () => {
    const resolvers: Array<(t: string) => void> = []
    const statuses: string[] = []
    const s = new LiveSocket({
      getTicket: () => new Promise<string>((res) => resolvers.push(res)),
      buildUrl: (t) => `ws://x/v1/stream?ticket=${t}`,
      onMessage: () => undefined,
      onStatus: (st) => statuses.push(st),
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      random: () => 0.5,
    })
    s.start()
    await flushMicrotasks()
    resolvers[0]!('ticket-1') // gen-1 socket constructed + open
    await flushMicrotasks()
    FakeWebSocket.instances[0]!.open()
    s.stop() // closes the gen-1 socket and supersedes it
    s.start() // gen 3
    await flushMicrotasks()
    resolvers[1]!('ticket-2')
    await flushMicrotasks()
    const before = FakeWebSocket.instances.length
    // the OLD (gen-1) socket dropping late must not schedule a reconnect
    FakeWebSocket.instances[0]!.serverDrop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances.length).toBe(before)
    s.stop()
  })

  it('non-auth ticket failure keeps retrying', async () => {
    let calls = 0
    const s = makeSocket({
      getTicket: () => {
        calls++
        return calls < 3 ? Promise.reject(new Error('503')) : Promise.resolve('ticket-ok')
      },
      isAuthError: () => false,
    })
    s.start()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(2_000)
    await flushMicrotasks()
    expect(FakeWebSocket.instances.at(-1)!.url).toContain('ticket-ok')
    s.stop()
  })
})
