import type { Redis } from 'ioredis'

import { MAX_RULE_SCOPE_IDS } from '@orbetra/shared'

import { ENGINE_RULE_KINDS, type EngineRuleKind, type RuleDef } from './types.js'

/**
 * Rule cache (E05-4), mirrors GeofenceCache (E05-2). The rule engine's feed() is
 * synchronous, so the worker PRE-RESOLVES each batch's devices → their applicable rules
 * (async Redis) into a plain lookup. Per device: tenant + account come from the registry
 * (device:tenant/device:account); the tenant's rules come from `rule:tenant:{tenant}`
 * (synced by the API on CRUD, ruleRegistry.ts) and are filtered by account, `enabled`, the
 * engine-handled kinds (geofence/device_offline are handled elsewhere), and — when a rule
 * carries `config.scope.deviceIds` — device membership. Tenant rule sets are cached with a
 * short TTL so CRUD changes are picked up within it.
 */
interface StoredRule {
  accountId: string
  kind: string
  name: string
  config?: Record<string, unknown>
  cooldownS?: number
  enabled?: boolean
  scope?: Record<string, unknown>
}
interface TenantRule extends RuleDef {
  /** device allow-list as a Set, resolved once at load; `null` = account-wide */
  scopeIds: Set<string> | null
}

/** A geofence-kind rule (E05-5 gap fix): matched against geofence-engine transitions in the
 * pipeline, NOT fed to the IO rule engine. `on` mirrors the UI's stored values. */
export interface GeofenceRuleDef {
  id: string
  accountId: string
  name: string
  cooldownS: number
  geofenceId: string
  on: 'enter' | 'exit' | 'both'
}
interface TenantGeofenceRule extends GeofenceRuleDef {
  scopeIds: Set<string> | null
}

const ENGINE_KINDS = new Set<string>(ENGINE_RULE_KINDS)

export class RuleCache {
  private readonly byTenant = new Map<string, { defs: TenantRule[]; gf: TenantGeofenceRule[]; at: number }>()

  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 30_000,
  ) {}

  /** device → applicable engine rules, for a whole batch. `now` is injected for determinism. */
  async resolveBatch(deviceIds: readonly bigint[], now: number): Promise<Map<string, RuleDef[]>> {
    const ids = [...new Set(deviceIds.map((d) => d.toString()))]
    const [tenants, accounts] = await Promise.all([this.redis.hmget('device:tenant', ...ids), this.redis.hmget('device:account', ...ids)])
    const tenantOf = new Map<string, string | null>()
    const accountOf = new Map<string, string | null>()
    ids.forEach((id, i) => {
      tenantOf.set(id, tenants[i] ?? null)
      accountOf.set(id, accounts[i] ?? null)
    })
    const uniqTenants = [...new Set([...tenantOf.values()].filter((t): t is string => t !== null))]
    await Promise.all(uniqTenants.filter((t) => this.stale(t, now)).map((t) => this.load(t, now)))

    const out = new Map<string, RuleDef[]>()
    for (const id of ids) {
      const tenant = tenantOf.get(id)
      if (tenant === null || tenant === undefined) continue
      const account = accountOf.get(id) ?? null
      const defs = (this.byTenant.get(tenant)?.defs ?? []).filter((r) => r.accountId === account && inScope(r.scopeIds, id))
      if (defs.length > 0) out.set(id, defs.map(strip))
    }
    return out
  }

  /**
   * device → applicable GEOFENCE rules (E05-5 gap fix). Same tenant/account/scope resolution as
   * resolveBatch; a separate method because these rules are matched against geofence-engine
   * transitions in the pipeline, never fed to the IO rule engine.
   */
  async resolveGeofenceBatch(deviceIds: readonly bigint[], now: number): Promise<Map<string, GeofenceRuleDef[]>> {
    const ids = [...new Set(deviceIds.map((d) => d.toString()))]
    if (ids.length === 0) return new Map()
    const [tenants, accounts] = await Promise.all([this.redis.hmget('device:tenant', ...ids), this.redis.hmget('device:account', ...ids)])
    const tenantOf = new Map<string, string | null>()
    const accountOf = new Map<string, string | null>()
    ids.forEach((id, i) => {
      tenantOf.set(id, tenants[i] ?? null)
      accountOf.set(id, accounts[i] ?? null)
    })
    const uniqTenants = [...new Set([...tenantOf.values()].filter((t): t is string => t !== null))]
    await Promise.all(uniqTenants.filter((t) => this.stale(t, now)).map((t) => this.load(t, now)))
    const out = new Map<string, GeofenceRuleDef[]>()
    for (const id of ids) {
      const tenant = tenantOf.get(id)
      if (tenant === null || tenant === undefined) continue
      const account = accountOf.get(id) ?? null
      const defs = (this.byTenant.get(tenant)?.gf ?? []).filter((r) => r.accountId === account && inScope(r.scopeIds, id))
      if (defs.length > 0) out.set(id, defs.map((d) => ({ id: d.id, accountId: d.accountId, name: d.name, cooldownS: d.cooldownS, geofenceId: d.geofenceId, on: d.on })))
    }
    return out
  }

  private stale(tenant: string, now: number): boolean {
    const e = this.byTenant.get(tenant)
    return e === undefined || now - e.at >= this.ttlMs
  }

  private async load(tenant: string, now: number): Promise<void> {
    const raw = await this.redis.hgetall(`rule:tenant:${tenant}`)
    const defs: TenantRule[] = []
    const gf: TenantGeofenceRule[] = []
    for (const [id, val] of Object.entries(raw)) {
      try {
        const j = JSON.parse(val) as StoredRule
        if (j.enabled === false) continue
        if (j.kind === 'geofence') {
          // matched against geofence-engine transitions (E05-5 gap fix); a rule without a
          // geofenceId can match nothing and is skipped outright
          const rawGeofenceId = j.config?.['geofenceId']
          const geofenceId = typeof rawGeofenceId === 'string' ? rawGeofenceId : ''
          if (geofenceId === '') continue
          const onRaw = j.config?.['on']
          gf.push({
            id,
            accountId: j.accountId,
            name: j.name,
            cooldownS: typeof j.cooldownS === 'number' ? j.cooldownS : 300,
            geofenceId,
            on: onRaw === 'enter' || onRaw === 'exit' ? onRaw : 'both',
            scopeIds: toScopeIds(j.scope),
          })
          continue
        }
        if (!ENGINE_KINDS.has(j.kind)) continue // device_offline handled by the sweeper
        defs.push({
          id,
          accountId: j.accountId,
          kind: j.kind as EngineRuleKind,
          name: j.name,
          config: j.config ?? {},
          cooldownS: typeof j.cooldownS === 'number' ? j.cooldownS : 300,
          // Normalised to a Set ONCE per cache load, not per device per batch (audit MED). The old
          // `list.map(String).includes(id)` allocated a fresh string array for every device × rule ×
          // batch, so an unvalidated `deviceIds` was work a tenant admin could ask the pipeline to
          // do on their behalf indefinitely with one PATCH. Bounded here as well as in the API
          // schema: the cache reads whatever is already in Redis, including rules written before
          // that schema existed.
          scopeIds: toScopeIds(j.scope),
        })
      } catch {
        // malformed entry → skip, never crash the pipeline
      }
    }
    this.byTenant.set(tenant, { defs, gf, at: now })
  }
}

/** Largest allow-list the cache will honour — the SAME constant the API schema enforces, imported
 *  rather than repeated so the two cannot drift. Beyond it the rule is treated as account-wide
 *  rather than dropped: a rule that fires too broadly is visible and fixable, one that silently
 *  stopped firing is neither. */
const MAX_SCOPE_IDS = MAX_RULE_SCOPE_IDS

/** Allow-list as a Set, built once at load. `null` = account-wide (absent, empty, or oversize). */
function toScopeIds(scope: unknown): Set<string> | null {
  if (scope === null || typeof scope !== 'object') return null
  const list = (scope as Record<string, unknown>)['deviceIds']
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SCOPE_IDS) return null
  return new Set(list.map((v) => String(v)))
}

/** A rule applies to a device unless it declares a `deviceIds` allow-list that excludes it. */
function inScope(scopeIds: Set<string> | null, deviceId: string): boolean {
  return scopeIds === null || scopeIds.has(deviceId)
}

/** Drop the cache-only `scope` field before handing to the engine. */
function strip(r: TenantRule): RuleDef {
  return { id: r.id, accountId: r.accountId, kind: r.kind, name: r.name, config: r.config, cooldownS: r.cooldownS }
}
