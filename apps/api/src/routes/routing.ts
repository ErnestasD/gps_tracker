import type { Hono } from 'hono'
import type { Redis } from 'ioredis'

import {
  buildMapboxTripPath,
  buildOsrmTripPath,
  mapOsrmTrip,
  OsrmUnroutableError,
  routeOptimizeRequestSchema,
  type RouteOptimizeResult,
  type RouteStop,
} from '@orbetra/shared'

import { problem, type AuthEnv } from '../auth/middleware.js'

// atomic fixed-window (mirrors caddyAsk/pilotRequest): INCR, set TTL on first hit OR re-arm a
// stranded TTL-less key — never leaves a key that would 429 forever
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export interface RoutingDeps {
  redis: Redis
  /**
   * Mapbox access token for the Optimization API (ADR-034). Worldwide coverage, $0 at our volume
   * (100k free requests/month against a few thousand used). SECRET: lives in the server `.env`,
   * never in git — GitHub push protection blocks Mapbox tokens, and rightly.
   */
  mapboxToken?: string
  /** self-hosted OSRM base URL (ADR-029), e.g. http://osrm:5000. The alternative driver, kept so a
   *  customer who genuinely needs more than 12 stops is a config change rather than a rewrite. */
  osrmUrl?: string
  /** injectable for tests; default native fetch (no npm dep — rule 10 / ADR-029). */
  fetchImpl?: typeof fetch
  /** per-USER fixed-window rate limit; default 30/min. */
  rateLimit?: { max: number; windowS: number }
}

/**
 * Which engine answers `/v1/routing/optimize`. Mapbox wins when configured — it needs no dataset,
 * no disk and no quarterly rebuild — and OSRM is the escape hatch for >12 stops (ADR-034).
 *
 * Mapbox Optimization v1 IS OSRM's trip service, so both share `mapOsrmTrip`: one response mapper,
 * no chance of the two drivers disagreeing about what a route means.
 */
function pickEngine(deps: RoutingDeps): { url: (stops: readonly RouteStop[], roundtrip: boolean) => string; name: 'mapbox' | 'osrm' } | null {
  if (deps.mapboxToken !== undefined && deps.mapboxToken !== '') {
    const token = deps.mapboxToken
    return { name: 'mapbox', url: (stops, rt) => `https://api.mapbox.com${buildMapboxTripPath(stops, rt, token)}` }
  }
  if (deps.osrmUrl !== undefined && deps.osrmUrl !== '') {
    const base = deps.osrmUrl
    return { name: 'osrm', url: (stops, rt) => `${base}${buildOsrmTripPath(stops, rt)}` }
  }
  return null
}

/**
 * Route optimization (ADR-029). `POST /v1/routing/optimize` proxies the caller's stops to the
 * self-hosted OSRM `/trip` service (TSP approximation) and returns the optimized visiting order,
 * road geometry and per-leg totals. STATELESS: nothing is persisted and NO tenant data is read,
 * so it is EXEMPT from the isolation manifest (no tenant boundary to defend) — auth is still
 * required (all roles; it burns CPU on our OSRM box, hence the per-user rate limit).
 * Errors: 400 zod (incl. >12 stops — the Mapbox ceiling, ADR-034) · 422 unroutable · 429 over
 * limit · 502 engine unreachable/malformed · 503 no engine configured.
 */
export function mountRouting(app: Hono<AuthEnv>, deps: RoutingDeps): void {
  const limit = deps.rateLimit ?? { max: 30, windowS: 60 }
  const fetchImpl = deps.fetchImpl ?? fetch

  app.post('/v1/routing/optimize', async (c) => {
    const auth = c.get('auth')
    c.header('Cache-Control', 'no-store')
    // config-missing → 503 BEFORE spending the caller's rate-limit budget (caddyAsk pattern)
    const engine = pickEngine(deps)
    if (engine === null) {
      return problem(c, 503, 'Service Unavailable', 'route optimization is not configured (MAPBOX_TOKEN or OSRM_URL)')
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

    let body: unknown
    try {
      // NB: both engines answer non-200 for NoSegment etc. WITH a JSON body — parse regardless of
      // status and let mapOsrmTrip translate the code (422 vs 502)
      const res = await fetchImpl(engine.url(parsed.data.stops, parsed.data.roundtrip), { signal: AbortSignal.timeout(5_000) })
      body = await res.json()
    } catch {
      // the URL carries the access token as a query parameter, so it must NEVER reach a log or a
      // response body (rule 12) — the engine name is all the caller or the operator needs
      return problem(c, 502, 'Bad Gateway', 'routing engine unreachable')
    }

    try {
      const result: RouteOptimizeResult = mapOsrmTrip(body, parsed.data.stops)
      return c.json(result)
    } catch (err) {
      if (err instanceof OsrmUnroutableError) {
        // Mapbox covers the planet, so an unroutable answer really does mean the stops cannot be
        // connected by road (an island, a pedestrian-only address) — no region caveat to add.
        return problem(c, 422, 'Unprocessable Entity', `no road route connects these stops (${err.code})`)
      }
      return problem(c, 502, 'Bad Gateway', 'malformed routing engine response')
    }
  })
}
