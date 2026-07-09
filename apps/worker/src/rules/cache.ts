import type { Redis } from 'ioredis'

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
  scope: Record<string, unknown>
}

const ENGINE_KINDS = new Set<string>(ENGINE_RULE_KINDS)

export class RuleCache {
  private readonly byTenant = new Map<string, { defs: TenantRule[]; at: number }>()

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
      const defs = (this.byTenant.get(tenant)?.defs ?? []).filter((r) => r.accountId === account && inScope(r.scope, id))
      if (defs.length > 0) out.set(id, defs.map(strip))
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
    for (const [id, val] of Object.entries(raw)) {
      try {
        const j = JSON.parse(val) as StoredRule
        if (j.enabled === false) continue
        if (!ENGINE_KINDS.has(j.kind)) continue // geofence + device_offline handled elsewhere
        defs.push({
          id,
          accountId: j.accountId,
          kind: j.kind as EngineRuleKind,
          name: j.name,
          config: j.config ?? {},
          cooldownS: typeof j.cooldownS === 'number' ? j.cooldownS : 300,
          scope: j.scope ?? {},
        })
      } catch {
        // malformed entry → skip, never crash the pipeline
      }
    }
    this.byTenant.set(tenant, { defs, at: now })
  }
}

/** A rule applies to a device unless it declares a `deviceIds` allow-list that excludes it. */
function inScope(scope: Record<string, unknown>, deviceId: string): boolean {
  const list = scope['deviceIds']
  if (!Array.isArray(list) || list.length === 0) return true // account-wide (v1 default)
  return list.map(String).includes(deviceId)
}

/** Drop the cache-only `scope` field before handing to the engine. */
function strip(r: TenantRule): RuleDef {
  return { id: r.id, accountId: r.accountId, kind: r.kind, name: r.name, config: r.config, cooldownS: r.cooldownS }
}
