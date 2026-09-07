import type { PrismaClient } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import type { AuditRepo } from './audit.js'

/** Another tenant has already PROVED ownership of this domain (partial unique index). */
export class SendingDomainConflictError extends Error {
  constructor() {
    super('sending domain already verified by another tenant')
    this.name = 'SendingDomainConflictError'
  }
}

/**
 * The address a white-label tenant's mail goes out AS (ADR-036, audit W-3).
 *
 * One row per tenant, enforced by a unique index on `tenantId`, which is what makes
 * `verifiedAddress()` a total function: the send path has no sensible way to choose between two
 * sending identities, and more than one is a deliverability problem rather than a feature.
 *
 * ── Ownership is NOT what SES tells us ───────────────────────────────────────────────────────────
 * SES answers whether a DOMAIN published the DKIM records. It never says who asked. So a row also
 * carries a CSPRNG `txtToken` the tenant publishes at `_orbetra-verify.<domain>`, exactly as an app
 * domain does, and `markVerified` is guarded by a partial unique index over verified rows. Without
 * both, a tenant could name a domain another tenant had verified, read back the identity SES already
 * holds, and send DKIM-signed mail as somebody else's company.
 *
 * ── This repo does not serve the SEND path ───────────────────────────────────────────────────────
 * The worker reads the address through `notify/senderAddress.ts` against the raw pool, next to its
 * sibling `primaryDomain`, because it has no Scope. There is deliberately no second read here: one
 * existed briefly, production never called it, and the API tests that asserted it were therefore
 * testing nothing.
 */
export interface TenantSendingDomain {
  id: string
  tenantId: string
  domain: string
  mailbox: string
  status: string
  /** the CSPRNG ownership proof, published at `_orbetra-verify.<domain>` */
  txtToken: string
  dkimTokens: string[]
  sesIdentity: string | null
  createdAt: Date
  verifiedAt: Date | null
}

export interface TenantSendingDomainRepo {
  get(scope: Scope): Promise<TenantSendingDomain | null>
  /**
   * Create or replace this tenant's sending identity, back in `pending`.
   *
   * An upsert rather than create-or-409: changing the domain is the same act as setting it, and a
   * tenant who mistyped once should not have to delete a row to fix a letter. Replacing always
   * clears `verifiedAt` — the new domain has proved nothing yet, and carrying the old flag over
   * would let mail go out as a domain that never signed for us.
   */
  put(scope: Scope, actor: Actor, input: { domain: string; mailbox: string; txtToken: string; dkimTokens: string[]; sesIdentity: string | null }): Promise<TenantSendingDomain>
  /** Record the DKIM selectors SES returned, once ownership has been proved. */
  setDkim(scope: Scope, actor: Actor, input: { dkimTokens: string[]; sesIdentity: string }): Promise<TenantSendingDomain | null>
  /** Ownership proved AND SES reported SUCCESS. Idempotent — re-verifying keeps the first time.
   *  @throws SendingDomainConflictError if another tenant proved this domain first. */
  markVerified(scope: Scope, actor: Actor): Promise<TenantSendingDomain | null>
  /** SES reported FAILED / TEMPORARY_FAILURE. Never clears the row: the tenant needs to see it. */
  markFailed(scope: Scope, actor: Actor): Promise<TenantSendingDomain | null>
  remove(scope: Scope, actor: Actor): Promise<boolean>
  /** Does any OTHER tenant's row still name this SES identity? Guards the teardown on delete. */
  otherHolders(scope: Scope, sesIdentity: string): Promise<number>
}

export function createTenantSendingDomainRepo(prisma: PrismaClient, audit: AuditRepo): TenantSendingDomainRepo {
  const byTenant = (tenantId: string) => prisma.tenantSendingDomain.findUnique({ where: { tenantId } })
  return {
    get: (scope) => byTenant(scope.tenantId),

    put: async (scope, actor, input) => {
      const before = await byTenant(scope.tenantId)
      const row = await prisma.tenantSendingDomain.upsert({
        where: { tenantId: scope.tenantId },
        create: {
          tenantId: scope.tenantId,
          domain: input.domain,
          mailbox: input.mailbox,
          txtToken: input.txtToken,
          dkimTokens: input.dkimTokens,
          sesIdentity: input.sesIdentity,
          status: 'pending',
        },
        // verifiedAt AND the token back to fresh: the identity being described is a different one,
        // and reusing a token already published under the old domain would prove nothing about this one
        update: {
          domain: input.domain,
          mailbox: input.mailbox,
          txtToken: input.txtToken,
          dkimTokens: input.dkimTokens,
          sesIdentity: input.sesIdentity,
          status: 'pending',
          verifiedAt: null,
        },
      })
      await audit.record(scope, actor, {
        action: before === null ? 'create' : 'update',
        entity: 'sendingDomain',
        entityId: row.id,
        ...(before !== null ? { before } : {}),
        after: row,
      })
      return row
    },

    markVerified: async (scope, actor) => {
      const before = await byTenant(scope.tenantId)
      if (before === null) return null
      if (before.verifiedAt !== null && before.status === 'verified') return before
      let row: TenantSendingDomain
      try {
        // the partial unique index rejects this when another tenant proved the same domain first
        row = await prisma.tenantSendingDomain.update({
          where: { tenantId: scope.tenantId },
          data: { status: 'verified', verifiedAt: before.verifiedAt ?? new Date() },
        })
      } catch (e) {
        if (isUniqueViolation(e)) throw new SendingDomainConflictError()
        throw e
      }
      await audit.record(scope, actor, { action: 'update', entity: 'sendingDomain', entityId: row.id, before, after: row })
      return row
    },

    setDkim: async (scope, actor, input) => {
      const before = await byTenant(scope.tenantId)
      if (before === null) return null
      const row = await prisma.tenantSendingDomain.update({
        where: { tenantId: scope.tenantId },
        data: { dkimTokens: input.dkimTokens, sesIdentity: input.sesIdentity },
      })
      await audit.record(scope, actor, { action: 'update', entity: 'sendingDomain', entityId: row.id, before, after: row })
      return row
    },

    markFailed: async (scope, actor) => {
      const before = await byTenant(scope.tenantId)
      if (before === null) return null
      // verifiedAt is NOT cleared here. A previously verified identity that reports a transient
      // failure must keep sending: DKIM records do not stop working because one GetEmailIdentity
      // call came back unhappy, and silently reverting a reseller to our From line is the leak.
      const row = await prisma.tenantSendingDomain.update({ where: { tenantId: scope.tenantId }, data: { status: 'failed' } })
      await audit.record(scope, actor, { action: 'update', entity: 'sendingDomain', entityId: row.id, before, after: row })
      return row
    },

    remove: async (scope, actor) => {
      const before = await byTenant(scope.tenantId)
      if (before === null) return false
      await prisma.tenantSendingDomain.delete({ where: { tenantId: scope.tenantId } })
      await audit.record(scope, actor, { action: 'delete', entity: 'sendingDomain', entityId: before.id, before })
      return true
    },

    otherHolders: (scope, sesIdentity) =>
      prisma.tenantSendingDomain.count({ where: { sesIdentity, NOT: { tenantId: scope.tenantId } } }),
  }
}

// duck-typed Prisma unique-violation, the same shape tenantDomains uses
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
