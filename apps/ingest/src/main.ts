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

/**
 * `enableOfflineQueue: false` — the same root fix apps/api took, applied to the connection where it
 * matters most and never got.
 *
 * With the default (true) plus `maxRetriesPerRequest: null`, a DISCONNECTED Redis makes every
 * command WAIT in an uncapped in-memory queue instead of rejecting. On the API that produced a
 * credential oracle; here it is an out-of-memory kill. Measured against a dead Redis: every device
 * reconnect queues a `registry.lookup` that never resolves and is never cancelled when the
 * handshake timer destroys the socket ~6.3 KB retained per attempt, perfectly linear. A
 * 5 000-device fleet reconnecting every 15 s is ~2 MB/s — roughly 7 GB/hour, so Node's default heap
 * is gone in about half an hour of a Redis outage, and `maxConn` does not bound it because a closed
 * socket frees a slot that immediately strands another lookup.
 *
 * Rejecting immediately is also what this process already wants: the ingest path is deliberately
 * fail-CLOSED (a lookup rejection destroys the socket without an ACK, so the device buffers and
 * re-sends). The only behaviour that changes during an outage is that it fails in milliseconds
 * instead of accumulating.
 *
 * `commandTimeout` covers the other half: a command issued while the socket is still considered
 * healthy but the server has stopped answering would otherwise hang forever, which is the same leak
 * through a different door.
 */
const REDIS_COMMAND_TIMEOUT_MS = Number(process.env['REDIS_COMMAND_TIMEOUT_MS'] ?? 5_000)
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
})
const promPort = Number(process.env['PROMETHEUS_PORT'] ?? 9101) // §6.7
const preMetricsHolder: { hist?: (ms: number) => void } = {}
const config = {
  ...DEFAULT_CONFIG,
  maxConn: Number(process.env['INGEST_MAX_CONN'] ?? DEFAULT_CONFIG.maxConn),
  maxConnPerIp: Number(process.env['INGEST_MAX_CONN_PER_IP'] ?? DEFAULT_CONFIG.maxConnPerIp),
}
/** IMEIs already named in a parse-failure log — see the note at the call site. */
const warnedParseFail = new Set<string>()
const warnParseFail = (imei: string, reason: string): void => {
  if (warnedParseFail.has(imei)) return
  warnedParseFail.add(imei)
  console.warn('ingest: packet rejected (first for this device)', JSON.stringify({ imei, reason }))
}

const { server, metrics } = createIngestServer(
  redis,
  config,
  (ms) => preMetricsHolder.hist?.(ms),
  // NAMED, not just counted. `ParseFailSpike` fires on a rate; the failure that actually costs data
  // is one device stuck resending bytes we will never accept, and until now nothing said which. The
  // IMEI is not a secret here (rule 12 is about credentials, and session.ts already logs it), but
  // container stdout has neither a retention window nor a GDPR erase path, which is the second
  // reason to say it ONCE.
  //
  // Once per device per process lifetime — the same shape as the worker's clock-skew warning. A
  // wedged device resends forever, so printing per packet turns "name the device" into a log flood
  // at exactly the rate the alert is trying to describe. The counter carries the rate; this line
  // carries the identity, and the identity does not change.
  warnParseFail,
)
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
        warnParseFail, // same dedupe set as TCP: one device, one line, whichever transport it uses
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
