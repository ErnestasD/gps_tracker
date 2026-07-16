import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { Badge } from '@/components/ui/badge'
import { getCurrentUser } from '@/lib/auth'
import { listDevices } from '@/lib/devices'
import { createMaintenance, deleteMaintenance, dueVariant, listMaintenance, markServiced, type MaintenanceView } from '@/lib/maintenance'

const selectStyle: React.CSSProperties = {
  borderColor: 'var(--admin-hairline)',
  background: 'var(--admin-surface)',
  color: 'var(--admin-ink)',
}

/** Maintenance reminders (V2): per-device service intervals by km/days; due computed at read.
 * Admin re-skin (ADR-028): PageHeader + StatCard counts + admin-card list. */
export function MaintenancePage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const items = useQuery({ queryKey: ['maintenance'], queryFn: listMaintenance })
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['maintenance'] })
  const deviceName = (id: string) => (devices.data ?? []).find((d) => d.id === id)?.name ?? id

  const list = items.data ?? []
  const okCount = list.filter((m) => m.due.status === 'ok').length
  const dueCount = list.filter((m) => m.due.status === 'due_soon').length
  const overdueCount = list.filter((m) => m.due.status === 'overdue').length

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('maint.title')} description={t('maint.desc')} />

      {list.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard
            label={t('maint.stat.ok')}
            value={<><CheckCircle2 className="mr-2 inline h-5 w-5" style={{ color: 'var(--admin-success)' }} />{okCount}</>}
          />
          <StatCard
            label={t('maint.stat.due')}
            value={<><Wrench className="mr-2 inline h-5 w-5" style={{ color: 'var(--admin-warning)' }} />{dueCount}</>}
          />
          <StatCard
            label={t('maint.stat.overdue')}
            value={<><AlertTriangle className="mr-2 inline h-5 w-5" style={{ color: 'var(--admin-danger)' }} />{overdueCount}</>}
          />
        </div>
      )}

      {canWrite && <MaintForm devices={devices.data ?? []} onCreated={refresh} />}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('maint.list')}
        </div>
        {items.isLoading ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('maint.loading')}</p>
        ) : items.isError ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>{t('maint.loadError')}</p>
        ) : list.length === 0 ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('maint.empty')}</p>
        ) : (
          <ul data-testid="maint-list">
            {list.map((m) => (
              <li
                key={m.id}
                className="admin-hairline-b flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-[var(--admin-surface-sunken)]"
                data-testid={`maint-${m.id}`}
              >
                {/* dueVariant is the unit-tested ui/badge mapping — keep ui/badge here */}
                <Badge variant={dueVariant(m.due.status)} data-testid={`maint-status-${m.id}`}>{t(`maint.status.${m.due.status}`)}</Badge>
                <span className="font-medium" style={{ color: 'var(--admin-ink)' }}>{m.title}</span>
                <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{deviceName(m.deviceId)}</span>
                <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`maint-remaining-${m.id}`}>{remaining(m, t)}</span>
                {canWrite && (
                  <span className="ml-auto flex gap-1">
                    <AdminButton variant="ghost" size="sm" data-testid={`maint-serviced-${m.id}`} onClick={() => void markServiced(m.id, m.currentOdoKm).then(refresh).catch(() => undefined)}>{t('maint.markServiced')}</AdminButton>
                    <AdminButton variant="ghost" size="sm" style={{ color: 'var(--admin-danger)' }} data-testid={`maint-del-${m.id}`} onClick={() => void deleteMaintenance(m.id).then(refresh).catch(() => undefined)}>{t('maint.delete')}</AdminButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** The remaining-until-due label (km and/or days), from the computed due. */
function remaining(m: MaintenanceView, t: (k: string, o?: Record<string, unknown>) => string): string {
  const parts: string[] = []
  if (m.due.kmRemaining !== null) parts.push(t('maint.kmLeft', { n: m.due.kmRemaining }))
  if (m.due.daysRemaining !== null) parts.push(t('maint.daysLeft', { n: m.due.daysRemaining }))
  return parts.join(' · ')
}

function MaintForm({ devices, onCreated }: { devices: { id: string; name: string }[]; onCreated: () => void }) {
  const { t } = useTranslation()
  const [deviceId, setDeviceId] = useState('')
  const [title, setTitle] = useState('')
  const [intervalKm, setIntervalKm] = useState('')
  const [intervalDays, setIntervalDays] = useState('')
  const [odoKm, setOdoKm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dev = deviceId || devices[0]?.id || ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (title.trim() === '' || dev === '') { setError(t('maint.needFields')); return }
    const km = intervalKm.trim() === '' ? null : Number(intervalKm)
    const days = intervalDays.trim() === '' ? null : Number(intervalDays)
    if (km === null && days === null) { setError(t('maint.needInterval')); return }
    setBusy(true)
    try {
      // only send an explicit odometer baseline when the operator typed one; otherwise the server
      // baselines a km reminder to the device's CURRENT odometer (full interval remaining), never 0
      await createMaintenance({
        deviceId: dev, title: title.trim(),
        intervalKm: km, intervalDays: days,
        ...(km !== null && odoKm.trim() !== '' ? { lastServiceOdoKm: Number(odoKm) } : {}),
      })
      setTitle(''); setIntervalKm(''); setIntervalDays(''); setOdoKm('')
      onCreated()
    } catch {
      setError(t('maint.saveError'))
    } finally { setBusy(false) }
  }

  return (
    <div className="admin-card">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {t('maint.add')}
      </div>
      <div className="p-4">
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2" data-testid="maint-form">
          <Field label={t('maint.device')}>
            <select value={dev} onChange={(e) => setDeviceId(e.target.value)} data-testid="maint-device" className="h-9 rounded-md border px-2 text-sm" style={selectStyle}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={t('maint.itemTitle')}><AdminInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} data-testid="maint-title" className="w-40" /></Field>
          <Field label={t('maint.intervalKm')}><AdminInput type="number" min={1} value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} data-testid="maint-km" className="w-28" /></Field>
          <Field label={t('maint.intervalDays')}><AdminInput type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} data-testid="maint-days" className="w-28" /></Field>
          <Field label={t('maint.currentOdo')}><AdminInput type="number" min={0} value={odoKm} onChange={(e) => setOdoKm(e.target.value)} placeholder="0" data-testid="maint-odo" className="w-28" /></Field>
          <AdminButton type="submit" disabled={busy} data-testid="maint-create">{t('maint.create')}</AdminButton>
          {error !== null && <p role="alert" className="w-full text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="maint-error">{error}</p>}
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}
