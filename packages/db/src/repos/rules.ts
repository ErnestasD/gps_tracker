import type { PrismaClient, Rule, RuleKind } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import { createGenericRepo, type Delegate, type GenericRepo } from './generic.js'

// JSON columns typed as unknown at the API boundary (zod validates shape upstream);
// the generic delegate persists them as-is.
export interface RuleCreate {
  accountId: string
  kind: RuleKind
  name: string
  config?: unknown
  scope?: unknown
  channels?: unknown
  cooldownS?: number
  enabled?: boolean
}
export interface RuleUpdate {
  name?: string
  config?: unknown
  scope?: unknown
  channels?: unknown
  cooldownS?: number
  enabled?: boolean
}

export type RuleRepo = GenericRepo<Rule, RuleCreate, RuleUpdate> & {
  /**
   * UNSCOPED boot rehydrate (no request scope): every rule across all tenants, so the API can
   * repopulate the `rule:tenant:*` Redis cache after a Redis flush — exactly what
   * `geofences.listAll` exists for.
   *
   * Rules were the one registry `rehydrateRegistries` did not restore, and the gap was invisible
   * because geofence events kept firing and every rule still rendered as enabled in the UI. The
   * rule cache holds no DB handle at all (it is one HGETALL against Redis with a 30 s TTL), so an
   * empty hash means the worker skips the rule engine entirely: overspeed, ignition, power_cut,
   * low_battery, fuel_theft, device_offline and PANIC all stop, silently, until someone edits each
   * rule by hand. Disabled rules are returned too — CRUD publishes them with their flag, and the
   * rehydrate must write the same shape or the two paths drift.
   */
  listAll(): Promise<Rule[]>
}

/** Rules: account-scoped (non-null accountId). accountId travels in create data
 * (API validates it belongs to the caller's scope). */
export function createRuleRepo(prisma: PrismaClient, audit: AuditRepo): RuleRepo {
  const base = createGenericRepo<Rule, RuleCreate, RuleUpdate>(prisma.rule as unknown as Delegate<Rule>, audit, {
    entity: 'rule',
    orderBy: { createdAt: 'desc' },
  })
  return { ...base, listAll: () => prisma.rule.findMany({ orderBy: { createdAt: 'asc' } }) }
}
