import { createHash, randomBytes } from 'node:crypto'

import type { ApiKey, PrismaClient } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * API keys (E06-3, §6.6). Integrations authenticate with `X-Api-Key`. The full key is shown
 * exactly ONCE at creation (`orb_live_<random>`); we persist only its SHA-256 hash + a short
 * display prefix — the plaintext is never stored or logged. Keys are tenant-scoped
 * (nullable account); `findActiveByHash` is the ONE unscoped lookup (auth must resolve any
 * tenant's key and returns its scope), analogous to the auth surface.
 */
export interface ApiKeyView {
  id: string
  tenantId: string
  accountId: string | null
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}
export interface ApiKeyCreate {
  name: string
  accountId?: string | null
  scopes?: string[]
}
export interface CreatedApiKey {
  /** plaintext — returned ONCE, never retrievable again */
  key: string
  view: ApiKeyView
}
/** The subset auth needs: identity + the scope to build the request's AuthContext. */
export interface ApiKeyResolved {
  id: string
  tenantId: string
  accountId: string | null
  scopes: string[]
}

export interface ApiKeyRepo {
  list(scope: Scope): Promise<ApiKeyView[]>
  create(scope: Scope, actor: Actor, data: ApiKeyCreate): Promise<CreatedApiKey>
  revoke(scope: Scope, actor: Actor, id: string): Promise<boolean>
  /** UNSCOPED auth lookup: SHA-256 hash → active (non-revoked) key. */
  findActiveByHash(hash: string): Promise<ApiKeyResolved | null>
  /** Best-effort lastUsedAt bump (auth path; failures are swallowed by the caller). */
  touch(id: string): Promise<void>
}

const KEY_PREFIX = 'orb_live_'
export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
/** Generate a new opaque key: `orb_live_<48 hex chars>` (24 random bytes). */
function generateKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(24).toString('hex')
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 4), hash: hashKey(key) }
}

function toView(r: ApiKey): ApiKeyView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    accountId: r.accountId,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export function createApiKeyRepo(prisma: PrismaClient, audit: AuditRepo): ApiKeyRepo {
  return {
    list: async (scope) => {
      const rows = await prisma.apiKey.findMany({ where: scopedWhere(scope, { nullableAccount: true }), orderBy: { createdAt: 'desc' } })
      return rows.map(toView)
    },
    create: async (scope, actor, data) => {
      const { key, prefix, hash } = generateKey()
      // an account-scoped creator is pinned to their account; a tenant admin may target an
      // account or null (tenant-shared). The caller (route) validates a named account is in scope.
      const accountId = scope.accountId !== undefined ? scope.accountId : (data.accountId ?? null)
      const row = await prisma.apiKey.create({
        data: { tenantId: scope.tenantId, accountId, name: data.name, prefix, hash, scopes: data.scopes ?? ['read'] },
      })
      // audit stores the VIEW (never the hash/plaintext)
      await audit.record(scope, actor, { action: 'create', entity: 'apiKey', entityId: row.id, after: toView(row) })
      return { key, view: toView(row) }
    },
    revoke: async (scope, actor, id) => {
      // scoped update: only a key in the caller's tenant/account is reachable
      const found = await prisma.apiKey.findFirst({ where: { ...scopedWhere(scope, { nullableAccount: true }), id } })
      if (found === null || found.revokedAt !== null) return false
      const row = await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })
      await audit.record(scope, actor, { action: 'update', entity: 'apiKey', entityId: id, before: toView(found), after: toView(row) })
      return true
    },
    findActiveByHash: async (hash) => {
      const row = await prisma.apiKey.findFirst({ where: { hash, revokedAt: null } })
      return row === null ? null : { id: row.id, tenantId: row.tenantId, accountId: row.accountId, scopes: row.scopes }
    },
    touch: async (id) => {
      await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } })
    },
  }
}
