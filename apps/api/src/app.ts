import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client'

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
import { createVerifyEmailRoute } from './routes/verifyEmail.js'
import { buildRoutes } from './routes/crud.js'
import { restoreTenantDevices, tenantDevicesKey } from './routes/deviceRegistry.js'
import { mountRoutes, toManifest, type ManifestEntry } from './routes/registry.js'
import { mountReports } from './routes/reports.js'
import { mountDriverScores } from './routes/driverScores.js'
import { mountRouting } from './routes/routing.js'
import { mountBilling, mountStripeWebhook } from './routes/billing.js'
import { createSesWebhookRoutes } from './routes/sesWebhook.js'
import { mountPush } from './routes/push.js'
import type { StripeGateway } from './billing/stripe.js'
import { defaultTxtResolver, type TxtResolver } from './routes/tenantSelf.js'
import { fixedWindowCount, securityHeaders } from './security.js'
import { issueTicket, revokedAfter, type WsDeps } from './ws.js'

export interface ApiDeps extends WsDeps {
  db: Db
  /** raw-SQL pool for positions history reads (E04-3); positions are not in Prisma. */
  pool?: Pool
  jwtSecret: string
  jwtTtlS: number
  refreshTtlS: number
  /**
   * Failed-login ceilings inside `windowS`. `maxFails` is the documented per (IP, email) rule;
   * the other two close the holes that key shape leaves open — one IP varying the email, and many
   * IPs stuffing one account. Defaults derive from maxFails so a deployment that only sets it
   * still gets all three.
   */
  lockout: {
    maxFails: number
    windowS: number
    /** Soft per-IP ceiling on FAILURES: past it a wrong password is refused, a correct one is not. */
    maxFailsPerIp?: number
    /** Hard per-IP ceiling on ATTEMPTS (successes included): past it nothing is verified at all. */
    maxAttemptsPerIpHard?: number
    /** Distinct source IPs that may fail against ONE account before it is locked for the window. */
    maxFailIpsPerEmail?: number
  }
  /** A lockout gate refused a login, by which ceiling tripped (see `auth/login.ts`). */
  onLockout?: (gate: 'credential' | 'ip' | 'email' | 'degraded') => void
  /** the activation mail for a new signup could not be sent — that customer cannot log in. */
  onVerifyMailFailed?: () => void
  /** an address was successfully verified (the signup funnel's real conversion event). */
  onEmailVerified?: () => void
  /** the activation path is not wired at all — every new signup is an account nobody can log into. */
  onVerifyMailUnconfigured?: () => void
  /** a suspended tenant paid and its fleet was restored on the spot (audit MED #22). */
  onTenantRestored?: () => void
  /** override the registry rebuild on restore (tests); production builds it from `redis`. */
  restoreDevices?: (devices: readonly { id: bigint; imei: string; tenantId: string; accountId: string; presenceRules: unknown; odometerSource: string }[]) => Promise<void>
  /** a login presented the right password for an unverified account — invisible in the response. */
  onUnverifiedLogin?: () => void
  /** a public signup hit an address that already has an account. Since the response no longer says
   *  so, this counter is the only place bulk probing becomes visible (audit MED #67). */
  onSignupEmailInUse?: () => void
  /** Self-service password-change limit per user; default 10/h (two argon2 ops per request). */
  passwordChangeRateLimit?: { max: number; windowS: number }
  /** Partner-portal login ceilings; each falls back to the partner module's default. */
  partnerLoginLimits?: { maxFails?: number; maxFailsPerIp?: number; maxAttemptsPerIpHard?: number; maxFailIpsPerEmail?: number; setPwRedeemMax?: number }
  secureCookies: boolean
  trustProxy: boolean
  /** Remote socket address resolver (Node server adapter specific; tests inject). */
  getRemoteAddr?: (c: unknown) => string
  /** DNS TXT resolver for domain verification (E03-5); default node:dns. */
  resolveTxt?: TxtResolver
  /** Our own domain (`PLATFORM_DOMAIN`). Enables the zero-setup `<slug>.<domain>` white-label
   *  option; unset ⇒ every tenant domain goes through DNS TXT, which is right anywhere the
   *  wildcard record does not exist. */
  platformDomain?: string
  /** Where a tenant points their OWN domain's CNAME (`EDGE_HOSTNAME`). Shown in the UI. */
  edgeHostname?: string
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
  /** Per-tenant device-creation ceiling; default DEFAULT_DEVICE_CREATE_LIMIT. */
  deviceCreateLimit?: { max: number; windowS: number }
  /** Fired when a tenant hits that ceiling (`limit`), when Redis could not be consulted and the
   *  create was let THROUGH (`degraded`), or when a reservation could not be handed back so the
   *  tenant now carries a phantom charge (`refund_failed` — the opposite reflex to `degraded`);
   *  wired to `device_create_throttled_total` in main.ts. */
  onDeviceCreateThrottled?: (why: 'limit' | 'degraded' | 'refund_failed') => void
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
  /** Public marketing site origin (e.g. https://orbetra.com) — where a partner's short link lands.
   *  Unset ⇒ `/r/<code>` 404s rather than guessing a host. */
  siteUrl?: string
  /** an SES feedback event arrived (bounce | complaint | other | rejected-signature) */
  onSesEvent?: (kind: 'bounce' | 'complaint' | 'other' | 'rejected') => void
  /** where a partner's payout request lands (PARTNER_OPS_EMAIL). Absent ⇒ recorded, not mailed. */
  opsEmail?: string
  /** the partner short link's click counter failed (swallowed — see affiliateSilentFailure) */
  onClickCountFailed?: () => void
  /** a partner notification could not be queued (swallowed — see affiliateSilentFailure) */
  onPartnerMailFailed?: () => void
  /** Password-reset token lifetime (ADR-031); default 3600 s (1 h). */
  resetTokenTtlS?: number
  /** Transactional auth-email enqueuer (ADR-031): the API can't send email, so it hands the branded
   *  reset mail to the worker's `auth-email` queue. Absent ⇒ forgot-password is a no-op (still 200). */
  mail?: {
    enqueueResetEmail(job: { kind: 'password-reset'; email: string; tenantId: string; locale: string; resetUrl: string; expiresMinutes: number }): Promise<void>
    /** "someone tried to sign up with your address" (audit MED #67) — the out-of-band half of a
     *  signup that no longer answers "this email is taken" to anonymous callers. */
    enqueueSignupExistsEmail?(job: { kind: 'signup-exists'; email: string; tenantId: string; locale: string; loginUrl: string; resetUrl: string }): Promise<void>
    /** the ACTIVATION mail for a self-serve signup — without it the new account can never log in. */
    enqueueVerifyEmail?(job: { kind: 'verify-email'; email: string; tenantId: string; locale: string; verifyUrl: string; expiresHours: number }): Promise<void>
    /** Partner-facing notification (referral signed up / commission earned). Platform-branded. */
    enqueuePartnerEmail?(job: { kind: 'partner'; event: 'referral' | 'commission' | 'payout-request'; email: string; tenantId: string; locale: string; customer: string; amount?: string; portalUrl: string }): Promise<void>
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
  /** Route-optimization engine. `mapboxToken` is preferred (worldwide, no dataset); `osrm.url` is
   *  the self-hosted alternative kept for >12 stops. Neither ⇒ the route 503s. ADR-034. */
  mapboxToken?: string
  osrm?: { url: string; fetchImpl?: typeof fetch }
  /** route-optimization per-user rate limit (ADR-029); default 30/min. */
  routingRateLimit?: { max: number; windowS: number }
  /** reports per-user rate limit (audit MED); default 60/min. */
  reportRateLimit?: { max: number; windowS: number }
  /** `GET /v1/devices/last` per-user rate limit (audit MED); default 60/min. */
  deviceLastRateLimit?: { max: number; windowS: number }
}

export interface ApiProm {
  registry: Registry
  setWsClients: (n: number) => void
  /** Sends refused by an SMS quota, by which ceiling tripped. `global` = the platform breaker. */
  smsQuotaRejected: Counter
  deviceCreateThrottled: Counter
  /** Verified Stripe subscription webhooks that provisioned NOTHING — a paying customer with no plan. */
  billingWebhookUnmatched: Counter
  /** Live sockets dropped for exceeding the send-buffer ceiling: a client that stopped reading. */
  wsSlowConsumer: Counter
  /** Logins refused by a lockout ceiling, by gate. A rising `email` rate is an account under
   *  attack; a rising `ip` rate is either abuse or a shared egress that needs a higher ceiling. */
  authLockoutTripped: Counter
  signupEmailInUse: Counter
  affiliateSilentFailure: Counter
  emailVerification: Counter
  tenantRestored: Counter
  /** Every HTTP response, by method / route TEMPLATE / status class. The route template (not the
   *  raw path) keeps the label set bounded — `/v1/devices/:id` is one series, not one per device. */
  httpRequests: Counter
  httpDuration: Histogram
}

export function createApiProm(): ApiProm {
  const registry = new Registry()
  // Process-level metrics (RSS, heap, event-loop lag, GC, fd count). The API exported ONE gauge —
  // `ws_clients` — so `up == 1` held for a process that answered every request with a 500, and the
  // only alert covering the api was `up == 0`. A dead port was visible; a dead SERVICE was not.
  collectDefaultMetrics({ register: registry })
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
  const deviceCreateThrottled = new Counter({
    name: 'device_create_throttled_total',
    help: 'device creations refused by the per-tenant ceiling (limit), let through because Redis could not be consulted (degraded), or over-charged because a reservation could not be handed back (refund_failed)',
    labelNames: ['why'],
    registers: [registry],
  })
  const billingWebhookUnmatched = new Counter({
    name: 'billing_webhook_unmatched_total',
    help: 'signature-verified Stripe subscription webhooks that matched no tenant (paying customer left unprovisioned)',
    labelNames: ['reason'],
    registers: [registry],
  })
  const wsSlowConsumer = new Counter({
    name: 'ws_slow_consumer_dropped_total',
    help: 'WS connections closed because their send buffer exceeded the ceiling (client not reading)',
    registers: [registry],
  })
  const authLockoutTripped = new Counter({
    name: 'auth_lockout_tripped_total',
    help: 'logins refused by a lockout ceiling (credential = per IP+email, ip = per source, email = per account) — plus degraded = a gate could not be evaluated and the request was allowed through',
    labelNames: ['gate'],
    registers: [registry],
  })
  const emailVerification = new Counter({
    name: 'email_verification_total',
    help: 'self-serve address verification outcomes: verified = a signup activated; unverified_login = the right password on an account that never activated (invisible in the response by design); mail_failed = the activation mail could not be sent; mail_unconfigured = the activation path is not wired at all — either way that customer cannot log in',
    labelNames: ['outcome'],
    registers: [registry],
  })
  const tenantRestored = new Counter({
    name: 'billing_tenant_restored_total',
    help: 'suspended tenants whose fleet was restored on the spot by a payment webhook (audit #22)',
    registers: [registry],
  })
  const signupEmailInUse = new Counter({
    name: 'signup_email_in_use_total',
    help: 'public signups that hit an address which already has an account — the response is a normal 201, so this is the only signal that someone is walking a list of addresses (audit #67)',
    registers: [registry],
  })
  /**
   * The affiliate module's two silent paths, made visible.
   *
   * Both swallow deliberately — a broken click counter must not break a marketing link, and a mail
   * failure must not make Stripe retry an accrual that already succeeded. Silence is right for the
   * caller and wrong for us: an unapplied migration zeroes every partner's funnel forever, which
   * reads exactly like "nobody clicked", and a wedged mail queue is indistinguishable from "no
   * referrals happened".
   */
  const affiliateSilentFailure = new Counter({
    name: 'affiliate_silent_failure_total',
    help: 'affiliate side-effects that failed and were swallowed on purpose: click counting, partner notifications',
    labelNames: ['kind'],
    registers: [registry],
  })
  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP responses by method, route template and status class',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  })
  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route template',
    labelNames: ['method', 'route'],
    // sub-ms to 10 s: the API's own SLA lives in the low hundreds of ms, and a report or an
    // exhausted pg pool shows up in the long tail
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  })
  return { registry, setWsClients: (n) => g.set(n), smsQuotaRejected, deviceCreateThrottled, billingWebhookUnmatched, wsSlowConsumer, authLockoutTripped, signupEmailInUse, affiliateSilentFailure, emailVerification, tenantRestored, httpRequests, httpDuration }
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
      return problem(c, mapped.status, mapped.title, mapped.detail)
    }
    console.error('unhandled API error', err)
    return problem(c, 500, 'Internal Server Error')
  })

  // security headers on EVERY response, incl. 401/404/problem+json (E07-5) — registered
  // first so no route can be reached without them. HSTS only in TLS deployments.
  app.use('*', securityHeaders({ hsts: deps.hsts ?? deps.secureCookies }))

  // Request metrics on EVERY response. Registered next to the headers so nothing can be served
  // without being counted — a process that answers every request with a 500 used to keep `up == 1`
  // and fire no alert, because `ws_clients` was the only series the API exported (audit MED).
  //
  // Labelled by the matched ROUTE TEMPLATE, never the raw path: `/v1/devices/:id` must be one
  // series, not one per device id, or the label set grows with the fleet and takes Prometheus with
  // it. Hono exposes the matched pattern as `c.req.routePath`; an unmatched request is `<unmatched>`.
  if (prom) {
    app.use('*', async (c, next) => {
      const started = performance.now()
      try {
        await next()
      } finally {
        const route = c.req.routePath !== '/*' ? c.req.routePath : '<unmatched>'
        const method = c.req.method
        prom.httpDuration.observe({ method, route }, (performance.now() - started) / 1000)
        // status CLASS, not the exact code: 2xx/4xx/5xx is what an alert asks about, and it keeps
        // the cardinality flat while `problem()` details stay in the logs
        prom.httpRequests.inc({ method, route, status: `${Math.floor(c.res.status / 100)}xx` })
      }
    })
  }

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
  // bound, not detached: the enqueuer closes over the queue on `deps.mail`, and handing the bare
  // method to another object would rebind `this`
  // bound, not detached: the enqueuers close over the queue on `deps.mail`, and handing the bare
  // methods to another object would rebind `this`
  const existsMail = deps.mail?.enqueueSignupExistsEmail?.bind(deps.mail)
  const verifyMail = deps.mail?.enqueueVerifyEmail?.bind(deps.mail)
  const partnerMail = deps.mail?.enqueuePartnerEmail?.bind(deps.mail)
  // BOTH mails or neither: signup's two branches must not differ in whether they can notify. With
  // only one wired, a taken address would get a mail and a free one would not (or the reverse),
  // which is observable to anyone who controls one of the two addresses.
  const signupMail =
    existsMail !== undefined && verifyMail !== undefined
      ? { enqueueSignupExistsEmail: existsMail, enqueueVerifyEmail: verifyMail, ...(partnerMail !== undefined ? { enqueuePartnerEmail: partnerMail } : {}) }
      : undefined
  app.route(
    '/',
    createSignupRoute({
      db: deps.db,
      redis: deps.redis,
      getRemoteAddr,
      trustProxy: deps.trustProxy,
      ...(deps.signupRateLimit !== undefined ? { rateLimit: deps.signupRateLimit } : {}),
      ...(deps.appBaseUrl !== undefined ? { appBaseUrl: deps.appBaseUrl } : {}),
      ...(signupMail !== undefined ? { mail: signupMail } : {}),
      // the partner portal link in the referral notice lives on the public site, not the app
      ...(deps.siteUrl !== undefined ? { siteUrl: deps.siteUrl } : {}),
      ...(deps.onPartnerMailFailed !== undefined ? { onPartnerMailFailed: deps.onPartnerMailFailed } : {}),
      ...(deps.onSignupEmailInUse !== undefined ? { onEmailInUse: deps.onSignupEmailInUse } : {}),
      ...(deps.onVerifyMailFailed !== undefined ? { onVerifyMailFailed: deps.onVerifyMailFailed } : {}),
      ...(deps.onVerifyMailUnconfigured !== undefined ? { onVerifyMailUnconfigured: deps.onVerifyMailUnconfigured } : {}),
    }),
  )
  app.route(
    '/',
    createVerifyEmailRoute({
      db: deps.db,
      redis: deps.redis,
      getRemoteAddr,
      trustProxy: deps.trustProxy,
      ...(deps.appBaseUrl !== undefined ? { appBaseUrl: deps.appBaseUrl } : {}),
      ...(verifyMail !== undefined ? { mail: { enqueueVerifyEmail: verifyMail } } : {}),
      ...(deps.onEmailVerified !== undefined ? { onVerified: deps.onEmailVerified } : {}),
      ...(deps.onVerifyMailUnconfigured !== undefined ? { onMailUnconfigured: deps.onVerifyMailUnconfigured } : {}),
    }),
  )

  // PUBLIC Stripe webhook (ADR-024) — before the /v1/* auth guard (Stripe carries no JWT);
  // raw body + signature verified inside. Manifest-exempt.
  mountStripeWebhook(app, {
    db: deps.db,
    stripe: deps.stripe,
    appBaseUrl: deps.appBaseUrl,
    // the "you earned X" notice rides the same queue as every other transactional mail
    ...(deps.siteUrl !== undefined ? { siteUrl: deps.siteUrl } : {}),
    ...(partnerMail !== undefined ? { mail: { enqueuePartnerEmail: partnerMail } } : {}),
    ...(deps.onPartnerMailFailed !== undefined ? { onPartnerMailFailed: deps.onPartnerMailFailed } : {}),
    ...(deps.onWebhookUnmatched !== undefined ? { onWebhookUnmatched: deps.onWebhookUnmatched } : {}),
    // RESTORE ON PAYMENT (audit MED #22): the api owns the registry write path, so a suspended
    // tenant's fleet comes back within one webhook rather than waiting for tomorrow's sweep.
    // overridable so the most dangerous path in this route — "paying restores the feed" — can be
    // tested for its ORDER (registry first, flag second) without a Redis fault injector
    restoreDevices:
      deps.restoreDevices ??
      (async (devices) => {
        await restoreTenantDevices(deps.redis, devices) // nests the trip config itself — see the registry
      }),
    ...(deps.onTenantRestored !== undefined ? { onTenantRestored: deps.onTenantRestored } : {}),
  })

  // PUBLIC SES bounce/complaint feedback (SNS) — before the /v1/* auth guard, because SNS carries no
  // credential. Its security is the signature, verified inside. Manifest-EXEMPT.
  app.route('/', createSesWebhookRoutes({
    db: deps.db,
    ...(deps.onSesEvent !== undefined ? { onEvent: deps.onSesEvent } : {}),
  }))

  // everything below /v1/* requires a valid access JWT (registration order — Hono
  // middleware applies only to handlers registered after it)
  // PUBLIC API docs (E06-5) — the OpenAPI document + docs page, before the /v1/* auth guard.
  mountDocs(app, { manifest: apiManifest(), ...(process.env['PUBLIC_API_URL'] ? { serverUrl: process.env['PUBLIC_API_URL'] } : {}) })

  // PARTNER (affiliate) self-service (F5) — a SEPARATE auth surface, mounted before the tenant /v1/*
  // guard: login/set-password are public, me/commissions carry their OWN partner-token guard. A
  // partner is never a tenant user, so the tenant middleware must not see these. Manifest-EXEMPT.
  app.route('/', createPartnerRoutes({
    db: deps.db,
    redis: deps.redis,
    jwtSecret: deps.jwtSecret,
    trustProxy: deps.trustProxy,
    getRemoteAddr,
    // the partner portal shares the tenant login's ceilings and its lockout counter — one
    // authentication surface should not be invisible in Grafana because it lives in another file
    loginLimits: deps.partnerLoginLimits,
    onLockout: deps.onLockout,
    // the short link `/r/<code>` sends visitors to the PUBLIC SITE, not the app
    ...(deps.siteUrl !== undefined ? { siteUrl: deps.siteUrl } : {}),
    ...(deps.onClickCountFailed !== undefined ? { onClickCountFailed: deps.onClickCountFailed } : {}),
    // a payout request is mailed to US, so the partner routes need the queue and the ops address
    ...(partnerMail !== undefined ? { mail: { enqueuePartnerEmail: partnerMail } } : {}),
    ...(deps.opsEmail !== undefined ? { opsEmail: deps.opsEmail } : {}),
    ...(deps.onPartnerMailFailed !== undefined ? { onPartnerMailFailed: deps.onPartnerMailFailed } : {}),
    ...(deps.onUnverifiedLogin !== undefined ? { onUnverifiedLogin: deps.onUnverifiedLogin } : {}),
  }))

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

  /**
   * Last-known snapshot for the caller's devices, so the web map is not empty until each device
   * next reports. Reads the Redis hashes LiveState maintains — deliberately NO database: this is
   * the map's first paint, and it keeps working while Postgres is degraded.
   *
   * It used to `HGETALL device:tenant` — a hash holding EVERY device on the platform — and filter
   * in JS, then issue one `HGET` per surviving device on the shared connection (audit MED). Both
   * halves scaled with the PLATFORM rather than with the caller: at 5k devices one request pulled
   * ~5k field/value pairs across the wire to keep 40, and the N+1 round trips ran head-of-line on
   * the connection every other request shares. Any authenticated user could repeat it as fast as
   * they liked.
   *
   * Now 2 + N commands, and every one of them is bounded by the CALLER's own fleet instead of the
   * platform: SMEMBERS on the per-tenant index, one HMGET to RE-VERIFY ownership against the
   * authoritative `device:tenant` hash (so a stale index member costs a wasted lookup, never a
   * cross-tenant leak), then a pipeline of N HGETs. Plus a per-user rate limit, like
   * reports/routing/share already have. The N remains proportional to the tenant's device count —
   * a map that shows every vehicle has to read every vehicle — so a very large fleet is still a
   * heavy request; paginating the snapshot is a follow-up that changes the web client too.
   */
  app.get('/v1/devices/last', async (c) => {
    const auth = c.get('auth')
    const rl = deps.deviceLastRateLimit ?? { max: 60, windowS: 60 }
    if ((await fixedWindowCount(deps.redis, `devlast:rl:${auth.userId}`, rl.windowS, () => deps.onLockout?.('degraded'))) > rl.max) {
      c.header('Retry-After', String(rl.windowS)) // a throttled client needs a basis for backoff
      return problem(c, 429, 'Too Many Requests')
    }

    c.header('Cache-Control', 'no-store') // tenant-scoped positions: never cacheable
    // Redis errors answer with an EMPTY snapshot, never a 500 and never a hang: the live WS feed
    // fills the map within seconds anyway, so a blip is a briefly-late map rather than a broken
    // dashboard. (`enableOfflineQueue: false` on the client is what makes these reject promptly
    // instead of waiting in an uncapped queue — see main.ts.)
    const candidates = (await deps.redis.smembers(tenantDevicesKey(auth.tenantId)).catch(() => [])).sort()
    if (candidates.length === 0) return c.json({ devices: [] })

    const owners = await deps.redis.hmget('device:tenant', ...candidates).catch(() => [])
    const deviceIds = candidates.filter((_, i) => owners[i] === auth.tenantId)
    if (deviceIds.length === 0) return c.json({ devices: [] })

    const pipe = deps.redis.pipeline()
    for (const id of deviceIds) pipe.hget(`device:${id}:last`, 'json')
    const results = (await pipe.exec().catch(() => [])) ?? []

    const devices: LiveEvent[] = []
    for (const entry of results) {
      const [err, raw] = entry as [Error | null, string | null]
      if (err !== null || typeof raw !== 'string') continue // never reported, or a per-command blip
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
  mountRoutes(app, buildRoutes({ db: deps.db, redis: deps.redis, resolveTxt: deps.resolveTxt ?? defaultTxtResolver, ...(deps.platformDomain !== undefined ? { platformDomain: deps.platformDomain } : {}), ...(deps.edgeHostname !== undefined ? { edgeHostname: deps.edgeHostname } : {}), pool: deps.pool, gdpr: deps.gdpr, onboarding: deps.onboarding, sms: deps.sms, smsQuota: deps.smsQuota, onSmsQuotaRejected: deps.onSmsQuotaRejected, ...(deps.deviceCreateLimit !== undefined ? { deviceCreateLimit: deps.deviceCreateLimit } : {}), ...(deps.onDeviceCreateThrottled !== undefined ? { onDeviceCreateThrottled: deps.onDeviceCreateThrottled } : {}) }), deps.db)

  // Reports (E06-1) — tenant/account-scoped read over trips+events; not a manifest CRUD
  // entity (see reports.ts), EXEMPT from the meta-test with dedicated isolation tests.
  mountReports(app, { db: deps.db, pool: deps.pool, redis: deps.redis, ...(deps.reportRateLimit !== undefined ? { rateLimit: deps.reportRateLimit } : {}) })

  // Driver safety scoring (V2) — dedicated read route, EXEMPT from the manifest (aggregate result).
  mountDriverScores(app, { db: deps.db, pool: deps.pool })
  // Route optimization (ADR-029) — stateless OSRM proxy, no tenant data; manifest-EXEMPT.
  mountRouting(app, {
    redis: deps.redis,
    ...(deps.mapboxToken !== undefined ? { mapboxToken: deps.mapboxToken } : {}),
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
