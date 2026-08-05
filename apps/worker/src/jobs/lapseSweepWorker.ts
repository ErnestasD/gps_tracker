import { Worker, type ConnectionOptions } from 'bullmq'

import type { Db, LapsedTenant } from '@orbetra/db'

import { LAPSE_SWEEP_QUEUE } from './lapseSweepQueue.js'

export interface LapseSweepResult {
  /** tenants whose entitlements are floored right now */
  tenants: number
  /** devices those tenants still have registered — the ones still being ingested for free */
  devices: number
  /** how many of them are past the grace window and worth acting on */
  actionable: number
}

export interface LapseSweepWorkerDeps {
  connection: ConnectionOptions
  db: Db
  now?: () => number
  /** days after the lapse before a tenant counts as `actionable` (env `BILLING_GRACE_DAYS`, default 14) */
  graceDays?: number
  onSwept?: (r: LapseSweepResult) => void
  onFailed?: () => void
}

const DAY_MS = 86_400_000
export const DEFAULT_GRACE_DAYS = 14

/**
 * Past the grace window? A lapse with no known date (an old row with no `lastBillingEventAt`) counts
 * as actionable: an unknown lapse date means it has been lapsed at least since the row was written,
 * and treating it as "recent" would hide the oldest cases — exactly the ones worth acting on.
 */
export function isActionable(t: LapsedTenant, nowMs: number, graceDays: number): boolean {
  if (t.lapsedAt === null) return true
  return nowMs - t.lapsedAt.getTime() >= graceDays * DAY_MS
}

/**
 * Daily read-only sweep: count tenants being served past their entitlement floor, and say which.
 *
 * Deliberately does NOT suspend anyone. Tearing down a lapsed tenant's registry entries stops the
 * cost, but doing it from a background job with no warning e-mail, no grace policy and no way for
 * the customer to see why their map went dark would be worse than the leak. The counts here are what
 * makes the decision possible; the alert rule on `billing_lapsed_tenants` is what surfaces it.
 */
export async function runLapseSweep(db: Db, nowMs: number, graceDays: number): Promise<LapseSweepResult> {
  const lapsed = await db.tenants.listLapsedTenants(new Date(nowMs))
  const actionable = lapsed.filter((t) => isActionable(t, nowMs, graceDays))
  // one line per tenant, not a total: the total says there is a problem, this says whose it is.
  // Tenant name and device count only — no personal data in an ops log.
  for (const t of actionable) {
    console.warn(
      'billing: tenant served past its entitlement floor',
      JSON.stringify({ tenantId: t.tenantId, name: t.name, plan: t.plan, reason: t.reason, status: t.subscriptionStatus, lapsedAt: t.lapsedAt?.toISOString() ?? null, activeDevices: t.activeDevices }),
    )
  }
  return {
    tenants: lapsed.length,
    // every lapsed tenant's devices, not just the actionable ones: the cost is being incurred
    // during the grace window too
    devices: lapsed.reduce((n, t) => n + t.activeDevices, 0),
    actionable: actionable.length,
  }
}

export function createLapseSweepWorker(deps: LapseSweepWorkerDeps): Worker {
  const now = deps.now ?? Date.now
  const graceDays = deps.graceDays ?? DEFAULT_GRACE_DAYS
  return new Worker(
    LAPSE_SWEEP_QUEUE,
    async () => {
      try {
        deps.onSwept?.(await runLapseSweep(deps.db, now(), graceDays))
      } catch (err) {
        deps.onFailed?.()
        throw err
      }
    },
    { connection: deps.connection, concurrency: 1 },
  )
}

/** `BILLING_GRACE_DAYS`, clamped to 0…365. */
export function graceDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env['BILLING_GRACE_DAYS'])
  if (!Number.isFinite(n)) return DEFAULT_GRACE_DAYS
  return Math.min(365, Math.max(0, Math.floor(n)))
}
