import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  TENANT_PLANS,
  isDirectPlan,
  planEntitlements,
  tenantPlanSchema,
  type TenantPlan,
} from '../src/plans.js'

describe('tenant plans contract', () => {
  it('mirrors the Prisma TenantPlan enum exactly (order-insensitive, set-equal)', () => {
    const schema = readFileSync(resolve(import.meta.dirname, '../../db/prisma/schema.prisma'), 'utf8')
    const match = /enum TenantPlan \{([^}]+)\}/.exec(schema)
    expect(match).not.toBeNull()
    const prismaPlans = match![1]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('//'))
    expect([...prismaPlans].sort()).toEqual([...TENANT_PLANS].sort())
  })

  it('tenantPlanSchema accepts each plan and rejects unknowns', () => {
    for (const p of TENANT_PLANS) expect(tenantPlanSchema.parse(p)).toBe(p)
    expect(tenantPlanSchema.safeParse('direct').success).toBe(false)
    expect(tenantPlanSchema.safeParse('tsp').success).toBe(false)
    expect(tenantPlanSchema.safeParse('').success).toBe(false)
  })

  it('isDirectPlan splits the two tracks', () => {
    for (const p of ['direct_5', 'direct_10', 'direct_25', 'direct_50', 'direct_100'] as const) {
      expect(isDirectPlan(p)).toBe(true)
    }
    for (const p of ['tsp_start', 'tsp_grow', 'tsp_scale', 'tsp_enterprise'] as const) {
      expect(isDirectPlan(p)).toBe(false)
    }
  })
})

describe('planEntitlements matrix (founder-locked 2026-07-20)', () => {
  const TSP_PLUS = ['whiteLabel', 'customDomains', 'subAccounts', 'apiAccess', 'webhooks', 'prioritySupport'] as const
  const SCALE_PLUS = ['sso', 'dataResidency', 'sla999'] as const

  it('direct_5: deviceLimit 5 and every TSP-plus feature false', () => {
    const e = planEntitlements('direct_5')
    expect(e.deviceLimit).toBe(5)
    for (const k of TSP_PLUS) expect(e[k], k).toBe(false)
    for (const k of SCALE_PLUS) expect(e[k], k).toBe(false)
  })

  it('direct_N device caps map to the plan suffix; all TSP-plus stay false', () => {
    const caps: Record<TenantPlan, number> = {
      direct_5: 5,
      direct_10: 10,
      direct_25: 25,
      direct_50: 50,
      direct_100: 100,
    } as Record<TenantPlan, number>
    for (const [plan, limit] of Object.entries(caps)) {
      const e = planEntitlements(plan as TenantPlan)
      expect(e.deviceLimit, plan).toBe(limit)
      for (const k of TSP_PLUS) expect(e[k], `${plan}.${k}`).toBe(false)
    }
  })

  it('tsp_grow: all TSP-plus true, uncapped, but sso/residency/sla still false', () => {
    const e = planEntitlements('tsp_grow')
    expect(e.deviceLimit).toBeNull()
    for (const k of TSP_PLUS) expect(e[k], k).toBe(true)
    for (const k of SCALE_PLUS) expect(e[k], k).toBe(false)
  })

  it('tsp_start: TSP-plus true, sso/residency/sla false', () => {
    const e = planEntitlements('tsp_start')
    expect(e.deviceLimit).toBeNull()
    for (const k of TSP_PLUS) expect(e[k], k).toBe(true)
    for (const k of SCALE_PLUS) expect(e[k], k).toBe(false)
  })

  it('tsp_scale + tsp_enterprise: sso/dataResidency/sla999 all true', () => {
    for (const plan of ['tsp_scale', 'tsp_enterprise'] as const) {
      const e = planEntitlements(plan)
      expect(e.deviceLimit, plan).toBeNull()
      for (const k of TSP_PLUS) expect(e[k], `${plan}.${k}`).toBe(true)
      for (const k of SCALE_PLUS) expect(e[k], `${plan}.${k}`).toBe(true)
    }
  })
})
