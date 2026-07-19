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

/**
 * May `actor` mutate or delete a user who CURRENTLY holds `targetCurrent`? A caller may only
 * act on a user of a STRICTLY LOWER tier — never a peer or higher — EXCEPT platform_admin (the
 * top tier), which may manage anyone. Without this, `canGrantRole` alone let a tsp_admin
 * password-reset/demote/delete a co-tenant platform_admin (no `role` in the body ⇒ the grant
 * check was skipped) → account takeover (audit HIGH). Self-edits are the caller's own concern
 * (an id match), not this function's.
 */
export function canManageUser(actor: Role, targetCurrent: Role): boolean {
  if (actor === 'platform_admin') return true
  return ROLE_TIER[actor] > ROLE_TIER[targetCurrent]
}
