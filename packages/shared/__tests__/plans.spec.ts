import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  FLOOR_ENTITLEMENTS,
  TENANT_PLANS,
  effectiveEntitlements,
  effectiveEntitlementsAt,
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
  const TSP_PLUS = ['whiteLabel', 'customDomains', 'subAccounts', 'apiAccess', 'webhooks', 'prioritySupport', 'smsGateway'] as const
  // `sso` and `dataResidency` used to be here. They granted nothing — no SSO code path, no
  // residency routing existed — so they were removed from the matrix rather than left as promises
  // the product cannot keep. Re-add them WITH the implementation (audit finding, founder decision).
  const SCALE_PLUS = ['sla999'] as const

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

  it('tsp_grow: all TSP-plus true, uncapped, but sla999 still false', () => {
    const e = planEntitlements('tsp_grow')
    expect(e.deviceLimit).toBeNull()
    for (const k of TSP_PLUS) expect(e[k], k).toBe(true)
    for (const k of SCALE_PLUS) expect(e[k], k).toBe(false)
  })

  it('tsp_start: TSP-plus true, sla999 false', () => {
    const e = planEntitlements('tsp_start')
    expect(e.deviceLimit).toBeNull()
    for (const k of TSP_PLUS) expect(e[k], k).toBe(true)
    for (const k of SCALE_PLUS) expect(e[k], k).toBe(false)
  })

  it('tsp_scale + tsp_enterprise: sla999 all true', () => {
    for (const plan of ['tsp_scale', 'tsp_enterprise'] as const) {
      const e = planEntitlements(plan)
      expect(e.deviceLimit, plan).toBeNull()
      for (const k of TSP_PLUS) expect(e[k], `${plan}.${k}`).toBe(true)
      for (const k of SCALE_PLUS) expect(e[k], `${plan}.${k}`).toBe(true)
    }
  })
})

describe('effectiveEntitlements — subscription-status gating (revenue-leak fix)', () => {
  it('active / trialing / past_due(grace) / null keep the full plan matrix', () => {
    for (const status of ['active', 'trialing', 'past_due', null]) {
      expect(effectiveEntitlements('tsp_grow', status), String(status)).toEqual(planEntitlements('tsp_grow'))
    }
  })

  it('a LAPSED subscription (canceled/unpaid/incomplete_expired/paused) drops to the zero floor', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
      const e = effectiveEntitlements('tsp_grow', status)
      expect(e, status).toEqual(FLOOR_ENTITLEMENTS)
      expect(e.smsGateway, status).toBe(false) // billable feature is cut off
      expect(e.apiAccess, status).toBe(false)
      expect(e.deviceLimit, status).toBe(0) // no new devices while lapsed
    }
  })

  it('flooring is plan-independent — a lapsed direct_50 also gets nothing', () => {
    expect(effectiveEntitlements('direct_50', 'canceled')).toEqual(FLOOR_ENTITLEMENTS)
  })
})

describe('effectiveEntitlementsAt — the F2 trial window (review HIGH: never floor a PAYING trial)', () => {
  const past = new Date('2026-01-01T00:00:00Z')
  const future = new Date('2099-01-01T00:00:00Z')
  const now = new Date('2026-06-01T00:00:00Z')

  it('floors an EXPIRED local trial (no Stripe subscription behind it)', () => {
    expect(effectiveEntitlementsAt('direct_10', 'trialing', past, null, now)).toEqual(FLOOR_ENTITLEMENTS)
  })

  it('keeps the plan matrix while a local trial is still running', () => {
    expect(effectiveEntitlementsAt('direct_10', 'trialing', future, null, now)).toEqual(planEntitlements('direct_10'))
  })

  it('NEVER floors a STRIPE-side trial, even past its period end — that is a paying customer', () => {
    // a Stripe trial carries a subscription id; between trial end and the subscription.updated
    // webhook the old code stripped white-label/API/webhooks and set deviceLimit 0 on a live account
    expect(effectiveEntitlementsAt('tsp_grow', 'trialing', past, 'sub_123', now)).toEqual(planEntitlements('tsp_grow'))
    expect(effectiveEntitlementsAt('tsp_grow', 'trialing', future, 'sub_123', now)).toEqual(planEntitlements('tsp_grow'))
  })

  it('an unknown discriminator (undefined) is fail-safe — never floors', () => {
    expect(effectiveEntitlementsAt('tsp_grow', 'trialing', past, undefined, now)).toEqual(planEntitlements('tsp_grow'))
  })

  it('still floors a LAPSED subscription regardless of the trial logic', () => {
    expect(effectiveEntitlementsAt('tsp_scale', 'canceled', future, 'sub_1', now)).toEqual(FLOOR_ENTITLEMENTS)
  })

  it('a never-subscribed tenant (null status) keeps its plan', () => {
    expect(effectiveEntitlementsAt('tsp_scale', null, null, null, now)).toEqual(planEntitlements('tsp_scale'))
  })
})
