import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getCurrentUser } from '@/lib/auth'
import { listDevices } from '@/lib/devices'
import { createMaintenance, deleteMaintenance, dueVariant, listMaintenance, markServiced, type MaintenanceView } from '@/lib/maintenance'

/** Maintenance reminders (V2): per-device service intervals by km/days; due computed at read. */
export function MaintenancePage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const items = useQuery({ queryKey: ['maintenance'], queryFn: listMaintenance })
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['maintenance'] })
  const deviceName = (id: string) => (devices.data ?? []).find((d) => d.id === id)?.name ?? id

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">{t('maint.title')}</h1>

      {canWrite && <MaintForm devices={devices.data ?? []} onCreated={refresh} />}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('maint.list')}</CardTitle></CardHeader>
        <CardContent>
          {items.isLoading ? (
            <p className="text-sm text-muted">{t('maint.loading')}</p>
          ) : items.isError ? (
            <p className="text-sm text-danger">{t('maint.loadError')}</p>
          ) : (items.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t('maint.empty')}</p>
          ) : (
            <ul className="space-y-2" data-testid="maint-list">
              {(items.data ?? []).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line p-2 text-sm" data-testid={`maint-${m.id}`}>
                  <Badge variant={dueVariant(m.due.status)} data-testid={`maint-status-${m.id}`}>{t(`maint.status.${m.due.status}`)}</Badge>
                  <span className="font-medium">{m.title}</span>
                  <span className="text-xs text-muted">{deviceName(m.deviceId)}</span>
                  <span className="text-xs text-muted" data-testid={`maint-remaining-${m.id}`}>{remaining(m, t)}</span>
                  {canWrite && (
                    <span className="ml-auto flex gap-1">
                      <Button variant="ghost" size="sm" data-testid={`maint-serviced-${m.id}`} onClick={() => void markServiced(m.id, m.currentOdoKm).then(refresh).catch(() => undefined)}>{t('maint.markServiced')}</Button>
                      <Button variant="ghost" size="sm" className="text-danger" data-testid={`maint-del-${m.id}`} onClick={() => void deleteMaintenance(m.id).then(refresh).catch(() => undefined)}>{t('maint.delete')}</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader><CardTitle className="text-base">{t('maint.add')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2" data-testid="maint-form">
          <Field label={t('maint.device')}>
            <select value={dev} onChange={(e) => setDeviceId(e.target.value)} data-testid="maint-device" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={t('maint.itemTitle')}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} data-testid="maint-title" className="w-40" /></Field>
          <Field label={t('maint.intervalKm')}><Input type="number" min={1} value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} data-testid="maint-km" className="w-28" /></Field>
          <Field label={t('maint.intervalDays')}><Input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} data-testid="maint-days" className="w-28" /></Field>
          <Field label={t('maint.currentOdo')}><Input type="number" min={0} value={odoKm} onChange={(e) => setOdoKm(e.target.value)} placeholder="0" data-testid="maint-odo" className="w-28" /></Field>
          <Button type="submit" disabled={busy} data-testid="maint-create">{t('maint.create')}</Button>
          {error !== null && <p role="alert" className="w-full text-sm text-danger" data-testid="maint-error">{error}</p>}
        </form>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-muted">{label}{children}</label>
}
