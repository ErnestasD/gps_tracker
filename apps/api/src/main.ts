import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'

import { createApiProm, createApp } from './app.js'
import { attachWsGateway } from './ws.js'

// Env contract per PROJECT_PLAN §6.7. AUTH IS THE E03-1 STUB (single token) —
// E03-1 replaces it with argon2id + JWT and deletes AuthStub.
const port = Number(process.env['API_PORT'] ?? 3010)
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379'
const stubToken = process.env['STUB_AUTH_TOKEN'] ?? ''

if (!stubToken) {
  console.error('STUB_AUTH_TOKEN required until E03-1 lands real auth')
  process.exit(2)
}

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
const redisSub = redis.duplicate()
const deps = { redis, redisSub }
const prom = createApiProm()
const app = createApp(deps, {
  token: stubToken,
  ctx: {
    userId: process.env['STUB_USER_ID'] ?? 'stub-user',
    tenantId: process.env['STUB_TENANT_ID'] ?? 'stub-tenant',
  },
}, prom)

const httpServer = serve({ fetch: app.fetch, port, createServer }) as ReturnType<typeof createServer>
attachWsGateway(httpServer, deps, (n) => prom.setWsClients(n))
console.log(`orbetra api listening on :${port} (ws_clients metric live)`)

process.on('SIGTERM', () => {
  httpServer.close(() => {
    void redis.quit().then(() => redisSub.quit()).then(() => process.exit(0))
  })
  setTimeout(() => process.exit(0), 5_000).unref()
})
