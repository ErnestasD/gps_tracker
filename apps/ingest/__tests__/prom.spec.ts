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

  /**
   * EVERY counter on IngestMetrics must reach /metrics.
   *
   * Two of them did not, for four months: `udpInflightDropsTotal` and `sessionErrorsTotal` were
   * incremented on real loss paths and had no `reflect()` line. It was confirmed twice by the
   * 2026-08-04 audit (#80) and never entered the remediation tracker — a finding can be found
   * repeatedly and still not be fixed, so this asserts the property instead of the two names.
   *
   * Derived from the object's own fields rather than a list, so the next counter someone adds is
   * covered the moment it exists. A new field with no exposition fails here, at the commit that
   * introduces it, instead of during the outage it was meant to explain.
   */
  it('exports EVERY counter the ingest tracks — a field with no exposition is a blind spot', async () => {
    const metrics = new IngestMetrics()
    // distinct non-zero values so a name that is exported but wired to the WRONG field is caught too
    const fields = Object.keys(metrics) as (keyof IngestMetrics)[]
    fields.forEach((f, i) => {
      metrics[f] = (i + 1) * 3
    })
    const prom = startIngestProm(metrics, 0)
    const port = (prom.server.address() as { port: number }).port
    const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text()
    prom.server.close()

    const missing = fields.filter((f, i) => {
      // the exported name is not derivable from the field name (`ackedRecordsTotal` →
      // `ingest_acked_records_total`), so match on the VALUE being present on some ingest_ line —
      // every value is unique, so a hit proves that field is exposed somewhere
      const value = (i + 1) * 3
      return !new RegExp(`^ingest_\\w+ ${value}$`, 'm').test(body)
    })
    expect(missing, `counters incremented in code but never exported: ${missing.join(', ')}`).toEqual([])
  })
})
