import type { Hono } from 'hono'

import type { Db } from '@orbetra/db'
import { apiKeyCreateSchema, type Role } from '@orbetra/shared'

import { hasEntitlement } from '../auth/entitlements.js'
import { problem, type AuthEnv } from '../auth/middleware.js'
import { scopeOf } from './registry.js'

/**
 * API-key management (E06-3). Tenant-admin only — minting a key is privileged config, so an
 * API key itself (role `viewer`) can never reach these routes (no privilege escalation). Not
 * a manifest CRUD entity (create returns the plaintext key ONCE, a non-standard shape), so
 * registered here and EXEMPT from the manifest meta-test, with dedicated isolation tests. The
 * plaintext key is shown once on create and never retrievable again (only its hash is stored).
 */
const TENANT_ADMINS: Role[] = ['platform_admin', 'tsp_admin']

export function mountApiKeys(app: Hono<AuthEnv>, deps: { db: Db }): void {
  const admin = (c: { get: (k: 'auth') => { role: Role } }): boolean => TENANT_ADMINS.includes(c.get('auth').role)

  // apiAccess is a Track-B (TSP) entitlement: Direct plans get NO REST API. Gate INLINE next to
  // the admin role check on every api-key route — both the role AND the plan gate must pass (WP2).
  const apiAccess = (c: { get: (k: 'auth') => { tenantId: string } }): Promise<boolean> =>
    hasEntitlement(deps.db, c.get('auth').tenantId, 'apiAccess')

  app.get('/v1/api-keys', async (c) => {
    if (!admin(c)) return problem(c, 403, 'Forbidden')
    if (!(await apiAccess(c))) return problem(c, 403, 'Forbidden', 'plan_upgrade_required')
    c.header('Cache-Control', 'no-store')
    return c.json(await deps.db.apiKeys.list(scopeOf(c.get('auth'))))
  })

  app.post('/v1/api-keys', async (c) => {
    if (!admin(c)) return problem(c, 403, 'Forbidden')
    if (!(await apiAccess(c))) return problem(c, 403, 'Forbidden', 'plan_upgrade_required')
    const parsed = apiKeyCreateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')
    const auth = c.get('auth')
    // a named account must be within the caller's tenant scope (null = tenant-wide read)
    if (parsed.data.accountId != null && (await deps.db.accounts.get(scopeOf(auth), parsed.data.accountId)) === null) {
      return problem(c, 400, 'Bad Request', 'accountId not in scope')
    }
    const created = await deps.db.apiKeys.create(scopeOf(auth), { userId: auth.userId }, parsed.data)
    c.header('Cache-Control', 'no-store')
    // the plaintext `key` is returned ONCE here and never again
    return c.json({ key: created.key, ...created.view }, 201)
  })

  app.delete('/v1/api-keys/:id', async (c) => {
    if (!admin(c)) return problem(c, 403, 'Forbidden')
    if (!(await apiAccess(c))) return problem(c, 403, 'Forbidden', 'plan_upgrade_required')
    const ok = await deps.db.apiKeys.revoke(scopeOf(c.get('auth')), { userId: c.get('auth').userId }, c.req.param('id'))
    return ok ? c.json({ ok: true }) : problem(c, 404, 'Not Found')
  })
}
