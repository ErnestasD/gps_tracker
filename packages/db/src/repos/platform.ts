import type { PrismaClient } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { Actor } from '../scope.js'

/**
 * The platform console's data layer — the ONLY unscoped repository in the codebase.
 *
 * Every other repo takes a tenant scope because tenant isolation is invariant I1. This one exists
 * precisely to cross that line, so two rules hold instead:
 *
 *  1. Reachable ONLY from a `scopeClass: 'platform'` route, which the API gates on `platform_admin`.
 *     Nothing here may be called from a tenant-scoped handler — the route class is the boundary.
 *  2. It answers in AGGREGATES. A platform admin steering the business needs "eleven tenants, two
 *     of them lapsing, €2 340 at list"; they do not need one customer's geofence crossings. Detail
 *     belongs to the tenant's own screens, where the scope check lives. Where a row-level list IS
 *     returned (users, failures) it is bounded and carries the tenant name, because the question
 *     being asked is "which customer is this happening to", not "what happened".
 */
export interface PlatformOverview {
  tenants: { total: number; byPlan: Record<string, number>; payingByPlan: Record<string, number>; suspended: number; lapsing: number; trialing: number; paying: number; enterprise: number }
  users: { total: number; activeLast30d: number; neverLoggedIn: number; disabled: number }
  devices: { total: number; active: number; retired: number }
  /** recurring revenue at LIST price — see PLAN_MONTHLY_EUR; enterprise is quoted per deal and excluded */
  revenue: { monthlyEurAtList: number; pricedTenants: number; unpricedTenants: number }
  growth: { tenantsLast30d: number; usersLast30d: number }
  partners: { total: number; active: number; referredTenants: number }
}

export interface PlatformUser {
  id: string
  email: string
  role: string
  tenantId: string
  tenantName: string
  accountId: string | null
  locale: string
  createdAt: string
  lastLoginAt: string | null
  emailVerifiedAt: string | null
  disabledAt: string | null
}

export interface PlatformBillingRow {
  tenantId: string
  tenantName: string
  plan: string
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  stripeCustomerId: string | null
  subscriptionPriceId: string | null
  activeDevices: number
  suspendedAt: string | null
}

export interface PlatformLapse {
  tenantId: string
  tenantName: string
  plan: string
  subscriptionStatus: string | null
  /** end of the paid period — the moment the lapse started counting */
  currentPeriodEnd: string | null
  /** 0 none, 1 grace-end, 2 day+1, 3 day+2 (final) — 3 means the next run suspends them */
  lapseNoticeStage: number
  lapseNoticeFor: string | null
  suspendedAt: string | null
  activeDevices: number
  billingEmail: string | null
}

export interface PlatformFailure {
  kind: 'webhook' | 'sms' | 'email'
  tenantId: string
  tenantName: string
  count: number
  lastAt: string | null
  lastError: string | null
}

export interface PlatformRepo {
  overview(now: Date): Promise<PlatformOverview>
  users(opts: { limit: number; search?: string }): Promise<PlatformUser[]>
  setUserDisabled(actor: Actor, userId: string, disabled: boolean): Promise<PlatformUser | null>
  /** stamped on every successful login; best-effort, never blocks the response */
  touchLogin(userId: string, at: Date): Promise<void>
  billing(): Promise<PlatformBillingRow[]>
  lapses(now: Date): Promise<PlatformLapse[]>
  failures(since: Date, limit: number): Promise<PlatformFailure[]>
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

export function createPlatformRepo(prisma: PrismaClient, audit: AuditRepo): PlatformRepo {
  /** active = not retired. Counted per tenant in ONE query rather than N. */
  const activeDeviceCounts = async (): Promise<Map<string, number>> => {
    const rows = await prisma.device.groupBy({ by: ['tenantId'], where: { retiredAt: null }, _count: { _all: true } })
    return new Map(rows.map((r) => [r.tenantId, r._count._all]))
  }

  return {
    overview: async (now) => {
      const day30 = new Date(now.getTime() - 30 * 86_400_000)
      const [tenants, userAgg, deviceAgg, affiliates] = await Promise.all([
        prisma.tenant.findMany({
          select: { id: true, plan: true, subscriptionStatus: true, suspendedAt: true, lapseNoticeStage: true, createdAt: true, referredByAffiliateId: true },
        }),
        prisma.user.findMany({ select: { lastLoginAt: true, disabledAt: true, createdAt: true } }),
        prisma.device.groupBy({ by: ['retiredAt'], _count: { _all: true } }),
        prisma.affiliate.findMany({ select: { status: true } }),
      ])

      const byPlan: Record<string, number> = {}
      // Revenue counts the PAYING population only. Counting every tenant would price trials and
      // cancelled accounts as income, which is the one number a founder must never see inflated.
      const payingByPlan: Record<string, number> = {}
      let suspended = 0
      let lapsing = 0
      let trialing = 0
      let paying = 0
      let enterprise = 0
      let tenantsLast30d = 0
      let referredTenants = 0
      for (const t of tenants) {
        byPlan[t.plan] = (byPlan[t.plan] ?? 0) + 1
        if (t.suspendedAt !== null) suspended++
        // "lapsing" is the ladder actually running — a stage above zero and not yet cut off. This
        // is the population the founder must act on TODAY, distinct from those already suspended.
        if (t.lapseNoticeStage > 0 && t.suspendedAt === null) lapsing++
        if (t.subscriptionStatus === 'trialing') trialing++
        if (t.subscriptionStatus === 'active' || t.subscriptionStatus === 'past_due') {
          paying++
          // past_due is still counted: the money is contracted and the dunning window is open, so
          // dropping it would make revenue lurch down on a card retry and back up when it clears.
          payingByPlan[t.plan] = (payingByPlan[t.plan] ?? 0) + 1
        }
        if (t.plan === 'tsp_enterprise') enterprise++
        if (t.createdAt >= day30) tenantsLast30d++
        if (t.referredByAffiliateId !== null) referredTenants++
      }

      const totalDevices = deviceAgg.reduce((n, r) => n + r._count._all, 0)
      const retiredDevices = deviceAgg.filter((r) => r.retiredAt !== null).reduce((n, r) => n + r._count._all, 0)

      return {
        tenants: { total: tenants.length, byPlan, payingByPlan, suspended, lapsing, trialing, paying, enterprise },
        users: {
          total: userAgg.length,
          activeLast30d: userAgg.filter((u) => u.lastLoginAt !== null && u.lastLoginAt >= day30).length,
          neverLoggedIn: userAgg.filter((u) => u.lastLoginAt === null).length,
          disabled: userAgg.filter((u) => u.disabledAt !== null).length,
        },
        devices: { total: totalDevices, active: totalDevices - retiredDevices, retired: retiredDevices },
        // priced in the API layer, which owns the plan→price map (packages/shared); the repo
        // returns the counts it can prove and lets the caller apply the list prices
        revenue: { monthlyEurAtList: 0, pricedTenants: 0, unpricedTenants: enterprise },
        growth: { tenantsLast30d, usersLast30d: userAgg.filter((u) => u.createdAt >= day30).length },
        partners: { total: affiliates.length, active: affiliates.filter((a) => a.status === 'active').length, referredTenants },
      }
    },

    users: async (opts) => {
      const search = opts.search?.trim().toLowerCase()
      const rows = await prisma.user.findMany({
        where: search !== undefined && search !== '' ? { email: { contains: search, mode: 'insensitive' } } : {},
        select: {
          id: true, email: true, role: true, tenantId: true, accountId: true, locale: true,
          createdAt: true, lastLoginAt: true, emailVerifiedAt: true, disabledAt: true,
          tenant: { select: { name: true } },
        },
        // never-logged-in users sort last rather than first: the console opens on who is USING the
        // product, and a page of dormant seats would bury that
        orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: opts.limit,
      })
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        tenantId: r.tenantId,
        tenantName: r.tenant.name,
        accountId: r.accountId,
        locale: r.locale,
        createdAt: r.createdAt.toISOString(),
        lastLoginAt: iso(r.lastLoginAt),
        emailVerifiedAt: iso(r.emailVerifiedAt),
        disabledAt: iso(r.disabledAt),
      }))
    },

    setUserDisabled: async (actor, userId, disabled) => {
      const before = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, tenantId: true, disabledAt: true } })
      if (before === null) return null
      const row = await prisma.user.update({
        where: { id: userId },
        // Disabling REVOKES live sessions too. Without it the block only stops the next login while
        // the tab they already have open keeps working until its refresh expires — which is not
        // what anyone means by "disable this account".
        data: disabled ? { disabledAt: new Date(), sessionsRevokedAt: new Date() } : { disabledAt: null },
        select: {
          id: true, email: true, role: true, tenantId: true, accountId: true, locale: true,
          createdAt: true, lastLoginAt: true, emailVerifiedAt: true, disabledAt: true,
          tenant: { select: { name: true } },
        },
      })
      // `update`, not a bespoke 'disable' action: the audit vocabulary is create|update|delete
      // everywhere, and the before/after pair already says which way this went. Widening the union
      // for one screen would make every existing audit reader handle a verb it has never seen.
      await audit.recordPlatform(actor, {
        action: 'update',
        entity: 'user',
        entityId: userId,
        before: { email: before.email, tenantId: before.tenantId, disabledAt: iso(before.disabledAt) },
        after: { email: row.email, tenantId: row.tenantId, disabledAt: iso(row.disabledAt) },
      })
      return {
        id: row.id,
        email: row.email,
        role: row.role,
        tenantId: row.tenantId,
        tenantName: row.tenant.name,
        accountId: row.accountId,
        locale: row.locale,
        createdAt: row.createdAt.toISOString(),
        lastLoginAt: iso(row.lastLoginAt),
        emailVerifiedAt: iso(row.emailVerifiedAt),
        disabledAt: iso(row.disabledAt),
      }
    },

    touchLogin: async (userId, at) => {
      // `updateMany` rather than `update`: a user deleted between the credential check and this
      // write must not turn a successful login into a 500 over a statistic.
      await prisma.user.updateMany({ where: { id: userId }, data: { lastLoginAt: at } })
    },

    billing: async () => {
      const [tenants, counts] = await Promise.all([
        prisma.tenant.findMany({
          select: {
            id: true, name: true, plan: true, subscriptionStatus: true, currentPeriodEnd: true,
            stripeCustomerId: true, subscriptionPriceId: true, suspendedAt: true,
          },
          orderBy: { name: 'asc' },
        }),
        activeDeviceCounts(),
      ])
      return tenants.map((t) => ({
        tenantId: t.id,
        tenantName: t.name,
        plan: t.plan,
        subscriptionStatus: t.subscriptionStatus,
        currentPeriodEnd: iso(t.currentPeriodEnd),
        stripeCustomerId: t.stripeCustomerId,
        subscriptionPriceId: t.subscriptionPriceId,
        activeDevices: counts.get(t.id) ?? 0,
        suspendedAt: iso(t.suspendedAt),
      }))
    },

    lapses: async () => {
      const [tenants, counts] = await Promise.all([
        prisma.tenant.findMany({
          // Everything the ladder can act on: a stage already recorded, a status Stripe calls
          // delinquent, or an account already cut off. A tenant that simply never subscribed is
          // NOT a lapse — it is a trial, and mixing the two makes the list unusable.
          where: { OR: [{ lapseNoticeStage: { gt: 0 } }, { subscriptionStatus: { in: ['past_due', 'unpaid'] } }, { suspendedAt: { not: null } }] },
          select: {
            id: true, name: true, plan: true, subscriptionStatus: true, currentPeriodEnd: true,
            lapseNoticeStage: true, lapseNoticeFor: true, suspendedAt: true,
            users: { where: { role: 'tsp_admin' }, select: { email: true }, orderBy: { createdAt: 'asc' }, take: 1 },
          },
          orderBy: [{ lapseNoticeStage: 'desc' }, { currentPeriodEnd: 'asc' }],
        }),
        activeDeviceCounts(),
      ])
      return tenants.map((t) => ({
        tenantId: t.id,
        tenantName: t.name,
        plan: t.plan,
        subscriptionStatus: t.subscriptionStatus,
        currentPeriodEnd: iso(t.currentPeriodEnd),
        lapseNoticeStage: t.lapseNoticeStage,
        lapseNoticeFor: iso(t.lapseNoticeFor),
        suspendedAt: iso(t.suspendedAt),
        activeDevices: counts.get(t.id) ?? 0,
        billingEmail: t.users[0]?.email ?? null,
      }))
    },

    failures: async (since, limit) => {
      // GROUPED BY TENANT, not listed per event. Two hundred identical webhook failures from one
      // broken endpoint is ONE problem belonging to ONE customer; rendering it as two hundred rows
      // buries the second customer whose integration also broke. The founder asked for the view
      // from above, and this is what that means for errors.
      const [webhooks, sms, suppressions, tenants] = await Promise.all([
        prisma.webhookDelivery.groupBy({
          by: ['tenantId'],
          where: { success: false, at: { gte: since } },
          _count: { _all: true },
          _max: { at: true },
        }),
        prisma.smsDelivery.groupBy({
          by: ['tenantId'],
          where: { status: 'failed', createdAt: { gte: since } },
          _count: { _all: true },
          _max: { createdAt: true },
        }),
        prisma.emailSuppression.findMany({ where: { createdAt: { gte: since } }, select: { address: true, reason: true, createdAt: true }, take: limit }),
        prisma.tenant.findMany({ select: { id: true, name: true } }),
      ])
      const nameOf = new Map(tenants.map((t) => [t.id, t.name]))

      const out: PlatformFailure[] = []
      for (const w of webhooks.slice(0, limit)) {
        const last = await prisma.webhookDelivery.findFirst({
          where: { tenantId: w.tenantId, success: false, at: { gte: since } },
          orderBy: { at: 'desc' },
          select: { error: true, statusCode: true },
        })
        out.push({
          kind: 'webhook',
          tenantId: w.tenantId,
          tenantName: nameOf.get(w.tenantId) ?? '(deleted tenant)',
          count: w._count._all,
          lastAt: iso(w._max.at),
          lastError: last?.error ?? (last?.statusCode != null ? `HTTP ${last.statusCode}` : null),
        })
      }
      for (const s of sms.slice(0, limit)) {
        const last = await prisma.smsDelivery.findFirst({
          where: { tenantId: s.tenantId, status: 'failed', createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          select: { error: true },
        })
        out.push({
          kind: 'sms',
          tenantId: s.tenantId,
          tenantName: nameOf.get(s.tenantId) ?? '(deleted tenant)',
          count: s._count._all,
          lastAt: iso(s._max.createdAt),
          lastError: last?.error ?? null,
        })
      }
      // Undeliverable addresses have no tenant column — they are platform-wide by construction, and
      // they matter here because the lapse ladder stops for a customer we cannot reach at all.
      if (suppressions.length > 0) {
        const newest = suppressions.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
        out.push({
          kind: 'email',
          tenantId: '',
          tenantName: '(platform)',
          count: suppressions.length,
          lastAt: newest.createdAt.toISOString(),
          lastError: `${newest.reason}: ${newest.address}`,
        })
      }
      return out.sort((a, b) => b.count - a.count)
    },
  }
}
