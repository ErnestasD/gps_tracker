import type { PrismaClient } from '@prisma/client'

import type { Scope } from '../scope.js'
import { isPgSafeDate } from '../dateGuard.js'

/**
 * Usage metering reads (E07-4). `usage_daily` rows are written by the worker sweep (one row
 * per device per UTC day it reported); these are the read sides:
 * - `platformSummary` — per-tenant device-days + distinct active devices. UNSCOPED BY DESIGN
 *   (the platform panel spans tenants) — the route MUST be platform_admin-gated; never expose
 *   this through a tenant-scoped surface.
 * - `tenantSummary` — the caller's own tenant, per-day counts (a tenant can see its bill).
 * Date bounds are sanitized here so malformed query strings never 500 (house pattern).
 */
export interface PlatformUsageRow {
  tenantId: string
  deviceDays: number
  activeDevices: number
}
export interface TenantUsageRow {
  day: string // YYYY-MM-DD
  deviceDays: number
}
/** Per-ACCOUNT rollup for the reseller dashboard (TSP UX audit): who is using how much. */
export interface AccountUsageRow {
  accountId: string
  deviceDays: number
  activeDevices: number
}
/** What Stripe has been told for one tenant-day. `reported` is CUMULATIVE, not the last delta. */
export interface OverageReport {
  reported: number
  /** the plan's included-device allowance this was computed against — recorded so a later run can see
   *  what the day was actually settled under. */
  included: number | null
  /** the base price the day was settled under. A later run freezes the day when THIS changes (the
   *  plan changed under it), not when `included` changes (STRIPE_INCLUDED was corrected). */
  priceId: string | null
}
export interface UsageRangeOpts {
  from?: string
  to?: string
}
export interface UsageRepo {
  platformSummary(opts?: UsageRangeOpts): Promise<PlatformUsageRow[]>
  tenantSummary(scope: Scope, opts?: UsageRangeOpts): Promise<TenantUsageRow[]>
  /** Tenant-scoped per-account rollup — the reseller's "who uses how much". Route must stay
   *  tenant-wide-gated like /v1/usage (an account-pinned admin must not read siblings). */
  accountSummary(scope: Scope, opts?: UsageRangeOpts): Promise<AccountUsageRow[]>
  /**
   * What has ALREADY been reported to Stripe's overage meter for a tenant, per day → the CUMULATIVE
   * value, so the reporter can submit only the delta. UNSCOPED BY DESIGN: the caller is the billing
   * job, which walks every subscriber; it takes an explicit tenant id rather than a Scope because
   * there is no request identity behind it (same shape as `listActiveSubscribers`).
   */
  reportedOverage(tenantId: string, opts: UsageRangeOpts): Promise<Map<string, OverageReport>>
  /** Record what Stripe has now been told about (tenant, day), with the allowance it was computed
   *  against. Idempotent upsert; billing-job only. */
  recordOverageReport(tenantId: string, day: string, report: OverageReport): Promise<void>
}

const dayWhere = (opts: UsageRangeOpts) => ({
  ...(isPgSafeDate(opts.from) ? { gte: new Date(opts.from!) } : {}),
  ...(isPgSafeDate(opts.to) ? { lte: new Date(opts.to!) } : {}),
})

export function createUsageRepo(prisma: PrismaClient): UsageRepo {
  return {
    platformSummary: async (opts = {}) => {
      const day = dayWhere(opts)
      const where = Object.keys(day).length > 0 ? { day } : {}
      const [days, devices] = await Promise.all([
        prisma.usageDaily.groupBy({ by: ['tenantId'], where, _count: { _all: true } }),
        prisma.usageDaily.findMany({ where, distinct: ['tenantId', 'deviceId'], select: { tenantId: true } }),
      ])
      const distinctByTenant = new Map<string, number>()
      for (const d of devices) distinctByTenant.set(d.tenantId, (distinctByTenant.get(d.tenantId) ?? 0) + 1)
      return days
        .map((g) => ({ tenantId: g.tenantId, deviceDays: g._count._all, activeDevices: distinctByTenant.get(g.tenantId) ?? 0 }))
        .sort((a, b) => b.deviceDays - a.deviceDays)
    },
    accountSummary: async (scope, opts = {}) => {
      const day = dayWhere(opts)
      const where = { tenantId: scope.tenantId, ...(Object.keys(day).length > 0 ? { day } : {}) }
      const [days, devices] = await Promise.all([
        prisma.usageDaily.groupBy({ by: ['accountId'], where, _count: { _all: true } }),
        prisma.usageDaily.findMany({ where, distinct: ['accountId', 'deviceId'], select: { accountId: true } }),
      ])
      const distinctByAccount = new Map<string, number>()
      for (const d of devices) distinctByAccount.set(d.accountId, (distinctByAccount.get(d.accountId) ?? 0) + 1)
      return days
        .map((g) => ({ accountId: g.accountId, deviceDays: g._count._all, activeDevices: distinctByAccount.get(g.accountId) ?? 0 }))
        .sort((a, b) => b.deviceDays - a.deviceDays)
    },
    tenantSummary: async (scope, opts = {}) => {
      const day = dayWhere(opts)
      const groups = await prisma.usageDaily.groupBy({
        by: ['day'],
        where: { tenantId: scope.tenantId, ...(Object.keys(day).length > 0 ? { day } : {}) },
        _count: { _all: true },
        orderBy: { day: 'desc' },
        take: 366, // a year of rows at most
      })
      return groups.map((g) => ({ day: g.day.toISOString().slice(0, 10), deviceDays: g._count._all }))
    },
    reportedOverage: async (tenantId, opts) => {
      const day = dayWhere(opts)
      const rows = await prisma.usageReport.findMany({
        where: { tenantId, ...(Object.keys(day).length > 0 ? { day } : {}) },
        select: { day: true, reported: true, included: true, priceId: true },
      })
      return new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), { reported: r.reported, included: r.included, priceId: r.priceId }]))
    },
    recordOverageReport: async (tenantId, day, report) => {
      // guarded here rather than at the call site: a malformed day would otherwise reach Prisma as
      // `new Date('…')` → Invalid Date → an opaque 500 from a background job nobody is watching
      if (!isPgSafeDate(day)) throw new Error(`recordOverageReport: unusable day ${JSON.stringify(day)}`)
      const at = new Date(day)
      await prisma.usageReport.upsert({
        where: { tenantId_day: { tenantId, day: at } },
        create: { tenantId, day: at, reported: report.reported, included: report.included, priceId: report.priceId },
        update: { reported: report.reported, included: report.included, priceId: report.priceId, reportedAt: new Date() },
      })
    },
  }
}
