import { writeSync } from 'node:fs'
import { inspect } from 'node:util'
import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

import { createDb, createPool, poolOptionsFromEnv } from '@orbetra/db'
import { smsConfigured } from '@orbetra/shared'

import { createApiProm, createApp } from './app.js'
import { DEFAULT_SMS_QUOTA } from './routes/crud.js'
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

// `enableOfflineQueue: false` is the root fix for a whole class of bug this API had. With the
// default (true) plus `maxRetriesPerRequest: null`, a DISCONNECTED Redis makes every command WAIT
// in an uncapped in-memory queue instead of rejecting — so a `.catch()` never runs and the request
// HANGS. That produced a clean credential oracle during a Redis outage (a wrong password answered
// 401 in ~130 ms through the timeout-bounded gates, a CORRECT one reached the unguarded success
// bookkeeping and never answered at all), and pinned an HTTP socket plus queue entries per login
// for the whole outage. Rejecting immediately makes every `.catch()` on this branch do what its
// author believed it did. BullMQ's queues take their own connections, so they are unaffected.
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false })
const redisSub = redis.duplicate()
const db = createDb(databaseUrl)
const pool = createPool(databaseUrl, poolOptionsFromEnv()) // raw-SQL positions history reads (E04-3)
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
const authEmailOpts = { attempts: 5, backoff: { type: 'exponential' as const, delay: 5_000 }, removeOnComplete: true, removeOnFail: 500 }
const mail = {
  enqueueResetEmail: async (job: { kind: 'password-reset'; email: string; tenantId: string; locale: string; resetUrl: string; expiresMinutes: number }): Promise<void> => {
    await authEmailQueue.add('auth-email', job, authEmailOpts)
  },
  // audit MED #67: signup no longer tells an anonymous caller that an address is taken, so the
  // address's OWNER is told instead. Same queue, same worker, no token in the payload.
  enqueueSignupExistsEmail: async (job: { kind: 'signup-exists'; email: string; tenantId: string; locale: string; loginUrl: string; resetUrl: string }): Promise<void> => {
    await authEmailQueue.add('auth-email', job, authEmailOpts)
  },
  // …and the other half: the mail that ACTIVATES a real signup. Without it the new account can
  // never log in, which is what makes the two branches indistinguishable.
  enqueueVerifyEmail: async (job: { kind: 'verify-email'; email: string; tenantId: string; locale: string; verifyUrl: string; expiresHours: number }): Promise<void> => {
    await authEmailQueue.add('auth-email', job, authEmailOpts)
  },
}

// SMS gateway (SMS gateway feature): the api enqueues a config-SMS job; the worker's `sms` queue
// sends it via Twilio. Built ONLY when Twilio is configured (smsConfigured, shared) — exactly like
// email/Stripe: absent ⇒ the SMS routes 503 and the onboarding sheet reports smsEnabled:false.
// jobId = `sms-<deliveryId>` dedupes a double-submit of the same delivery; removeOnFail keeps the
// last 500 corpses for debugging (the API also marks the row failed if the enqueue itself throws).
const smsQueue = smsConfigured(process.env) ? new Queue('sms', { connection: gdprConn }) : undefined
const sms = smsQueue !== undefined
  ? {
      enqueue: (job: { smsDeliveryId: string; deviceId: string; tenantId: string; to: string; body: string; provider: string }) =>
        smsQueue.add('sms', job, { jobId: `sms-${job.smsDeliveryId}`, attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 500 }),
    }
  : undefined
if (sms === undefined) console.warn('SMS gateway not configured (TWILIO_ACCOUNT_SID/TWILIO_FROM + auth token or API key) — config-SMS routes disabled')

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
  // route optimization (ADR-034): Mapbox by default — worldwide, no dataset to build or refresh,
  // $0 at our volume. OSRM stays wired as the alternative driver for the >12-stop case.
  ...(process.env['MAPBOX_TOKEN'] ? { mapboxToken: process.env['MAPBOX_TOKEN'] } : {}),
  ...(process.env['OSRM_URL'] ? { osrm: { url: process.env['OSRM_URL'] } } : {}),
  redisSub,
  db,
  pool,
  gdpr,
  mail,
  ...(sms !== undefined ? { sms } : {}),
  resetTokenTtlS: Number(process.env['RESET_TOKEN_TTL'] ?? 3_600),
  jwtSecret,
  jwtTtlS: Number(process.env['JWT_TTL'] ?? 900),
  refreshTtlS: Number(process.env['REFRESH_TTL'] ?? 1_209_600),
  ticketTtlS: Number(process.env['WS_TICKET_TTL'] ?? 30),
  // SMS ceilings (config SMS is an onboarding action, not a messaging product). Every send is a
  // real billable message from the platform's Twilio sender, so these bound unrecoverable cost.
  smsQuota: {
    perDevicePerDay: Number(process.env['SMS_QUOTA_DEVICE_PER_DAY'] ?? DEFAULT_SMS_QUOTA.perDevicePerDay),
    perTenantPerDay: Number(process.env['SMS_QUOTA_TENANT_PER_DAY'] ?? DEFAULT_SMS_QUOTA.perTenantPerDay),
    globalPerDay: Number(process.env['SMS_QUOTA_GLOBAL_PER_DAY'] ?? DEFAULT_SMS_QUOTA.globalPerDay),
  },
  onSmsQuotaRejected: (scope: 'device' | 'tenant' | 'global') => prom.smsQuotaRejected.inc({ scope }),
  onWebhookUnmatched: (reason: 'no_tenant' | 'unmappable') => prom.billingWebhookUnmatched.inc({ reason }),
  onLockout: (gate: 'credential' | 'ip' | 'email' | 'degraded') => prom.authLockoutTripped.inc({ gate }),
  onSignupEmailInUse: () => prom.signupEmailInUse.inc(),
  onTenantRestored: () => prom.tenantRestored.inc(),
  onEmailVerified: () => prom.emailVerification.inc({ outcome: 'verified' }),
  onUnverifiedLogin: () => prom.emailVerification.inc({ outcome: 'unverified_login' }),
  onVerifyMailFailed: () => prom.emailVerification.inc({ outcome: 'mail_failed' }),
  onVerifyMailUnconfigured: () => prom.emailVerification.inc({ outcome: 'mail_unconfigured' }),
  // partner-portal ceilings; unset entries fall back to the module defaults (1 h window there)
  partnerLoginLimits: {
    ...(process.env['PARTNER_LOCKOUT_MAX_FAILS_PER_IP'] !== undefined ? { maxFailsPerIp: Number(process.env['PARTNER_LOCKOUT_MAX_FAILS_PER_IP']) } : {}),
    ...(process.env['PARTNER_LOCKOUT_MAX_ATTEMPTS_PER_IP_HARD'] !== undefined ? { maxAttemptsPerIpHard: Number(process.env['PARTNER_LOCKOUT_MAX_ATTEMPTS_PER_IP_HARD']) } : {}),
    ...(process.env['PARTNER_LOCKOUT_MAX_FAIL_IPS_PER_EMAIL'] !== undefined ? { maxFailIpsPerEmail: Number(process.env['PARTNER_LOCKOUT_MAX_FAIL_IPS_PER_EMAIL']) } : {}),
  },
  // hard ceiling on one live socket (default 4 h). A stream is authorized only at connect, so this
  // is what makes a plan downgrade / role change eventually reach an already-open one; clients
  // reconnect with a fresh ticket, which re-authorizes.
  maxSocketLifetimeMs: Number(process.env['WS_MAX_SOCKET_LIFETIME_MS'] ?? 4 * 3_600_000),
  lockout: {
    maxFails: Number(process.env['LOCKOUT_MAX_FAILS'] ?? 5),
    windowS: Number(process.env['LOCKOUT_WINDOW_S'] ?? 900),
    // Abuse ceilings, not the per-credential rule. One source IP is a whole office or a carrier
    // NAT, so the soft one refuses only wrong passwords: 50 FAILED logins per 15 min from one
    // address is not a human getting it wrong, but it is no reason to deny a valid credential.
    maxFailsPerIp: Number(process.env['LOCKOUT_MAX_FAILS_PER_IP'] ?? 50),
    // The hard one counts every ATTEMPT and refuses before argon2 — the CPU shed. 1000 per 15 min
    // is ~65/min sustained from one address: far beyond a 300-seat office arriving on a Monday
    // (~5/min), and ~2 minutes of one core in argon2, which the 8-slot semaphore already bounds.
    maxAttemptsPerIpHard: Number(process.env['LOCKOUT_MAX_ATTEMPTS_PER_IP_HARD'] ?? 1_000),
    // DISTINCT source IPs failing against one account. A real user fails from one or two; needing
    // 30 makes the account lockout cost a botnet, which is exactly when locking is the right call.
    maxFailIpsPerEmail: Number(process.env['LOCKOUT_MAX_FAIL_IPS_PER_EMAIL'] ?? 30),
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
const wss = attachWsGateway(httpServer, deps, (n) => prom.setWsClients(n), () => prom.wsSlowConsumer.inc())
console.log(`orbetra api listening on :${port} (auth live, ws_clients metric live)`)
// Misconfiguring this now has a much larger blast radius than it used to. Without TRUST_PROXY the
// client IP is the socket peer, which behind Caddy is ONE bucket for the entire platform — and the
// hard per-IP ceiling (1000 attempts, pre-verify, never refunded) then applies to everybody at
// once: 1000 logins platform-wide and the whole product 429s for the window.
if (process.env['TRUST_PROXY'] !== '1') {
  console.warn(
    'WARNING: TRUST_PROXY is not "1". If this process sits behind a reverse proxy, every per-source ' +
      'rate limit and lockout now counts the PROXY as the client — one shared bucket for all users.',
  )
}

// Boot backfill (DB→Redis): repopulate the geofence + iButton caches in case Redis was flushed;
// best-effort — a failure here must never block serving (CRUD re-syncs incrementally anyway).
// Waits for the connection: with the offline queue disabled, commands issued before the socket is
// ready would reject rather than queue, and a boot backfill that silently did nothing is the
// audit-D1 failure (an empty `registry:imei` quarantines the whole fleet) all over again.
const redisReady = redis.status === 'ready' ? Promise.resolve() : new Promise<void>((r) => redis.once('ready', () => r()))
void redisReady
  .then(() => rehydrateRegistries(redis, db))
  .then((r) => console.log(`rehydrated Redis registries: ${r.devices} devices, ${r.geofences} geofences, ${r.ibuttons} iButtons`))
  .catch((e: unknown) => console.error('rehydrate failed (non-fatal)', e))

// Last resort. Every known throw path is handled, but an unhandled 'error' event anywhere in a
// long-lived listener (ws, ioredis, a pg pool client) is an uncaught exception, and the default
// behaviour — die silently with a stack on stderr — makes a platform-wide outage look like a
// container that "just restarted". Log it in a shape an operator can search for, then exit and let
// the restart policy do its job: a process that has thrown from an unknown place is not trustworthy.
const fatal = (kind: string, err: unknown): never => {
  // writeSync, not console.error: stderr is ASYNCHRONOUS on a pipe (docker logs, journald) and
  // process.exit does not flush it, so the diagnostic this handler exists to produce was truncated
  // at one pipe buffer — losing precisely the stack that distinguishes an outage from "a container
  // that just restarted". Measured: 64 KB kept of a 200 KB message.
  // inspect(), not String(): a non-Error rejection renders as "[object Object]" otherwise, which
  // is the opposite of a diagnostic
  const msg = err instanceof Error ? (err.stack ?? err.message) : inspect(err, { depth: 4 })
  // LOOP on the returned byte count. writeSync does SHORT writes on a pipe — measured 146176 of
  // 200025 bytes in one call — so ignoring the count drops the tail of the stack, which is the part
  // that names the throwing frame. EAGAIN on a full non-blocking pipe is retried, not swallowed.
  const buf = Buffer.from(`FATAL ${kind} — exiting for restart\n${msg}\n`)
  for (let off = 0, spins = 0; off < buf.length && spins < 10_000; spins++) {
    try {
      off += writeSync(2, buf, off)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') break
    }
  }
  process.exit(1)
}
process.on('uncaughtException', (err) => fatal('uncaughtException', err))
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason))

process.on('SIGTERM', () => {
  // Close the WS gateway FIRST (audit MED). `httpServer.close()` waits for every connection to end,
  // and an upgraded WebSocket never ends on its own — so with a single live client the callback
  // never fired and this whole shutdown chain was dead code: Redis was never quit, the BullMQ
  // queues were never closed, the pg pool was never drained. Only the 5 s hard exit below ran, i.e.
  // every deploy killed the API mid-flight while looking graceful. Closing `wss` ends those sockets
  // (clients reconnect and re-authorize, which they already do on a 4 h lifetime), so `close()` can
  // actually complete.
  wss.close()
  for (const client of wss.clients) client.terminate()
  httpServer.close(() => {
    // Every step is best-effort and the exit is in `finally`. This chain had never actually RUN
    // before the line above made `close()` reachable — and with `enableOfflineQueue: false`, a
    // `quit()` issued after Redis has already gone (a compose redeploy restarts it first) rejects
    // immediately. Unhandled, that hits the process-level handler, logs a FATAL and exits 1: an
    // orchestrator reads a graceful stop as a crash, and `pool.end()`/`$disconnect()` — the drains
    // this whole change exists to enable — never run.
    void Promise.resolve()
      .then(() => redis.quit())
      .then(() => redisSub.quit())
      .then(() => gdprEraseQueue.close())
      .then(() => gdprExportQueue.close())
      .then(() => authEmailQueue.close())
      .then(() => smsQueue?.close())
      .then(() => pool.end())
      .then(() => db.$disconnect())
      .catch((err: unknown) => console.error('shutdown step failed (continuing)', err))
      .finally(() => process.exit(0))
  })
  // …and a plain HTTP keep-alive connection can outlast the close too. Give in-flight requests a
  // moment, then cut the idle ones; the hard exit stays as the last resort.
  setTimeout(() => httpServer.closeIdleConnections?.(), 1_000).unref()
  setTimeout(() => process.exit(0), 5_000).unref()
})
