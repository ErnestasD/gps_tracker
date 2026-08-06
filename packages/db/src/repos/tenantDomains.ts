import type { PrismaClient, TenantDomain } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { Actor, Scope } from '../scope.js'

/** Per-tenant custom-domain cap — bounds pending-domain squatting (review MED). */
export const MAX_DOMAINS_PER_TENANT = 25

/** Another tenant has already VERIFIED this domain (partial-unique violation at verify). */
export class DomainConflictError extends Error {
  constructor() {
    super('domain already verified by another tenant')
    this.name = 'DomainConflictError'
  }
}
/** Tenant is at MAX_DOMAINS_PER_TENANT. */
export class DomainLimitError extends Error {
  constructor() {
    super('domain limit reached')
    this.name = 'DomainLimitError'
  }
}

/**
 * Tenant custom domains (E03-5). Tenant-self scoped for CRUD (tsp_admin manages
 * their own tenant's domains, tenantId from auth — never a path param). Two
 * UNSCOPED lookups by domain feed the PUBLIC endpoints (Caddy on-demand-TLS ask +
 * pre-login branding by Host) — a domain has no tenant scope above it; these are
 * documented exceptions, analogous to UNSCOPED_AUTH_METHODS.
 *
 * Uniqueness model: pending rows are unique per (tenantId, domain); a partial unique
 * index (migration 20260708000000) makes VERIFIED rows unique globally, so a squatter's
 * pending row can't block the real owner from adding+verifying — first to prove DNS wins.
 */
export interface TenantDomainRepo {
  list(scope: Scope): Promise<TenantDomain[]>
  get(scope: Scope, id: string): Promise<TenantDomain | null>
  /**
   * `verified` is for PLATFORM SUBDOMAINS only (`<slug>.orbetra.com`): we own that zone, so there is
   * no DNS proof for a tenant to publish and the ownership question is decided entirely by the
   * caller's slug check plus the global partial-unique index this insert hits. Every other domain
   * MUST go through setVerified after a real TXT lookup.
   * @throws DomainConflictError when `verified` and another tenant already holds this domain.
   */
  create(scope: Scope, actor: Actor, domain: string, txtToken: string, opts?: { verified?: boolean }): Promise<TenantDomain>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
  /** @throws DomainConflictError if another tenant already verified this domain. */
  setVerified(scope: Scope, actor: Actor, id: string): Promise<TenantDomain | null>
  /** UNSCOPED (public Caddy ask): is this domain a VERIFIED tenant domain? */
  isVerifiedDomain(domain: string): Promise<boolean>
  /** UNSCOPED (public branding by Host): the verified domain's tenant id, or null. */
  tenantIdForDomain(domain: string): Promise<string | null>
}

// duck-typed Prisma unique-violation (can't import @prisma/client error classes cheaply)
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'

export function createTenantDomainRepo(prisma: PrismaClient, audit: AuditRepo): TenantDomainRepo {
  const scoped = (scope: Scope, id: string) =>
    prisma.tenantDomain.findFirst({ where: { id, tenantId: scope.tenantId } })
  return {
    list: (scope) => prisma.tenantDomain.findMany({ where: { tenantId: scope.tenantId }, orderBy: { createdAt: 'desc' } }),
    get: (scope, id) => scoped(scope, id),
    create: async (scope, actor, domain, txtToken, opts = {}) => {
      const count = await prisma.tenantDomain.count({ where: { tenantId: scope.tenantId } })
      if (count >= MAX_DOMAINS_PER_TENANT) throw new DomainLimitError()
      let row: TenantDomain
      try {
        row = await prisma.tenantDomain.create({ data: { tenantId: scope.tenantId, domain, txtToken, verified: opts.verified === true } })
      } catch (e) {
        // Creating an ALREADY-VERIFIED row races the same partial unique index setVerified does, so
        // a slug another tenant took must read as a conflict rather than as "you already added it".
        if (opts.verified === true && isUniqueViolation(e)) throw new DomainConflictError()
        throw e
      }
      await audit.record(scope, actor, { action: 'create', entity: 'domain', entityId: row.id, after: row })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await scoped(scope, id)
      if (before === null) return false
      await prisma.tenantDomain.delete({ where: { id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'domain', entityId: id, before })
      return true
    },
    setVerified: async (scope, actor, id) => {
      const before = await scoped(scope, id)
      if (before === null) return null
      if (before.verified) return before // idempotent; avoids a needless self-conflict
      let row: TenantDomain
      try {
        // the partial unique index rejects this if another tenant already verified it
        row = await prisma.tenantDomain.update({ where: { id }, data: { verified: true } })
      } catch (e) {
        if (isUniqueViolation(e)) throw new DomainConflictError()
        throw e
      }
      await audit.record(scope, actor, { action: 'update', entity: 'domain', entityId: id, before, after: row })
      return row
    },
    // domain is no longer globally unique (only verified rows are) — findFirst on the
    // verified row is the single authoritative match the partial index guarantees
    isVerifiedDomain: async (domain) => {
      const row = await prisma.tenantDomain.findFirst({ where: { domain, verified: true }, select: { id: true } })
      return row !== null
    },
    tenantIdForDomain: async (domain) => {
      const row = await prisma.tenantDomain.findFirst({ where: { domain, verified: true }, select: { tenantId: true } })
      return row?.tenantId ?? null
    },
  }
}
