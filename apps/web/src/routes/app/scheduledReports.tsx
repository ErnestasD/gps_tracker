import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { createScheduledReport, deleteScheduledReport, listScheduledReports, REPORT_TYPES } from '@/lib/scheduledReports'

const fieldCls = 'flex flex-col gap-1 text-xs'
const fieldStyle: CSSProperties = { color: 'var(--admin-ink-soft)' }

/** Scheduled emailed reports (V1-nice): pick a report + cadence + recipients; the worker e-mails it.
 * Round 2 (ADR-028): the add form lives in a right Sheet behind the card-header "+ Add" button
 * (reference app.reports "Suplanuotos ataskaitos" card); rows are Lovable tiles (leading icon,
 * two-line title/subtitle, recipient Badges); delete goes through a danger ConfirmDialog.
 * All sr-* testids kept (selects became Comboboxes in the round-2 control sweep). */
export function ScheduledReportsCard({ accountId }: { accountId?: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['scheduled-reports'], queryFn: listScheduledReports })
  const [addOpen, setAddOpen] = useState(false)
  const [deleteError, setDeleteError] = useState(false) // a failed delete was swallowed
  // delete target resolves against the LIVE list (devices precedent)
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  const deleteFor = (list.data ?? []).find((s) => s.id === deleteForId) ?? null

  return (
    <div className="admin-card space-y-3 p-4 md:p-5" data-testid="scheduled-reports-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('scheduled.title')}</h2>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton size="sm" variant="secondary" data-testid="sr-add-open">
              <Plus className="h-4 w-4" aria-hidden />
              {t('scheduled.add')}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t('scheduled.addTitle')}</SheetTitle>
            </SheetHeader>
            {/* closing the sheet unmounts the form, so each open starts fresh */}
            <ScheduleForm
              accountId={accountId}
              onCreated={() => {
                setAddOpen(false)
                void qc.invalidateQueries({ queryKey: ['scheduled-reports'] })
              }}
              onCancel={() => setAddOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      {deleteError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="sr-action-error">{t('scheduled.actionError')}</p>
      )}

      {list.isError ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="sr-error">{t('admin.loadError')}</p>
      ) : (list.data ?? []).length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sr-empty">{t('scheduled.empty')}</p>
      ) : (
        <ul className="space-y-2" data-testid="sr-list">
          {(list.data ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--admin-hairline)', color: 'var(--admin-ink)' }} data-testid={`sr-${s.id}`}>
              {/* Lovable tile: leading icon + two-line title/subtitle + recipient badges */}
              <FileText className="h-4 w-4 shrink-0" style={{ color: 'var(--admin-brand)' }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t(`reports.t.${s.reportType}`)}</div>
                <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  {t(`scheduled.${s.cadence}`)}{s.cadence === 'weekly' && s.weekday != null ? ` · ${t(`scheduled.wd.${s.weekday}`)}` : ''} · {String(s.hourUtc).padStart(2, '0')}:00 UTC
                </div>
              </div>
              <div className="flex max-w-[50%] flex-wrap justify-end gap-1">
                {s.recipients.map((r) => <Badge key={r} tone="neutral">{r}</Badge>)}
              </div>
              <button
                type="button"
                aria-label={t('scheduled.delete')}
                data-testid={`sr-del-${s.id}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                style={{ color: 'var(--admin-danger)' }}
                onClick={() => setDeleteForId(s.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
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
          setDeleteError(false)
          void deleteScheduledReport(s.id)
            .then(() => qc.invalidateQueries({ queryKey: ['scheduled-reports'] }))
            .catch(() => setDeleteError(true))
        }}
      />
    </div>
  )
}

/** Add form inside the Sheet (devices precedent): same fields/testids as the old inline form,
 * stacked vertically; sr-save stays the submit control. */
function ScheduleForm({ accountId, onCreated, onCancel }: {
  accountId?: string
  onCreated: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [reportType, setReportType] = useState<string>('trips')
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily')
  const [hourUtc, setHourUtc] = useState(6)
  const [weekday, setWeekday] = useState(1)
  const [recipients, setRecipients] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false) // in-flight guard: a double-click must not create duplicate schedules (which then double-email every tick)

  const emails = recipients.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const canSave = emails.length > 0

  const save = () => {
    if (busy) return
    setError(null)
    setBusy(true)
    createScheduledReport({
      ...(accountId ? { accountId } : {}),
      reportType, cadence, hourUtc, recipients: emails,
      ...(cadence === 'weekly' ? { weekday } : {}),
    })
      .then(() => onCreated()) // parent closes the sheet; unmount resets the form
      .catch(() => setError(t('scheduled.error')))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      <label className={fieldCls} style={fieldStyle}>{t('scheduled.type')}
        <Combobox value={reportType} onChange={setReportType} data-testid="sr-type" aria-label={t('scheduled.type')}
          options={REPORT_TYPES.map((k) => ({ value: k, label: t(`reports.t.${k}`) }))} />
      </label>
      <label className={fieldCls} style={fieldStyle}>{t('scheduled.cadence')}
        <Combobox value={cadence} onChange={(v) => setCadence(v as 'daily' | 'weekly')} data-testid="sr-cadence" aria-label={t('scheduled.cadence')}
          options={[{ value: 'daily', label: t('scheduled.daily') }, { value: 'weekly', label: t('scheduled.weekly') }]} />
      </label>
      {cadence === 'weekly' && (
        <label className={fieldCls} style={fieldStyle}>{t('scheduled.weekday')}
          <Combobox value={String(weekday)} onChange={(v) => setWeekday(Number(v))} data-testid="sr-weekday" aria-label={t('scheduled.weekday')}
            options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`scheduled.wd.${d}`) }))} />
        </label>
      )}
      <label className={fieldCls} style={fieldStyle}>{t('scheduled.hour')}
        <AdminInput type="number" min={0} max={23} value={hourUtc} onChange={(e) => setHourUtc(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} data-testid="sr-hour" className="w-20" />
      </label>
      <label className={fieldCls} style={fieldStyle}>{t('scheduled.recipients')}
        <AdminInput value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@co.com, boss@co.com" data-testid="sr-recipients" />
      </label>
      {error !== null && <span role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</span>}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton disabled={!canSave || busy} data-testid="sr-save" onClick={save}>{t('scheduled.create')}</AdminButton>
      </SheetFooter>
    </div>
  )
}
