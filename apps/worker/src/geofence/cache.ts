import type { Redis } from 'ioredis'

import type { GeofenceDef } from './engine.js'
import type { GeoPolygon } from './point.js'

/**
 * Geofence geom cache (E05-2). The transition engine's feed() is synchronous, so the
 * worker must PRE-RESOLVE each batch's devices → their applicable geofences (async Redis)
 * into a plain lookup. Per device: tenant + account come from the registry
 * (device:tenant/device:account); the tenant's fences come from geofence:tenant:{tenant}
 * (synced by the API on CRUD) and are filtered by account (accountId null ⇒ tenant-shared).
 * Tenant fence sets are cached with a short TTL — CRUD changes are picked up within it.
 */
interface TenantGeofence extends GeofenceDef {
  accountId: string | null
}

export class GeofenceCache {
  private readonly byTenant = new Map<string, { defs: TenantGeofence[]; at: number }>()

  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 30_000,
  ) {}

  /** device → applicable geofences, for a whole batch. `now` is injected for determinism. */
  async resolveBatch(deviceIds: readonly bigint[], now: number): Promise<Map<string, GeofenceDef[]>> {
    const ids = [...new Set(deviceIds.map((d) => d.toString()))]
    // device → tenant / account (registry)
    const [tenants, accounts] = await Promise.all([
      this.redis.hmget('device:tenant', ...ids),
      this.redis.hmget('device:account', ...ids),
    ])
    const tenantOf = new Map<string, string | null>()
    const accountOf = new Map<string, string | null>()
    ids.forEach((id, i) => {
      tenantOf.set(id, tenants[i] ?? null)
      accountOf.set(id, accounts[i] ?? null)
    })
    // load (stale) tenant fence sets
    const uniqTenants = [...new Set([...tenantOf.values()].filter((t): t is string => t !== null))]
    await Promise.all(uniqTenants.filter((t) => this.stale(t, now)).map((t) => this.load(t, now)))

    const out = new Map<string, GeofenceDef[]>()
    for (const id of ids) {
      const tenant = tenantOf.get(id)
      if (tenant === null || tenant === undefined) continue
      const account = accountOf.get(id) ?? null
      const defs = (this.byTenant.get(tenant)?.defs ?? []).filter((g) => g.accountId === null || g.accountId === account)
      if (defs.length > 0) out.set(id, defs)
    }
    return out
  }

  private stale(tenant: string, now: number): boolean {
    const e = this.byTenant.get(tenant)
    return e === undefined || now - e.at >= this.ttlMs
  }

  private async load(tenant: string, now: number): Promise<void> {
    const raw = await this.redis.hgetall(`geofence:tenant:${tenant}`)
    const defs: TenantGeofence[] = []
    for (const [id, val] of Object.entries(raw)) {
      try {
        const j = JSON.parse(val) as { accountId: string | null; name: string; geometry: GeoPolygon }
        if (j.geometry?.type === 'Polygon') defs.push({ id, name: j.name, geometry: j.geometry, accountId: j.accountId })
      } catch {
        // malformed entry → skip, never crash the pipeline
      }
    }
    this.byTenant.set(tenant, { defs, at: now })
  }
}
