import { Hono } from 'hono'
import { Gauge, Registry } from 'prom-client'

import type { Db, Pool } from '@orbetra/db'
import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

import { createAuthRoutes } from './auth/login.js'
import { createApiKeyAuth } from './auth/apiKey.js'
import { authMiddleware, type AuthEnv } from './auth/middleware.js'
import { mountApiKeys } from './routes/apiKeys.js'
import { mountDocs } from './routes/docs.js'
import { createPublicRoutes } from './routes/caddyAsk.js'
import { createPilotRequestRoute } from './routes/pilotRequest.js'
import { buildRoutes } from './routes/crud.js'
import { mountRoutes, toManifest, type ManifestEntry } from './routes/registry.js'
import { mountReports } from './routes/reports.js'
import { defaultTxtResolver, type TxtResolver } from './routes/tenantSelf.js'
import { securityHeaders } from './security.js'
import { issueTicket, type WsDeps } from './ws.js'

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
  /** GDPR job enqueuers (E08-4, ADR-020 addendum); routes 503 when absent. */
  gdpr?: {
    enqueueErase(data: { deviceId: string; tenantId: string }): Promise<void>
    enqueueExport(data: { exportId: string }): Promise<void>
  }
}

export interface ApiProm {
  registry: Registry
  setWsClients: (n: number) => void
}

export function createApiProm(): ApiProm {
  const registry = new Registry()
  const g = new Gauge({ name: 'ws_clients', help: 'live WS connections', registers: [registry] })
  return { registry, setWsClients: (n) => g.set(n) }
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

  // security headers on EVERY response, incl. 401/404/problem+json (E07-5) — registered
  // first so no route can be reached without them. HSTS only in TLS deployments.
  app.use('*', securityHeaders({ hsts: deps.hsts ?? deps.secureCookies }))

  app.get('/healthz', (c) => c.text('ok'))

  if (prom) {
    app.get('/metrics', async (c) => c.text(await prom.registry.metrics()))
  }

  const getRemoteAddr = deps.getRemoteAddr ?? (() => '0.0.0.0')

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

  // everything below /v1/* requires a valid access JWT (registration order — Hono
  // middleware applies only to handlers registered after it)
  // PUBLIC API docs (E06-5) — the OpenAPI document + docs page, before the /v1/* auth guard.
  mountDocs(app, { manifest: apiManifest(), ...(process.env['PUBLIC_API_URL'] ? { serverUrl: process.env['PUBLIC_API_URL'] } : {}) })

  const apiKeyAuth = createApiKeyAuth({ apiKeys: deps.db.apiKeys, redis: deps.redis, perMin: deps.apiKeyRateLimitPerMin ?? 600 })
  app.use('/v1/*', authMiddleware({ jwtSecret: deps.jwtSecret, apiKey: apiKeyAuth }))

  // §6.6: GET /v1/ws-ticket → single-use ticket for wss://…/v1/stream?ticket=
  // (any authenticated role — live map is viewer-accessible)
  app.get('/v1/ws-ticket', async (c) => {
    const auth = c.get('auth')
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
  mountRoutes(app, buildRoutes({ db: deps.db, redis: deps.redis, resolveTxt: deps.resolveTxt ?? defaultTxtResolver, pool: deps.pool, gdpr: deps.gdpr, onboarding: deps.onboarding }))

  // Reports (E06-1) — tenant/account-scoped read over trips+events; not a manifest CRUD
  // entity (see reports.ts), EXEMPT from the meta-test with dedicated isolation tests.
  mountReports(app, { db: deps.db, pool: deps.pool })

  // API-key management (E06-3) — tenant-admin only; dedicated route, EXEMPT from the manifest.
  mountApiKeys(app, { db: deps.db })

  return app
}
