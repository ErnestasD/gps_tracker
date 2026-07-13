import { describe, expect, it } from 'vitest'

import { p99FromBuckets, parseAckLatencyBuckets, quantileFromBuckets, readMetric, type Bucket } from '../src/histogram.js'

const B = (le: number, count: number): Bucket => ({ le, count })

describe('W7-S3 quantileFromBuckets (pure)', () => {
  it('interpolates within the bucket holding the target rank', () => {
    // 100 obs: 90 ≤ 100ms, 100 ≤ 250ms. p99 rank = 99 → in the (100,250] bucket,
    // 9/10 of the way through → 100 + 0.9*150 = 235ms
    const buckets = [B(1, 0), B(50, 0), B(100, 90), B(250, 100), B(Number.POSITIVE_INFINITY, 100)]
    const r = p99FromBuckets(buckets)
    expect(r.saturated).toBe(false)
    expect(r.value).toBeCloseTo(235, 5)
  })

  it('p50 lands mid-bucket', () => {
    const buckets = [B(10, 0), B(100, 100), B(Number.POSITIVE_INFINITY, 100)]
    expect(quantileFromBuckets(buckets, 0.5).value).toBeCloseTo(10 + 0.5 * 90, 5)
  })

  it('flags saturation when the quantile is in the +Inf overflow bucket', () => {
    // 100 obs, only 98 ≤ 1000ms, 2 above → p99 rank 99 is in +Inf
    const buckets = [B(250, 50), B(1000, 98), B(Number.POSITIVE_INFINITY, 100)]
    const r = p99FromBuckets(buckets)
    expect(r.saturated).toBe(true)
    expect(r.value).toBe(1000) // last finite edge = lower bound
  })

  it('empty histogram → 0, not NaN', () => {
    expect(p99FromBuckets([]).value).toBe(0)
    expect(p99FromBuckets([B(1, 0), B(Number.POSITIVE_INFINITY, 0)]).value).toBe(0)
  })
})

describe('W7-S3 metrics parsing (pure)', () => {
  it('extracts ack_latency buckets incl. +Inf', () => {
    const text = [
      'ack_latency_ms_bucket{le="1"} 10',
      'ack_latency_ms_bucket{le="250"} 990',
      'ack_latency_ms_bucket{le="+Inf"} 1000',
      'ack_latency_ms_sum 12345',
    ].join('\n')
    const b = parseAckLatencyBuckets(text)
    expect(b).toHaveLength(3)
    expect(b[2]!.le).toBe(Number.POSITIVE_INFINITY)
    expect(p99FromBuckets(b).value).toBeCloseTo(1 + (0.99 * 1000 - 10) / 980 * 249, 0)
  })

  it('reads plain and labelled metric values', () => {
    expect(readMetric('ingest_msgs_total 900000', 'ingest_msgs_total')).toBe(900000)
    expect(readMetric('ingest_acked_records_total{a="b"} 42', 'ingest_acked_records_total')).toBe(42)
    expect(readMetric('other 1', 'ingest_msgs_total')).toBeNull()
  })
})
