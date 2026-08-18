import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useFmt } from '@/lib/datetime'
import type { Device } from '@/lib/devices'
import { updateDevice } from '@/lib/devices'
import type { Driver } from '@/lib/drivers'
import {
  createDocument,
  createServiceLog,
  deleteDocument,
  deleteServiceLog,
  docVariant,
  DOCUMENT_KINDS,
  listDeviceDocuments,
  listServiceLog,
  type DocumentKind,
} from '@/lib/fleet'

const FUEL_TYPES = ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'cng', 'other'] as const
const VEHICLE_STATUSES = ['active', 'in_service', 'reserve'] as const

/**
 * FLEET-1 F1 vehicle card — the sub-card the devices table opens (health/onboarding/commands
 * idiom): the VEHICLE behind the tracker in one place. Three sections: the editable profile
 * (make/model/VIN/fuel/status/purchase/driver), expiry-tracked documents (F3) and the
 * completed-service history (F2). Documents and log are per-device queries keyed by device id,
 * so switching vehicles never shows the previous one's rows.
 */
export function VehicleCardPanel({ device, drivers, canWrite }: { device: Device; drivers: Driver[]; canWrite: boolean }) {
  const { t } = useTranslation()
  return (
    <Card data-testid="vehicle-card">
      <CardHeader>
        <CardTitle className="text-base">{t('fleet.cardTitle', { name: device.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ProfileSection device={device} drivers={drivers} canWrite={canWrite} />
        <DocumentsSection deviceId={device.id} canWrite={canWrite} />
        <ServiceLogSection deviceId={device.id} canWrite={canWrite} />
      </CardContent>
    </Card>
  )
}

function ProfileSection({ device, drivers, canWrite }: { device: Device; drivers: Driver[]; canWrite: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [make, setMake] = useState(device.make ?? '')
  const [model, setModel] = useState(device.vehicleModel ?? '')
  const [year, setYear] = useState(device.year !== null ? String(device.year) : '')
  const [vin, setVin] = useState(device.vin ?? '')
  const [fuelType, setFuelType] = useState(device.fuelType ?? '')
  const [status, setStatus] = useState<string>(device.vehicleStatus)
  const [purchaseDate, setPurchaseDate] = useState(device.purchaseDate?.slice(0, 10) ?? '')
  const [priceEur, setPriceEur] = useState(device.purchasePriceCents !== null ? String(device.purchasePriceCents / 100) : '')
  const [driverId, setDriverId] = useState(device.driverId ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setState('busy')
    try {
      await updateDevice(device.id, {
        make: make.trim() === '' ? null : make.trim(),
        vehicleModel: model.trim() === '' ? null : model.trim(),
        year: year.trim() === '' ? null : Number(year),
        vin: vin.trim() === '' ? null : vin.trim(),
        fuelType: fuelType === '' ? null : fuelType,
        vehicleStatus: status as Device['vehicleStatus'],
        purchaseDate: purchaseDate === '' ? null : purchaseDate,
        purchasePriceCents: priceEur.trim() === '' ? null : Math.round(Number(priceEur) * 100),
        driverId: driverId === '' ? null : driverId,
      })
      await qc.invalidateQueries({ queryKey: ['devices'] })
      setState('saved')
    } catch {
      setState('error')
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" data-testid="vehicle-profile-form">
      <SectionLabel>{t('fleet.profile')}</SectionLabel>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label={t('fleet.make')}><AdminInput value={make} onChange={(e) => setMake(e.target.value)} maxLength={64} disabled={!canWrite} data-testid="veh-make" /></Field>
        <Field label={t('fleet.model')}><AdminInput value={model} onChange={(e) => setModel(e.target.value)} maxLength={64} disabled={!canWrite} data-testid="veh-model" /></Field>
        <Field label={t('fleet.year')}><AdminInput type="number" min={1950} max={2100} value={year} onChange={(e) => setYear(e.target.value)} disabled={!canWrite} data-testid="veh-year" /></Field>
        <Field label={t('fleet.vin')}><AdminInput value={vin} onChange={(e) => setVin(e.target.value)} maxLength={17} disabled={!canWrite} data-testid="veh-vin" /></Field>
        <Field label={t('fleet.fuel')}>
          <Combobox value={fuelType} onChange={setFuelType} disabled={!canWrite} aria-label={t('fleet.fuel')} data-testid="veh-fuel"
            options={FUEL_TYPES.map((f) => ({ value: f, label: t(`fleet.fuelType.${f}`) }))} />
        </Field>
        <Field label={t('fleet.status')}>
          <Combobox value={status} onChange={setStatus} disabled={!canWrite} aria-label={t('fleet.status')} data-testid="veh-status"
            options={VEHICLE_STATUSES.map((v) => ({ value: v, label: t(`fleet.vstatus.${v}`) }))} />
        </Field>
        <Field label={t('fleet.purchaseDate')}><AdminInput type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} disabled={!canWrite} data-testid="veh-pdate" /></Field>
        <Field label={t('fleet.purchasePrice')}><AdminInput type="number" min={0} step="0.01" value={priceEur} onChange={(e) => setPriceEur(e.target.value)} disabled={!canWrite} data-testid="veh-price" /></Field>
      </div>
      <Field label={t('fleet.assignedDriver')}>
        <Combobox value={driverId} onChange={setDriverId} disabled={!canWrite} aria-label={t('fleet.assignedDriver')} data-testid="veh-driver"
          options={[{ value: '', label: t('fleet.noDriver') }, ...drivers.map((d) => ({ value: d.id, label: d.name }))]} />
      </Field>
      {canWrite && (
        <div className="flex items-center gap-3">
          <AdminButton type="submit" disabled={state === 'busy'} data-testid="veh-save">{t('admin.save')}</AdminButton>
          {state === 'saved' && <span className="text-xs" style={{ color: 'var(--admin-success)' }}>{t('fleet.saved')}</span>}
          {state === 'error' && <span role="alert" className="text-xs" style={{ color: 'var(--admin-danger)' }}>{t('fleet.saveError')}</span>}
        </div>
      )}
    </form>
  )
}

function DocumentsSection({ deviceId, canWrite }: { deviceId: string; canWrite: boolean }) {
  const { t } = useTranslation()
  const { d } = useFmt()
  const qc = useQueryClient()
  const docs = useQuery({ queryKey: ['documents', deviceId], queryFn: () => listDeviceDocuments(deviceId) })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['documents'] })
  const [kind, setKind] = useState<DocumentKind>('insurance')
  const [title, setTitle] = useState('')
  const [number, setNumber] = useState('')
  const [validTo, setValidTo] = useState('')
  const [error, setError] = useState(false)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (title.trim() === '' || validTo === '') return
    setError(false)
    try {
      await createDocument(deviceId, { kind, title: title.trim(), number: number.trim() === '' ? null : number.trim(), validTo })
      setTitle(''); setNumber(''); setValidTo('')
      refresh()
    } catch { setError(true) }
  }

  return (
    <div className="space-y-2" data-testid="vehicle-documents">
      <SectionLabel>{t('fleet.documents')}</SectionLabel>
      {(docs.data ?? []).length === 0 && !docs.isLoading && (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('fleet.noDocuments')}</p>
      )}
      <div className="space-y-1">
        {(docs.data ?? []).map((doc) => (
          <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--admin-hairline)' }} data-testid={`doc-${doc.id}`}>
            <span className="font-medium">{t(`fleet.docKind.${doc.kind}`)}</span>
            <span style={{ color: 'var(--admin-ink-soft)' }}>{doc.title}{doc.number !== null ? ` · ${doc.number}` : ''}</span>
            <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{t('fleet.validTo', { date: d(doc.validTo) })}</span>
            <Badge variant={docVariant(doc.due.status)}>
              {doc.due.status === 'overdue' ? t('fleet.docOverdue', { n: -doc.due.daysRemaining }) : t('fleet.docDays', { n: doc.due.daysRemaining })}
            </Badge>
            {canWrite && (
              <button type="button" aria-label={t('admin.delete')} data-testid={`doc-del-${doc.id}`}
                onClick={() => { void deleteDocument(doc.id).then(refresh).catch(() => setError(true)) }}
                className="grid h-6 w-6 place-items-center rounded transition-colors hover:bg-[var(--admin-surface-sunken)]">
                <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--admin-danger)' }} aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        <form onSubmit={(e) => void add(e)} className="grid grid-cols-2 items-end gap-2 md:grid-cols-5" data-testid="doc-form">
          <Field label={t('fleet.docKindLabel')}>
            <Combobox value={kind} onChange={(v) => setKind(v as DocumentKind)} aria-label={t('fleet.docKindLabel')} data-testid="doc-kind"
              options={DOCUMENT_KINDS.map((k) => ({ value: k, label: t(`fleet.docKind.${k}`) }))} />
          </Field>
          <Field label={t('fleet.docTitle')}><AdminInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} data-testid="doc-title" /></Field>
          <Field label={t('fleet.docNumber')}><AdminInput value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} data-testid="doc-number" /></Field>
          <Field label={t('fleet.docValidTo')}><AdminInput type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} required data-testid="doc-validto" /></Field>
          <AdminButton type="submit" variant="secondary" data-testid="doc-add">{t('fleet.addDocument')}</AdminButton>
        </form>
      )}
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--admin-danger)' }}>{t('fleet.saveError')}</p>}
    </div>
  )
}

function ServiceLogSection({ deviceId, canWrite }: { deviceId: string; canWrite: boolean }) {
  const { t } = useTranslation()
  const { d } = useFmt()
  const qc = useQueryClient()
  const log = useQuery({ queryKey: ['service-log', deviceId], queryFn: () => listServiceLog(deviceId) })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['service-log', deviceId] })
  const [title, setTitle] = useState('')
  const [costEur, setCostEur] = useState('')
  const [vendor, setVendor] = useState('')
  const [error, setError] = useState(false)

  const totalCents = (log.data ?? []).reduce((sum, e) => sum + (e.costCents ?? 0), 0)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (title.trim() === '') return
    setError(false)
    try {
      await createServiceLog(deviceId, {
        title: title.trim(),
        costCents: costEur.trim() === '' ? null : Math.round(Number(costEur) * 100),
        vendor: vendor.trim() === '' ? null : vendor.trim(),
      })
      setTitle(''); setCostEur(''); setVendor('')
      refresh()
    } catch { setError(true) }
  }

  return (
    <div className="space-y-2" data-testid="vehicle-service-log">
      <div className="flex items-baseline justify-between">
        <SectionLabel>{t('fleet.serviceLog')}</SectionLabel>
        {totalCents > 0 && (
          <span className="text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>
            {t('fleet.totalCost', { eur: (totalCents / 100).toFixed(2) })}
          </span>
        )}
      </div>
      {(log.data ?? []).length === 0 && !log.isLoading && (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('fleet.noServiceLog')}</p>
      )}
      <div className="space-y-1">
        {(log.data ?? []).map((entry) => (
          <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--admin-hairline)' }} data-testid={`slog-${entry.id}`}>
            <span className="text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{d(entry.at)}</span>
            <span className="font-medium">{entry.title}</span>
            {entry.odoKm !== null && <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('fleet.atKm', { n: entry.odoKm })}</span>}
            {entry.engineH !== null && <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('fleet.atH', { n: entry.engineH })}</span>}
            {entry.vendor !== null && <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{entry.vendor}</span>}
            <span className="ml-auto text-xs tabular-nums">{entry.costCents !== null ? `${(entry.costCents / 100).toFixed(2)} €` : '—'}</span>
            {canWrite && (
              <button type="button" aria-label={t('admin.delete')} data-testid={`slog-del-${entry.id}`}
                onClick={() => { void deleteServiceLog(entry.id).then(refresh).catch(() => setError(true)) }}
                className="grid h-6 w-6 place-items-center rounded transition-colors hover:bg-[var(--admin-surface-sunken)]">
                <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--admin-danger)' }} aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        <form onSubmit={(e) => void add(e)} className="grid grid-cols-2 items-end gap-2 md:grid-cols-4" data-testid="slog-form">
          <Field label={t('fleet.slogTitle')}><AdminInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} data-testid="slog-title" /></Field>
          <Field label={t('fleet.slogCost')}><AdminInput type="number" min={0} step="0.01" value={costEur} onChange={(e) => setCostEur(e.target.value)} data-testid="slog-cost" /></Field>
          <Field label={t('fleet.slogVendor')}><AdminInput value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={160} data-testid="slog-vendor" /></Field>
          <AdminButton type="submit" variant="secondary" data-testid="slog-add">{t('fleet.addEntry')}</AdminButton>
        </form>
      )}
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--admin-danger)' }}>{t('fleet.saveError')}</p>}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>{children}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}
