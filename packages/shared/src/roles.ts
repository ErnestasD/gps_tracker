import { z } from 'zod'

/**
 * RBAC roles (PROJECT_PLAN §6.2 hierarchy Platform→TSP→Account→User; E03-1).
 * MUST mirror the Prisma `Role` enum (packages/db/prisma/schema.prisma) —
 * asserted by packages/shared/__tests__/roles.spec.ts.
 */
export const ROLES = ['platform_admin', 'tsp_admin', 'account_manager', 'viewer'] as const

export type Role = (typeof ROLES)[number]

export const roleSchema = z.enum(ROLES)

/** Privilege tiers (higher = more) for grant authorization (E03-2 review HIGH). */
export const ROLE_TIER: Record<Role, number> = {
  viewer: 0,
  account_manager: 1,
  tsp_admin: 2,
  platform_admin: 3,
}

/**
 * May `actor` grant `target` to a user? A caller can only grant a role at or
 * below its own tier, and platform_admin is grantable ONLY by platform_admin —
 * so no tenant-level writer can mint a platform admin (the cross-tenant breach
 * the isolation suite was blind to).
 */
export function canGrantRole(actor: Role, target: Role): boolean {
  if (target === 'platform_admin') return actor === 'platform_admin'
  return ROLE_TIER[actor] >= ROLE_TIER[target]
}
