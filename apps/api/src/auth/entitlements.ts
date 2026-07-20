import type { MiddlewareHandler } from 'hono'

import type { Db } from '@orbetra/db'
import { planEntitlements, type EntitlementKey } from '@orbetra/shared'

import { problem, type AuthEnv } from './middleware.js'

/**
 * Tenant-plan entitlement gate (WP2) — the tenant-level axis that sits ORTHOGONAL to
 * RBAC roles (middleware.ts requireRole). A route may require BOTH a role AND a plan
 * entitlement; this guard runs AFTER requireRole so both must pass. The plan is read
 * from the DB per request (not the JWT) so a downgrade takes effect immediately rather
 * than after the 15-minute access-token TTL — gated routes are low-frequency admin config.
 *
 * A stable `detail:'plan_upgrade_required'` is returned so the web app can key an
 * "upgrade your plan" affordance on it.
 */
export function requireEntitlement(db: Db, key: EntitlementKey): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const plan = await db.tenants.getPlan(c.get('auth').tenantId)
    if (!planEntitlements(plan)[key]) return problem(c, 403, 'Forbidden', 'plan_upgrade_required')
    await next()
  }
}

/**
 * Inline entitlement check for handlers that gate INSIDE the body (dedicated
 * manifest-exempt routes, or where only part of a handler is plan-gated). Reads the
 * tenant's plan and returns whether the boolean feature `key` is enabled.
 */
export async function hasEntitlement(db: Db, tenantId: string, key: EntitlementKey): Promise<boolean> {
  return planEntitlements(await db.tenants.getPlan(tenantId))[key]
}
