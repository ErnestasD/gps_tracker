import type { Hono } from 'hono'

import { isReportType, runReport, type Db, type Pool } from '@orbetra/db'
import { reportRequestSchema } from '@orbetra/shared'

import { problem, type AuthEnv } from '../auth/middleware.js'
import { scopeOf } from './registry.js'

/**
 * Reports API (E06-1, §6.6). `POST /v1/reports/:type` runs a report over the caller's scope
 * and returns JSON rows. NOT a manifest CRUD entity (the `:type` param + non-entity result
 * don't fit the isolation harness), so it's registered here and EXEMPT from the manifest
 * meta-test, with DEDICATED isolation tests instead. It IS still tenant/account-scoped: the
 * tenant comes from the JWT (never a param) and the account is validated in the caller's
 * scope before its IANA zone drives the report's day bucketing (§7.7). Reads only — allowed
 * for every authenticated role in scope (async CSV/XLSX export is E06-2).
 */
export function mountReports(app: Hono<AuthEnv>, deps: { db: Db; pool?: Pool }): void {
  app.post('/v1/reports/:type', async (c) => {
    const type = c.req.param('type')
    if (!isReportType(type)) return problem(c, 404, 'Not Found', 'unknown report type')

    const auth = c.get('auth')
    const parsed = reportRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')
    const { from, to, deviceId, accountId: bodyAccount } = parsed.data

    // account-scoped users are pinned to their account; a tenant-wide caller must name one
    const accountId = auth.accountId !== undefined ? auth.accountId : bodyAccount
    if (accountId === undefined) return problem(c, 400, 'Bad Request', 'accountId required')
    const account = await deps.db.accounts.get(scopeOf(auth), accountId)
    if (account === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
    if (deps.pool === undefined) return problem(c, 503, 'Service Unavailable', 'reports backend unavailable')

    const result = await runReport(
      deps.pool,
      type,
      { tenantId: auth.tenantId, accountId },
      { from, to, timezone: account.timezone, ...(deviceId !== undefined ? { deviceId } : {}) },
    )
    c.header('Cache-Control', 'no-store') // tenant-scoped data: never cacheable
    return c.json(result)
  })
}
