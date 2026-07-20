import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

import { createDb, createPool } from '@orbetra/db'

import { createApiProm, createApp } from './app.js'
import { rehydrateRegistries } from './rehydrate.js'
import { createStripeGateway, stripeConfigFromEnv } from './billing/stripe.js'
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

// GDPR job producers (E08-4, ADR-020 addendum): the api enqueues, the worker consumes.
// BullMQ wants its own connection options; jobIds dedupe double-submits.
const gdprConn = { url: redisUrl }
const gdprEraseQueue = new Queue('gdpr-erase', { connection: gdprConn })
const gdprExportQueue = new Queue('gdpr-export', { connection: gdprConn })
// removeOnFail: TRUE (review HIGH-2) — a job parked in the failed set blocks its jobId, so a
// later POST would 202 while nothing ever runs. Both jobs are idempotent; failure is already
// surfaced via gdpr_job_failed_total + logs, so dropping the corpse re-opens the retry path.
const gdpr = {
  enqueueErase: async (data: { deviceId: string; tenantId: string }): Promise<void> => {
    await gdprEraseQueue.add('erase', data, { jobId: `erase-${data.deviceId}`, attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: true })
  },
  enqueueExport: async (data: { exportId: string }): Promise<void> => {
    await gdprExportQueue.add('export', data, { jobId: `export-${data.exportId}`, attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: true })
  },
}

// Transactional auth email (ADR-031): the api enqueues the branded password-reset mail, the worker
// sends it (SES/SMTP transport lives there). No jobId — two real reset requests are distinct sends.
const authEmailQueue = new Queue('auth-email', { connection: gdprConn })
const mail = {
  enqueueResetEmail: async (job: { kind: 'password-reset'; email: string; tenantId: string; locale: string; resetUrl: string; expiresMinutes: number }): Promise<void> => {
    await authEmailQueue.add('auth-email', job, { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 500 })
  },
}

// Stripe billing (ADR-024): configured only when all three keys are present; otherwise the
// billing routes report not-configured / 503 (staging + CI run keyless).
const stripeConfig = stripeConfigFromEnv()
const stripe = stripeConfig !== null ? createStripeGateway(stripeConfig) : undefined
if (stripe === undefined) console.warn('Stripe not configured (STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_ID) — billing routes disabled')

const deps = {
  redis,
  onboarding: { host: process.env['INGEST_PUBLIC_HOST'] ?? 'orbetra.com', port: Number(process.env['INGEST_TCP_PORT'] ?? 5027) },
  ...(stripe !== undefined ? { stripe } : {}),
  ...(process.env['APP_BASE_URL'] ? { appBaseUrl: process.env['APP_BASE_URL'] } : {}),
  ...(process.env['VAPID_PUBLIC_KEY'] ? { vapidPublicKey: process.env['VAPID_PUBLIC_KEY'] } : {}),
  // OSRM route optimization (ADR-029): unset ⇒ POST /v1/routing/optimize answers 503
  ...(process.env['OSRM_URL'] ? { osrm: { url: process.env['OSRM_URL'] } } : {}),
  redisSub,
  db,
  pool,
  gdpr,
  mail,
  resetTokenTtlS: Number(process.env['RESET_TOKEN_TTL'] ?? 3_600),
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

// Boot backfill (DB→Redis): repopulate the geofence + iButton caches in case Redis was flushed;
// best-effort — a failure here must never block serving (CRUD re-syncs incrementally anyway).
void rehydrateRegistries(redis, db)
  .then((r) => console.log(`rehydrated Redis registries: ${r.geofences} geofences, ${r.ibuttons} iButtons`))
  .catch((e: unknown) => console.error('rehydrate failed (non-fatal)', e))

process.on('SIGTERM', () => {
  httpServer.close(() => {
    void redis
      .quit()
      .then(() => redisSub.quit())
      .then(() => gdprEraseQueue.close())
      .then(() => gdprExportQueue.close())
      .then(() => pool.end())
      .then(() => db.$disconnect())
      .then(() => process.exit(0))
  })
  setTimeout(() => process.exit(0), 5_000).unref()
})
