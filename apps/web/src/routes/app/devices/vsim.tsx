import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, RotateCcw, Square } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { getVsim, restartVsim, startVsim, stopVsim, type Device } from '@/lib/devices'

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

export function VsimCard({ device }: { device: Device }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [fromKey, setFromKey] = useState('vilnius')
  const [toKey, setToKey] = useState('kaunas')
  const [speed, setSpeed] = useState(90)
  const [loop, setLoop] = useState(false)
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
      startVsim(device.id, { from: from.at, to: to.at, speedKmh: speed, loop, label: `${from.name} – ${to.name}` }),
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
