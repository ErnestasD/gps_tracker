import { z } from 'zod'

/**
 * RBAC roles (PROJECT_PLAN §6.2 hierarchy Platform→TSP→Account→User; E03-1).
 * MUST mirror the Prisma `Role` enum (packages/db/prisma/schema.prisma) —
 * asserted by packages/shared/__tests__/roles.spec.ts.
 */
export const ROLES = ['platform_admin', 'tsp_admin', 'account_manager', 'viewer'] as const

export type Role = (typeof ROLES)[number]

export const roleSchema = z.enum(ROLES)
