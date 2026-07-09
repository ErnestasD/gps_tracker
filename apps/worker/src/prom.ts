import { createServer, type Server } from 'node:http'
import type { Redis } from 'ioredis'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'

import { SHARD_COUNT } from './shards.js'

/**
 * Prometheus exposition for the worker (E02-5). Frozen names per Appendix A:
 * stream_depth{shard}, pipeline_lag_ms, pipeline_batch_rows. E04-1 adds
 * trips_opened_total / trips_closed_total.
 */
export interface WorkerProm {
  registry: Registry
  batchRows: Histogram
  /** Call per processed batch with now − max(fix_time) of the batch. */
  setLagMs: (ms: number) => void
  tripsOpened: Counter
  tripsClosed: Counter
  tripPersistErrors: Counter
  tripRecomputes: Counter
  tripRecomputeDeleted: Counter
  geofenceEvents: Counter
  ruleEvents: Counter
  server: Server
}

export function startWorkerProm(redis: Redis, port: number): WorkerProm {
  const registry = new Registry()

  new Gauge({
    name: 'stream_depth',
    help: 'raw:{shard} XLEN',
    labelNames: ['shard'],
    registers: [registry],
    async collect() {
      const pipe = redis.pipeline()
      for (let s = 0; s < SHARD_COUNT; s++) pipe.xlen(`raw:${s}`)
      const res = await pipe.exec()
      res?.forEach((r, s) => {
        if (r[0] === null) this.set({ shard: String(s) }, Number(r[1]))
      })
    },
  })

  const lag = new Gauge({
    name: 'pipeline_lag_ms',
    help: 'now − max(fix_time) of the last processed batch (Grafana derives p95)',
    registers: [registry],
  })

  const batchRows = new Histogram({
    name: 'pipeline_batch_rows',
    help: 'rows per INSERT batch',
    buckets: [1, 10, 50, 100, 200, 500],
    registers: [registry],
  })

  const tripsOpened = new Counter({ name: 'trips_opened_total', help: 'trips opened by the state machine (E04-1)', registers: [registry] })
  const tripsClosed = new Counter({ name: 'trips_closed_total', help: 'trips closed by the state machine (E04-1)', registers: [registry] })
  // streaming trip persistence is advisory (E04-2 recompute is authoritative); a
  // non-zero rate here means trips are being dropped from the stream path → alert.
  const tripPersistErrors = new Counter({ name: 'trip_persist_errors_total', help: 'trip open/close DB writes that failed (advisory; E04-2 recompute reconciles)', registers: [registry] })
  const tripRecomputes = new Counter({ name: 'trip_recompute_total', help: 'trip-recompute jobs applied (E04-2 late-batch reconciliation)', registers: [registry] })
  const tripRecomputeDeleted = new Counter({ name: 'trip_recompute_deleted_total', help: 'trip rows deleted-and-replayed by recompute', registers: [registry] })
  const geofenceEvents = new Counter({ name: 'geofence_events_total', help: 'geofence enter/exit transition events written (E05-2)', registers: [registry] })
  const ruleEvents = new Counter({ name: 'rule_events_total', help: 'rule events written by kind (E05-4)', labelNames: ['kind'], registers: [registry] })

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
  return { registry, batchRows, setLagMs: (ms) => lag.set(ms), tripsOpened, tripsClosed, tripPersistErrors, tripRecomputes, tripRecomputeDeleted, geofenceEvents, ruleEvents, server }
}
