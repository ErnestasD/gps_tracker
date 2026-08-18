import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SettingKey } from '@orbetra/shared'

import { Badge } from '@/components/ui/badge'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useFmt } from '@/lib/datetime'
import {
  ASSUMED_DRIVING_HOURS,
  ASSUMED_SPEED_KMH,
  displayValue,
  estimateFor,
  getDeviceSettings,
  isInFlight,
  isRejected,
  refreshDeviceSettings,
  saveDeviceSettings,
  settingsView,
  type CurrentSetting,
} from '@/lib/deviceSettings'
import type { Device } from '@/lib/devices'

/**
 * Tracking-settings card — how often the device records and how often it reports.
 *
 * Three things this screen must never do, each of them a mistake already made once:
 *
 *  - show a number the device has not confirmed as though it were the device's state. Every value
 *    here is sourced from a `getparam` reply, or shown explicitly as a change still in flight.
 *  - say "saved". Nothing is saved: a change is queued until the tracker next connects, which on a
 *    parked vehicle took an hour. The badge says so.
 *  - hide the cost. Dragging towards "more live" spends the customer's mobile data, so the estimate
 *    sits under the sliders and moves with them.
 */
export function SettingsCard({ device, canWrite }: { device: Device; canWrite: boolean }) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['device-settings', device.id], queryFn: () => getDeviceSettings(device.id) })
  const [draft, setDraft] = useState<Partial<Record<SettingKey, number>>>({})
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = q.data?.available ?? []
  const current = q.data?.current ?? {}

  // positions and pending come from ONE function on purpose: they are similarly-shaped records, and
  // handing the save path the positions (which fall back to the factory value) is what once armed
  // an untouched card with six numbers nobody chose.
  const { positions, pending, dirty } = useMemo(
    () => settingsView(available, current, draft),
    [available, current, draft],
  )
  const estimate = estimateFor(positions)

  const save = () => {
    setSaving(true)
    setError(null)
    saveDeviceSettings(device.id, pending)
      // Refetch BEFORE clearing the draft. Clearing first left the sliders recomputing from the
      // stale `current` for the whole round trip, so the value just applied visibly snapped back to
      // the factory number and Save re-armed with it.
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ['device-settings', device.id] })
        setDraft({})
        void qc.invalidateQueries({ queryKey: ['commands', device.id] })
      })
      // ApiError's `message` is just "API 400"; the server's explanation is in `detail`, which is
      // what names the bound the customer exceeded.
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.detail !== undefined ? e.detail : t('devices.settings.saveError')),
      )
      .finally(() => setSaving(false))
  }

  const refresh = () => {
    setRefreshing(true)
    setError(null)
    refreshDeviceSettings(device.id)
      .then(() => qc.invalidateQueries({ queryKey: ['device-settings', device.id] }))
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.detail !== undefined ? e.detail : t('devices.settings.saveError')),
      )
      .finally(() => setRefreshing(false))
  }

  return (
    <Card data-testid="settings-card">
      <CardHeader>
        <CardTitle className="text-base">{t('devices.settings.title', { name: device.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.isLoading && <p className="text-sm text-muted" data-testid="settings-loading">{t('admin.loading')}</p>}
        {q.isError && <p className="text-sm text-danger" role="alert">{t('devices.settings.loadError')}</p>}

        {q.isSuccess && available.length === 0 && (
          // 12 catalogued models have no parameter page and the TAT family has no data-acquisition
          // block. Saying so is the honest answer; inventing bounds from a sibling model is not.
          <p className="text-sm text-muted" data-testid="settings-unsupported">
            {t('devices.settings.unsupported')}
          </p>
        )}

        {available.map((s) => {
          const c = current[s.key]
          const deviceValue = displayValue(c)
          const outOfRange = deviceValue !== null && (deviceValue < s.min || deviceValue > s.max)
          // keep the thumb inside the track; the real number is stated beside it when they differ
          const value = Math.min(s.max, Math.max(s.min, positions[s.key] ?? s.factory))
          return (
            <div key={s.key} className="space-y-1" data-testid={`setting-${s.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`set-${s.key}`} className="text-sm font-medium">
                  {t(`devices.settings.key.${s.key}`)}
                </label>
                <span className="text-sm tabular-nums">
                  {value} {t(`devices.settings.unit.${s.unit}`)}
                </span>
              </div>
              <input
                id={`set-${s.key}`}
                type="range"
                min={s.min}
                max={s.max}
                step={1}
                value={value}
                disabled={!canWrite || saving}
                onChange={(e) => setDraft((d) => ({ ...d, [s.key]: Number(e.currentTarget.value) }))}
                className="w-full accent-[var(--admin-brand)]"
                data-testid={`setting-input-${s.key}`}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>
                  {s.min}–{s.max} {t(`devices.settings.unit.${s.unit}`)}
                </span>
                {/* A device may legitimately hold a value outside what we offer — FMB640/FMC650/
                    FMM650 ship movingByTime at 3600 s against our 300 s ceiling. Saying so beats a
                    printed number and a slider thumb that silently disagree. */}
                {outOfRange && (
                  <span data-testid={`setting-outofrange-${s.key}`}>
                    {t('devices.settings.outOfRange', { value: deviceValue })}
                  </span>
                )}
                <SettingState c={c} dt={dt} t={t} />
              </div>
            </div>
          )
        })}

        {available.length > 0 && (
          <>
            {/* The cost, stated before the customer commits rather than after they read a bill. */}
            <div className="rounded-md border p-3 text-sm" data-testid="settings-estimate">
              <p>
                {t('devices.settings.estimate', {
                  // "0.0 MB" reads as "this device is free to run". Below a tenth of a megabyte the
                  // honest statement is a bound, not a rounded zero.
                  day: fmtMB(estimate.perDrivingDayMB),
                  month: fmtMB(estimate.perMonthMB),
                  hours: ASSUMED_DRIVING_HOURS,
                })}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t('devices.settings.estimateAssumes', { speed: ASSUMED_SPEED_KMH })}
              </p>
            </div>

            {/* Which network the values apply to. The roaming profile ships with a send period of 0
                on most models, so a vehicle abroad may transmit nothing whatever these say. */}
            <p className="text-xs text-muted" data-testid="settings-profile-note">
              {t('devices.settings.homeProfileOnly')}
            </p>

            {error !== null && <p className="text-sm text-danger" role="alert" data-testid="settings-error">{error}</p>}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={!canWrite || !dirty || saving} data-testid="settings-save">
                {saving ? t('devices.settings.queuing') : t('devices.settings.save')}
              </Button>
              {/* Reads are free and cannot misconfigure anything, so this stays available to every
                  role — including a viewer who just wants to know what the tracker actually holds. */}
              <Button variant="secondary" onClick={refresh} disabled={refreshing} data-testid="settings-refresh">
                {refreshing ? t('devices.settings.queuing') : t('devices.settings.reread')}
              </Button>
              {dirty && <span className="text-xs text-muted">{t('devices.settings.queuedNote')}</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Megabytes for a label: a rounded 0 would read as "free to run", so state a bound instead. */
const fmtMB = (mb: number): string => (mb > 0 && mb < 0.1 ? '< 0.1' : mb.toFixed(mb < 10 ? 1 : 0))

/** The per-setting badge: where a change has got to, in the customer's words. */
function SettingState({
  c,
  dt,
  t,
}: {
  c: CurrentSetting | undefined
  dt: (iso: string) => string
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  if (c === undefined) return null
  if (isRejected(c)) {
    // Delivered, acknowledged, and the device kept something else. This is the failure that spent a
    // day looking like bad GPS reception, so it gets the loudest badge on the screen.
    return (
      <Badge variant="danger" data-testid="setting-rejected">
        {t('devices.settings.state.rejected', { value: c.value ?? '—' })}
      </Badge>
    )
  }
  if (c.state === 'undelivered') {
    return <Badge variant="warn" data-testid="setting-undelivered">{t('devices.settings.state.undelivered')}</Badge>
  }
  if (isInFlight(c)) {
    // "sent" and "waiting" are different facts: one is in the queue, the other is already on the
    // device and only its confirmation is missing. Collapsing them deletes the distinction the API
    // computes and this feature exists to surface.
    return (
      <Badge variant="outline" data-testid="setting-pending">
        {t(c.state === 'sent' ? 'devices.settings.state.sent' : 'devices.settings.state.waiting')}
      </Badge>
    )
  }
  if (c.value !== null && c.checkedAt !== null) {
    return <span data-testid="setting-checked">{t('devices.settings.state.checked', { when: dt(c.checkedAt) })}</span>
  }
  // No reply has ever mentioned it. Say so rather than implying the factory number is the truth.
  return <span data-testid="setting-unknown">{t('devices.settings.state.unknown')}</span>
}
