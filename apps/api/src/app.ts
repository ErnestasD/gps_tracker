import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { Counter, Gauge, Registry } from 'prom-client'

import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'

import { dbErrorHttp, type Db, type Pool } from '@orbetra/db'
import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

import { problem } from './auth/middleware.js'

import { createAuthRoutes } from './auth/login.js'
import { Argon2OverloadedError, argon2QueueDepth } from './auth/passwords.js'
import { createApiKeyAuth } from './auth/apiKey.js'
import { hasEntitlement } from './auth/entitlements.js'
import { authMiddleware, type AuthEnv } from './auth/middleware.js'
import { mountApiKeys } from './routes/apiKeys.js'
import { mountDocs } from './routes/docs.js'
import { createPublicRoutes } from './routes/caddyAsk.js'
import { createPilotRequestRoute } from './routes/pilotRequest.js'
import { createPartnerRoutes } from './routes/partner.js'
import { createSignupRoute } from './routes/signup.js'
import { buildRoutes } from './routes/crud.js'
import { mountRoutes, toManifest, type ManifestEntry } from './routes/registry.js'
import { mountReports } from './routes/reports.js'
import { mountDriverScores } from './routes/driverScores.js'
import { mountRouting } from './routes/routing.js'
import { mountBilling, mountStripeWebhook } from './routes/billing.js'
import { mountPush } from './routes/push.js'
import type { StripeGateway } from './billing/stripe.js'
import { defaultTxtResolver, type TxtResolver } from './routes/tenantSelf.js'
import { securityHeaders } from './security.js'
import { issueTicket, revokedAfter, type WsDeps } from './ws.js'

export interface ApiDeps extends WsDeps {
  db: Db
  /** raw-SQL pool for positions history reads (E04-3); positions are not in Prisma. */
  pool?: Pool
  jwtSecret: string
  jwtTtlS: number
  refreshTtlS: number
  lockout: { maxFails: number; windowS: number }
  secureCookies: boolean
  trustProxy: boolean
  /** Remote socket address resolver (Node server adapter specific; tests inject). */
  getRemoteAddr?: (c: unknown) => string
  /** DNS TXT resolver for domain verification (E03-5); default node:dns. */
  resolveTxt?: TxtResolver
  /** Caddy-ask rate limit (E03-5); default 10/min per IP. */
  askRateLimit?: { max: number; windowS: number }
  /** Public share-resolve rate limit (V1-nice); default 60/min per token. */
  shareRateLimit?: { max: number; windowS: number }
  /** Per-API-key rate limit (E06-3); default 600/min. */
  apiKeyRateLimitPerMin?: number
  /** Send Strict-Transport-Security (E07-5); defaults to secureCookies (TLS deployments). */
  hsts?: boolean
  /** SMS onboarding target (V1-nice); default orbetra.com:5027. */
  onboarding?: { host: string; port: number }
  /** Per-device / per-tenant / platform-wide SMS ceilings; default DEFAULT_SMS_QUOTA. */
  smsQuota?: { perDevicePerDay: number; perTenantPerDay: number; globalPerDay: number }
  /** Fired when a send is refused by a quota; wired to `sms_quota_rejected_total` in main.ts. */
  onSmsQuotaRejected?: (scope: 'device' | 'tenant' | 'global') => void
  /** Fired when a verified Stripe subscription webhook provisioned nothing; wired to a counter. */
  onWebhookUnmatched?: (reason: 'no_tenant' | 'unmappable') => void
  /** GDPR job enqueuers (E08-4, ADR-020 addendum); routes 503 when absent. */
  gdpr?: {
    enqueueErase(data: { deviceId: string; tenantId: string }): Promise<void>
    enqueueExport(data: { exportId: string }): Promise<void>
  }
  /** Stripe billing gateway (ADR-024); absent ⇒ billing routes report not-configured / 503. */
  stripe?: StripeGateway
  /** absolute base URL for Checkout/portal return URLs; falls back to the request Origin. */
  appBaseUrl?: string
  /** Password-reset token lifetime (ADR-031); default 3600 s (1 h). */
  resetTokenTtlS?: number
  /** Transactional auth-email enqueuer (ADR-031): the API can't send email, so it hands the branded
   *  reset mail to the worker's `auth-email` queue. Absent ⇒ forgot-password is a no-op (still 200). */
  mail?: {
    enqueueResetEmail(job: { kind: 'password-reset'; email: string; tenantId: string; locale: string; resetUrl: string; expiresMinutes: number }): Promise<void>
  }
  /** SMS gateway job enqueuer (SMS gateway feature): the API can't send SMS, so it hands a config-SMS
   *  job to the worker's `sms` queue. Present ONLY when Twilio is configured (smsConfigured, shared) —
   *  absent ⇒ POST /v1/devices/:id/sms 503s and the onboarding sheet reports smsEnabled:false. */
  sms?: {
    enqueue(job: { smsDeliveryId: string; deviceId: string; tenantId: string; to: string; body: string; provider: string }): Promise<unknown>
  }
  /** VAPID public key for Web Push (ADR-026); absent ⇒ push unavailable (client sees a null key). */
  vapidPublicKey?: string
  /** self-serve signup per-IP rate limit (F2); default 5/hour. Tests raise it. */
  signupRateLimit?: { max: number; windowS: number }
  /** self-hosted OSRM for route optimization (ADR-029); absent ⇒ /v1/routing/optimize 503s. */
  osrm?: { url: string; fetchImpl?: typeof fetch }
  /** route-optimization per-user rate limit (ADR-029); default 30/min. */
  routingRateLimit?: { max: number; windowS: number }
  /** reports per-user rate limit (audit MED); default 60/min. */
  reportRateLimit?: { max: number; windowS: number }
}

export interface ApiProm {
  registry: Registry
  setWsClients: (n: number) => void
  /** Sends refused by an SMS quota, by which ceiling tripped. `global` = the platform breaker. */
  smsQuotaRejected: Counter
  /** Verified Stripe subscription webhooks that provisioned NOTHING — a paying customer with no plan. */
  billingWebhookUnmatched: Counter
}

export function createApiProm(): ApiProm {
  const registry = new Registry()
  const g = new Gauge({ name: 'ws_clients', help: 'live WS connections', registers: [registry] })
  // argon2 saturation. Every hashing route (login, password change/reset, signup, partner login)
  // queues behind ONE process-wide semaphore, so a rising queue IS an authentication outage in
  // progress — and past ARGON2_MAX_WAITING we shed with 503. A saturation signal nobody scrapes is
  // not a signal, so it is registered here rather than merely exported (review LOW).
  new Gauge({
    name: 'argon2_queue_depth',
    help: 'requests waiting for an argon2 slot (shed with 503 past the cap)',
    registers: [registry],
    collect() {
      this.set(argon2QueueDepth())
    },
  })
  const smsQuotaRejected = new Counter({
    name: 'sms_quota_rejected_total',
    help: 'SMS sends refused by a quota (device | tenant | global platform breaker)',
    labelNames: ['scope'],
    registers: [registry],
  })
  const billingWebhookUnmatched = new Counter({
    name: 'billing_webhook_unmatched_total',
    help: 'signature-verified Stripe subscription webhooks that matched no tenant (paying customer left unprovisioned)',
    labelNames: ['reason'],
    registers: [registry],
  })
  return { registry, setWsClients: (n) => g.set(n), smsQuotaRejected, billingWebhookUnmatched }
}

/**
 * The scoped-CRUD route manifest (E03-2) — exported for the isolation suite to
 * iterate cross-boundary. Built without deps (handlers are irrelevant to the
 * contract). If a /v1 data route is registered without a manifest entry, the
 * suite's meta-test fails.
 */
export function apiManifest(): ManifestEntry[] {
  return toManifest(buildRoutes({ db: undefined as never, redis: undefined as never, resolveTxt: undefined as never }))
}

export function createApp(deps: ApiDeps, prom?: ApiProm): Hono<AuthEnv> {
  // defense-in-depth (review LOW): the 32-char floor was only in main.ts; any
  // embedder/test with a weak HS256 secret is offline-brute-forceable
  if (deps.jwtSecret.length < 32) throw new Error('jwtSecret must be at least 32 chars')
  const app = new Hono<AuthEnv>()

  // Global error handler: translate an UNHANDLED Prisma error to the right HTTP status instead of a
  // raw 500 — chiefly a non-UUID `:id` hitting a uuid column (P2023 → 404), which previously 500'd on
  // every item route (accounts/users/rules/webhooks/drivers/…). Repos that own a constraint already
  // map it in their route, so those never reach here. HTTPException (intentional) passes through, and
  // any truly unexpected error still 500s (logged). Header middleware runs post-next, so the response
  // this returns still carries the security headers (pinned by securityHeaders.spec).
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    // argon2 queue saturated: an honest, retryable 503 — never a 500, and never mistaken for
    // "wrong password" (which would leak that the credential was even checked)
    if (err instanceof Argon2OverloadedError) {
      c.header('Retry-After', '5')
      return problem(c, 503, 'Service Unavailable', 'password hashing is saturated, retry shortly')
    }
    const mapped = dbErrorHttp(err)
    if (mapped !== null) {
      // log the code so a mis-mapped case (e.g. a would-be-400 P2023 from a body) is not silent
      console.warn('mapped DB error', mapped.status, (err as { code?: unknown }).code)
      return problem(c, mapped.status, mapped.title)
    }
    console.error('unhandled API error', err)
    return problem(c, 500, 'Internal Server Error')
  })

  // security headers on EVERY response, incl. 401/404/problem+json (E07-5) — registered
  // first so no route can be reached without them. HSTS only in TLS deployments.
  app.use('*', securityHeaders({ hsts: deps.hsts ?? deps.secureCookies }))

  app.get('/healthz', (c) => c.text('ok'))

  if (prom) {
    app.get('/metrics', async (c) => c.text(await prom.registry.metrics()))
  }

  const getRemoteAddr = deps.getRemoteAddr ?? (() => '0.0.0.0')

  // Global request-body cap. Every /v1 POST buffers the full body before zod runs, so without this a
  // single caller can amplify server memory with an arbitrarily large one. 1 MB covers every normal
  // payload; the CSV import (its own 2 MB field cap) gets a higher ceiling. Over-limit ⇒ 413.
  //
  // Registered BEFORE every route, not just the authenticated ones: Hono applies middleware only to
  // handlers registered after it, so while this lived below the mounts, /v1/auth/login,
  // /v1/public/pilot-request and the Stripe webhook were all UNCAPPED (audit high) — and those are
  // exactly the unauthenticated ones. The Stripe handler reads c.req.text() before it can verify the
  // signature, and none of them is behind Caddy's 64 KB cap (that applies only to the marketing
  // host's /v1/public/*), so a few slow chunked uploads could OOM the process and take REST, the WS
  // gateway and Caddy's on-demand-TLS ask down with it.
  const GLOBAL_BODY_LIMIT = 1024 * 1024
  const IMPORT_BODY_LIMIT = 3 * 1024 * 1024 // holds a 2 MB CSV + JSON wrapper with margin
  const onBodyTooLarge = (c: Context) => problem(c, 413, 'Payload Too Large', 'request body too large')
  const globalLimiter = bodyLimit({ maxSize: GLOBAL_BODY_LIMIT, onError: onBodyTooLarge }) as MiddlewareHandler<AuthEnv>
  const importLimiter = bodyLimit({ maxSize: IMPORT_BODY_LIMIT, onError: onBodyTooLarge }) as MiddlewareHandler<AuthEnv>
  const pickBodyLimit: MiddlewareHandler<AuthEnv> = (c, next) => {
    const p = c.req.path
    const isImport = p === '/v1/devices/import' || p === '/v1/devices/import/preview'
    return (isImport ? importLimiter : globalLimiter)(c, next)
  }
  app.use('/v1/*', pickBodyLimit)

  // §6.6 auth routes (login/refresh/logout public; /me + /password guard themselves)
  app.route('/v1/auth', createAuthRoutes({ ...deps, db: deps.db.auth }, getRemoteAddr))

  // PUBLIC white-label routes (E03-5) — MUST be registered before the /v1/* auth
  // middleware (Caddy + pre-login browsers have no bearer). Manifest-exempt.
  app.route(
    '/',
    createPublicRoutes({
      db: deps.db,
      redis: deps.redis,
      askRateLimit: deps.askRateLimit ?? { max: 10, windowS: 60 },
      shareRateLimit: deps.shareRateLimit ?? { max: 300, windowS: 60 },
      getRemoteAddr,
      trustProxy: deps.trustProxy,
      ...(deps.pool !== undefined ? { pool: deps.pool } : {}),
    }),
  )

  // PUBLIC pilot-request (W9-S1) — the marketing site's form; honeypot + per-IP limit
  app.route('/', createPilotRequestRoute({ db: deps.db, redis: deps.redis, getRemoteAddr, trustProxy: deps.trustProxy }))

  // PUBLIC self-serve signup (F2) — direct trial tenant creation; honeypot + per-IP limit + ?ref
  app.route('/', createSignupRoute({ db: deps.db, redis: deps.redis, getRemoteAddr, trustProxy: deps.trustProxy, ...(deps.signupRateLimit !== undefined ? { rateLimit: deps.signupRateLimit } : {}) }))

  // PUBLIC Stripe webhook (ADR-024) — before the /v1/* auth guard (Stripe carries no JWT);
  // raw body + signature verified inside. Manifest-exempt.
  mountStripeWebhook(app, { db: deps.db, stripe: deps.stripe, appBaseUrl: deps.appBaseUrl, ...(deps.onWebhookUnmatched !== undefined ? { onWebhookUnmatched: deps.onWebhookUnmatched } : {}) })

  // everything below /v1/* requires a valid access JWT (registration order — Hono
  // middleware applies only to handlers registered after it)
  // PUBLIC API docs (E06-5) — the OpenAPI document + docs page, before the /v1/* auth guard.
  mountDocs(app, { manifest: apiManifest(), ...(process.env['PUBLIC_API_URL'] ? { serverUrl: process.env['PUBLIC_API_URL'] } : {}) })

  // PARTNER (affiliate) self-service (F5) — a SEPARATE auth surface, mounted before the tenant /v1/*
  // guard: login/set-password are public, me/commissions carry their OWN partner-token guard. A
  // partner is never a tenant user, so the tenant middleware must not see these. Manifest-EXEMPT.
  app.route('/', createPartnerRoutes({ db: deps.db, redis: deps.redis, jwtSecret: deps.jwtSecret, trustProxy: deps.trustProxy, getRemoteAddr }))

  const apiKeyAuth = createApiKeyAuth({ apiKeys: deps.db.apiKeys, redis: deps.redis, perMin: deps.apiKeyRateLimitPerMin ?? 600 })
  // REST-API access is a TSP-plus entitlement — reject a resolved key whose tenant lacks apiAccess
  app.use('/v1/*', authMiddleware({ jwtSecret: deps.jwtSecret, apiKey: apiKeyAuth, apiKeyEntitled: (tenantId) => hasEntitlement(deps.db, tenantId, 'apiAccess') }))

  // §6.6: GET /v1/ws-ticket → single-use ticket for wss://…/v1/stream?ticket=
  // (any authenticated role — live map is viewer-accessible)
  app.get('/v1/ws-ticket', async (c) => {
    const auth = c.get('auth')
    // B1: refuse a ticket for a token minted BEFORE the user's sessions were revoked (logout /
    // delete / password reset / scope change) — else a stale-but-unexpired access token could open
    // a fresh, long-lived WS stream that the gateway's establishedAt-based sweep never closes.
    if (await revokedAfter(deps.redis, auth.userId, auth.tokenIssuedAtS)) return problem(c, 401, 'Unauthorized', 'session_revoked')
    const ticket = await issueTicket(deps, auth)
    c.header('Cache-Control', 'no-store') // single-use credential: never cacheable
    return c.json({ ticket, expiresInS: deps.ticketTtlS ?? 30 })
  })

  // TEMPORARY until E03-3 (founder-approved E02-6 addition): last-known snapshot so the
  // web map isn't empty until each device next reports. Reads the Redis hashes LiveState
  // maintains; E03-3 replaces this with a scoped repository in packages/db and deletes
  // the direct hash walk (HGETALL is fine at stub scale, not at 5k devices).
  app.get('/v1/devices/last', async (c) => {
    const auth = c.get('auth')
    const tenantMap = await deps.redis.hgetall('device:tenant')
    const deviceIds = Object.keys(tenantMap)
      .filter((id) => tenantMap[id] === auth.tenantId)
      .sort()
    const jsons = await Promise.all(
      deviceIds.map((id) => deps.redis.hget(`device:${id}:last`, 'json')),
    )
    const devices: LiveEvent[] = []
    for (const raw of jsons) {
      if (raw === null) continue // mapped but never reported
      try {
        const parsed = liveEventSchema.safeParse(JSON.parse(raw))
        if (!parsed.success) continue // malformed state is skipped, not fatal
        // account filter on the PAYLOAD accountId — the same field ws.ts filters the
        // fanout on; unmapped (null) fails CLOSED for account-scoped users
        if (auth.accountId !== undefined && parsed.data.accountId !== auth.accountId) continue
        devices.push(parsed.data)
      } catch {
        // broken JSON in the hash — skip
      }
    }
    c.header('Cache-Control', 'no-store') // tenant-scoped positions: never cacheable
    return c.json({ devices })
  })

  // GET /v1/profiles — GLOBAL reference data (device profiles are not tenant-scoped;
  // E03-3). All authenticated roles; exempt from the isolation manifest (no tenant
  // boundary to defend). Registered before mountRoutes.
  app.get('/v1/profiles', async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(await deps.db.profiles.list())
  })

  // manifest-driven scoped CRUD (E03-2/E03-3) — registered AFTER the exact routes
  // above so /v1/devices/:id does not shadow /v1/devices/last (Hono matches in
  // registration order). Routes come from buildRoutes so the exported manifest and
  // the live app cannot drift (isolation suite meta-test).
  mountRoutes(app, buildRoutes({ db: deps.db, redis: deps.redis, resolveTxt: deps.resolveTxt ?? defaultTxtResolver, pool: deps.pool, gdpr: deps.gdpr, onboarding: deps.onboarding, sms: deps.sms, smsQuota: deps.smsQuota, onSmsQuotaRejected: deps.onSmsQuotaRejected }), deps.db)

  // Reports (E06-1) — tenant/account-scoped read over trips+events; not a manifest CRUD
  // entity (see reports.ts), EXEMPT from the meta-test with dedicated isolation tests.
  mountReports(app, { db: deps.db, pool: deps.pool, redis: deps.redis, ...(deps.reportRateLimit !== undefined ? { rateLimit: deps.reportRateLimit } : {}) })

  // Driver safety scoring (V2) — dedicated read route, EXEMPT from the manifest (aggregate result).
  mountDriverScores(app, { db: deps.db, pool: deps.pool })
  // Route optimization (ADR-029) — stateless OSRM proxy, no tenant data; manifest-EXEMPT.
  mountRouting(app, {
    redis: deps.redis,
    ...(deps.osrm !== undefined ? { osrmUrl: deps.osrm.url } : {}),
    ...(deps.osrm?.fetchImpl !== undefined ? { fetchImpl: deps.osrm.fetchImpl } : {}),
    ...(deps.routingRateLimit !== undefined ? { rateLimit: deps.routingRateLimit } : {}),
  })
  // billing (ADR-024) — tenant-self, admin-only; manifest-exempt with a dedicated isolation test
  mountBilling(app, { db: deps.db, stripe: deps.stripe, appBaseUrl: deps.appBaseUrl, redis: deps.redis })
  // Web Push subscriptions (ADR-026) — tenant-self, manifest-exempt
  mountPush(app, { db: deps.db, vapidPublicKey: deps.vapidPublicKey })

  // API-key management (E06-3) — tenant-admin only; dedicated route, EXEMPT from the manifest.
  mountApiKeys(app, { db: deps.db, redis: deps.redis })

  return app
}
