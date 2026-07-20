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
}

export type AuthEnv = { Variables: { auth: AuthContext } }

/** RFC 7807 problem response (§6.6 error convention). */
export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  detail?: string,
  type = 'about:blank',
): Response {
  // c.body (not c.json): c.json stamps application/json over any preset header
  return c.body(
    JSON.stringify({ type, title, status, ...(detail !== undefined ? { detail } : {}) }),
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
        return out.error === 'rate_limited' ? problem(c, 429, 'Too Many Requests') : problem(c, 401, 'Unauthorized')
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
