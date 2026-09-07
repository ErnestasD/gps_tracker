import type { PrismaClient } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * The address a white-label tenant's mail goes out AS (ADR-036, audit W-3).
 *
 * One row per tenant, enforced by a unique index on `tenantId`, which is what makes
 * `verifiedAddress()` a total function: the send path has no sensible way to choose between two
 * sending identities, and more than one is a deliverability problem rather than a feature.
 *
 * ── Two reads, and they are not the same question ────────────────────────────────────────────────
 * `get` is the settings screen: it wants the row whatever state it is in, including a failed one, so
 * the tenant can see what went wrong. `verifiedAddress` is the SEND path: it wants an address only
 * when SES has actually authorised us to use it, and otherwise nothing — so the caller falls back to
 * the platform identity. Sending as a domain that has not signed for us fails DMARC and lands a
 * customer's alerts in spam, which is worse than the leak it was meant to fix.
 */
export interface TenantSendingDomain {
  id: string
  tenantId: string
  domain: string
  mailbox: string
  status: string
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
  put(scope: Scope, actor: Actor, input: { domain: string; mailbox: string; dkimTokens: string[]; sesIdentity: string | null }): Promise<TenantSendingDomain>
  /** SES reported SUCCESS. Idempotent — re-verifying an already verified row keeps the first time. */
  markVerified(scope: Scope, actor: Actor): Promise<TenantSendingDomain | null>
  /** SES reported FAILED / TEMPORARY_FAILURE. Never clears the row: the tenant needs to see it. */
  markFailed(scope: Scope, actor: Actor): Promise<TenantSendingDomain | null>
  remove(scope: Scope, actor: Actor): Promise<boolean>
  /**
   * UNSCOPED by tenant id (the worker has no Scope): the address to send this tenant's mail AS, or
   * null to use the platform identity. Reads `verifiedAt`, never `status` — see the note above.
   */
  verifiedAddress(tenantId: string): Promise<string | null>
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
          dkimTokens: input.dkimTokens,
          sesIdentity: input.sesIdentity,
          status: 'pending',
        },
        // verifiedAt back to null: the identity being described is a different one now
        update: {
          domain: input.domain,
          mailbox: input.mailbox,
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
      const row = await prisma.tenantSendingDomain.update({
        where: { tenantId: scope.tenantId },
        data: { status: 'verified', verifiedAt: before.verifiedAt ?? new Date() },
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

    verifiedAddress: async (tenantId) => {
      if (tenantId === '') return null
      const row = await prisma.tenantSendingDomain.findUnique({
        where: { tenantId },
        select: { domain: true, mailbox: true, verifiedAt: true },
      })
      if (row === null || row.verifiedAt === null) return null
      return `${row.mailbox}@${row.domain}`
    },
  }
}
