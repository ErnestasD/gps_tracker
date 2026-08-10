import { Worker, type ConnectionOptions } from 'bullmq'
import type { Redis } from 'ioredis'

import type { Db, LapsedTenant } from '@orbetra/db'
import { restoreTenantDevices, suspendTenantDevices } from '@orbetra/registry'

import { LAPSE_SWEEP_QUEUE } from './lapseSweepQueue.js'

export interface LapseSweepResult {
  /** tenants whose entitlements are floored right now */
  tenants: number
  /** devices those tenants still have registered */
  devices: number
  /** how many are past the grace window — i.e. somewhere on the notice ladder */
  actionable: number
  /** warning emails sent this run (stage 1, 2 or 3) */
  warned: number
  /** tenants SUSPENDED this run — their devices are out of the ingest registry */
  suspended: number
  /** tenants RESTORED this run because they paid */
  restored: number
}

export interface LapseSweepWorkerDeps {
  connection: ConnectionOptions
  db: Db
  /** the registry lives in Redis; suspension tears its keys down. Absent ⇒ count only, never cut off. */
  redis?: Redis | undefined
  now?: () => number
  /** days after the lapse before the notice ladder starts (env `BILLING_GRACE_DAYS`, default 14) */
  graceDays?: number
  /** absolute base for the "renew" link in the notices. Absent ⇒ no mail is sent, and — because a
   *  customer must never be cut off without warning — no suspension either. */
  appBaseUrl?: string | undefined
  mail?: {
    enqueueLapseEmail(job: { kind: 'lapse'; email: string; tenantId: string; locale: string; billingUrl: string; daysLeft: number }): Promise<void>
  }
  onSwept?: (r: LapseSweepResult) => void
  onFailed?: () => void
  /** a lapsed tenant's billing contact is undeliverable, so the ladder cannot run for them and their
   *  fleet will never be suspended. Someone has to fix the address; nothing else will. */
  onUnreachable?: () => void
}

/** SES has told us this billing contact is dead. Fails OPEN — see the note in authEmailWorker. */
async function isSuppressedContact(db: Db, email: string): Promise<boolean> {
  try {
    return await db.suppressions.isSuppressed(email)
  } catch {
    return false
  }
}

const DAY_MS = 86_400_000
export const DEFAULT_GRACE_DAYS = 14

/**
 * The ladder, from the founder's policy (2026-08-06):
 *
 *   grace ends (day 0)  →  notice 1: "3 days"
 *   +1 day              →  notice 2: "2 days"
 *   +2 days             →  notice 3: "1 day"  (final)
 *   +3 days             →  SUSPEND
 *
 * `stage` doubles as the idempotency record: it is written only after a notice is actually sent, so
 * a job that runs twice, or a worker restarted mid-sweep, neither mails a customer twice nor skips
 * the final warning before cutting them off.
 */
export const SUSPEND_AFTER_DAYS = 3

/** Days since the grace window closed. Negative ⇒ still inside grace. */
export function daysPastGrace(t: LapsedTenant, nowMs: number, graceDays: number): number | null {
  if (t.lapsedAt === null) return null
  return Math.floor((nowMs - t.lapsedAt.getTime()) / DAY_MS) - graceDays
}

/**
 * Which notice is DUE, given how far past grace the tenant is and what has already been sent.
 * `null` means nothing to send. Returns the stage number (1–3), which is also the row's new value.
 *
 * A tenant discovered LATE — one that lapsed while this job was not running, or whose grace ended
 * during an outage — gets the notice for where it is on the ladder, not the whole ladder at once.
 * The suspension check below refuses to fire until stage 3 has actually gone out, so the customer
 * still gets a final warning before the feed stops, however late we noticed.
 */
export function noticeDue(pastGrace: number, sentStage: number): number | null {
  if (pastGrace < 0) return null
  const due = Math.min(pastGrace + 1, SUSPEND_AFTER_DAYS)
  return due > sentStage ? due : null
}

/**
 * Past grace and worth a human looking at — the `billing_lapsed_actionable` gauge, not the ladder.
 *
 * A lapse with NO KNOWN DATE counts here and is deliberately skipped by the ladder below: an unknown
 * date means it has been lapsed at least since the row was written, so it is exactly the kind of
 * case worth surfacing — but it is not a date the automation may cut anyone off from. The gauge says
 * "look at these"; only a tenant with a real lapse date is ever acted on.
 */
export function isActionable(t: LapsedTenant, nowMs: number, graceDays: number): boolean {
  const past = daysPastGrace(t, nowMs, graceDays)
  return past === null || past >= 0
}

/**
 * `BILLING_GRACE_DAYS`, clamped to 0…365.
 *
 * EMPTY is absent, not zero. `Number('')` is 0 and finite, so the clamp accepted it — and an operator
 * "unsetting" the variable the usual way (`BILLING_GRACE_DAYS=` in .env, or compose's `${VAR:-}`)
 * would have given every already-lapsed tenant one email today and taken their fleet tomorrow.
 */
export function graceDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['BILLING_GRACE_DAYS']?.trim()
  if (raw === undefined || raw === '') return DEFAULT_GRACE_DAYS
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_GRACE_DAYS
  return Math.min(365, Math.max(0, Math.floor(n)))
}

/**
 * How many tenants ONE run may cut off. Not a throughput limit — a blast radius.
 *
 * The abandoned-signup prune batches because "a predicate bug that ran unbounded would take the
 * platform with it", and that only deletes debris. This suspends real customers' fleets, so it gets
 * the same protection: whatever a bad billing state, a clock skew or a bad grace value does, it does
 * to at most this many customers before someone sees the alert. The rest wait for tomorrow.
 */
export const MAX_SUSPENSIONS_PER_RUN = 50

export interface SweepDeps {
  db: Db
  redis?: Redis | undefined
  appBaseUrl?: string | undefined
  mail?: LapseSweepWorkerDeps['mail']
  /** a lapsed tenant's billing contact is undeliverable — see the note on the ladder below */
  onUnreachable?: () => void
}

/**
 * One pass of the lapse ladder.
 *
 * ORDER MATTERS, and it is: restore first, then warn, then suspend. Restoring first means a customer
 * whose payment landed since the last run gets their feed back before anything else happens, and can
 * never be warned or cut off in the same run that should have reinstated them.
 *
 * SUSPENSION IS REFUSED WITHOUT A WARNING PATH. If mail is not configured, or the final notice has
 * not gone out, nothing is cut off — a customer losing their live map with no email first is worse
 * than a lapsed tenant costing us another day of storage.
 */
export async function runLapseSweep(deps: SweepDeps, nowMs: number, graceDays: number): Promise<LapseSweepResult> {
  const lapsed = await deps.db.tenants.listLapsedTenants(new Date(nowMs))
  const result: LapseSweepResult = {
    tenants: lapsed.length,
    // every lapsed tenant's devices, not only the actionable ones: the cost is being incurred during
    // the grace window too
    devices: lapsed.reduce((n, t) => n + t.activeDevices, 0),
    actionable: lapsed.filter((t) => isActionable(t, nowMs, graceDays)).length,
    warned: 0,
    suspended: 0,
    restored: 0,
  }
  const canMail = deps.mail !== undefined && deps.appBaseUrl !== undefined
  const base = (deps.appBaseUrl ?? '').replace(/\/+$/, '')

  // 1. RESTORE anyone who paid. `listLapsedTenants` returns only floored tenants, so a suspended
  //    tenant that has paid is simply ABSENT from it — which is why the restore pass reads its own
  //    set rather than filtering this one.
  if (deps.redis !== undefined) {
    for (const t of await deps.db.tenants.listSuspended()) {
      if (lapsed.some((l) => l.tenantId === t.tenantId)) continue // still lapsed — leave suspended
      try {
        const devices = await deps.db.tenants.registryDevicesFor(t.tenantId)
        await restoreTenantDevices(deps.redis, devices) // nests the trip config itself — see the registry
        // the flag comes off AFTER the registry is rebuilt: a crash in between leaves the tenant
        // marked suspended with a working feed, which the next run simply repeats — the opposite
        // order would leave it unmarked and dark, and nothing would ever look at it again
        await deps.db.tenants.unsuspend(t.tenantId)
        result.restored++
        console.warn('billing: restored a tenant that paid', JSON.stringify({ tenantId: t.tenantId, devices: devices.length }))
      } catch (err) {
        console.error('billing: restore failed for tenant', t.tenantId, err instanceof Error ? err.message : String(err))
      }
    }
  }

  for (const t of lapsed) {
    const past = daysPastGrace(t, nowMs, graceDays)
    if (past === null || past < 0) continue // still inside the grace window
    try {
      /**
       * 2. WARN — one notice per day of the ladder, recorded before the next can be due.
       *
       * A SUPPRESSED CONTACT STOPS THE LADDER DEAD. The stage is what step 3 reads to decide the
       * customer has been warned enough to cut off, and it used to advance on ENQUEUE — so a tenant
       * whose billing address had hard-bounced was recorded as warned three times, warned into a
       * void, and then had their fleet stopped. Not advancing the stage means `readyToSuspend` can
       * never become true for them: they stay lapsed and visible in the counters until somebody
       * fixes the address, which is the only honest outcome when we cannot reach a customer.
       */
      const reachable = t.contactEmail !== null && !(await isSuppressedContact(deps.db, t.contactEmail))
      if (!reachable && t.contactEmail !== null) {
        console.warn('billing: lapse notice NOT sent — contact address is suppressed; suspension is blocked', JSON.stringify({ tenantId: t.tenantId, name: t.name }))
        deps.onUnreachable?.()
      }
      const due = noticeDue(past, t.noticeStage)
      if (due !== null && canMail && reachable && t.contactEmail !== null) {
        await deps.mail!.enqueueLapseEmail({
          kind: 'lapse',
          email: t.contactEmail,
          tenantId: t.tenantId,
          locale: t.contactLocale,
          billingUrl: `${base}/app/billing`,
          daysLeft: SUSPEND_AFTER_DAYS - (due - 1),
        })
        await deps.db.tenants.markLapseNotice(t.tenantId, due, t.lapsedAt)
        result.warned++
      }

      // 3. SUSPEND — only once the final warning has actually gone out, and only with a way to tell
      //    them it happened. `t.noticeStage` is the value BEFORE this run, so a tenant that reached
      //    stage 3 above waits one more day: the final notice must land before the feed stops.
      const readyToSuspend = past >= SUSPEND_AFTER_DAYS && t.noticeStage >= SUSPEND_AFTER_DAYS
      // ALREADY suspended and still lapsed ⇒ RE-ASSERT the teardown. `suspend()` commits before the
      // Redis walk, so a blip on device 3 of 40 used to leave the flag set, the customer told the
      // feed had stopped, and devices 3..N still ingesting — with the guard below blocking any retry
      // forever and the counter never incrementing, so the one suspension that went wrong was the
      // one nobody could see. The teardown is idempotent, so re-asserting costs nothing.
      //
      // RE-READ, never the snapshot. `lapsed` was listed at the top of the run, so a platform admin
      // clicking Restore in between would otherwise have this loop tear the registry straight back
      // down while the row already says not-suspended: a DARK fleet flagged Active, invisible to the
      // restore pass (not suspended) and to this one (it would fall through and re-suspend the
      // tenant a human deliberately just un-suspended). Being restored mid-run means SKIP for today
      // — tomorrow's sweep sees the real state and, because an override keeps the ladder, cuts them
      // off again immediately if they are still unpaid (review MED-HIGH).
      if (t.suspendedAt !== null) {
        if (!(await deps.db.tenants.isSuspended(t.tenantId))) continue
        if (deps.redis !== undefined) await suspendTenantDevices(deps.redis, await deps.db.tenants.registryDevicesFor(t.tenantId))
      } else if (readyToSuspend && deps.redis !== undefined && canMail && result.suspended < MAX_SUSPENSIONS_PER_RUN) {
        // COUNT from the DB write, not the Redis one: the flag is what every other pass keys on, so
        // it is the honest definition of "this tenant was cut off today".
        if (await deps.db.tenants.suspend(t.tenantId, new Date(nowMs))) {
          result.suspended++
          const devices = await deps.db.tenants.registryDevicesFor(t.tenantId)
          console.warn('billing: SUSPENDED a tenant for non-payment', JSON.stringify({ tenantId: t.tenantId, name: t.name, devices: devices.length }))
          await suspendTenantDevices(deps.redis, devices)
          if (reachable && t.contactEmail !== null) {
            await deps.mail!.enqueueLapseEmail({ kind: 'lapse', email: t.contactEmail, tenantId: t.tenantId, locale: t.contactLocale, billingUrl: `${base}/app/billing`, daysLeft: 0 })
          }
        }
      }
    } catch (err) {
      // one tenant's failure must not stop the ladder for the rest
      console.error('billing: lapse ladder failed for tenant', t.tenantId, err instanceof Error ? err.message : String(err))
    }
  }
  if (result.suspended >= MAX_SUSPENSIONS_PER_RUN) {
    // never silently truncate a destructive sweep — the number NOT acted on is the number that says
    // whether this was a normal day or a billing-state accident
    console.error('billing: suspension cap reached — remaining tenants deferred to the next run', MAX_SUSPENSIONS_PER_RUN)
  }
  return result
}

/**
 * Daily sweep: warn, then suspend, then restore whoever paid (audit MED #22).
 *
 * The entitlement floor was enforced only at device CREATE, so a canceled subscription changed
 * exactly one thing the customer could perceive — "you cannot add another device" — while the fleet
 * kept tracking at our cost, indefinitely, for free. This is the policy that makes lapsing mean
 * something, and every part of it is reversible: suspension stops NEW data being accepted and
 * deletes nothing, the customer can still sign in and read their whole history, and paying restores
 * the feed within a minute.
 */
export function createLapseSweepWorker(deps: LapseSweepWorkerDeps): Worker {
  const now = deps.now ?? Date.now
  const graceDays = deps.graceDays ?? DEFAULT_GRACE_DAYS
  if (deps.redis === undefined || deps.mail === undefined || deps.appBaseUrl === undefined) {
    console.warn('billing: lapse enforcement is COUNT-ONLY — no redis, mail transport or APP_BASE_URL, so nobody will be suspended')
  }
  return new Worker(
    LAPSE_SWEEP_QUEUE,
    async () => {
      try {
        deps.onSwept?.(
          await runLapseSweep(
            { db: deps.db, ...(deps.redis !== undefined ? { redis: deps.redis } : {}), ...(deps.appBaseUrl !== undefined ? { appBaseUrl: deps.appBaseUrl } : {}), ...(deps.mail !== undefined ? { mail: deps.mail } : {}), ...(deps.onUnreachable !== undefined ? { onUnreachable: deps.onUnreachable } : {}) },
            now(),
            graceDays,
          ),
        )
      } catch (err) {
        deps.onFailed?.()
        throw err
      }
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
