import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, RotateCcw, Square } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { createDevice, generateVirtualImei, getVsim, restartVsim, startVsim, stopVsim, type Device, type Profile } from '@/lib/devices'

/**
 * What CAN data can this MODEL give? Mirrors the compatibility page's taxonomy: the 140/150/250
 * families carry an integrated CAN processor (CAN on by default), the 1YX/640 families take an
 * LV-CAN200/ALL-CAN300 adapter (CAN offered, off by default — the adapter is optional hardware),
 * everything else has no CAN path at all (the option is not shown, "pagal įrenginio galimybę").
 */
export type CanCapability = 'integrated' | 'adapter' | 'none'
export function canCapability(profileKey: string | undefined): CanCapability {
  const k = (profileKey ?? '').toLowerCase()
  if (/^(fmb140|fmb150|fmc150|fmm150|fmc250|fmm250)/.test(k)) return 'integrated'
  if (/^(fmb1\d\d|fmc1\d\d|fmm1\d\d|fmu1\d\d|fmb640|fmc640|fmm640)/.test(k)) return 'adapter'
  return 'none'
}

/**
 * Virtual-device drive control (founder ask): pick a route (city presets → OSRM road
 * geometry), a speed and loop mode; start/stop/restart; watch the progress. The device
 * itself is watched everywhere else exactly like hardware — live map, trips, geofences,
 * rules — because the worker transmits its fixes through the real ingest TCP door.
 */

/** [lon, lat] — the OSRM coordinate order. City centres are plenty: OSRM snaps to roads. */
const CITIES: { key: string; name: string; at: [number, number] }[] = [
  { key: 'vilnius', name: 'Vilnius', at: [25.2797, 54.6872] },
  { key: 'kaunas', name: 'Kaunas', at: [23.9036, 54.8985] },
  { key: 'klaipeda', name: 'Klaipėda', at: [21.1443, 55.7033] },
  { key: 'siauliai', name: 'Šiauliai', at: [23.3168, 55.9349] },
  { key: 'panevezys', name: 'Panevėžys', at: [24.3609, 55.7348] },
  { key: 'alytus', name: 'Alytus', at: [24.0414, 54.3963] },
  { key: 'marijampole', name: 'Marijampolė', at: [23.354, 54.5599] },
  { key: 'utena', name: 'Utena', at: [25.6045, 55.4993] },
]

/**
 * "Real" add flow (founder): a virtual device is created like hardware — name, account and the
 * MODEL are chosen in a form; only the IMEI is assigned automatically from the reserved 9990*
 * range (it is the virtual identity, not a choice). The picked model drives the CAN default.
 */
export function VirtualDeviceForm({
  accounts,
  profiles,
  suggestedName,
  onCreated,
}: {
  accounts: { id: string; name: string }[]
  profiles: Profile[]
  suggestedName: string
  onCreated: (device: Device) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(suggestedName)
  const [accountId, setAccountId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const acc = accountId || accounts[0]?.id || ''
  const fallback = profiles.find((p) => p.key === 'fmb120')?.id ?? profiles[0]?.id ?? ''
  const prof = profileId || fallback
  const cap = canCapability(profiles.find((p) => p.id === prof)?.key)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(false)
    createDevice({ accountId: acc, profileId: prof, imei: generateVirtualImei(), name: name.trim(), plate: null })
      .then(onCreated)
      .catch(() => setError(true))
      .finally(() => setBusy(false))
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <div>
        <AdminLabel>{t('devices.name')}</AdminLabel>
        <AdminInput value={name} onChange={(e) => setName(e.target.value)} required data-testid="vdev-name" />
      </div>
      <div>
        <AdminLabel>{t('devices.account')}</AdminLabel>
        <Combobox value={acc} onChange={setAccountId} aria-label={t('devices.account')} data-testid="vdev-account"
          options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
      </div>
      <div>
        <AdminLabel>{t('devices.model')}</AdminLabel>
        <Combobox value={prof} onChange={setProfileId} aria-label={t('devices.model')} data-testid="vdev-profile"
          options={profiles.map((pr) => ({ value: pr.id, label: pr.name }))} />
        <p className="mt-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid="vdev-can-note">
          {t(`devices.vsim.cap.${cap}`)}
        </p>
      </div>
      <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('devices.vsim.imeiNote')}</p>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="vdev-error">
          {t('devices.createError')}
        </p>
      )}
      <AdminButton type="submit" disabled={busy || name.trim() === '' || acc === '' || prof === ''} data-testid="vdev-create">
        {t('devices.vsim.addButton')}
      </AdminButton>
    </form>
  )
}

export function VsimCard({ device, canCap }: { device: Device; canCap: CanCapability }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [fromKey, setFromKey] = useState('vilnius')
  const [toKey, setToKey] = useState('kaunas')
  const [speed, setSpeed] = useState(90)
  const [loop, setLoop] = useState(false)
  // "pagal įrenginio galimybę": integrated CAN ships data by default, adapter models offer the
  // choice off-by-default, CAN-less models never send it (the checkbox is not rendered)
  const [can, setCan] = useState(canCap === 'integrated')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const sim = useQuery({
    queryKey: ['vsim', device.id],
    queryFn: () => getVsim(device.id),
    // 5 s matches the worker's transmit tick — the progress bar moves as the vehicle does
    refetchInterval: 5_000,
  })
  const st = sim.data

  const refresh = () => void qc.invalidateQueries({ queryKey: ['vsim', device.id] })
  const run = (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(false)
    action()
      .then(refresh)
      .catch(() => setError(true))
      .finally(() => setBusy(false))
  }

  const start = () => {
    const from = CITIES.find((c) => c.key === fromKey)!
    const to = CITIES.find((c) => c.key === toKey)!
    run(() =>
      startVsim(device.id, {
        from: from.at,
        to: to.at,
        speedKmh: speed,
        loop,
        can: canCap !== 'none' && can,
        label: `${from.name} – ${to.name}`,
      }),
    )
  }

  const running = st?.status === 'running'

  return (
    <div className="admin-card" data-testid="vsim-card">
      <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('devices.vsim.title')} — {device.name}
        </span>
        {st !== undefined && st.status !== 'none' && (
          <Badge tone={running ? 'success' : st.status === 'finished' ? 'brand' : 'neutral'} data-testid="vsim-status">
            {t(`devices.vsim.st.${st.status}`)}
            {st.label !== '' ? ` · ${st.label}` : ''}
            {running || st.status === 'finished' ? ` · ${st.progressPct}%` : ''}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <div className="w-40">
          <AdminLabel>{t('devices.vsim.from')}</AdminLabel>
          <Combobox value={fromKey} onChange={setFromKey} aria-label={t('devices.vsim.from')} data-testid="vsim-from"
            options={CITIES.map((c) => ({ value: c.key, label: c.name }))} />
        </div>
        <div className="w-40">
          <AdminLabel>{t('devices.vsim.to')}</AdminLabel>
          <Combobox value={toKey} onChange={setToKey} aria-label={t('devices.vsim.to')} data-testid="vsim-to"
            options={CITIES.map((c) => ({ value: c.key, label: c.name }))} />
        </div>
        <div className="w-28">
          <AdminLabel>{t('devices.vsim.speed')}</AdminLabel>
          <AdminInput type="number" min={10} max={150} step={5} value={speed} data-testid="vsim-speed"
            onChange={(e) => setSpeed(Math.max(10, Math.min(150, Number(e.target.value) || 10)))} />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm" style={{ color: 'var(--admin-ink)' }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} data-testid="vsim-loop" />
          {t('devices.vsim.loop')}
        </label>
        {canCap !== 'none' && (
          <label className="flex h-9 items-center gap-2 text-sm" style={{ color: 'var(--admin-ink)' }}>
            <input type="checkbox" checked={can} onChange={(e) => setCan(e.target.checked)} data-testid="vsim-can" />
            {t('devices.vsim.can')}
          </label>
        )}
        <div className="flex gap-2">
          <AdminButton size="sm" disabled={busy || fromKey === toKey} onClick={start} data-testid="vsim-start">
            <Play className="h-3.5 w-3.5" aria-hidden />
            {t('devices.vsim.start')}
          </AdminButton>
          <AdminButton variant="secondary" size="sm" disabled={busy || st === undefined || st.status !== 'running'}
            onClick={() => run(() => stopVsim(device.id))} data-testid="vsim-stop">
            <Square className="h-3.5 w-3.5" aria-hidden />
            {t('devices.vsim.stop')}
          </AdminButton>
          <AdminButton variant="secondary" size="sm" disabled={busy || st === undefined || st.status === 'none'}
            onClick={() => run(() => restartVsim(device.id))} data-testid="vsim-restart">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('devices.vsim.restart')}
          </AdminButton>
        </div>
      </div>
      <div className="px-4 pb-4">
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('devices.vsim.hint')}</p>
        {fromKey === toKey && <p className="mt-1 text-xs" style={{ color: 'var(--admin-warning)' }}>{t('devices.vsim.samePlace')}</p>}
        {error && (
          <p role="alert" className="mt-1 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="vsim-error">
            {t('devices.vsim.error')}
          </p>
        )}
      </div>
    </div>
  )
}
