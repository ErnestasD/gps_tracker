import type { Redis } from 'ioredis'

/** The rule row fields the worker needs (structural — avoids importing @prisma/client,
 * which is lint-banned outside packages/db). The repo's Rule row satisfies this. */
export interface RuleRow {
  id: string
  tenantId: string
  accountId: string
  kind: string
  name: string
  config: unknown
  scope: unknown
  cooldownS: number
  enabled: boolean
}

/**
 * Rule → Redis sync (E05-4), mirrors geofenceRegistry (E05-2). The worker evaluates rules
 * in-memory against a cached rule set (RuleCache), so rule CRUD publishes to
 * `rule:tenant:{tenantId}` (hash: ruleId → {accountId, kind, name, config, cooldownS,
 * enabled, scope}). Keyed by tenant so a delete/update is a single field op and the worker
 * loads one tenant's rules at once. Channels are intentionally NOT synced — the worker only
 * decides IF an event fires; the notification dispatcher (E05-5) reads channels from the DB.
 *
 * The boot resync IS built now (`rehydrateRegistries`), and it was not a nicety. `RuleCache` holds
 * no DB handle — evaluation is one HGETALL against Redis behind a 30 s TTL — so an empty hash makes
 * the worker skip the rule engine outright: overspeed, ignition, power_cut, low_battery, fuel_theft,
 * device_offline and PANIC all stop firing, while geofence events (which WERE rehydrated) keep
 * working and mask it, and every rule still renders as enabled. Two triggers, not one: a Redis flush
 * or DR restore, and — needing no fault at all — a single swallowed `bestEffortSync` on rule create,
 * which leaves a rule that exists in Postgres and never fires.
 */
const key = (tenantId: string): string => `rule:tenant:${tenantId}`

/** The exact hash entry CRUD writes, so the boot rehydrate cannot drift from the live path. */
export function ruleCacheEntry(r: RuleRow): [string, string, string] {
  return [
    key(r.tenantId),
    r.id,
    JSON.stringify({ accountId: r.accountId, kind: r.kind, name: r.name, config: r.config, cooldownS: r.cooldownS, enabled: r.enabled, scope: r.scope }),
  ]
}

export async function syncRule(redis: Redis, r: RuleRow): Promise<void> {
  const [k, field, value] = ruleCacheEntry(r)
  await redis.hset(k, field, value)
}

export async function removeRule(redis: Redis, tenantId: string, id: string): Promise<void> {
  await redis.hdel(key(tenantId), id)
}
