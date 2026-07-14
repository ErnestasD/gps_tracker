import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getCurrentUser } from '@/lib/auth'
import { listAccounts } from '@/lib/devices'
import {
  createDriver,
  deleteDriver,
  isIbuttonConflict,
  listDriverScores,
  listDrivers,
  normalizeIbutton,
  scoreVariant,
  updateDriver,
  type Driver,
} from '@/lib/drivers'

/** Driver registry (V2): list + create/edit + deactivate. Account-scoped; the iButton key is the
 * physical tag a driver taps (resolved to trips in a follow-up). */
export function DriversPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const [editing, setEditing] = useState<Driver | null>(null)
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['drivers'] })

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">{t('drivers.title')}</h1>

      {canWrite && (
        <DriverForm
          key={editing?.id ?? 'new'}
          accounts={accounts.data ?? []}
          editing={editing}
          onDone={() => { setEditing(null); refresh() }}
          onCancel={() => setEditing(null)}
        />
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('drivers.list')}</CardTitle></CardHeader>
        <CardContent>
          {drivers.isLoading ? (
            <p className="text-sm text-muted">{t('drivers.loading')}</p>
          ) : drivers.isError ? (
            <p className="text-sm text-danger">{t('drivers.loadError')}</p>
          ) : (drivers.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t('drivers.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="drivers-table">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-4 font-medium">{t('drivers.name')}</th>
                    <th className="py-2 pr-4 font-medium">{t('drivers.license')}</th>
                    <th className="py-2 pr-4 font-medium">{t('drivers.ibutton')}</th>
                    <th className="py-2 pr-4 font-medium">{t('drivers.status')}</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {(drivers.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-line/50" data-testid={`driver-${d.id}`}>
                      <td className="py-2 pr-4">{d.name}</td>
                      <td className="py-2 pr-4 text-muted">{d.licenseNo ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{d.ibutton ?? '—'}</td>
                      <td className="py-2 pr-4">
                        {d.active ? <Badge variant="success">{t('drivers.active')}</Badge> : <Badge variant="outline">{t('drivers.inactive')}</Badge>}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {canWrite && (
                          <>
                            <Button variant="ghost" size="sm" data-testid={`driver-edit-${d.id}`} onClick={() => setEditing(d)}>{t('drivers.edit')}</Button>
                            <Button variant="ghost" size="sm" className="text-danger" data-testid={`driver-delete-${d.id}`} onClick={() => void deleteDriver(d.id).then(refresh).catch(() => undefined)}>{t('drivers.delete')}</Button>
                          </>
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

      <DriverScores />
    </div>
  )
}

/** Safety scores over the last 30 days (V2) — from assigned trips + overspeed events. */
function DriverScores() {
  const { t } = useTranslation()
  const scores = useQuery({ queryKey: ['driver-scores'], queryFn: listDriverScores })
  const rows = (scores.data ?? []).filter((s) => s.trips > 0) // only drivers with driving in the window
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('drivers.scores.title')}</CardTitle></CardHeader>
      <CardContent>
        {scores.isLoading ? (
          <p className="text-sm text-muted">{t('drivers.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{t('drivers.scores.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="driver-scores-table">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">{t('drivers.name')}</th>
                  <th className="py-2 pr-4 font-medium">{t('drivers.scores.trips')}</th>
                  <th className="py-2 pr-4 font-medium">{t('drivers.scores.distance')}</th>
                  <th className="py-2 pr-4 font-medium">{t('drivers.scores.overspeed')}</th>
                  <th className="py-2 pr-4 font-medium">{t('drivers.scores.score')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.driverId} className="border-b border-line/50" data-testid={`driver-score-${s.driverId}`}>
                    <td className="py-2 pr-4">{s.driverName}</td>
                    <td className="py-2 pr-4 tabular-nums text-muted">{s.trips}</td>
                    <td className="py-2 pr-4 tabular-nums text-muted">{s.distanceKm} km</td>
                    <td className="py-2 pr-4 tabular-nums text-muted">{s.overspeedEvents}</td>
                    <td className="py-2 pr-4"><Badge variant={scoreVariant(s.score)}>{s.score ?? '—'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DriverForm({ accounts, editing, onDone, onCancel }: {
  accounts: { id: string; name: string }[]
  editing: Driver | null
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(editing?.name ?? '')
  const [licenseNo, setLicenseNo] = useState(editing?.licenseNo ?? '')
  const [ibutton, setIbutton] = useState(editing?.ibutton ?? '')
  const [phone, setPhone] = useState(editing?.phone ?? '')
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (name.trim() === '') { setError(t('drivers.nameRequired')); return }
    const ib = normalizeIbutton(ibutton)
    if (ib === false) { setError(t('drivers.ibuttonInvalid')); return }
    setBusy(true)
    try {
      const payload = { name: name.trim(), licenseNo: licenseNo.trim() || null, ibutton: ib, phone: phone.trim() || null }
      if (editing) await updateDriver(editing.id, payload)
      else await createDriver({ ...payload, ...(accounts.length > 1 ? { accountId } : {}) })
      onDone()
    } catch (err) {
      setError(isIbuttonConflict(err) ? t('drivers.ibuttonTaken') : t('drivers.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{editing ? t('drivers.editTitle') : t('drivers.addTitle')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2" data-testid="driver-form">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">{t('drivers.name')}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="driver-name" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">{t('drivers.license')}</span>
            <Input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} maxLength={60} data-testid="driver-license" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">{t('drivers.ibutton')}</span>
            <Input value={ibutton} onChange={(e) => setIbutton(e.target.value)} maxLength={32} placeholder="A1B2C3D4" data-testid="driver-ibutton" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">{t('drivers.phone')}</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} data-testid="driver-phone" />
          </label>
          {!editing && accounts.length > 1 && (
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">{t('drivers.account')}</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text" data-testid="driver-account">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <Button type="submit" disabled={busy} data-testid="driver-save">{editing ? t('drivers.save') : t('drivers.create')}</Button>
          {editing && <Button type="button" variant="ghost" onClick={onCancel}>{t('drivers.cancel')}</Button>}
        </form>
        {error !== null && <p role="alert" className="mt-2 text-sm text-danger" data-testid="driver-error">{error}</p>}
      </CardContent>
    </Card>
  )
}
