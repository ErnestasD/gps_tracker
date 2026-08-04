import { describe, expect, it } from 'vitest'

import { GlobalRateLimiter, HandshakeRateLimiter, IpLimiter } from '../src/limits.js'

describe('HandshakeRateLimiter (§6.1 per-IP handshake/datagram budget)', () => {
  const clock = (start = 1_700_000_000_000) => {
    let t = start
    return { now: () => t, advance: (ms: number) => (t += ms) }
  }

  it('allows up to the budget, then refuses — without growing state per rejected packet', () => {
    // REGRESSION (audit high): the window was a timestamp ARRAY re-filtered on every call, including
    // the reject path. At the UDP default (6000/ip/min) one spoofed-source flood cost 6000 comparisons
    // plus a fresh 6000-element allocation PER DATAGRAM — the guard amplified the attack it existed to
    // stop. The counter below is O(1) and allocation-free whether the packet is allowed or refused.
    const c = clock()
    const rl = new HandshakeRateLimiter(5, c.now)
    for (let i = 0; i < 5; i++) expect(rl.allow('1.2.3.4')).toBe(true)
    for (let i = 0; i < 1000; i++) expect(rl.allow('1.2.3.4')).toBe(false)
    expect(rl.allow('5.6.7.8')).toBe(true) // per-IP, not global
  })

  it('the budget refills as the window slides, not all at once', () => {
    const c = clock(1_700_000_000_000 - (1_700_000_000_000 % 60_000)) // minute boundary
    const rl = new HandshakeRateLimiter(10, c.now)
    for (let i = 0; i < 10; i++) expect(rl.allow('1.2.3.4')).toBe(true)
    expect(rl.allow('1.2.3.4')).toBe(false)

    c.advance(60_000) // new bucket, but the previous minute still weighs ~fully
    expect(rl.allow('1.2.3.4')).toBe(false)
    c.advance(30_000) // half decayed: 10 * 0.5 = 5 used, 5 free
    for (let i = 0; i < 5; i++) expect(rl.allow('1.2.3.4')).toBe(true)
    expect(rl.allow('1.2.3.4')).toBe(false)

    c.advance(60_000) // fully past the old traffic
    expect(rl.allow('1.2.3.4')).toBe(true)
  })

  it('refuses NEW ips once the tracked-IP cap is hit; existing ones keep working', () => {
    // UDP sources are spoofable (ADR-027), so the key map itself is an attack surface.
    const c = clock()
    const rl = new HandshakeRateLimiter(100, c.now, 2)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('b')).toBe(true)
    expect(rl.allow('c')).toBe(false) // map full — new key refused
    expect(rl.allow('a')).toBe(true) // real device unaffected
  })

  it('sweep() drops idle windows but keeps ones still inside the trailing minute', () => {
    const c = clock()
    const rl = new HandshakeRateLimiter(1, c.now, 2)
    expect(rl.allow('idle')).toBe(true)
    c.advance(121_000)
    expect(rl.allow('fresh')).toBe(true)
    rl.sweep()
    expect(rl.allow('newcomer')).toBe(true) // 'idle' was evicted, so there is room again
    expect(rl.allow('fresh')).toBe(false) // still budgeted, so it survived the sweep
  })
})

describe('IpLimiter + GlobalRateLimiter', () => {
  it('IpLimiter caps live connections and releases cleanly', () => {
    const l = new IpLimiter(2)
    expect(l.tryAcquire('ip')).toBe(true)
    expect(l.tryAcquire('ip')).toBe(true)
    expect(l.tryAcquire('ip')).toBe(false)
    l.release('ip')
    expect(l.activeFor('ip')).toBe(1)
    l.release('ip')
    expect(l.activeFor('ip')).toBe(0) // key deleted, not left at 0
  })

  it('GlobalRateLimiter bounds datagrams per second regardless of source', () => {
    let t = 1_700_000_000_000
    const g = new GlobalRateLimiter(3, () => t)
    expect([g.allow(), g.allow(), g.allow(), g.allow()]).toEqual([true, true, true, false])
    t += 1_000
    expect(g.allow()).toBe(true)
  })
})
