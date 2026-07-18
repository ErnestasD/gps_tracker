import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { DatePicker } from '@/components/admin/DatePicker'
import { useFmt } from '@/lib/datetime'
import { listAccounts, listDevices } from '@/lib/devices'
import { dayEndIso, dayStartIso } from '@/lib/playback'
import { cellValue, COLUMNS, dateColumns, downloadCsv, downloadPdf, runReport, toCsv, unitColumns, REPORT_TYPES, type ReportResult, type ReportType } from '@/lib/reports'
import { useUnits } from '@/lib/units'
import { ScheduledReportsCard } from '@/routes/app/scheduledReports'

/** Reports (E06-2): run a report over a date range and export CSV. Consumes the E06-1 sync
 * API; account timezone is applied server-side. Async server-side XLSX export is a follow-up. */
export function ReportsPage() {
  const { t } = useTranslation()
  const u = useUnits()
  const { dt } = useFmt()
  const [type, setType] = useState<ReportType>('mileage')
  const [account, setAccount] = useState('')
  const [deviceId, setDeviceId] = useState('')
  // DatePicker bounds are date-only (ADR-028 round-2 amendment): the report window spans the
  // FULL local days [from 00:00, to 23:59:59.999]; account timezone still applies server-side
  const [from, setFrom] = useState<Date | undefined>(undefined)
  const [to, setTo] = useState<Date | undefined>(undefined)

  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  // a tenant-wide caller (platform/tsp admin) MUST name an account (their token has none);
  // an account-scoped user's account is fixed server-side (the sent id is ignored) — so we
  // always send the resolved account, defaulting to the first in scope (review HIGH).
  const acc = account || accounts.data?.[0]?.id || ''
  const canRun = from !== undefined && to !== undefined && acc !== ''

  const run = useMutation({
    mutationFn: () => runReport(type, { from: dayStartIso(from!), to: dayEndIso(to!), accountId: acc, ...(deviceId ? { deviceId } : {}) }),
  })
  const result: ReportResult | undefined = run.data
  // display prefs applied to the RESULT table, CSV and PDF alike: distance/speed value
  // columns convert (unit-suffixed headers say which unit the numbers are in)
  const units = { distance: u.prefs.unitDistance, speed: u.prefs.unitSpeed }
  // datetime columns (trips start/end) go through dt — display prefs are "effective everywhere" (PR #101)
  const exportCols = (rt: ReportType) => dateColumns(unitColumns(COLUMNS[rt], units), dt)
  const cols = dateColumns(unitColumns(result ? COLUMNS[result.type] : COLUMNS[type], units), dt)

  const exportCsv = () => {
    if (result === undefined) return
    downloadCsv(`${result.type}-report.csv`, toCsv(exportCols(result.type), result.rows))
  }
  const exportPdf = () => {
    if (result === undefined) return
    // localized PDF title from the report-type label — no raw slug, no hardcoded brand
    // (white-label: the platform name doesn't belong in a tenant's export)
    void downloadPdf(`${result.type}-report.pdf`, t('reports.pdfTitle', { type: t(`reports.t.${result.type}`) }), exportCols(result.type), result.rows)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('reports.title')} description={t('reports.desc')} className="mb-0" />

      {/* generator card — run/export actions live in the card header */}
      <div className="admin-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('reports.run')}</h2>
          <div className="flex flex-wrap gap-2">
            <AdminButton data-testid="report-run" disabled={!canRun || run.isPending} onClick={() => run.mutate()}>{t('reports.runBtn')}</AdminButton>
            <AdminButton variant="secondary" data-testid="report-export" disabled={result === undefined || result.rows.length === 0} onClick={exportCsv}>{t('reports.exportCsv')}</AdminButton>
            <AdminButton variant="secondary" data-testid="report-export-pdf" disabled={result === undefined || result.rows.length === 0} onClick={exportPdf}>{t('reports.exportPdf')}</AdminButton>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('reports.type')}>
            <div className="w-44">
              <Combobox value={type} onChange={(v) => setType(v as ReportType)} data-testid="report-type" aria-label={t('reports.type')}
                options={REPORT_TYPES.map((k) => ({ value: k, label: t(`reports.t.${k}`) }))} />
            </div>
          </Field>
          {(accounts.data ?? []).length > 1 && (
            <Field label={t('reports.account')}>
              <div className="w-44">
                <Combobox value={acc} onChange={setAccount} data-testid="report-account" aria-label={t('reports.account')}
                  options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
              </div>
            </Field>
          )}
          <Field label={t('reports.device')}>
            <div className="w-44">
              <Combobox value={deviceId} onChange={setDeviceId} data-testid="report-device" aria-label={t('reports.device')}
                options={[{ value: '', label: t('reports.allDevices') }, ...(devices.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
            </div>
          </Field>
          <Field label={t('reports.from')}>
            <div className="w-40"><DatePicker value={from} onChange={setFrom} data-testid="report-from" aria-label={t('reports.from')} /></div>
          </Field>
          <Field label={t('reports.to')}>
            <div className="w-40"><DatePicker value={to} onChange={setTo} data-testid="report-to" aria-label={t('reports.to')} /></div>
          </Field>
        </div>
        {run.isError && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="report-error">{t('reports.error')}</p>}
      </div>

      {/* result card */}
      <div className="admin-card overflow-hidden">
        <h2 className="admin-hairline-b px-4 py-3 font-semibold md:px-5" style={{ color: 'var(--admin-ink)' }}>{t('reports.result')}</h2>
        {result === undefined ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="report-idle">{t('reports.idle')}</p>
        ) : result.rows.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="report-empty">{t('reports.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="report-table">
              <thead style={{ background: 'var(--admin-surface-sunken)' }}>
                <tr className="text-left text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  {cols.map((col) => <th key={col.key} className="px-3 py-2 font-medium md:px-4" >{t(`reports.col.${col.label}`, col.label)}</th>)}
                </tr>
              </thead>
              <tbody style={{ color: 'var(--admin-ink)' }}>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--admin-hairline)' }} data-testid="report-row">
                    {cols.map((col) => <td key={col.key} className="px-3 py-2 tabular-nums md:px-4">{fmtCell(cellValue(col, r))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ScheduledReportsCard {...(acc ? { accountId: acc } : {})} />
    </div>
  )
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{label}{children}</label>
}
