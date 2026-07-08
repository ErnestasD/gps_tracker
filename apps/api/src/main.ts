import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Redis } from 'ioredis'

import { createDb, createPool } from '@orbetra/db'

import { createApiProm, createApp } from './app.js'
import { attachWsGateway } from './ws.js'

// Env contract per PROJECT_PLAN §6.7 (E03-1: real auth — the E02-4 stub is gone).
const port = Number(process.env['API_PORT'] ?? 3010)
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
const jwtSecret = process.env['JWT_SECRET'] ?? ''
const databaseUrl = process.env['DATABASE_URL'] ?? ''

if (jwtSecret.length < 32) {
  console.error('JWT_SECRET is required (min 32 chars)')
  process.exit(2)
}
if (!databaseUrl) {
  console.error('DATABASE_URL is required (auth reads users/refresh tokens)')
  process.exit(2)
}

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
const redisSub = redis.duplicate()
const db = createDb(databaseUrl)
const pool = createPool(databaseUrl) // raw-SQL positions history reads (E04-3)
const prom = createApiProm()

const deps = {
  redis,
  redisSub,
  db,
  pool,
  jwtSecret,
  jwtTtlS: Number(process.env['JWT_TTL'] ?? 900),
  refreshTtlS: Number(process.env['REFRESH_TTL'] ?? 1_209_600),
  ticketTtlS: Number(process.env['WS_TICKET_TTL'] ?? 30),
  lockout: {
    maxFails: Number(process.env['LOCKOUT_MAX_FAILS'] ?? 5),
    windowS: Number(process.env['LOCKOUT_WINDOW_S'] ?? 900),
  },
  // Caddy on-demand-TLS ask throttle per source IP (E03-5); DNS TXT verify uses
  // the real resolver by default (no env — tests inject a mock).
  askRateLimit: {
    max: Number(process.env['ASK_RATE_MAX'] ?? 10),
    windowS: Number(process.env['ASK_RATE_WINDOW_S'] ?? 60),
  },
  // Secure cookies DEFAULT ON — only an explicit dev opt-out disables them
  // (a prod box with NODE_ENV unset must still ship Secure)
  secureCookies: process.env['COOKIE_SECURE'] !== '0',
  trustProxy: process.env['TRUST_PROXY'] === '1',
  getRemoteAddr: (c: unknown) =>
    getConnInfo(c as Parameters<typeof getConnInfo>[0]).remote.address ?? '0.0.0.0',
}

const app = createApp(deps, prom)

const httpServer = serve({ fetch: app.fetch, port, createServer }) as ReturnType<typeof createServer>
attachWsGateway(httpServer, deps, (n) => prom.setWsClients(n))
console.log(`orbetra api listening on :${port} (auth live, ws_clients metric live)`)

process.on('SIGTERM', () => {
  httpServer.close(() => {
    void redis
      .quit()
      .then(() => redisSub.quit())
      .then(() => pool.end())
      .then(() => db.$disconnect())
      .then(() => process.exit(0))
  })
  setTimeout(() => process.exit(0), 5_000).unref()
})
