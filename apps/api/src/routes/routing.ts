import type { Hono } from 'hono'
import type { Redis } from 'ioredis'

import {
  buildOsrmTripPath,
  mapOsrmTrip,
  OsrmUnroutableError,
  routeOptimizeRequestSchema,
  type RouteOptimizeResult,
} from '@orbetra/shared'

import { problem, type AuthEnv } from '../auth/middleware.js'

// atomic fixed-window (mirrors caddyAsk/pilotRequest): INCR, set TTL on first hit OR re-arm a
// stranded TTL-less key — never leaves a key that would 429 forever
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export interface RoutingDeps {
  redis: Redis
  /** self-hosted OSRM base URL (ADR-029), e.g. http://osrm:5000; absent ⇒ 503. */
  osrmUrl?: string
  /** injectable for tests; default native fetch (no npm dep — rule 10 / ADR-029). */
  fetchImpl?: typeof fetch
  /** per-USER fixed-window rate limit; default 30/min. */
  rateLimit?: { max: number; windowS: number }
}

/**
 * Route optimization (ADR-029). `POST /v1/routing/optimize` proxies the caller's stops to the
 * self-hosted OSRM `/trip` service (TSP approximation) and returns the optimized visiting order,
 * road geometry and per-leg totals. STATELESS: nothing is persisted and NO tenant data is read,
 * so it is EXEMPT from the isolation manifest (no tenant boundary to defend) — auth is still
 * required (all roles; it burns CPU on our OSRM box, hence the per-user rate limit).
 * Errors: 400 zod · 422 unroutable (stop outside covered region) · 429 over limit ·
 * 502 OSRM unreachable/malformed · 503 OSRM_URL unset.
 */
export function mountRouting(app: Hono<AuthEnv>, deps: RoutingDeps): void {
  const limit = deps.rateLimit ?? { max: 30, windowS: 60 }
  const fetchImpl = deps.fetchImpl ?? fetch

  app.post('/v1/routing/optimize', async (c) => {
    const auth = c.get('auth')
    c.header('Cache-Control', 'no-store')
    // config-missing → 503 BEFORE spending the caller's rate-limit budget (caddyAsk pattern)
    if (deps.osrmUrl === undefined || deps.osrmUrl === '') {
      return problem(c, 503, 'Service Unavailable', 'route optimization is not configured (OSRM_URL)')
    }

    // per-user fixed window (atomic) — bounds the CPU one caller can burn on the OSRM box
    try {
      const n = (await deps.redis.eval(RL_SCRIPT, 1, `routing:rl:${auth.userId}`, String(limit.windowS))) as number
      if (n > limit.max) return problem(c, 429, 'Too Many Requests')
    } catch {
      /* fail OPEN on a Redis blip — availability wins; OSRM has its own --max-trip-size guard */
    }

    const parsed = routeOptimizeRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')

    const path = buildOsrmTripPath(parsed.data.stops, parsed.data.roundtrip)
    let body: unknown
    try {
      // NB: OSRM answers non-200 for NoSegment etc. WITH a JSON body — parse regardless of
      // status and let mapOsrmTrip translate the code (422 vs 502)
      const res = await fetchImpl(`${deps.osrmUrl}${path}`, { signal: AbortSignal.timeout(5_000) })
      body = await res.json()
    } catch {
      return problem(c, 502, 'Bad Gateway', 'routing engine unreachable')
    }

    try {
      const result: RouteOptimizeResult = mapOsrmTrip(body, parsed.data.stops)
      return c.json(result)
    } catch (err) {
      if (err instanceof OsrmUnroutableError) {
        // name the region: the pilot dataset covers Lithuania only (ADR-029)
        return problem(c, 422, 'Unprocessable Entity', `no road route connects these stops (${err.code}) — the routing dataset covers Lithuania only`)
      }
      return problem(c, 502, 'Bad Gateway', 'malformed routing engine response')
    }
  })
}
