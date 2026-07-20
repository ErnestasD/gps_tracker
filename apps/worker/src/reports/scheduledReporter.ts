import { runReport, type Db, type Pool, type ReportResult, type ReportType } from '@orbetra/db'
import { brandingSchema, escapeHtml, renderBrandedEmail, type Branding } from '@orbetra/shared'

import { renderReportTable, renderReportTableHtml, reportTitle } from '../format/report.js'
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

/**
 * The [from,to] ISO window a schedule reports over. Two properties matter (review MED):
 *  1. `to` is anchored to TODAY's scheduled UTC hour (≤ nowMs, guaranteed by isDue), NOT the actual
 *     tick instant — so consecutive windows tile at the same boundary regardless of which catch-up
 *     hour the cron happened to fire, and no boundary hour is dropped or double-reported.
 *  2. `from` is normally `to - span`, but extends back to cover the missed periods when the last
 *     successful run was MORE than one span ago — so a period missed during an outage (including
 *     across UTC midnight, and a weekly period skipped for a whole week) is still reported, not
 *     silently lost. Crucially `from` is anchored to a SCHEDULED boundary (a whole number of spans
 *     back from `to`), NOT the raw `lastRunAt` fire instant: a catch-up tick stamps lastRunAt at
 *     whatever hour it happened to run (isDue only requires hour ≥ hourUtc), so using it verbatim
 *     would drop the sub-span slice [alignedBoundary, lastRunAt] from the report (review MED).
 *
 * KNOWN LIMITATION: the window is a UTC span, not an account-local (IANA) day span. The report engine
 * still buckets ROWS by the account zone (§7.7), but the window edges are UTC — a full account-local
 * alignment needs date-fns-tz in the worker (a new dep ⇒ ADR). Tracked for a follow-up.
 */
export function reportWindow(
  s: Pick<Schedule, 'cadence' | 'hourUtc'>,
  nowMs: number,
  lastRunAtMs: number | null,
): { from: string; to: string } {
  const span = s.cadence === 'weekly' ? 7 * DAY_MS : DAY_MS
  const d = new Date(nowMs)
  const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.hourUtc, 0, 0)
  const defaultFrom = to - span
  // When a run was missed (lastRunAt older than one span), step whole spans back from `to` until we
  // cover lastRunAt — anchoring `from` to the previous scheduled boundary, not the raw fire instant.
  let from = defaultFrom
  if (lastRunAtMs !== null && lastRunAtMs < defaultFrom) {
    const spansBack = Math.ceil((to - lastRunAtMs) / span)
    from = to - spansBack * span
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

/**
 * A readable, tenant-BRANDED plain-text report body. Columns get human labels, raw storage units are
 * converted to display units (meters→km, seconds→h), and any timestamp column renders in the ACCOUNT
 * timezone (rule 7) — none of the raw camelCase keys / meters / UTC ISO leak to the recipient.
 * `brand` is the tenant's product name (white-label — never hardcode the platform name in a tenant's mail).
 * TODO(account-settings): text is English + units are canonical metric (km, km/h, h); the per-user
 * locale + unit choice is device-local on the web and unknown to the server (see format/localize.ts).
 */
export function formatReport(
  result: ReportResult,
  window: { from: string; to: string },
  opts: { timezone: string; brand: string; branding?: Branding | undefined; tenantName?: string | undefined },
): { subject: string; text: string; html?: string } {
  const title = reportTitle(result.type)
  const subject = `${opts.brand} — ${title} report (${window.from.slice(0, 10)} to ${window.to.slice(0, 10)})`
  // ReportRow is a closed interface (no index signature); the renderer reads keys generically
  const rows = result.rows as unknown as Array<Record<string, unknown>>
  const table = renderReportTable(result.type, rows, opts.timezone)
  const text = `${subject}\n\n${table}\n\nAll times shown in ${opts.timezone}. Generated by ${opts.brand}.\n`
  const html = renderReportHtml(result.type, subject, title, rows, opts)
  return { subject, text, html }
}

/** Wrap the report's HTML table in the tenant's white-label brand shell. FAIL SAFE: any render error
 *  returns undefined so the report still emails as plain text (`text`) and the cron never crashes. */
function renderReportHtml(
  type: string,
  subject: string,
  title: string,
  rows: Array<Record<string, unknown>>,
  opts: { timezone: string; brand: string; branding?: Branding | undefined; tenantName?: string | undefined },
): string | undefined {
  try {
    const table = renderReportTableHtml(type, rows, opts.timezone)
    const bodyHtml = [
      `<h2 style="margin:0 0 12px;font-size:16px">${escapeHtml(title)} report</h2>`,
      table,
      `<p style="margin:12px 0 0;color:#93a1b7;font-size:12px">All times shown in ${escapeHtml(opts.timezone)}.</p>`,
    ].join('')
    const tenantName = opts.tenantName && opts.tenantName.trim() !== '' ? opts.tenantName : opts.brand
    return renderBrandedEmail(opts.branding ?? {}, tenantName, { subject, bodyHtml })
  } catch {
    return undefined
  }
}

/** The tenant's white-label identity for a report: the outgoing `brand` string (productName → tenant
 *  name → 'Orbetra', used in the subject) plus the FULL `branding` (logo/color/supportEmail) and
 *  tenant `name` for the branded HTML shell. Any lookup/parse failure defaults gracefully — a missing
 *  brand must never suppress report delivery; a malformed branding jsonb simply falls back to name. */
async function resolveBranding(pool: Pool, tenantId: string): Promise<{ brand: string; branding: Branding | undefined; tenantName: string | undefined }> {
  try {
    const res = await pool.query<{ name: string; branding: unknown }>('SELECT name, branding FROM tenants WHERE id = $1', [tenantId])
    const row = res.rows[0]
    if (row === undefined) return { brand: 'Orbetra', branding: undefined, tenantName: undefined }
    const tenantName = row.name && row.name.trim() !== '' ? row.name : undefined
    const parsed = row.branding && typeof row.branding === 'object' ? brandingSchema.safeParse(row.branding) : undefined
    const branding = parsed?.success ? parsed.data : undefined
    const product = branding?.productName
    const brand = typeof product === 'string' && product.trim() !== '' ? product : tenantName ?? 'Orbetra'
    return { brand, branding, tenantName }
  } catch {
    return { brand: 'Orbetra', branding: undefined, tenantName: undefined }
  }
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
      const window = reportWindow(s, nowMs, s.lastRunAt ? s.lastRunAt.getTime() : null)
      const result = await runReport(deps.pool, s.reportType as ReportType, { tenantId: s.tenantId, accountId: s.accountId }, { ...window, timezone: s.timezone })
      const { brand, branding, tenantName } = await resolveBranding(deps.pool, s.tenantId)
      const { subject, text, html } = formatReport(result, window, { timezone: s.timezone, brand, branding, tenantName })
      // each recipient independently: one bad address must NOT suppress the others
      for (const to of s.recipients) {
        try {
          await deps.transport.send(to, subject, text, html)
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
