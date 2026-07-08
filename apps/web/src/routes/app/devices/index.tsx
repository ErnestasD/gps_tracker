import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getCurrentUser } from '@/lib/auth'
import { ApiError } from '@/lib/http'
import { QuarantineSection } from '@/routes/app/devices/quarantine'
import {
  createDevice,
  importApply,
  importPreview,
  listAccounts,
  listDevices,
  listProfiles,
  retireDevice,
  type DryRunResult,
} from '@/lib/devices'

/** Devices page (E03-3): list + create + retire + CSV import wizard (dry-run → apply).
 * Full shared DataTable (§3) is deferred; this is a functional table on tokens. */
export function DevicesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })
  const [retireError, setRetireError] = useState<string | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['devices'] })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('devices.title')}</h1>
      </div>
      {retireError !== null && (
        <p role="alert" className="text-sm text-danger" data-testid="retire-error">
          {t('devices.retireError', { imei: retireError })}
        </p>
      )}

      {getCurrentUser()?.role === 'platform_admin' && <QuarantineSection />}

      <CreateDeviceForm
        accounts={accounts.data ?? []}
        profiles={profiles.data ?? []}
        onCreated={refresh}
      />

      <ImportCard onImported={refresh} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('devices.list')}</CardTitle>
        </CardHeader>
        <CardContent>
          {devices.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : devices.isError ? (
            <p className="text-sm text-danger">{t('devices.loadError')}</p>
          ) : (devices.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t('devices.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="devices-table">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-4 font-medium">{t('devices.name')}</th>
                    <th className="py-2 pr-4 font-medium">{t('devices.imei')}</th>
                    <th className="py-2 pr-4 font-medium">{t('devices.status')}</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {(devices.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-line/50" data-testid={`device-${d.imei}`}>
                      <td className="py-2 pr-4">{d.name}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{d.imei}</td>
                      <td className="py-2 pr-4">
                        {d.retiredAt !== null ? (
                          <Badge variant="outline">{t('devices.retired')}</Badge>
                        ) : (
                          <Badge variant="success">{t('devices.active')}</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {d.retiredAt === null && (
                          <Button
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
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const acc = accountId || accounts[0]?.id || ''
  const prof = profileId || profiles[0]?.id || ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    createDevice({ accountId: acc, profileId: prof, imei, name })
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('devices.add')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('devices.imei')}
            <Input value={imei} onChange={(e) => setImei(e.target.value)} required pattern="\d{15}" placeholder="15 digits" data-testid="device-imei" className="w-48" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('devices.name')}
            <Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="device-name" className="w-48" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('devices.account')}
            <select value={acc} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text" data-testid="device-account">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('devices.profile')}
            <select value={prof} onChange={(e) => setProfileId(e.target.value)} className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text" data-testid="device-profile">
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={busy || imei === '' || name === '' || acc === '' || prof === ''} data-testid="device-create">
            {t('devices.create')}
          </Button>
          {error !== null && <p role="alert" data-testid="device-error" className="w-full text-sm text-danger">{error}</p>}
        </form>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('devices.import.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">{t('devices.import.hint')}</p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={4}
          placeholder="imei,name,profileKey,accountId"
          data-testid="import-csv"
          className="w-full rounded-card border border-line bg-surface p-2 font-mono text-xs text-text"
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy || csv === ''} onClick={runPreview} data-testid="import-preview">
            {t('devices.import.preview')}
          </Button>
          {preview !== null && (
            <Button size="sm" disabled={busy || preview.create.length === 0} onClick={apply} data-testid="import-apply">
              {t('devices.import.apply', { n: preview.create.length })}
            </Button>
          )}
          {applied !== null && <span className="text-sm text-success" data-testid="import-done">{t('devices.import.done', { n: applied })}</span>}
        </div>
        {preview !== null && (
          <div className="text-xs" data-testid="import-summary">
            <div className="flex gap-4">
              <span className="text-success">{t('devices.import.create', { n: preview.create.length })}</span>
              <span className="text-warn">{t('devices.import.update', { n: preview.update.length })}</span>
              <span className="text-danger">{t('devices.import.errors', { n: preview.errors.length })}</span>
            </div>
            {preview.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                {preview.errors.slice(0, 50).map((e, i) => (
                  <li key={i} className="text-danger">
                    {t('devices.import.rowError', { row: e.row, imei: e.imei, reason: e.reason })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
