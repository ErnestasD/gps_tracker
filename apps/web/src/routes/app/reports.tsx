import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, PageHeader } from '@/components/admin/AdminKit'
import { listAccounts, listDevices } from '@/lib/devices'
import { COLUMNS, downloadCsv, downloadPdf, runReport, toCsv, REPORT_TYPES, type ReportResult, type ReportType } from '@/lib/reports'
import { ScheduledReportsCard } from '@/routes/app/scheduledReports'

const selectCls = 'h-9 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--admin-brand)]/30'
const selectStyle: CSSProperties = { borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }

/** Reports (E06-2): run a report over a date range and export CSV. Consumes the E06-1 sync
 * API; account timezone is applied server-side. Async server-side XLSX export is a follow-up. */
export function ReportsPage() {
  const { t } = useTranslation()
  const [type, setType] = useState<ReportType>('mileage')
  const [account, setAccount] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  // a tenant-wide caller (platform/tsp admin) MUST name an account (their token has none);
  // an account-scoped user's account is fixed server-side (the sent id is ignored) — so we
  // always send the resolved account, defaulting to the first in scope (review HIGH).
  const acc = account || accounts.data?.[0]?.id || ''
  const iso = (v: string): string | undefined => {
    if (v === '') return undefined
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  const canRun = iso(from) !== undefined && iso(to) !== undefined && acc !== ''

  const run = useMutation({
    mutationFn: () => runReport(type, { from: iso(from)!, to: iso(to)!, accountId: acc, ...(deviceId ? { deviceId } : {}) }),
  })
  const result: ReportResult | undefined = run.data
  const cols = result ? COLUMNS[result.type] : COLUMNS[type]

  const exportCsv = () => {
    if (result === undefined) return
    downloadCsv(`${result.type}-report.csv`, toCsv(COLUMNS[result.type], result.rows))
  }
  const exportPdf = () => {
    if (result === undefined) return
    // localized PDF title from the report-type label — no raw slug, no hardcoded brand
    // (white-label: the platform name doesn't belong in a tenant's export)
    void downloadPdf(`${result.type}-report.pdf`, t('reports.pdfTitle', { type: t(`reports.t.${result.type}`) }), COLUMNS[result.type], result.rows)
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
            <select value={type} onChange={(e) => setType(e.target.value as ReportType)} data-testid="report-type" className={selectCls} style={selectStyle}>
              {REPORT_TYPES.map((k) => <option key={k} value={k}>{t(`reports.t.${k}`)}</option>)}
            </select>
          </Field>
          {(accounts.data ?? []).length > 1 && (
            <Field label={t('reports.account')}>
              <select value={acc} onChange={(e) => setAccount(e.target.value)} data-testid="report-account" className={selectCls} style={selectStyle}>
                {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('reports.device')}>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="report-device" className={selectCls} style={selectStyle}>
              <option value="">{t('reports.allDevices')}</option>
              {(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={t('reports.from')}>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="report-from" className={selectCls} style={selectStyle} />
          </Field>
          <Field label={t('reports.to')}>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} data-testid="report-to" className={selectCls} style={selectStyle} />
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
                    {cols.map((col) => <td key={col.key} className="px-3 py-2 tabular-nums md:px-4">{fmtCell(r[col.key])}</td>)}
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
