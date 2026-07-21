import { z } from 'zod'

/**
 * Tenant plans (founder decision 2026-07-20) — the tenant-level entitlement axis
 * that sits ORTHOGONAL to RBAC roles (roles.ts). Two tracks:
 *   - `direct_N`  — Track A self-service small fleets: single account, NO white-label,
 *                   NO sub-accounts/API/webhooks; capped at N devices.
 *   - `tsp_*`     — Track B white-label/reseller: white-label + custom domains + sub-accounts
 *                   + REST API + webhooks + priority support; no device cap. Scale/Enterprise
 *                   additionally unlock SSO, data residency and the 99.9% SLA.
 *
 * MUST mirror the Prisma `TenantPlan` enum (packages/db/prisma/schema.prisma) —
 * asserted by packages/shared/__tests__/plans.spec.ts, the same pattern as roles.spec.ts.
 */
export const TENANT_PLANS = [
  'direct_5',
  'direct_10',
  'direct_25',
  'direct_50',
  'direct_100',
  'tsp_start',
  'tsp_grow',
  'tsp_scale',
  'tsp_enterprise',
] as const

export type TenantPlan = (typeof TENANT_PLANS)[number]

export const tenantPlanSchema = z.enum(TENANT_PLANS)

/**
 * Derived, typed entitlement matrix — the SINGLE SOURCE consumed by api (403 gating)
 * and web (nav/route hiding). Booleans are hard feature gates; `deviceLimit` is the
 * Direct device cap (null = uncapped, all TSP plans).
 */
export const entitlementsSchema = z.strictObject({
  whiteLabel: z.boolean(),
  customDomains: z.boolean(),
  subAccounts: z.boolean(),
  apiAccess: z.boolean(),
  webhooks: z.boolean(),
  prioritySupport: z.boolean(),
  /** SMS gateway: send Teltonika config SMS to a device's SIM (SMS gateway feature). TSP-only. */
  smsGateway: z.boolean(),
  sso: z.boolean(),
  dataResidency: z.boolean(),
  sla999: z.boolean(),
  /** max non-retired devices; null = uncapped (all TSP plans). */
  deviceLimit: z.number().int().nonnegative().nullable(), // 0 = fail-closed cap; null = uncapped (TSP)
})
export type Entitlements = z.infer<typeof entitlementsSchema>

/** The boolean feature gates only (everything except the numeric deviceLimit). */
export type EntitlementKey = keyof Omit<Entitlements, 'deviceLimit'>

/** Per-Direct-plan device cap; the plan suffix IS the cap. */
const DIRECT_DEVICE_LIMIT: Record<string, number> = {
  direct_5: 5,
  direct_10: 10,
  direct_25: 25,
  direct_50: 50,
  direct_100: 100,
}

/** True for the self-service Track A plans (`direct_*`), false for every `tsp_*` plan. */
export function isDirectPlan(p: TenantPlan): boolean {
  return p.startsWith('direct_')
}

/**
 * The full entitlement matrix for a plan (founder-locked 2026-07-20):
 *   - whiteLabel/customDomains/subAccounts/apiAccess/webhooks/prioritySupport → true for ALL tsp_*, false for all direct_*.
 *   - sso/dataResidency/sla999 → true ONLY for tsp_scale + tsp_enterprise.
 *   - deviceLimit → 5/10/25/50/100 for direct_N, null (uncapped) for all tsp_*.
 */
export function planEntitlements(plan: TenantPlan): Entitlements {
  const tsp = !isDirectPlan(plan)
  const scalePlus = plan === 'tsp_scale' || plan === 'tsp_enterprise'
  return {
    whiteLabel: tsp,
    customDomains: tsp,
    subAccounts: tsp,
    apiAccess: tsp,
    webhooks: tsp,
    prioritySupport: tsp,
    smsGateway: tsp,
    sso: scalePlus,
    dataResidency: scalePlus,
    sla999: scalePlus,
    // FAIL-CLOSED on the cap: an unmapped direct_* plan (e.g. a future enum value added without a
    // DIRECT_DEVICE_LIMIT entry) caps at 0 rather than silently uncapping (review LOW). tsp_* = null (uncapped).
    deviceLimit: tsp ? null : (DIRECT_DEVICE_LIMIT[plan] ?? 0),
  }
}
