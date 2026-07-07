import type { Hono } from 'hono'

import { requireRole, type AuthContext, type AuthEnv } from '../auth/middleware.js'

export type Method = 'get' | 'post' | 'patch' | 'delete'
export type ScopeClass = 'public' | 'tenant' | 'account' | 'platform'

export interface RouteDef {
  method: Method
  /** Hono path, e.g. '/v1/accounts' or '/v1/accounts/:id'. */
  path: string
  scopeClass: ScopeClass
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
  entity: string
  shape: 'collection' | 'item'
}

export const toManifest = (defs: RouteDef[]): ManifestEntry[] =>
  defs.map(({ method, path, scopeClass, entity, shape }) => ({ method, path, scopeClass, entity, shape }))

/**
 * Register every route from its definition (E03-2). Platform routes get a
 * `requireRole('platform_admin')` guard; auth is already applied to /v1/* by
 * createApp. Registration is manifest-driven, so the exported manifest and the
 * live routes CANNOT drift — the isolation suite's meta-test proves it.
 */
export function mountRoutes(app: Hono<AuthEnv>, defs: RouteDef[]): void {
  for (const def of defs) {
    // platform routes get the role guard; auth is already applied to /v1/* upstream.
    // Explicit per-method dispatch keeps Hono's typed overloads (indexed method
    // access erases them).
    const guard = def.scopeClass === 'platform' ? requireRole('platform_admin') : null
    if (def.method === 'get') {
      if (guard) app.get(def.path, guard, def.handler)
      else app.get(def.path, def.handler)
    } else if (def.method === 'post') {
      if (guard) app.post(def.path, guard, def.handler)
      else app.post(def.path, def.handler)
    } else if (def.method === 'patch') {
      if (guard) app.patch(def.path, guard, def.handler)
      else app.patch(def.path, def.handler)
    } else {
      if (guard) app.delete(def.path, guard, def.handler)
      else app.delete(def.path, def.handler)
    }
  }
}

/** auth claims → repo Scope. Account-scoped users are pinned to their account. */
export function scopeOf(auth: AuthContext): { tenantId: string; accountId?: string } {
  return auth.accountId !== undefined
    ? { tenantId: auth.tenantId, accountId: auth.accountId }
    : { tenantId: auth.tenantId }
}
