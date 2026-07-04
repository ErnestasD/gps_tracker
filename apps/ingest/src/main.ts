import { Redis } from 'ioredis'

import { createIngestServer, DEFAULT_CONFIG } from './server.js'

// Env contract per PROJECT_PLAN §6.7 — new vars only there + README table.
const port = Number(process.env['INGEST_TCP_PORT'] ?? 5027)
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
const { server, metrics } = createIngestServer(redis, {
  ...DEFAULT_CONFIG,
  maxConn: Number(process.env['INGEST_MAX_CONN'] ?? DEFAULT_CONFIG.maxConn),
  maxConnPerIp: Number(process.env['INGEST_MAX_CONN_PER_IP'] ?? DEFAULT_CONFIG.maxConnPerIp),
})

server.listen(port, () => {
  console.log(`orbetra ingest listening on :${port}`)
})

// Graceful drain (PROJECT_PLAN §6.1 deploy protocol): stop accepting, let in-flight
// parse→XADD→ACK finish (sessions self-terminate on idle), then exit.
process.on('SIGTERM', () => {
  server.close(() => {
    void redis.quit().then(() => process.exit(0))
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
