import type { Hono } from 'hono'

import type { Role } from '@orbetra/shared'

import { requireRole, type AuthContext, type AuthEnv } from '../auth/middleware.js'

export type Method = 'get' | 'post' | 'patch' | 'delete'
export type ScopeClass = 'public' | 'tenant' | 'account' | 'platform'

export interface RouteDef {
  method: Method
  /** Hono path, e.g. '/v1/accounts' or '/v1/accounts/:id'. */
  path: string
  scopeClass: ScopeClass
  /** Roles allowed to CALL this route (E03-2 review HIGH: writes were unguarded). */
  roles: Role[]
  /** Isolation-suite metadata: which seeded fixture entity this route addresses. */
  entity: string
  /** 'item' routes carry a :id param (cross-tenant target → 404); 'collection' don't. */
  shape: 'collection' | 'item'
  handler: (c: import('hono').Context<AuthEnv>) => Response | Promise<Response>
}

/** Manifest entry the isolation suite iterates (no handler — just the contract). */
export interface ManifestEntry {
  method: Method
  path: string
  scopeClass: ScopeClass
  roles: Role[]
  entity: string
  shape: 'collection' | 'item'
}

export const toManifest = (defs: RouteDef[]): ManifestEntry[] =>
  defs.map(({ method, path, scopeClass, roles, entity, shape }) => ({ method, path, scopeClass, roles, entity, shape }))

/**
 * Register every route from its definition (E03-2). Platform routes get a
 * `requireRole('platform_admin')` guard; auth is already applied to /v1/* by
 * createApp. Registration is manifest-driven, so the exported manifest and the
 * live routes CANNOT drift — the isolation suite's meta-test proves it.
 */
export function mountRoutes(app: Hono<AuthEnv>, defs: RouteDef[]): void {
  for (const def of defs) {
    // EVERY route carries an explicit allowed-roles list (review HIGH: writes were
    // unguarded). auth is already applied to /v1/* upstream, so requireRole sees
    // c.get('auth'). Explicit per-method dispatch keeps Hono's typed overloads.
    const guard = requireRole(...def.roles)
    if (def.method === 'get') app.get(def.path, guard, def.handler)
    else if (def.method === 'post') app.post(def.path, guard, def.handler)
    else if (def.method === 'patch') app.patch(def.path, guard, def.handler)
    else app.delete(def.path, guard, def.handler)
  }
}

/** auth claims → repo Scope. Account-scoped users are pinned to their account. */
export function scopeOf(auth: AuthContext): { tenantId: string; accountId?: string } {
  return auth.accountId !== undefined
    ? { tenantId: auth.tenantId, accountId: auth.accountId }
    : { tenantId: auth.tenantId }
}
