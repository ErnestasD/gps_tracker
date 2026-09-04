import { assetPath, isBrandAssetPath, type BrandAssetMime, type BrandAssetSlot } from '@orbetra/shared'
import type { PrismaClient } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * Uploaded white-label brand images (W10) — the bytes behind `branding.logoUrl` / `branding.faviconUrl`
 * when a tenant uploaded a file instead of linking one they host.
 *
 * ── Why put() also writes the branding jsonb ─────────────────────────────────────────────────────
 * Storing the bytes and pointing branding at them are one act, not two. Split across two calls, a
 * failure between them leaves either an orphaned blob nothing renders or — far worse — a branding
 * value pointing at a row that was never written, which is a broken image on a reseller's sign-in
 * page. They go in one transaction, here, because `apps/api` is thin by rule and this is exactly the
 * kind of invariant the DB layer exists to hold.
 *
 * The branding update is a MERGE of the one key, not a replacement: `PATCH /v1/tenant/branding`
 * replaces the whole object, and an upload that did the same would silently drop the colours and
 * product name the tenant had already set.
 */
export interface BrandAssetMeta {
  slot: BrandAssetSlot
  mime: BrandAssetMime
  sha256: string
  width: number | null
  height: number | null
  sizeBytes: number
  /** the relative path this asset is served from — what branding stores */
  path: string
  updatedAt: string
}

/** What the public serving route needs, and nothing else. */
export interface BrandAssetBytes {
  bytes: Uint8Array
  mime: string
  sha256: string
}

export interface TenantAssetRepo {
  /** Metadata for every slot this tenant has filled. Never selects `bytes` — this is called on read
   *  paths (branding GET, the web manifest) where the blob would be pure waste. */
  meta(scope: Scope): Promise<BrandAssetMeta[]>
  /**
   * Resolve a served asset by its content hash AND mime. UNSCOPED by design, like
   * `tenantIdForDomain`: the route has no tenant context, which is the whole reason one relative
   * path works on every host. Safe because the response is a public brand image with a `sandbox`
   * CSP — see ADR-041.
   *
   * The mime is part of the QUERY, not a check afterwards. The same bytes can legitimately be stored
   * under both mimes (a file can satisfy the PNG header check and contain `<svg`), and picking an
   * arbitrary row then rejecting it on type turned a valid brand URL into an intermittent 404.
   */
  byHash(sha256Prefix: string, mime: BrandAssetMime): Promise<BrandAssetBytes | null>
  /** Store (or replace) one slot AND point branding at it, atomically. */
  put(
    scope: Scope,
    actor: Actor,
    slot: BrandAssetSlot,
    data: { bytes: Uint8Array; mime: BrandAssetMime; sha256: string; width: number | null; height: number | null },
  ): Promise<BrandAssetMeta>
  /** Drop one slot, and clear the branding key if it still points at this asset. */
  remove(scope: Scope, actor: Actor, slot: BrandAssetSlot): Promise<boolean>
}

/** Which branding key each slot drives. */
const BRANDING_KEY: Record<BrandAssetSlot, 'logoUrl' | 'faviconUrl'> = { logo: 'logoUrl', favicon: 'faviconUrl' }

const HASH_PREFIX = /^[0-9a-f]{32}$/

interface AssetRow {
  slot: string
  mime: string
  sha256: string
  width: number | null
  height: number | null
  sizeBytes: number
  updatedAt: Date
}

function toMeta(r: AssetRow): BrandAssetMeta {
  const mime = r.mime as BrandAssetMime
  return {
    slot: r.slot as BrandAssetSlot,
    mime,
    sha256: r.sha256,
    width: r.width,
    height: r.height,
    sizeBytes: r.sizeBytes,
    path: assetPath(r.sha256, mime),
    updatedAt: r.updatedAt.toISOString(),
  }
}

const META_SELECT = { slot: true, mime: true, sha256: true, width: true, height: true, sizeBytes: true, updatedAt: true } as const

/** Read the branding object as a plain record — `Json` is `unknown`-shaped and a null column is
 *  legal, so an unchecked spread is a runtime throw waiting for the one tenant it applies to. */
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}

/**
 * Take the tenant row's write lock and return its branding, inside the caller's transaction.
 *
 * Both mutations below merge ONE key into a jsonb blob, which is a read-modify-write. A transaction
 * makes that atomic but not isolated: at READ COMMITTED a plain SELECT takes no lock, so two
 * concurrent uploads both read the pre-merge object and the second write silently drops the first
 * one's key. That is not hypothetical here — the settings page lets a tenant pick a logo and a
 * favicon a second apart, and the two requests are independent. The row would end up with both
 * files stored and only one of them referenced.
 *
 * `FOR UPDATE` serialises them. It is taken FIRST in both transactions, before touching
 * `tenant_assets`, so the lock order is consistent and cannot deadlock against itself.
 */
async function lockBranding(
  tx: Pick<PrismaClient, '$queryRaw'>,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const rows = await tx.$queryRaw<{ branding: unknown }[]>`
    SELECT branding FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`
  if (rows.length === 0) throw new Error(`tenant ${tenantId} not found`)
  return asRecord(rows[0]!.branding)
}

export function createTenantAssetRepo(prisma: PrismaClient, audit: AuditRepo): TenantAssetRepo {
  return {
    meta: async (scope) => {
      const rows = await prisma.tenantAsset.findMany({ where: { tenantId: scope.tenantId }, select: META_SELECT })
      return rows.map(toMeta)
    },

    byHash: async (sha256Prefix, mime) => {
      // Reject the shape before it reaches the query: the route builds this from a URL segment, and
      // an index scan is not the place to discover it was never a hash.
      if (!HASH_PREFIX.test(sha256Prefix)) return null
      const row = await prisma.tenantAsset.findFirst({
        where: { sha256: { startsWith: sha256Prefix }, mime },
        select: { bytes: true, mime: true, sha256: true },
      })
      return row === null ? null : { bytes: row.bytes, mime: row.mime, sha256: row.sha256 }
    },

    put: async (scope, actor, slot, data) => {
      const key = BRANDING_KEY[slot]
      const path = assetPath(data.sha256, data.mime)
      const row = { ...data, bytes: Buffer.from(data.bytes), sizeBytes: data.bytes.length }

      const { asset, before, after } = await prisma.$transaction(async (tx) => {
        const before = await lockBranding(tx, scope.tenantId)
        const asset = await tx.tenantAsset.upsert({
          where: { tenantId_slot: { tenantId: scope.tenantId, slot } },
          create: { tenantId: scope.tenantId, slot, ...row },
          update: row,
          select: META_SELECT,
        })
        const after = { ...before, [key]: path }
        await tx.tenant.update({ where: { id: scope.tenantId }, data: { branding: after as never } })
        return { asset, before, after }
      })

      // Two records because they are two different things a reviewer looks for: "who changed the
      // brand" reads the branding trail it already had, "what was uploaded" reads this one.
      await audit.record(scope, actor, { action: 'update', entity: 'branding_asset', entityId: slot, after: toMeta(asset) })
      await audit.record(scope, actor, { action: 'update', entity: 'branding', entityId: scope.tenantId, before, after })
      return toMeta(asset)
    },

    remove: async (scope, actor, slot) => {
      const key = BRANDING_KEY[slot]
      const result = await prisma.$transaction(async (tx) => {
        const before = await lockBranding(tx, scope.tenantId)
        const existing = await tx.tenantAsset.findUnique({
          where: { tenantId_slot: { tenantId: scope.tenantId, slot } },
          select: META_SELECT,
        })
        if (existing === null) return null
        await tx.tenantAsset.delete({ where: { tenantId_slot: { tenantId: scope.tenantId, slot } } })

        // Clear the key ONLY if it still points at the asset being deleted. A tenant who uploaded a
        // logo and later typed their own URL over it must keep that URL when they tidy up the upload.
        const current = before[key]
        const after = { ...before }
        if (typeof current === 'string' && isBrandAssetPath(current) && current === assetPath(existing.sha256, existing.mime as BrandAssetMime)) {
          delete after[key]
        }
        await tx.tenant.update({ where: { id: scope.tenantId }, data: { branding: after as never } })
        return { existing, before, after }
      })
      if (result === null) return false
      await audit.record(scope, actor, { action: 'delete', entity: 'branding_asset', entityId: slot, before: toMeta(result.existing) })
      await audit.record(scope, actor, { action: 'update', entity: 'branding', entityId: scope.tenantId, before: result.before, after: result.after })
      return true
    },
  }
}
