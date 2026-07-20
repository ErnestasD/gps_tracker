import type { Hono } from 'hono'

import type { Db } from '@orbetra/db'
import type { EntitlementKey, Role } from '@orbetra/shared'

import { requireEntitlement } from '../auth/entitlements.js'
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
  /** Tenant-plan gate (WP2): when set, requireEntitlement runs AFTER the role gate — both
   * must pass. Declarative so the isolation meta-test can read plan-gating off the manifest. */
  entitlement?: EntitlementKey
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
  /** Tenant-plan gate (WP2) — present on the manifest so the isolation meta-test reads it. */
  entitlement?: EntitlementKey
}

export const toManifest = (defs: RouteDef[]): ManifestEntry[] =>
  defs.map(({ method, path, scopeClass, roles, entity, shape, entitlement }) => ({
    method, path, scopeClass, roles, entity, shape,
    ...(entitlement !== undefined ? { entitlement } : {}),
  }))

/**
 * Register every route from its definition (E03-2). Platform routes get a
 * `requireRole('platform_admin')` guard; auth is already applied to /v1/* by
 * createApp. Registration is manifest-driven, so the exported manifest and the
 * live routes CANNOT drift — the isolation suite's meta-test proves it.
 */
export function mountRoutes(app: Hono<AuthEnv>, defs: RouteDef[], db: Db): void {
  for (const def of defs) {
    // EVERY route carries an explicit allowed-roles list (review HIGH: writes were
    // unguarded). auth is already applied to /v1/* upstream, so requireRole sees
    // c.get('auth'). A route may ALSO carry a tenant-plan `entitlement` (WP2): the
    // plan gate is chained AFTER the role gate, so BOTH must pass. Explicit per-method
    // dispatch keeps Hono's typed overloads.
    const role = requireRole(...def.roles)
    if (def.entitlement !== undefined) {
      // role gate THEN plan gate — both must pass. Explicit fixed-arity calls (no spread) keep
      // Hono's typed handler overloads.
      const plan = requireEntitlement(db, def.entitlement)
      if (def.method === 'get') app.get(def.path, role, plan, def.handler)
      else if (def.method === 'post') app.post(def.path, role, plan, def.handler)
      else if (def.method === 'patch') app.patch(def.path, role, plan, def.handler)
      else app.delete(def.path, role, plan, def.handler)
    } else {
      if (def.method === 'get') app.get(def.path, role, def.handler)
      else if (def.method === 'post') app.post(def.path, role, def.handler)
      else if (def.method === 'patch') app.patch(def.path, role, def.handler)
      else app.delete(def.path, role, def.handler)
    }
  }
}

/** auth claims → repo Scope. Account-scoped users are pinned to their account. */
export function scopeOf(auth: AuthContext): { tenantId: string; accountId?: string } {
  return auth.accountId !== undefined
    ? { tenantId: auth.tenantId, accountId: auth.accountId }
    : { tenantId: auth.tenantId }
}
