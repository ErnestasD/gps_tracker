import { createHash, randomBytes } from 'node:crypto'

import type { PrismaClient, ShareLink } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * Temporary public share links (V1-nice). A tenant user mints an EXPIRING, REVOCABLE URL that
 * exposes ONE device's live position with no login. Like API keys (E06-3) the opaque token is
 * shown ONCE at creation; we persist only its SHA-256 hash + a short display prefix — the
 * plaintext is never stored or logged. `resolveByHash` is the ONE unscoped lookup (the public
 * endpoint has no tenant context) and enforces expiry + revoke IN THE QUERY so a stale or
 * revoked hash never resolves. Every management method is tenant/account scoped.
 */
export interface ShareLinkView {
  id: string
  tenantId: string
  deviceId: string
  prefix: string
  label: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}
export interface ShareLinkCreate {
  deviceId: bigint
  /** the device's account — pinned onto the link so account-scoped users see only their own */
  accountId: string
  ttlHours: number
  label?: string | null
}
export interface CreatedShareLink {
  /** plaintext token — returned ONCE, never retrievable again */
  token: string
  view: ShareLinkView
}
/** The subset the public endpoint needs: which device (in which tenant) the token grants. */
export interface ShareLinkResolved {
  tenantId: string
  deviceId: bigint
  expiresAt: string
}

export interface ShareLinkRepo {
  /** management list; optionally narrowed to one device */
  list(scope: Scope, deviceId?: bigint): Promise<ShareLinkView[]>
  create(scope: Scope, actor: Actor, data: ShareLinkCreate): Promise<CreatedShareLink>
  revoke(scope: Scope, actor: Actor, id: string): Promise<boolean>
  /** UNSCOPED public lookup: SHA-256 hash → an ACTIVE (non-revoked, non-expired) link. */
  resolveByHash(hash: string): Promise<ShareLinkResolved | null>
}

const HOUR_MS = 3_600_000
export function hashShareToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
/** Generate a new opaque share token: 64 hex chars (32 random bytes) — unguessable. */
function generateToken(): { token: string; prefix: string; hash: string } {
  const token = randomBytes(32).toString('hex')
  return { token, prefix: token.slice(0, 8), hash: hashShareToken(token) }
}

function toView(r: ShareLink): ShareLinkView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    deviceId: r.deviceId.toString(),
    prefix: r.tokenPrefix,
    label: r.label,
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export function createShareLinkRepo(prisma: PrismaClient, audit: AuditRepo): ShareLinkRepo {
  return {
    list: async (scope, deviceId) => {
      const rows = await prisma.shareLink.findMany({
        where: { ...scopedWhere(scope), ...(deviceId !== undefined ? { deviceId } : {}) },
        orderBy: { createdAt: 'desc' },
      })
      return rows.map(toView)
    },
    create: async (scope, actor, data) => {
      const { token, prefix, hash } = generateToken()
      // account pinned from the DEVICE (authoritative), not the caller's scope — a tenant-wide
      // admin creating a share still gets the device's real account boundary on the link
      const expiresAt = new Date(Date.now() + data.ttlHours * HOUR_MS)
      const row = await prisma.shareLink.create({
        data: {
          tenantId: scope.tenantId,
          accountId: data.accountId,
          deviceId: data.deviceId,
          tokenHash: hash,
          tokenPrefix: prefix,
          label: data.label ?? null,
          createdByUserId: actor.userId,
          expiresAt,
        },
      })
      // audit stores the VIEW (never the hash/plaintext)
      await audit.record(scope, actor, { action: 'create', entity: 'shareLink', entityId: row.id, after: toView(row) })
      return { token, view: toView(row) }
    },
    revoke: async (scope, actor, id) => {
      // scoped read: only a link in the caller's tenant/account is reachable
      const found = await prisma.shareLink.findFirst({ where: { ...scopedWhere(scope), id } })
      if (found === null || found.revokedAt !== null) return false
      const row = await prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } })
      await audit.record(scope, actor, { action: 'update', entity: 'shareLink', entityId: id, before: toView(found), after: toView(row) })
      return true
    },
    resolveByHash: async (hash) => {
      // expiry + revoke enforced in the query — a stale hash never resolves
      const row = await prisma.shareLink.findFirst({
        where: { tokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
      })
      return row === null ? null : { tenantId: row.tenantId, deviceId: row.deviceId, expiresAt: row.expiresAt.toISOString() }
    },
  }
}
