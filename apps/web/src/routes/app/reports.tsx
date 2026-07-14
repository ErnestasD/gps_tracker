import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listAccounts, listDevices } from '@/lib/devices'
import { COLUMNS, downloadCsv, runReport, toCsv, REPORT_TYPES, type ReportResult, type ReportType } from '@/lib/reports'
import { ScheduledReportsCard } from '@/routes/app/scheduledReports'

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

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t('reports.title')}</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('reports.run')}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('reports.type')}>
              <select value={type} onChange={(e) => setType(e.target.value as ReportType)} data-testid="report-type" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                {REPORT_TYPES.map((k) => <option key={k} value={k}>{t(`reports.t.${k}`)}</option>)}
              </select>
            </Field>
            {(accounts.data ?? []).length > 1 && (
              <Field label={t('reports.account')}>
                <select value={acc} onChange={(e) => setAccount(e.target.value)} data-testid="report-account" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                  {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            )}
            <Field label={t('reports.device')}>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="report-device" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                <option value="">{t('reports.allDevices')}</option>
                {(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label={t('reports.from')}>
              <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="report-from" className="h-9 rounded-card border border-line bg-surface px-2 text-sm" />
            </Field>
            <Field label={t('reports.to')}>
              <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} data-testid="report-to" className="h-9 rounded-card border border-line bg-surface px-2 text-sm" />
            </Field>
            <Button data-testid="report-run" disabled={!canRun || run.isPending} onClick={() => run.mutate()}>{t('reports.runBtn')}</Button>
            <Button variant="secondary" data-testid="report-export" disabled={result === undefined || result.rows.length === 0} onClick={exportCsv}>{t('reports.exportCsv')}</Button>
          </div>
          {run.isError && <p role="alert" className="mt-2 text-sm text-danger" data-testid="report-error">{t('reports.error')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('reports.result')}</CardTitle></CardHeader>
        <CardContent>
          {result === undefined ? (
            <p className="py-8 text-center text-sm text-muted" data-testid="report-idle">{t('reports.idle')}</p>
          ) : result.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted" data-testid="report-empty">{t('reports.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="report-table">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    {cols.map((col) => <th key={col.key} className="py-2 pr-3 font-medium">{t(`reports.col.${col.label}`, col.label)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/60" data-testid="report-row">
                      {cols.map((col) => <td key={col.key} className="py-2 pr-3 tabular-nums">{fmtCell(r[col.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

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
  return <label className="flex flex-col gap-1 text-xs text-muted">{label}{children}</label>
}
