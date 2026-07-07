import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { Role } from '@orbetra/shared'

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

/** Bearer JWT → c.set('auth', ctx); 401 problem+json otherwise. */
export function authMiddleware(cfg: { jwtSecret: string }): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
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
