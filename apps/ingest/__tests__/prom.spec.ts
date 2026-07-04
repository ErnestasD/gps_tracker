import { describe, expect, it } from 'vitest'

import { IngestMetrics } from '../src/metrics.js'
import { startIngestProm } from '../src/prom.js'

describe('E02-5 ingest metrics exposition (frozen names)', () => {
  it('serves every frozen metric name over /metrics', async () => {
    const metrics = new IngestMetrics()
    metrics.msgsTotal = 7
    metrics.parseFailTotal = 2
    metrics.pausedSockets = 1
    const prom = startIngestProm(metrics, 0)
    prom.ackLatencyMs.observe(12)
    const port = (prom.server.address() as { port: number }).port
    const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text()
    prom.server.close()

    for (const name of [
      'ingest_msgs_total',
      'ingest_parse_fail_total',
      'ingest_frame_violations_total',
      'ingest_paused_sockets',
      'ack_latency_ms_bucket',
    ]) {
      expect(body, name).toContain(name)
    }
    expect(body).toMatch(/ingest_msgs_total 7/)
    expect(body).toMatch(/ingest_parse_fail_total 2/)
    expect(body).toMatch(/ingest_paused_sockets 1/)
  })
})
