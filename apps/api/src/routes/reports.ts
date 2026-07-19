import type { Hono } from 'hono'
import type { Redis } from 'ioredis'

import { isReportType, runReport, type Db, type Pool } from '@orbetra/db'
import { reportRequestSchema } from '@orbetra/shared'

import { problem, type AuthEnv } from '../auth/middleware.js'
import { scopeOf } from './registry.js'

// atomic fixed-window (mirrors caddyAsk/routing): INCR, set TTL on first hit OR re-arm a stranded
// TTL-less key — never leaves a key that would 429 forever.
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

/** Max report span (audit MED): an unbounded from/to = a full-history GROUP BY scan. 366 days
 *  covers a full year (leap-safe) — anything larger is rejected 400. */
const MAX_REPORT_RANGE_MS = 366 * 24 * 3_600 * 1_000

/**
 * Reports API (E06-1, §6.6). `POST /v1/reports/:type` runs a report over the caller's scope
 * and returns JSON rows. NOT a manifest CRUD entity (the `:type` param + non-entity result
 * don't fit the isolation harness), so it's registered here and EXEMPT from the manifest
 * meta-test, with DEDICATED isolation tests instead. It IS still tenant/account-scoped: the
 * tenant comes from the JWT (never a param) and the account is validated in the caller's
 * scope before its IANA zone drives the report's day bucketing (§7.7). Reads only — allowed
 * for every authenticated role in scope (async CSV/XLSX export is E06-2).
 */
export function mountReports(app: Hono<AuthEnv>, deps: { db: Db; pool?: Pool; redis?: Redis; rateLimit?: { max: number; windowS: number } }): void {
  const limit = deps.rateLimit ?? { max: 60, windowS: 60 }
  app.post('/v1/reports/:type', async (c) => {
    const type = c.req.param('type')
    if (!isReportType(type)) return problem(c, 404, 'Not Found', 'unknown report type')

    const auth = c.get('auth')

    // per-user fixed window (atomic) — a report is a full GROUP BY over trips/events; bound how
    // often one caller can trigger it (audit MED). Fail OPEN on a Redis blip (availability wins).
    if (deps.redis !== undefined) {
      try {
        const n = (await deps.redis.eval(RL_SCRIPT, 1, `reports:rl:${auth.userId}`, String(limit.windowS))) as number
        if (n > limit.max) return problem(c, 429, 'Too Many Requests')
      } catch {
        /* fail open */
      }
    }

    const parsed = reportRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')
    const { from, to, deviceId, accountId: bodyAccount } = parsed.data

    // bound the date range (audit MED): reject invalid/reversed/oversize spans BEFORE the scan,
    // instead of silently widening to the account's full history (the repo dropped a non-pg-safe
    // bound, so from='x' meant NO time predicate → whole-table aggregate).
    const fromMs = Date.parse(from)
    const toMs = Date.parse(to)
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return problem(c, 400, 'Bad Request', 'from/to must be valid ISO timestamps')
    if (fromMs > toMs) return problem(c, 400, 'Bad Request', 'from must be on or before to')
    if (toMs - fromMs > MAX_REPORT_RANGE_MS) return problem(c, 400, 'Bad Request', 'date range too large (max 366 days)')

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
