import type { Hono } from 'hono'

import { readDriverScores, type Db, type Pool } from '@orbetra/db'
import { driverScore, type DriverScoreView } from '@orbetra/shared'

import { type AuthEnv } from '../auth/middleware.js'

/**
 * Driver safety scoring API (V2). `GET /v1/driver-scores?from=&to=` returns a 0–100 score per
 * driver over the window, from their assigned trips + overspeed events. NOT a manifest CRUD entity
 * (aggregate result, no `:id`), so it's registered here and EXEMPT from the manifest meta-test with
 * a DEDICATED cross-tenant isolation test. Tenant-scoped from the JWT (never a param); an
 * account-scoped user sees only their account's drivers, a tenant admin sees all their tenant's.
 * Read-only, all authenticated roles in scope. `db` is unused today but kept for symmetry/future.
 */
export function mountDriverScores(app: Hono<AuthEnv>, deps: { db: Db; pool?: Pool }): void {
  app.get('/v1/driver-scores', async (c) => {
    const auth = c.get('auth')
    if (deps.pool === undefined) return c.json({ error: 'unavailable' }, 503)
    const q = c.req.query.bind(c.req)
    const aggs = await readDriverScores(
      deps.pool,
      { tenantId: auth.tenantId, ...(auth.accountId !== undefined ? { accountId: auth.accountId } : {}) },
      { ...(q('from') !== undefined ? { from: q('from')! } : {}), ...(q('to') !== undefined ? { to: q('to')! } : {}) },
    )
    const rows: DriverScoreView[] = aggs.map((a) => ({
      driverId: a.driverId,
      driverName: a.driverName,
      trips: a.trips,
      distanceKm: Math.round(a.distanceM / 100) / 10, // one decimal
      maxSpeed: a.maxSpeed,
      idleH: Math.round(a.idleS / 360) / 10, // hours, one decimal
      overspeedEvents: a.overspeedEvents,
      score: driverScore(a),
    }))
    c.header('Cache-Control', 'no-store') // tenant-scoped data: never cacheable
    return c.json(rows)
  })
}
