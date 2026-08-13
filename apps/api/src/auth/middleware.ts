import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { Role } from '@orbetra/shared'

import type { ApiKeyAuth } from './apiKey.js'
import { verifyAccessToken } from './jwt.js'

/** Authenticated request context — claims verified from the access JWT. */
export interface AuthContext {
  userId: string
  tenantId: string
  /** undefined ⇒ tenant-wide visibility; set ⇒ single-account scope (matches ws.ts). */
  accountId?: string
  role: Role
  /** token issued-at (seconds) — ws-ticket issuance rejects a token older than a revoke marker (B1). */
  tokenIssuedAtS?: number
}

export type AuthEnv = { Variables: { auth: AuthContext } }

/**
 * The HTTP reason phrase for the statuses this API returns (RFC 9110 §15).
 *
 * RFC 7807 §4.2: under `type: "about:blank"` the `title` SHOULD be the status code's reason phrase.
 * Call sites drifted — 503 shipped as both 'Unavailable' and 'Service Unavailable', and 400/409/429
 * each carried more than one wording — so a client keying on `title` saw different strings for the
 * same condition. Normalising here fixes every call site at once, including future ones; a caller
 * that supplies a real `type` URI keeps its own title, which is what RFC 7807 intends.
 */
const REASON: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 410: 'Gone',
  413: 'Content Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Content',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
}

/** RFC 7807 problem response (§6.6 error convention). */
export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  detail?: string,
  type = 'about:blank',
): Response {
  // `detail` is where a call site's own wording belongs — it is free-form by design and is left
  // exactly as passed, so nothing that carries meaning to a client is lost by normalising `title`.
  const t = type === 'about:blank' ? REASON[status] ?? title : title
  // c.body (not c.json): c.json stamps application/json over any preset header
  return c.body(
    JSON.stringify({ type, title: t, status, ...(detail !== undefined ? { detail } : {}) }),
    status,
    { 'Content-Type': 'application/problem+json' },
  )
}

/** X-Api-Key → c.set('auth') (read-only), else Bearer JWT → c.set('auth'); 401/429 otherwise.
 * The API-key path (E06-3) is tried first only when the header is present, so the web's JWT
 * flow is unchanged. */
export function authMiddleware(cfg: {
  jwtSecret: string
  apiKey?: ApiKeyAuth
  /** REST API access is a TSP-plus (Track-B) entitlement: a resolved key whose tenant lacks
   *  `apiAccess` is rejected here, so a Direct tenant's pre-existing key can't keep REST access
   *  after a downgrade (review HIGH — key CREATION being gated didn't cover already-minted keys). */
  apiKeyEntitled?: (tenantId: string) => Promise<boolean>
}): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const rawKey = c.req.header('x-api-key')?.trim()
    // only take the API-key branch for a NON-EMPTY key — an empty/whitespace header must not
    // shadow a valid Bearer JWT (review LOW: a proxy that always attaches x-api-key: "")
    if (rawKey && cfg.apiKey !== undefined) {
      const out = await cfg.apiKey.resolve(rawKey)
      if ('error' in out) {
        if (out.error === 'rate_limited') {
          // the published docs promise this header on the per-key 429; the login lockout already
          // sets one, and a client implementing the documented backoff found nothing here
          c.header('Retry-After', String(out.retryAfterS))
          return problem(c, 429, 'Too Many Requests')
        }
        return problem(c, 401, 'Unauthorized')
      }
      if (cfg.apiKeyEntitled !== undefined && !(await cfg.apiKeyEntitled(out.ok.tenantId))) {
        return problem(c, 403, 'Forbidden', 'plan_upgrade_required')
      }
      c.set('auth', out.ok)
      await next()
      return
    }
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) return problem(c, 401, 'Unauthorized')
    const claims = await verifyAccessToken(header.slice('Bearer '.length), cfg.jwtSecret)
    if (claims === null) return problem(c, 401, 'Unauthorized')
    c.set('auth', {
      userId: claims.sub,
      tenantId: claims.ten,
      ...(claims.acc !== undefined ? { accountId: claims.acc } : {}),
      role: claims.role,
      tokenIssuedAtS: claims.iat,
    })
    await next()
  }
}

/**
 * Role guard (E03-1 AC[2]): allowed roles are listed EXPLICITLY at every call
 * site — no implicit platform_admin bypass (explicit beats magic; spread ROLES
 * for "any authenticated user"). Must run after authMiddleware.
 */
export function requireRole(...roles: Role[]): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const auth = c.get('auth')
    if (!roles.includes(auth.role)) return problem(c, 403, 'Forbidden')
    await next()
  }
}
