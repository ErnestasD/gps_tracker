import type { PrismaClient } from '@prisma/client'

import type { Scope } from '../scope.js'

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
export interface UsageRangeOpts {
  from?: string
  to?: string
}
export interface UsageRepo {
  platformSummary(opts?: UsageRangeOpts): Promise<PlatformUsageRow[]>
  tenantSummary(scope: Scope, opts?: UsageRangeOpts): Promise<TenantUsageRow[]>
}

const MIN_MS = Date.parse('0001-01-01T00:00:00Z')
const MAX_MS = Date.parse('9999-12-31T23:59:59Z')
const validDate = (s: string | undefined): boolean => {
  if (s === undefined) return false
  const t = new Date(s).getTime()
  return !Number.isNaN(t) && t >= MIN_MS && t <= MAX_MS
}
const dayWhere = (opts: UsageRangeOpts) => ({
  ...(validDate(opts.from) ? { gte: new Date(opts.from!) } : {}),
  ...(validDate(opts.to) ? { lte: new Date(opts.to!) } : {}),
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
  }
}
