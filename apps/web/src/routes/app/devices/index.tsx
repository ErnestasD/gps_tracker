import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge, PageHeader } from '@/components/admin/AdminKit'
import { Skeleton } from '@/components/ui/skeleton'
import { getCurrentUser } from '@/lib/auth'
import { ApiError } from '@/lib/http'
import { eraseDevice } from '@/lib/gdpr'
import { CommandsCard } from '@/routes/app/devices/commands'
import { HealthCard } from '@/routes/app/devices/health'
import { CanCard } from '@/routes/app/devices/can'
import { ShareCard } from '@/routes/app/devices/share'
import { OnboardingCard } from '@/routes/app/devices/onboarding'
import { QuarantineSection } from '@/routes/app/devices/quarantine'
import {
  ODOMETER_SOURCES,
  createDevice,
  importApply,
  importPreview,
  listAccounts,
  listDevices,
  listProfiles,
  retireDevice,
  updateDevice,
  type Device,
  type DryRunResult,
  type OdometerSource,
} from '@/lib/devices'

const selectStyle: React.CSSProperties = {
  borderColor: 'var(--admin-hairline)',
  background: 'var(--admin-surface)',
  color: 'var(--admin-ink)',
}

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

/** Devices page (E03-3): list + create + retire + CSV import wizard (dry-run → apply).
 * Re-skinned onto the admin design (ADR-028): PageHeader + admin-card sections; the table keeps
 * its own markup (per-row actions + sub-card toggling) restyled to the admin idiom. */
export function DevicesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })
  const [retireError, setRetireError] = useState<string | null>(null)
  const [commandsForId, setCommandsForId] = useState<string | null>(null)
  const [healthForId, setHealthForId] = useState<string | null>(null)
  const [shareForId, setShareForId] = useState<string | null>(null)
  const [onboardForId, setOnboardForId] = useState<string | null>(null)
  // GDPR erase (E08-4): two-step confirm per device id, auto-disarmed after 6 s so an
  // armed irreversible button never lingers (review LOW)
  const [eraseArmedId, setEraseArmedId] = useState<string | null>(null)
  const [eraseQueued, setEraseQueued] = useState(false)
  const [eraseError, setEraseError] = useState(false)
  useEffect(() => {
    if (eraseArmedId === null) return
    const t = setTimeout(() => setEraseArmedId(null), 6000)
    return () => clearTimeout(t)
  }, [eraseArmedId])
  const refresh = () => void qc.invalidateQueries({ queryKey: ['devices'] })
  const isAdmin = ['platform_admin', 'tsp_admin'].includes(getCurrentUser()?.role ?? '')
  // derive the panel's device from the LIVE list (never a snapshot): a retire or refetch
  // closes/updates the panel instead of leaving a stale device you can still command
  const commandsFor: Device | null = (devices.data ?? []).find((d) => d.id === commandsForId && d.retiredAt === null) ?? null
  const healthFor: Device | null = (devices.data ?? []).find((d) => d.id === healthForId && d.retiredAt === null) ?? null
  const shareFor: Device | null = (devices.data ?? []).find((d) => d.id === shareForId && d.retiredAt === null) ?? null
  const onboardFor: Device | null = (devices.data ?? []).find((d) => d.id === onboardForId && d.retiredAt === null) ?? null

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('devices.title')} description={t('devices.desc')} />
      {retireError !== null && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="retire-error">
          {t('devices.retireError', { imei: retireError })}
        </p>
      )}
      {eraseQueued && (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="erase-queued">
          {t('devices.eraseQueued')}
        </p>
      )}
      {eraseError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="erase-error">
          {t('devices.eraseError')}
        </p>
      )}

      {getCurrentUser()?.role === 'platform_admin' && <QuarantineSection />}

      <CreateDeviceForm
        accounts={accounts.data ?? []}
        profiles={profiles.data ?? []}
        onCreated={refresh}
      />

      <ImportCard onImported={refresh} />

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('devices.list')}
        </div>
        {devices.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : devices.isError ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>{t('devices.loadError')}</p>
        ) : (devices.data ?? []).length === 0 ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('devices.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="devices-table">
              <thead>
                <tr style={{ background: 'var(--admin-surface-sunken)' }}>
                  <th className={th} style={thStyle}>{t('devices.name')}</th>
                  <th className={th} style={thStyle}>{t('devices.imei')}</th>
                  <th className={th} style={thStyle}>{t('devices.odometer')}</th>
                  <th className={th} style={thStyle}>{t('devices.status')}</th>
                  <th className={th} style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {(devices.data ?? []).map((d) => (
                  <tr
                    key={d.id}
                    className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]"
                    data-testid={`device-${d.imei}`}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--admin-ink)' }}>{d.name}</td>
                    <td className="mono px-4 py-2.5 text-xs" style={{ color: 'var(--admin-ink)' }}>{d.imei}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={d.odometerSource}
                        disabled={d.retiredAt !== null}
                        data-testid={`odometer-${d.imei}`}
                        onChange={(e) => void updateDevice(d.id, { odometerSource: e.target.value as OdometerSource }).then(refresh).catch(() => undefined)}
                        className="h-7 rounded-md border px-1 text-xs disabled:opacity-50"
                        style={selectStyle}
                      >
                        {ODOMETER_SOURCES.map((s) => (
                          <option key={s} value={s}>{t(`devices.odo.${s}`)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      {d.retiredAt !== null ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge tone="neutral">{t('devices.retired')}</Badge>
                          {isAdmin && (
                            <AdminButton
                              variant="ghost"
                              size="sm"
                              style={{ color: 'var(--admin-danger)' }}
                              data-testid={`erase-${d.imei}`}
                              onClick={() => {
                                if (eraseArmedId !== d.id) {
                                  setEraseArmedId(d.id) // first click arms — GDPR erase is irreversible
                                  return
                                }
                                setEraseArmedId(null)
                                void eraseDevice(d.id)
                                  .then(() => setEraseQueued(true))
                                  .catch(() => setEraseError(true))
                              }}
                            >
                              {eraseArmedId === d.id ? t('devices.eraseConfirm') : t('devices.erase')}
                            </AdminButton>
                          )}
                        </span>
                      ) : (
                        <Badge tone="success">{t('devices.active')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {d.retiredAt === null && (
                        <>
                          <AdminButton
                            variant="ghost"
                            size="sm"
                            data-testid={`health-${d.imei}`}
                            onClick={() => setHealthForId((cur) => (cur === d.id ? null : d.id))}
                          >
                            {t('devices.healthBtn')}
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="sm"
                            data-testid={`onboarding-${d.imei}`}
                            onClick={() => setOnboardForId((cur) => (cur === d.id ? null : d.id))}
                          >
                            {t('devices.onboard')}
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="sm"
                            data-testid={`commands-${d.imei}`}
                            onClick={() => setCommandsForId((cur) => (cur === d.id ? null : d.id))}
                          >
                            {t('devices.commands')}
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="sm"
                            data-testid={`share-${d.imei}`}
                            onClick={() => setShareForId((cur) => (cur === d.id ? null : d.id))}
                          >
                            {t('devices.share.button')}
                          </AdminButton>
                          <AdminButton
                            variant="ghost"
                            size="sm"
                            data-testid={`retire-${d.imei}`}
                            onClick={() => {
                              void retireDevice(d.id)
                                .then(refresh)
                                .catch(() => setRetireError(d.imei))
                            }}
                          >
                            {t('devices.retire')}
                          </AdminButton>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* key remounts the panel per device — armed/text state must NEVER survive a device
          switch (a confirm armed for device A must not send with one click on device B) */}
      {healthFor !== null && <HealthCard key={healthFor.id} device={healthFor} />}
      {healthFor !== null && <CanCard key={`can-${healthFor.id}`} device={healthFor} />}
      {onboardFor !== null && <OnboardingCard key={onboardFor.id} device={onboardFor} />}
      {commandsFor !== null && <CommandsCard key={commandsFor.id} device={commandsFor} />}
      {shareFor !== null && <ShareCard key={shareFor.id} device={shareFor} />}
    </div>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}

function CreateDeviceForm({
  accounts,
  profiles,
  onCreated,
}: {
  accounts: { id: string; name: string }[]
  profiles: { id: string; key: string; name: string }[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [imei, setImei] = useState('')
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [odometerSource, setOdometerSource] = useState<OdometerSource>('auto')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const acc = accountId || accounts[0]?.id || ''
  const prof = profileId || profiles[0]?.id || ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    createDevice({ accountId: acc, profileId: prof, imei, name, odometerSource })
      .then(() => {
        setImei('')
        setName('')
        onCreated()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 409 ? t('devices.dupImei') : t('devices.createError'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="admin-card">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {t('devices.add')}
      </div>
      <div className="p-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <FieldLabel label={t('devices.imei')}>
            <AdminInput value={imei} onChange={(e) => setImei(e.target.value)} required pattern="\d{15}" placeholder="15 digits" data-testid="device-imei" className="w-48" />
          </FieldLabel>
          <FieldLabel label={t('devices.name')}>
            <AdminInput value={name} onChange={(e) => setName(e.target.value)} required data-testid="device-name" className="w-48" />
          </FieldLabel>
          <FieldLabel label={t('devices.account')}>
            <select value={acc} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-md border px-2 text-sm" style={selectStyle} data-testid="device-account">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label={t('devices.profile')}>
            <select value={prof} onChange={(e) => setProfileId(e.target.value)} className="h-9 rounded-md border px-2 text-sm" style={selectStyle} data-testid="device-profile">
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label={t('devices.odometer')}>
            <select value={odometerSource} onChange={(e) => setOdometerSource(e.target.value as OdometerSource)} className="h-9 rounded-md border px-2 text-sm" style={selectStyle} data-testid="device-odometer">
              {ODOMETER_SOURCES.map((s) => (
                <option key={s} value={s}>{t(`devices.odo.${s}`)}</option>
              ))}
            </select>
          </FieldLabel>
          <AdminButton type="submit" disabled={busy || imei === '' || name === '' || acc === '' || prof === ''} data-testid="device-create">
            {t('devices.create')}
          </AdminButton>
          {error !== null && (
            <p role="alert" data-testid="device-error" className="w-full text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</p>
          )}
        </form>
      </div>
    </div>
  )
}

function ImportCard({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation()
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<DryRunResult | null>(null)
  const [applied, setApplied] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const runPreview = () => {
    setBusy(true)
    setApplied(null)
    importPreview(csv)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setBusy(false))
  }
  const apply = () => {
    setBusy(true)
    importApply(csv)
      .then((r) => {
        setApplied(r.created)
        setPreview(null)
        setCsv('')
        onImported()
      })
      .catch(() => setApplied(null))
      .finally(() => setBusy(false))
  }

  return (
    <div className="admin-card">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {t('devices.import.title')}
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('devices.import.hint')}</p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={4}
          placeholder="imei,name,profileKey,accountId"
          data-testid="import-csv"
          className="mono w-full rounded-md border p-2 text-xs outline-none focus:ring-2 focus:ring-[var(--admin-brand)]/30"
          style={selectStyle}
        />
        <div className="flex items-center gap-2">
          <AdminButton variant="secondary" size="sm" disabled={busy || csv === ''} onClick={runPreview} data-testid="import-preview">
            {t('devices.import.preview')}
          </AdminButton>
          {preview !== null && (
            <AdminButton size="sm" disabled={busy || preview.create.length === 0} onClick={apply} data-testid="import-apply">
              {t('devices.import.apply', { n: preview.create.length })}
            </AdminButton>
          )}
          {applied !== null && (
            <span className="text-sm" style={{ color: 'var(--admin-success)' }} data-testid="import-done">{t('devices.import.done', { n: applied })}</span>
          )}
        </div>
        {preview !== null && (
          <div className="text-xs" data-testid="import-summary">
            <div className="flex gap-4">
              <span style={{ color: 'var(--admin-success)' }}>{t('devices.import.create', { n: preview.create.length })}</span>
              <span style={{ color: 'var(--admin-warning)' }}>{t('devices.import.update', { n: preview.update.length })}</span>
              <span style={{ color: 'var(--admin-danger)' }}>{t('devices.import.errors', { n: preview.errors.length })}</span>
            </div>
            {preview.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                {preview.errors.slice(0, 50).map((e, i) => (
                  <li key={i} style={{ color: 'var(--admin-danger)' }}>
                    {t('devices.import.rowError', { row: e.row, imei: e.imei, reason: e.reason })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
