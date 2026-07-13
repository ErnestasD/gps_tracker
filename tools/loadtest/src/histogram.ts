/**
 * Prometheus histogram → quantile (W7-S3 load gate). `ack_latency_ms` is a cumulative
 * histogram: each bucket `le=b` holds the count of observations ≤ b. We linear-interpolate
 * within the bucket that contains the target rank — the same method Prometheus's
 * histogram_quantile uses — so p99 from [1,5,…,1000,+Inf] buckets is a real estimate, not
 * a bucket-edge lie. PURE + unit-tested.
 */
export interface Bucket {
  le: number // upper bound (+Inf → Number.POSITIVE_INFINITY)
  count: number // CUMULATIVE count of observations ≤ le
}

export interface QuantileResult {
  value: number
  /** true when the quantile falls in the +Inf bucket — value is only a lower bound. */
  saturated: boolean
}

/** q in (0,1). Buckets must be sorted ascending by le and cumulative. */
export function quantileFromBuckets(buckets: readonly Bucket[], q: number): QuantileResult {
  const sorted = [...buckets].sort((a, b) => a.le - b.le)
  const total = sorted.length > 0 ? sorted[sorted.length - 1]!.count : 0
  if (total === 0) return { value: 0, saturated: false }
  const rank = q * total

  let prevLe = 0
  let prevCount = 0
  for (const b of sorted) {
    if (b.count >= rank) {
      if (!Number.isFinite(b.le)) {
        // target is in the overflow bucket — return the last finite edge as a lower bound
        return { value: prevLe, saturated: true }
      }
      // linear interpolation within [prevLe, b.le] over the bucket's own count share
      const inBucket = b.count - prevCount
      const frac = inBucket > 0 ? (rank - prevCount) / inBucket : 0
      return { value: prevLe + frac * (b.le - prevLe), saturated: false }
    }
    prevLe = b.le
    prevCount = b.count
  }
  return { value: prevLe, saturated: false }
}

export const p99FromBuckets = (buckets: readonly Bucket[]): QuantileResult => quantileFromBuckets(buckets, 0.99)

/** Parse `ack_latency_ms_bucket{le="250"} 1234` lines from a Prometheus /metrics dump. */
export function parseAckLatencyBuckets(metricsText: string): Bucket[] {
  const out: Bucket[] = []
  for (const line of metricsText.split('\n')) {
    const m = /^ack_latency_ms_bucket\{le="([^"]+)"\}\s+([0-9.e+]+)/.exec(line.trim())
    if (m) out.push({ le: m[1] === '+Inf' ? Number.POSITIVE_INFINITY : Number(m[1]), count: Number(m[2]) })
  }
  return out
}

/** Read a single gauge/counter value like `ingest_msgs_total 900000`. */
export function readMetric(metricsText: string, name: string): number | null {
  for (const line of metricsText.split('\n')) {
    const m = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.e+-]+)`).exec(line.trim())
    if (m) return Number(m[1])
  }
  return null
}
