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
