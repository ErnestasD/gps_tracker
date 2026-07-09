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
 * NOTE: rules created before this sync existed are backfilled on their next update; a
 * one-time boot resync (like geofences) is a V2 nicety.
 */
const key = (tenantId: string): string => `rule:tenant:${tenantId}`

export async function syncRule(redis: Redis, r: RuleRow): Promise<void> {
  await redis.hset(
    key(r.tenantId),
    r.id,
    JSON.stringify({ accountId: r.accountId, kind: r.kind, name: r.name, config: r.config, cooldownS: r.cooldownS, enabled: r.enabled, scope: r.scope }),
  )
}

export async function removeRule(redis: Redis, tenantId: string, id: string): Promise<void> {
  await redis.hdel(key(tenantId), id)
}
