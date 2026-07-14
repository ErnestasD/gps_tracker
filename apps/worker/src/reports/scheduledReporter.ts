import { runReport, type Db, type Pool, type ReportResult, type ReportType } from '@orbetra/db'

import type { EmailTransport } from '../notify/drivers.js'

/**
 * Scheduled emailed reports (V1-nice). An hourly worker cron runs each enabled schedule that is DUE
 * and e-mails the result. `isDue` triggers on a UTC hour (daily, or weekly on `weekday`) and won't
 * re-fire within the cadence (a >23 h `lastRunAt` gap guard, so an hourly cron / restart is safe).
 * The report WINDOW is the last day (daily) or last 7 days (weekly); the report engine buckets rows
 * by the account's IANA zone (§7.7), so the window itself stays a simple UTC span.
 */
export interface Schedule {
  id: string
  tenantId: string
  accountId: string
  reportType: string
  cadence: string // 'daily' | 'weekly'
  hourUtc: number
  weekday: number | null // 0=Sun … 6=Sat
  recipients: string[]
  timezone: string
  lastRunAt: Date | null
}

const DAY_MS = 24 * 3_600_000
export const RUN_GUARD_MS = 23 * 3_600_000 // won't re-run a schedule within this window (the claim is authoritative)

/** True when the schedule is eligible to fire at `nowMs`. Uses hour ≥ hourUtc (not ==) so a tick
 *  missed during a deploy/restart still CATCHES UP later the same day; the atomic claimRun then
 *  guarantees it runs at most once per cadence period. A weekly schedule with no weekday never fires. */
export function isDue(s: Pick<Schedule, 'cadence' | 'hourUtc' | 'weekday'>, nowMs: number, lastRunAtMs: number | null): boolean {
  const d = new Date(nowMs)
  if (d.getUTCHours() < s.hourUtc) return false
  if (s.cadence === 'weekly' && (s.weekday === null || d.getUTCDay() !== s.weekday)) return false
  if (lastRunAtMs !== null && nowMs - lastRunAtMs < RUN_GUARD_MS) return false // cheap pre-filter; claim is authoritative
  return true
}

/** The [from,to] ISO window a schedule reports over at `nowMs`. */
export function reportWindow(cadence: string, nowMs: number): { from: string; to: string } {
  const span = cadence === 'weekly' ? 7 * DAY_MS : DAY_MS
  return { from: new Date(nowMs - span).toISOString(), to: new Date(nowMs).toISOString() }
}

/** A plain-text summary of a report result (one line per daily/aggregate row). */
export function formatReport(result: ReportResult, window: { from: string; to: string }): { subject: string; text: string } {
  const subject = `Orbetra ${result.type} report — ${window.from.slice(0, 10)} to ${window.to.slice(0, 10)}`
  const lines =
    result.rows.length === 0
      ? ['(no data in this period)']
      : result.rows.map((row) => Object.entries(row).map(([k, v]) => `${k}: ${String(v)}`).join(', '))
  return { subject, text: `${subject}\n\n${lines.join('\n')}\n` }
}

export interface ScheduledReporterDeps {
  db: Db
  pool: Pool
  transport: EmailTransport // captures MAIL_FROM + the SES config-set header internally
  now?: () => number
}

/** Run all DUE schedules once (the hourly cron body). Returns counts for observability. */
export async function runDueSchedules(deps: ScheduledReporterDeps): Promise<{ due: number; emailed: number }> {
  const nowMs = (deps.now ?? Date.now)()
  const schedules = (await deps.db.scheduledReports.listEnabled()) as unknown as Schedule[]
  let due = 0
  let emailed = 0
  for (const s of schedules) {
    if (!isDue(s, nowMs, s.lastRunAt ? s.lastRunAt.getTime() : null)) continue
    due++
    // atomically CLAIM before doing any work: only one of two overlapping cron runs wins → no dup
    // emails; a lost claim (already run this period) is skipped. Claim-before-send = at-most-once.
    if (!(await deps.db.scheduledReports.claimRun(s.id, new Date(nowMs), RUN_GUARD_MS))) continue
    try {
      const window = reportWindow(s.cadence, nowMs)
      const result = await runReport(deps.pool, s.reportType as ReportType, { tenantId: s.tenantId, accountId: s.accountId }, { ...window, timezone: s.timezone })
      const { subject, text } = formatReport(result, window)
      // each recipient independently: one bad address must NOT suppress the others
      for (const to of s.recipients) {
        try {
          await deps.transport.send(to, subject, text)
          emailed++
        } catch (err) {
          console.error('scheduled report send failed', s.id, err instanceof Error ? err.message : String(err)) // message only, no PII object
        }
      }
    } catch (err) {
      // report build failed after the claim → this period is skipped (at-most-once); logged only
      console.error('scheduled report run failed', s.id, err instanceof Error ? err.message : String(err))
    }
  }
  return { due, emailed }
}
