import { createServer, type Server } from 'node:net'
import type { Redis } from 'ioredis'

import { IpLimiter } from './limits.js'
import { IngestMetrics } from './metrics.js'
import { DeviceRegistry } from './registry.js'
import { Session, type SessionConfig } from './session.js'

export interface IngestConfig extends SessionConfig {
  maxConn: number
  maxConnPerIp: number
}

export const DEFAULT_CONFIG: IngestConfig = {
  maxConn: 20_000, // §6.7 INGEST_MAX_CONN
  maxConnPerIp: 200, // §6.7 INGEST_MAX_CONN_PER_IP
  pauseAboveDepth: 50_000, // I4
  handshakeTimeoutMs: 10_000, // §6.1
  readIdleTimeoutMs: 40 * 60_000, // §6.1 default profile
  maxFutureMs: 48 * 3600 * 1000, // §3.6 sanity window
  minTsMs: Date.UTC(2020, 0, 1),
}

export interface IngestServer {
  server: Server
  metrics: IngestMetrics
  connectionCount(): number
}

export function createIngestServer(
  redis: Redis,
  config: IngestConfig = DEFAULT_CONFIG,
): IngestServer {
  const metrics = new IngestMetrics()
  const registry = new DeviceRegistry(redis)
  const limiter = new IpLimiter(config.maxConnPerIp)
  const liveByImei = new Map<string, Session>()
  let connections = 0

  const server = createServer((socket) => {
    const ip = socket.remoteAddress ?? 'unknown'
    if (connections >= config.maxConn || !limiter.tryAcquire(ip)) {
      socket.destroy() // cap reached — refuse outright (§6.1 anti-abuse)
      return
    }
    connections++
    socket.once('close', () => {
      connections--
      limiter.release(ip)
    })

    const session = new Session(socket, {
      redis,
      registry,
      metrics,
      config,
      onAuthenticated: (imei, s) => {
        // duplicate IMEI: newest wins, old socket closed (E01-5 edge case —
        // matches device reconnect behaviour after network flaps)
        const prior = liveByImei.get(imei)
        if (prior && prior !== s) prior.destroy()
        liveByImei.set(imei, s)
        socket.once('close', () => {
          if (liveByImei.get(imei) === s) liveByImei.delete(imei)
        })
      },
    })
    void session
  })

  return { server, metrics, connectionCount: () => connections }
}
