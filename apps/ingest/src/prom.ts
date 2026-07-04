import { createServer, type Server } from 'node:http'
import { Gauge, Histogram, Registry } from 'prom-client'

import type { IngestMetrics } from './metrics.js'

/**
 * Prometheus exposition for ingest (E02-5). Metric NAMES are frozen —
 * Appendix A: renaming requires an ADR.
 */
export interface IngestProm {
  registry: Registry
  ackLatencyMs: Histogram
  server: Server
}

export function startIngestProm(metrics: IngestMetrics, port: number): IngestProm {
  const registry = new Registry()

  const reflect = (name: string, help: string, read: () => number): void => {
    new Gauge({
      name,
      help,
      registers: [registry],
      collect() {
        this.set(read())
      },
    })
  }
  // totals as monotonic gauges reflecting in-process counters (ADR-017 note)
  reflect('ingest_msgs_total', 'AVL packets received', () => metrics.msgsTotal)
  reflect('ingest_parse_fail_total', 'packets failing CRC/structure', () => metrics.parseFailTotal)
  reflect(
    'ingest_frame_violations_total',
    'framing violations (oversize/garbage)',
    () => metrics.frameViolationsTotal,
  )
  reflect('ingest_acked_records_total', 'records ACKed after XADD', () => metrics.ackedRecordsTotal)
  reflect('ingest_rejected_imei_total', 'unknown-IMEI rejects', () => metrics.rejectedImeiTotal)
  reflect('ingest_sanity_rejects_total', 'records failing §3.6 sanity', () => metrics.sanityRejectsTotal)
  reflect('ingest_paused_sockets', 'sockets paused by I4 backpressure', () => metrics.pausedSockets)

  const ackLatencyMs = new Histogram({
    name: 'ack_latency_ms',
    help: 'packet arrival to ACK write, ms',
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    registers: [registry],
  })

  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end()
      return
    }
    registry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'content-type': registry.contentType }).end(body)
      })
      .catch(() => res.writeHead(500).end())
  })
  server.on('error', (err) => {
    // metrics must NEVER take down the data plane (e.g. EADDRINUSE on co-located workers)
    console.error('metrics listener failed', err)
  })
  server.listen(port)
  return { registry, ackLatencyMs, server }
}
