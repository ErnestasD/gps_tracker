import type { ExportJob, PrismaClient } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * GDPR account export jobs (E08-4). The api creates a `pending` job (7-day expiry) and the
 * worker drives it to done|failed. Reads are scoped; `path` (server filesystem) is NEVER
 * exposed in the view — the download route resolves it internally via pathOf.
 */
export interface ExportJobView {
  id: string
  accountId: string
  status: string
  sizeBytes: string | null
  error: string | null
  createdAt: string
  expiresAt: string
}
export interface ExportRepo {
  create(scope: Scope, actor: Actor, accountId: string): Promise<ExportJobView>
  get(scope: Scope, id: string): Promise<ExportJobView | null>
  list(scope: Scope): Promise<ExportJobView[]>
  /** a still-pending job for this account, if any — POST coalesces instead of piling up
   * full-history export files (review MED-3 flood guard). */
  findPending(scope: Scope, accountId: string): Promise<ExportJobView | null>
  /** internal (download route): scoped path + expiry lookup — not part of the JSON view.
   * path is null once the sweep removed the file (status 'expired' → the route 410s). */
  pathOf(scope: Scope, id: string): Promise<{ path: string | null; expiresAt: Date; status: string } | null>
}

const EXPIRY_MS = 7 * 24 * 3_600_000
const uuid = (s: string): boolean => /^[0-9a-f-]{36}$/i.test(s)

function toView(r: ExportJob): ExportJobView {
  return {
    id: r.id,
    accountId: r.accountId,
    status: r.status,
    sizeBytes: r.sizeBytes?.toString() ?? null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }
}

export function createExportRepo(prisma: PrismaClient, audit: AuditRepo): ExportRepo {
  return {
    create: async (scope, actor, accountId) => {
      // the API has already scope-gated the account (db.accounts.get)
      const row = await prisma.exportJob.create({
        data: { tenantId: scope.tenantId, accountId, expiresAt: new Date(Date.now() + EXPIRY_MS) },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'export', entityId: row.id, after: toView(row) })
      return toView(row)
    },
    get: async (scope, id) => {
      if (!uuid(id)) return null
      const row = await prisma.exportJob.findFirst({ where: { ...scopedWhere(scope), id } })
      return row === null ? null : toView(row)
    },
    list: async (scope) => {
      const rows = await prisma.exportJob.findMany({ where: scopedWhere(scope), orderBy: { createdAt: 'desc' }, take: 50 })
      return rows.map(toView)
    },
    findPending: async (scope, accountId) => {
      const row = await prisma.exportJob.findFirst({ where: { ...scopedWhere(scope), accountId, status: 'pending' }, orderBy: { createdAt: 'desc' } })
      return row === null ? null : toView(row)
    },
    pathOf: async (scope, id) => {
      if (!uuid(id)) return null
      const row = await prisma.exportJob.findFirst({ where: { ...scopedWhere(scope), id } })
      return row === null ? null : { path: row.path, expiresAt: row.expiresAt, status: row.status }
    },
  }
}
