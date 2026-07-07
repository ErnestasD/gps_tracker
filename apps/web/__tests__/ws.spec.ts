import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LiveSocket } from '../src/lib/ws.js'

/** Controllable WebSocket double. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  close(): void {
    this.closed = true
    this.onclose?.()
  }
  open(): void {
    this.onopen?.()
  }
  serverDrop(): void {
    this.onclose?.()
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
    // success resets the counter → next failure waits base delay again
    FakeWebSocket.instances.at(-1)!.open()
    FakeWebSocket.instances.at(-1)!.serverDrop()
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
