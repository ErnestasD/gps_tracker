import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createScheduledReport, deleteScheduledReport, listScheduledReports, REPORT_TYPES } from '@/lib/scheduledReports'

const inputCls = 'h-9 rounded-card border border-line bg-surface px-2 text-sm'

/** Scheduled emailed reports (V1-nice): pick a report + cadence + recipients; the worker e-mails it. */
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
    <Card data-testid="scheduled-reports-card">
      <CardHeader><CardTitle className="text-base">{t('scheduled.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">{t('scheduled.type')}
            <select value={reportType} onChange={(e) => setReportType(e.target.value)} data-testid="sr-type" className={inputCls}>
              {REPORT_TYPES.map((k) => <option key={k} value={k}>{t(`reports.t.${k}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">{t('scheduled.cadence')}
            <select value={cadence} onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly')} data-testid="sr-cadence" className={inputCls}>
              <option value="daily">{t('scheduled.daily')}</option>
              <option value="weekly">{t('scheduled.weekly')}</option>
            </select>
          </label>
          {cadence === 'weekly' && (
            <label className="flex flex-col gap-1 text-xs text-muted">{t('scheduled.weekday')}
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} data-testid="sr-weekday" className={inputCls}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{t(`scheduled.wd.${d}`)}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted">{t('scheduled.hour')}
            <Input type="number" min={0} max={23} value={hourUtc} onChange={(e) => setHourUtc(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} data-testid="sr-hour" className="w-20" />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-muted">{t('scheduled.recipients')}
            <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@co.com, boss@co.com" data-testid="sr-recipients" />
          </label>
          <Button size="sm" disabled={!canSave} data-testid="sr-save" onClick={save}>{t('scheduled.add')}</Button>
        </div>
        {error !== null && <span role="alert" className="text-sm text-danger">{error}</span>}

        {(list.data ?? []).length === 0 ? (
          <p className="text-sm text-muted" data-testid="sr-empty">{t('scheduled.empty')}</p>
        ) : (
          <ul className="space-y-1" data-testid="sr-list">
            {(list.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-card border border-line p-2 text-sm" data-testid={`sr-${s.id}`}>
                <Badge variant="outline">{t(`reports.t.${s.reportType}`)}</Badge>
                <span className="text-muted">{t(`scheduled.${s.cadence}`)}{s.cadence === 'weekly' && s.weekday != null ? ` · ${t(`scheduled.wd.${s.weekday}`)}` : ''} · {String(s.hourUtc).padStart(2, '0')}:00 UTC</span>
                <span className="truncate">{s.recipients.join(', ')}</span>
                <Button variant="ghost" size="sm" className="ml-auto" data-testid={`sr-del-${s.id}`} onClick={() => void deleteScheduledReport(s.id).then(() => qc.invalidateQueries({ queryKey: ['scheduled-reports'] })).catch(() => undefined)}>
                  {t('scheduled.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
