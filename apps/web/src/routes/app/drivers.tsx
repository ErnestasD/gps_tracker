import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge as AdminBadge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
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
  type DriverScoreView,
} from '@/lib/drivers'

/** scoreVariant (pure, unit-tested) → AdminBadge tone (1:1). */
const SCORE_TONE = { success: 'success', warn: 'warning', danger: 'danger', outline: 'neutral' } as const
/** scoreVariant → the score-bar fill color (Lovable's thin progress bar next to the badge). */
const SCORE_BAR: Record<keyof typeof SCORE_TONE, string> = {
  success: 'var(--admin-success)',
  warn: 'var(--admin-warning)',
  danger: 'var(--admin-danger)',
  outline: 'var(--admin-hairline)',
}

/** "Vardenis Pavardenis" → "VP" for the roster avatar circle (Lovable idiom). */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

/** Driver registry (V2): list + create/edit + delete. Rebuilt on the orbetra_design_new
 * app.drivers layout (ADR-028 round 2): the create/edit form lives in a right Sheet opened
 * from the PageHeader (key-remount per edited driver), the roster is the shared DataTable,
 * per-row actions sit in a "..." popover, and delete goes through ConfirmDialog. */
export function DriversPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['drivers'] })
    // the scores table joins driverName server-side — a rename must not leave it stale
    void qc.invalidateQueries({ queryKey: ['driver-scores'] })
  }

  // targets resolve against the LIVE list (devices precedent) — a refetch/delete never leaves
  // the sheet or confirm pointed at a stale snapshot
  const editing = (drivers.data ?? []).find((d) => d.id === editingId) ?? null
  const deleteFor = (drivers.data ?? []).find((d) => d.id === deleteForId) ?? null
  const formOpen = addOpen || editing !== null
  const closeForm = () => {
    setAddOpen(false)
    setEditingId(null)
  }

  const showAccount = (accounts.data ?? []).length > 1
  const accountName = (id: string) => (accounts.data ?? []).find((a) => a.id === id)?.name ?? '—'

  const columns: Column<Driver>[] = [
    {
      key: 'name',
      header: t('drivers.name'),
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
            style={{ background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' }}
            aria-hidden
          >
            {initials(r.name)}
          </div>
          <div>
            <div className="font-medium">{r.name}</div>
            {r.phone !== null && r.phone !== '' && (
              <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                {r.phone}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'license',
      header: t('drivers.license'),
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.licenseNo ?? '—'}</span>,
    },
    {
      key: 'ibutton',
      header: t('drivers.ibutton'),
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.ibutton ?? '—'}</span>,
    },
    // account column only when the operator actually sees several accounts (already fetched for the form)
    ...(showAccount
      ? [
          {
            key: 'account',
            header: t('drivers.account'),
            hideOnMobile: true,
            cell: (r) => accountName(r.accountId),
          } as Column<Driver>,
        ]
      : []),
    {
      key: 'status',
      header: t('drivers.status'),
      sortable: true,
      sortValue: (r) => (r.active ? 'active' : 'inactive'),
      filterValue: (r) => (r.active ? 'active' : 'inactive'),
      filterOptions: [
        { value: 'active', label: t('drivers.active') },
        { value: 'inactive', label: t('drivers.inactive') },
      ],
      cell: (r) =>
        r.active ? <AdminBadge tone="success">{t('drivers.active')}</AdminBadge> : <AdminBadge tone="neutral">{t('drivers.inactive')}</AdminBadge>,
    },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('drivers.title')} description={t('drivers.desc')}>
        {canWrite && (
          <Sheet
            open={formOpen}
            onOpenChange={(o) => {
              if (o) setAddOpen(true)
              else closeForm()
            }}
          >
            <SheetTrigger asChild>
              <AdminButton data-testid="driver-add-open">
                <Plus className="h-4 w-4" aria-hidden />
                {t('drivers.add')}
              </AdminButton>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>{editing !== null ? t('drivers.editTitle') : t('drivers.addTitle')}</SheetTitle>
              </SheetHeader>
              {/* key remounts the form per target — edit state must never leak across drivers */}
              <DriverForm
                key={editing?.id ?? 'new'}
                accounts={accounts.data ?? []}
                editing={editing}
                onDone={() => {
                  closeForm()
                  refresh()
                }}
                onCancel={closeForm}
              />
            </SheetContent>
          </Sheet>
        )}
      </PageHeader>

      {drivers.isLoading ? (
        <div className="admin-card space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : drivers.isError ? (
        <p className="text-sm" style={{ color: 'var(--admin-danger)' }}>{t('drivers.loadError')}</p>
      ) : (
        <DataTable
          data-testid="drivers-table"
          data={drivers.data ?? []}
          columns={columns}
          searchKeys={['name', 'licenseNo', 'ibutton', 'phone']}
          pageSize={10}
          emptyLabel={t('drivers.empty')}
          rowTestId={(d) => `driver-${d.id}`}
          rowAction={
            canWrite
              ? (d) => <DriverRowMenu driver={d} onEdit={() => setEditingId(d.id)} onDelete={() => setDeleteForId(d.id)} />
              : undefined
          }
        />
      )}

      <DriverScores />

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null)
        }}
        tone="danger"
        title={t('drivers.delete')}
        description={deleteFor !== null ? t('drivers.deleteSure', { name: deleteFor.name }) : undefined}
        confirmLabel={t('drivers.delete')}
        onConfirm={() => {
          const d = deleteFor
          if (d === null) return
          void deleteDriver(d.id).then(refresh).catch(() => undefined)
        }}
      />
    </div>
  )
}

/** Per-row "..." actions menu (devices precedent): edit opens the header Sheet prefilled;
 * delete arms the page-level ConfirmDialog. */
function DriverRowMenu({ driver, onEdit, onDelete }: { driver: Driver; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const item = (testid: string, label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      data-testid={testid}
      onClick={() => {
        setOpen(false)
        onClick()
      }}
      className="block w-full rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--admin-surface-sunken)]"
      style={{ color: danger ? 'var(--admin-danger)' : 'var(--admin-ink)' }}
    >
      {label}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('drivers.actions')}
          data-testid={`driver-menu-${driver.id}`}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--admin-ink-soft)' }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {item(`driver-edit-${driver.id}`, t('drivers.edit'), onEdit)}
        {item(`driver-delete-${driver.id}`, t('drivers.delete'), onDelete, true)}
      </PopoverContent>
    </Popover>
  )
}

/** Safety scores over the last 30 days (V2) — from assigned trips + overspeed events.
 * Rendered with the shared DataTable (Lovable idiom): trips/distance/score are sortable and
 * right-aligned; the thin score bar next to the badge stays, scoreVariant drives both colors. */
type ScoreRow = DriverScoreView & { id: string }

function DriverScores() {
  const { t } = useTranslation()
  const scores = useQuery({ queryKey: ['driver-scores'], queryFn: listDriverScores })
  // only drivers with driving in the window; DataTable rows need an `id`
  const rows: ScoreRow[] = (scores.data ?? []).filter((s) => s.trips > 0).map((s) => ({ ...s, id: s.driverId }))

  const columns: Column<ScoreRow>[] = [
    {
      key: 'name',
      header: t('drivers.name'),
      sortable: true,
      sortValue: (r) => r.driverName.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.driverName}</span>,
    },
    {
      key: 'trips',
      header: t('drivers.scores.trips'),
      sortable: true,
      sortValue: (r) => r.trips,
      align: 'right',
      cell: (r) => <span className="tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{r.trips}</span>,
    },
    {
      key: 'distance',
      header: t('drivers.scores.distance'),
      sortable: true,
      sortValue: (r) => r.distanceKm,
      align: 'right',
      cell: (r) => <span className="tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{t('units.km', { n: r.distanceKm })}</span>,
    },
    {
      key: 'overspeed',
      header: t('drivers.scores.overspeed'),
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className="tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{r.overspeedEvents}</span>,
    },
    {
      key: 'score',
      header: t('drivers.scores.score'),
      sortable: true,
      // null scores sort below every real score
      sortValue: (r) => r.score ?? -1,
      align: 'right',
      // scoreVariant stays the unit-tested pure mapping; its variants map 1:1 onto AdminBadge tones
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.score !== null && (
            <div className="h-1.5 w-16 rounded-full" style={{ background: 'var(--admin-hairline)' }} aria-hidden>
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${Math.max(0, Math.min(100, r.score))}%`, background: SCORE_BAR[scoreVariant(r.score)] }}
              />
            </div>
          )}
          <AdminBadge tone={SCORE_TONE[scoreVariant(r.score)]}>{r.score ?? '—'}</AdminBadge>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('drivers.scores.title')}</h2>
      {scores.isLoading ? (
        <div className="admin-card p-4">
          <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('drivers.loading')}</p>
        </div>
      ) : (
        <DataTable
          data-testid="driver-scores-table"
          data={rows}
          columns={columns}
          searchable={false}
          pageSize={10}
          emptyLabel={t('drivers.scores.empty')}
          rowTestId={(r) => `driver-score-${r.driverId}`}
        />
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
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-3" data-testid="driver-form">
      <FieldLabel label={t('drivers.name')}>
        <AdminInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="driver-name" />
      </FieldLabel>
      <FieldLabel label={t('drivers.license')}>
        <AdminInput value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} maxLength={60} data-testid="driver-license" />
      </FieldLabel>
      <FieldLabel label={t('drivers.ibutton')}>
        <AdminInput value={ibutton} onChange={(e) => setIbutton(e.target.value)} maxLength={32} placeholder="A1B2C3D4" data-testid="driver-ibutton" />
      </FieldLabel>
      <FieldLabel label={t('drivers.phone')}>
        <AdminInput value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} data-testid="driver-phone" />
      </FieldLabel>
      {!editing && accounts.length > 1 && (
        <FieldLabel label={t('drivers.account')}>
          <Combobox
            value={accountId}
            onChange={setAccountId}
            data-testid="driver-account"
            aria-label={t('drivers.account')}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </FieldLabel>
      )}
      {error !== null && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="driver-error">{error}</p>}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('drivers.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy} data-testid="driver-save">{editing ? t('drivers.save') : t('drivers.create')}</AdminButton>
      </SheetFooter>
    </form>
  )
}
