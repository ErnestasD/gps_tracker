import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge as AdminBadge, PageHeader } from '@/components/admin/AdminKit'
import { Badge } from '@/components/ui/badge'
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

const selectStyle: React.CSSProperties = {
  borderColor: 'var(--admin-hairline)',
  background: 'var(--admin-surface)',
  color: 'var(--admin-ink)',
}

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }
const rowCls = 'admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]'

/** Driver registry (V2): list + create/edit + deactivate. Account-scoped; the iButton key is the
 * physical tag a driver taps (resolved to trips in a follow-up). Admin re-skin (ADR-028). */
export function DriversPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const [editing, setEditing] = useState<Driver | null>(null)
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['drivers'] })

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('drivers.title')} description={t('drivers.desc')} />

      {canWrite && (
        <DriverForm
          key={editing?.id ?? 'new'}
          accounts={accounts.data ?? []}
          editing={editing}
          onDone={() => { setEditing(null); refresh() }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('drivers.list')}
        </div>
        {drivers.isLoading ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('drivers.loading')}</p>
        ) : drivers.isError ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>{t('drivers.loadError')}</p>
        ) : (drivers.data ?? []).length === 0 ? (
          <p className="p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('drivers.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="drivers-table">
              <thead>
                <tr style={{ background: 'var(--admin-surface-sunken)' }}>
                  <th className={th} style={thStyle}>{t('drivers.name')}</th>
                  <th className={th} style={thStyle}>{t('drivers.license')}</th>
                  <th className={th} style={thStyle}>{t('drivers.ibutton')}</th>
                  <th className={th} style={thStyle}>{t('drivers.status')}</th>
                  <th className={th} style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {(drivers.data ?? []).map((d) => (
                  <tr key={d.id} className={rowCls} data-testid={`driver-${d.id}`}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--admin-ink)' }}>{d.name}</td>
                    <td className="mono px-4 py-2.5 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{d.licenseNo ?? '—'}</td>
                    <td className="mono px-4 py-2.5 text-xs" style={{ color: 'var(--admin-ink)' }}>{d.ibutton ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {d.active
                        ? <AdminBadge tone="success">{t('drivers.active')}</AdminBadge>
                        : <AdminBadge tone="neutral">{t('drivers.inactive')}</AdminBadge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canWrite && (
                        <>
                          <AdminButton variant="ghost" size="sm" data-testid={`driver-edit-${d.id}`} onClick={() => setEditing(d)}>{t('drivers.edit')}</AdminButton>
                          <AdminButton variant="ghost" size="sm" style={{ color: 'var(--admin-danger)' }} data-testid={`driver-delete-${d.id}`} onClick={() => void deleteDriver(d.id).then(refresh).catch(() => undefined)}>{t('drivers.delete')}</AdminButton>
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
    <div className="admin-card overflow-hidden">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {t('drivers.scores.title')}
      </div>
      {scores.isLoading ? (
        <p className="p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('drivers.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('drivers.scores.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="driver-scores-table">
            <thead>
              <tr style={{ background: 'var(--admin-surface-sunken)' }}>
                <th className={th} style={thStyle}>{t('drivers.name')}</th>
                <th className={th} style={thStyle}>{t('drivers.scores.trips')}</th>
                <th className={th} style={thStyle}>{t('drivers.scores.distance')}</th>
                <th className={th} style={thStyle}>{t('drivers.scores.overspeed')}</th>
                <th className={th} style={thStyle}>{t('drivers.scores.score')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.driverId} className={rowCls} data-testid={`driver-score-${s.driverId}`}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--admin-ink)' }}>{s.driverName}</td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{s.trips}</td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{s.distanceKm} km</td>
                  <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{s.overspeedEvents}</td>
                  {/* scoreVariant is the unit-tested ui/badge mapping — keep ui/badge here */}
                  <td className="px-4 py-2.5"><Badge variant={scoreVariant(s.score)}>{s.score ?? '—'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    <div className="admin-card">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {editing ? t('drivers.editTitle') : t('drivers.addTitle')}
      </div>
      <div className="p-4">
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2" data-testid="driver-form">
          <FieldLabel label={t('drivers.name')}>
            <AdminInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="w-48" data-testid="driver-name" />
          </FieldLabel>
          <FieldLabel label={t('drivers.license')}>
            <AdminInput value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} maxLength={60} className="w-40" data-testid="driver-license" />
          </FieldLabel>
          <FieldLabel label={t('drivers.ibutton')}>
            <AdminInput value={ibutton} onChange={(e) => setIbutton(e.target.value)} maxLength={32} placeholder="A1B2C3D4" className="w-40" data-testid="driver-ibutton" />
          </FieldLabel>
          <FieldLabel label={t('drivers.phone')}>
            <AdminInput value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="w-40" data-testid="driver-phone" />
          </FieldLabel>
          {!editing && accounts.length > 1 && (
            <FieldLabel label={t('drivers.account')}>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-md border px-2 text-sm" style={selectStyle} data-testid="driver-account">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </FieldLabel>
          )}
          <AdminButton type="submit" disabled={busy} data-testid="driver-save">{editing ? t('drivers.save') : t('drivers.create')}</AdminButton>
          {editing && <AdminButton type="button" variant="ghost" onClick={onCancel}>{t('drivers.cancel')}</AdminButton>}
        </form>
        {error !== null && <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="driver-error">{error}</p>}
      </div>
    </div>
  )
}
