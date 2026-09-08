import { Worker, type ConnectionOptions } from 'bullmq'

import type { Pool } from '@orbetra/db'

import { SENDING_VERIFY_QUEUE } from './sendingVerifyQueue.js'

/**
 * What one sweep did. Counted rather than logged per tenant: a reseller's domain is their business,
 * and an ops dashboard needs the shape of the queue, not a list of customers.
 */
export interface SendingVerifyResult {
  /** rows still waiting on SES */
  pending: number
  /** rows flipped to verified this run — from here their mail leaves as their own address */
  verified: number
  /** rows SES reports as failed; the tenant sees it and fixes their records */
  failed: number
  /** rows we could not ask about — an AWS fault, never a tenant's problem */
  unreachable: number
}

/** What SES says about one identity. The API owns the SDK; the worker takes the answer. */
export type IdentityStatusReader = (domain: string) => Promise<'pending' | 'verified' | 'failed' | null>

export interface SendingVerifyWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  /** absent ⇒ the sweep counts and does nothing, exactly as the routes 503 without credentials */
  readIdentity?: IdentityStatusReader | undefined
  onRun?: (r: SendingVerifyResult) => void
  onFailed?: () => void
}

/**
 * Ask SES about every sending identity still waiting, and finish the ones it has verified.
 *
 * ── Only ever forward ────────────────────────────────────────────────────────────────────────────
 * `verifiedAt` is set once and never cleared here. A previously verified identity whose
 * GetEmailIdentity call comes back unhappy — a transient AWS answer, a throttle, a permission that
 * lapsed — keeps sending: its DKIM records are still published and still working, and reverting that
 * reseller to OUR From line on the strength of one bad call is the exact leak this feature closes.
 * Rows that already carry `verifiedAt` are not even selected.
 *
 * ── Fails quiet, never destructive ───────────────────────────────────────────────────────────────
 * Anything that throws counts as `unreachable` and the row is left exactly as it was. The worst case
 * is a tenant who waits one more interval; there is no case where this sweep takes a working sender
 * away.
 */
export async function runSendingVerify(deps: SendingVerifyWorkerDeps): Promise<SendingVerifyResult> {
  const out: SendingVerifyResult = { pending: 0, verified: 0, failed: 0, unreachable: 0 }
  const { rows } = await deps.pool.query<{ tenantId: string; domain: string }>(
    `SELECT "tenantId", domain FROM tenant_sending_domains WHERE "verifiedAt" IS NULL`,
  )
  out.pending = rows.length
  if (deps.readIdentity === undefined) return out // inert without credentials, like the routes

  for (const row of rows) {
    let status: Awaited<ReturnType<IdentityStatusReader>>
    try {
      status = await deps.readIdentity(row.domain)
    } catch {
      out.unreachable++
      continue
    }
    if (status === 'verified') {
      // conditional on still being unverified, so a panel that won the race is not overwritten and
      // the first verification time is the one that stands
      await deps.pool.query(
        `UPDATE tenant_sending_domains SET status = 'verified', "verifiedAt" = now()
          WHERE "tenantId" = $1 AND "verifiedAt" IS NULL`,
        [row.tenantId],
      )
      out.verified++
    } else if (status === 'failed') {
      // the tenant needs to SEE this; it does not stop anything, because nothing was flowing yet
      await deps.pool.query(
        `UPDATE tenant_sending_domains SET status = 'failed' WHERE "tenantId" = $1 AND "verifiedAt" IS NULL`,
        [row.tenantId],
      )
      out.failed++
    }
  }
  return out
}

/** BullMQ worker: run the sweep on its repeatable schedule. Concurrency 1 — it is a slow poll. */
export function startSendingVerifyWorker(deps: SendingVerifyWorkerDeps): Worker {
  return new Worker(
    SENDING_VERIFY_QUEUE,
    async () => {
      const r = await runSendingVerify(deps)
      deps.onRun?.(r)
      return r
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
