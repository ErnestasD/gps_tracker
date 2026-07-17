import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { createScheduledReport, deleteScheduledReport, listScheduledReports, REPORT_TYPES } from '@/lib/scheduledReports'

const selectCls = 'h-9 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--admin-brand)]/30'
const selectStyle: CSSProperties = { borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }
const fieldCls = 'flex flex-col gap-1 text-xs'
const fieldStyle: CSSProperties = { color: 'var(--admin-ink-soft)' }

/** Scheduled emailed reports (V1-nice): pick a report + cadence + recipients; the worker e-mails it.
 * Round 2 (ADR-028): delete goes through a danger ConfirmDialog. */
export function ScheduledReportsCard({ accountId }: { accountId?: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['scheduled-reports'], queryFn: listScheduledReports })
  const [reportType, setReportType] = useState<string>('trips')
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily')
  const [hourUtc, setHourUtc] = useState(6)
  const [weekday, setWeekday] = useState(1)
  const [recipients, setRecipients] = useState('')
  const [error, setError] = useState<string | null>(null)
  // delete target resolves against the LIVE list (devices precedent)
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  const deleteFor = (list.data ?? []).find((s) => s.id === deleteForId) ?? null

  const emails = recipients.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const canSave = emails.length > 0

  const save = () => {
    setError(null)
    createScheduledReport({
      ...(accountId ? { accountId } : {}),
      reportType, cadence, hourUtc, recipients: emails,
      ...(cadence === 'weekly' ? { weekday } : {}),
    })
      .then(() => { setRecipients(''); void qc.invalidateQueries({ queryKey: ['scheduled-reports'] }) })
      .catch(() => setError(t('scheduled.error')))
  }

  return (
    <div className="admin-card space-y-3 p-4 md:p-5" data-testid="scheduled-reports-card">
      <h2 className="font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('scheduled.title')}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className={fieldCls} style={fieldStyle}>{t('scheduled.type')}
          <select value={reportType} onChange={(e) => setReportType(e.target.value)} data-testid="sr-type" className={selectCls} style={selectStyle}>
            {REPORT_TYPES.map((k) => <option key={k} value={k}>{t(`reports.t.${k}`)}</option>)}
          </select>
        </label>
        <label className={fieldCls} style={fieldStyle}>{t('scheduled.cadence')}
          <select value={cadence} onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly')} data-testid="sr-cadence" className={selectCls} style={selectStyle}>
            <option value="daily">{t('scheduled.daily')}</option>
            <option value="weekly">{t('scheduled.weekly')}</option>
          </select>
        </label>
        {cadence === 'weekly' && (
          <label className={fieldCls} style={fieldStyle}>{t('scheduled.weekday')}
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} data-testid="sr-weekday" className={selectCls} style={selectStyle}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{t(`scheduled.wd.${d}`)}</option>)}
            </select>
          </label>
        )}
        <label className={fieldCls} style={fieldStyle}>{t('scheduled.hour')}
          <AdminInput type="number" min={0} max={23} value={hourUtc} onChange={(e) => setHourUtc(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} data-testid="sr-hour" className="w-20" />
        </label>
        <label className={`${fieldCls} flex-1`} style={fieldStyle}>{t('scheduled.recipients')}
          <AdminInput value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@co.com, boss@co.com" data-testid="sr-recipients" />
        </label>
        <AdminButton size="sm" disabled={!canSave} data-testid="sr-save" onClick={save}>{t('scheduled.add')}</AdminButton>
      </div>
      {error !== null && <span role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</span>}

      {(list.data ?? []).length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sr-empty">{t('scheduled.empty')}</p>
      ) : (
        <ul className="space-y-2" data-testid="sr-list">
          {(list.data ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm" style={{ borderColor: 'var(--admin-hairline)', color: 'var(--admin-ink)' }} data-testid={`sr-${s.id}`}>
              <Badge tone="brand">{t(`reports.t.${s.reportType}`)}</Badge>
              <span style={{ color: 'var(--admin-ink-soft)' }}>{t(`scheduled.${s.cadence}`)}{s.cadence === 'weekly' && s.weekday != null ? ` · ${t(`scheduled.wd.${s.weekday}`)}` : ''} · {String(s.hourUtc).padStart(2, '0')}:00 UTC</span>
              <span className="truncate">{s.recipients.join(', ')}</span>
              <button
                type="button"
                aria-label={t('scheduled.delete')}
                data-testid={`sr-del-${s.id}`}
                className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                style={{ color: 'var(--admin-danger)' }}
                onClick={() => setDeleteForId(s.id)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null)
        }}
        tone="danger"
        title={t('scheduled.delete')}
        description={t('scheduled.deleteSure')}
        confirmLabel={t('scheduled.delete')}
        onConfirm={() => {
          const s = deleteFor
          if (s === null) return
          void deleteScheduledReport(s.id).then(() => qc.invalidateQueries({ queryKey: ['scheduled-reports'] })).catch(() => undefined)
        }}
      />
    </div>
  )
}
