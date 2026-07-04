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
 */
export class HandshakeRateLimiter {
  private readonly windows = new Map<string, number[]>()

  constructor(
    private readonly maxPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(ip: string): boolean {
    const cutoff = this.now() - 60_000
    const times = (this.windows.get(ip) ?? []).filter((t) => t > cutoff)
    if (times.length >= this.maxPerMinute) {
      this.windows.set(ip, times)
      return false
    }
    times.push(this.now())
    this.windows.set(ip, times)
    return true
  }
}
