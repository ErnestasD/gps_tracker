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

export type RuleRepo = GenericRepo<Rule, RuleCreate, RuleUpdate>

/** Rules: account-scoped (non-null accountId). accountId travels in create data
 * (API validates it belongs to the caller's scope). */
export function createRuleRepo(prisma: PrismaClient, audit: AuditRepo): RuleRepo {
  return createGenericRepo(prisma.rule as unknown as Delegate<Rule>, audit, {
    entity: 'rule',
    orderBy: { createdAt: 'desc' },
  })
}
