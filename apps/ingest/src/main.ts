import { Redis } from 'ioredis'

import { startIngestProm } from './prom.js'
import { createIngestServer, DEFAULT_CONFIG } from './server.js'
import { createIngestUdpServer } from './udp.js'

// Env contract per PROJECT_PLAN §6.7 — new vars only there + README table.
const port = Number(process.env['INGEST_TCP_PORT'] ?? 5027)
// UDP shares the TCP port by default (a device is configured for ONE port + protocol); override
// or disable via INGEST_UDP_PORT (set to 0 to turn the UDP channel off entirely).
const udpPort = Number(process.env['INGEST_UDP_PORT'] ?? port)
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
const promPort = Number(process.env['PROMETHEUS_PORT'] ?? 9101) // §6.7
const preMetricsHolder: { hist?: (ms: number) => void } = {}
const config = {
  ...DEFAULT_CONFIG,
  maxConn: Number(process.env['INGEST_MAX_CONN'] ?? DEFAULT_CONFIG.maxConn),
  maxConnPerIp: Number(process.env['INGEST_MAX_CONN_PER_IP'] ?? DEFAULT_CONFIG.maxConnPerIp),
}
const { server, metrics } = createIngestServer(redis, config, (ms) => preMetricsHolder.hist?.(ms))
const prom = startIngestProm(metrics, promPort)
preMetricsHolder.hist = (ms) => prom.ackLatencyMs.observe(ms)

server.listen(port, () => {
  console.log(`orbetra ingest listening on tcp:${port}`)
})

// UDP channel (shares the metrics instance so counters aggregate both transports)
const udp =
  udpPort > 0
    ? createIngestUdpServer(
        redis,
        metrics,
        {
          ...config,
          maxDatagramsPerIpPerMin: Number(process.env['INGEST_UDP_MAX_DGRAMS_PER_IP_PER_MIN'] ?? 6000),
          maxDatagramsPerSec: Number(process.env['INGEST_UDP_MAX_DGRAMS_PER_SEC'] ?? 50_000),
        },
        (ms) => preMetricsHolder.hist?.(ms),
      )
    : null
udp?.socket.bind(udpPort, () => console.log(`orbetra ingest listening on udp:${udpPort}`))

// Graceful drain (PROJECT_PLAN §6.1 deploy protocol): stop accepting, let in-flight
// parse→XADD→ACK finish (sessions self-terminate on idle), then exit.
process.on('SIGTERM', () => {
  void (udp?.close() ?? Promise.resolve()).finally(() => {
    server.close(() => {
      void redis.quit().then(() => process.exit(0))
    })
  })
  setTimeout(() => process.exit(0), 10_000).unref() // 10 s grace
})

setInterval(() => {
  console.log(
    JSON.stringify({
      msgs: metrics.msgsTotal,
      acked: metrics.ackedRecordsTotal,
      parseFail: metrics.parseFailTotal,
      frameViolations: metrics.frameViolationsTotal,
      paused: metrics.pausedSockets,
    }),
  )
}, 60_000).unref()
