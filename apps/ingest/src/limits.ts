/**
 * Per-IP live connection accounting (PROJECT_PLAN §6.1: per-IP conn cap, default 200).
 * Pure in-memory — one ingest process owns its sockets.
 */
export class IpLimiter {
  private readonly counts = new Map<string, number>()

  constructor(private readonly maxPerIp: number) {}

  /** Returns false when the IP is at its cap (caller refuses the connection). */
  tryAcquire(ip: string): boolean {
    const current = this.counts.get(ip) ?? 0
    if (current >= this.maxPerIp) return false
    this.counts.set(ip, current + 1)
    return true
  }

  release(ip: string): void {
    const current = this.counts.get(ip) ?? 0
    if (current <= 1) this.counts.delete(ip)
    else this.counts.set(ip, current - 1)
  }

  activeFor(ip: string): number {
    return this.counts.get(ip) ?? 0
  }
}

/**
 * Per-IP handshake rate limiter (§6.1 security posture: handshake rate-limit).
 * Sliding one-minute window; over-limit connections are destroyed before any
 * Redis work, so IMEI-spoof churn cannot grind CPU or grow quarantine state.
 *
 * On TCP the source IP is validated by the 3-way handshake, so the key space is bounded by real
 * peers. On UDP (ADR-027) the source is spoofable, so two extra bounds keep the key map finite:
 * a hard `maxTrackedIps` cap (refuse NEW ips once full — existing devices keep working) and a
 * caller-driven `sweep()` that drops windows with no activity in the last minute.
 */
export class HandshakeRateLimiter {
  private readonly windows = new Map<string, number[]>()

  constructor(
    private readonly maxPerMinute: number,
    private readonly now: () => number = Date.now,
    private readonly maxTrackedIps = 200_000,
  ) {}

  allow(ip: string): boolean {
    const cutoff = this.now() - 60_000
    const times = (this.windows.get(ip) ?? []).filter((t) => t > cutoff)
    if (times.length >= this.maxPerMinute) {
      this.windows.set(ip, times)
      return false
    }
    // spoofed-source flood guard: never allocate a new key once the map is full
    if (!this.windows.has(ip) && this.windows.size >= this.maxTrackedIps) return false
    times.push(this.now())
    this.windows.set(ip, times)
    return true
  }

  /** Drop windows with no activity in the last minute (bounds steady-state memory). */
  sweep(): void {
    const cutoff = this.now() - 60_000
    for (const [ip, times] of this.windows) {
      if (times.every((t) => t <= cutoff)) this.windows.delete(ip)
    }
  }
}

/**
 * Global fixed-window datagram ceiling (ADR-027). The PRIMARY UDP flood defense: source IPs are
 * spoofable, so a per-IP limiter alone can be both bypassed (each spoofed IP gets a fresh window)
 * and grown; a global cap bounds total datagrams processed per second regardless of source, so the
 * parse/Redis work behind it is bounded. TCP does not use this (its per-IP guard suffices).
 */
export class GlobalRateLimiter {
  private windowSec = 0
  private count = 0

  constructor(
    private readonly maxPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(): boolean {
    const sec = Math.floor(this.now() / 1000)
    if (sec !== this.windowSec) {
      this.windowSec = sec
      this.count = 0
    }
    if (this.count >= this.maxPerSecond) return false
    this.count++
    return true
  }
}
