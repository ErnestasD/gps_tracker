import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, MoreHorizontal, Plus, Wrench } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { getCurrentUser } from '@/lib/auth'
import { listDevices } from '@/lib/devices'
import { createMaintenance, deleteMaintenance, dueVariant, listMaintenance, markServiced, type MaintenanceView } from '@/lib/maintenance'

/** row model for the DataTable: the view plus the resolved device name (searchable/sortable). */
type MaintRow = MaintenanceView & { deviceName: string }

/** due status → sort rank (most urgent first when ascending). */
const STATUS_RANK: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2, unknown: 3 }

/** Maintenance reminders (V2): per-device service intervals by km/days; due computed at read.
 * Rebuilt on the orbetra_design_new app.maintenance layout (ADR-028 round 2): StatCard counts,
 * the create form in a right Sheet, the list as the shared DataTable (sort/filter by status),
 * and the serviced/delete row actions behind ConfirmDialog (both change data). */
export function MaintenancePage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const items = useQuery({ queryKey: ['maintenance'], queryFn: listMaintenance })
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['maintenance'] })
  const deviceName = (id: string) => (devices.data ?? []).find((d) => d.id === id)?.name ?? id
  const [addOpen, setAddOpen] = useState(false)
  // row actions (mark serviced / delete) surface failures instead of swallowing them (rules.tsx idiom)
  const [actionError, setActionError] = useState(false)
  const onActionErr = () => setActionError(true)
  const clearErr = () => setActionError(false)
  // confirm targets resolve against the LIVE list (devices precedent), never a snapshot
  const [servicedForId, setServicedForId] = useState<string | null>(null)
  const [deleteForId, setDeleteForId] = useState<string | null>(null)

  const list = items.data ?? []
  const okCount = list.filter((m) => m.due.status === 'ok').length
  const dueCount = list.filter((m) => m.due.status === 'due_soon').length
  const overdueCount = list.filter((m) => m.due.status === 'overdue').length

  const rows: MaintRow[] = list.map((m) => ({ ...m, deviceName: deviceName(m.deviceId) }))
  const servicedFor = rows.find((m) => m.id === servicedForId) ?? null
  const deleteFor = rows.find((m) => m.id === deleteForId) ?? null

  const columns: Column<MaintRow>[] = [
    {
      key: 'device',
      header: t('maint.device'),
      sortable: true,
      sortValue: (r) => r.deviceName.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.deviceName}</span>,
    },
    { key: 'service', header: t('maint.itemTitle'), sortable: true, sortValue: (r) => r.title.toLowerCase(), cell: (r) => r.title },
    {
      key: 'interval',
      header: t('maint.interval'),
      hideOnMobile: true,
      align: 'right', // numeric column (reference right-aligns dueKm/currentKm)
      cell: (r) => (
        <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
          {[
            r.intervalKm !== null ? t('maint.everyKm', { n: r.intervalKm }) : null,
            r.intervalDays !== null ? t('maint.everyDays', { n: r.intervalDays }) : null,
          ]
            .filter((p) => p !== null)
            .join(' · ')}
        </span>
      ),
    },
    {
      key: 'remaining',
      header: t('maint.remaining'),
      align: 'right', // numeric column (reference right-aligns dueKm/currentKm)
      cell: (r) => (
        <span className="text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`maint-remaining-${r.id}`}>
          {remaining(r, t) || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('maint.statusHeader'),
      sortable: true,
      sortValue: (r) => STATUS_RANK[r.due.status] ?? 9,
      filterValue: (r) => r.due.status,
      // every MaintenanceStatus value is filterable — 'unknown' is a real state (shared
      // entities default) and must be isolatable like the rest
      filterOptions: [
        { value: 'ok', label: t('maint.status.ok') },
        { value: 'due_soon', label: t('maint.status.due_soon') },
        { value: 'overdue', label: t('maint.status.overdue') },
        { value: 'unknown', label: t('maint.status.unknown') },
      ],
      // dueVariant is the unit-tested ui/badge mapping — keep ui/badge here
      cell: (r) => <Badge variant={dueVariant(r.due.status)} data-testid={`maint-status-${r.id}`}>{t(`maint.status.${r.due.status}`)}</Badge>,
    },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('maint.title')} description={t('maint.desc')}>
        {canWrite && (
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger asChild>
              <AdminButton data-testid="maint-add-open">
                <Plus className="h-4 w-4" aria-hidden />
                {t('maint.add')}
              </AdminButton>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>{t('maint.addTitle')}</SheetTitle>
              </SheetHeader>
              {/* closing the sheet unmounts the form, so each open starts fresh */}
              <MaintForm
                devices={devices.data ?? []}
                onCreated={() => {
                  refresh()
                  setAddOpen(false)
                }}
                onCancel={() => setAddOpen(false)}
              />
            </SheetContent>
          </Sheet>
        )}
      </PageHeader>

      {/* always rendered (reference shows the stat row even at zero) with the per-card hints */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard
          label={t('maint.stat.ok')}
          hint={t('maint.stat.okHint')}
          value={<><CheckCircle2 className="mr-2 inline h-5 w-5" style={{ color: 'var(--admin-success)' }} />{okCount}</>}
        />
        <StatCard
          label={t('maint.stat.due')}
          hint={t('maint.stat.dueHint')}
          value={<><Wrench className="mr-2 inline h-5 w-5" style={{ color: 'var(--admin-warning)' }} />{dueCount}</>}
        />
        <StatCard
          label={t('maint.stat.overdue')}
          hint={t('maint.stat.overdueHint')}
          value={<><AlertTriangle className="mr-2 inline h-5 w-5" style={{ color: 'var(--admin-danger)' }} />{overdueCount}</>}
        />
      </div>

      {actionError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="maint-action-error">
          {t('maint.actionError')}
        </p>
      )}

      {items.isLoading ? (
        <div className="admin-card space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : items.isError ? (
        <p className="text-sm" style={{ color: 'var(--admin-danger)' }}>{t('maint.loadError')}</p>
      ) : (
        <DataTable
          data-testid="maint-list"
          data={rows}
          columns={columns}
          searchKeys={['title', 'deviceName']}
          pageSize={10}
          emptyLabel={t('maint.empty')}
          rowTestId={(m) => `maint-${m.id}`}
          rowAction={
            canWrite
              ? (m) => (
                  <MaintRowMenu
                    item={m}
                    onServiced={() => setServicedForId(m.id)}
                    onDelete={() => setDeleteForId(m.id)}
                  />
                )
              : undefined
          }
        />
      )}

      {/* mark-serviced changes data (re-baselines the countdown) → default-tone confirm */}
      <ConfirmDialog
        open={servicedFor !== null}
        onOpenChange={(o) => {
          if (!o) setServicedForId(null)
        }}
        title={t('maint.markServiced')}
        description={servicedFor !== null ? t('maint.servicedSure', { title: servicedFor.title }) : undefined}
        confirmLabel={t('maint.markServiced')}
        onConfirm={() => {
          const m = servicedFor
          if (m === null) return
          clearErr()
          void markServiced(m.id, m.currentOdoKm).then(refresh).catch(onActionErr)
        }}
      />
      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null)
        }}
        tone="danger"
        title={t('maint.delete')}
        description={deleteFor !== null ? t('maint.deleteSure', { title: deleteFor.title }) : undefined}
        confirmLabel={t('maint.delete')}
        onConfirm={() => {
          const m = deleteFor
          if (m === null) return
          clearErr()
          void deleteMaintenance(m.id).then(refresh).catch(onActionErr)
        }}
      />
    </div>
  )
}

/** Per-row "..." actions menu (devices precedent): both actions arm page-level ConfirmDialogs. */
function MaintRowMenu({ item, onServiced, onDelete }: { item: MaintRow; onServiced: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const entry = (testid: string, label: string, onClick: () => void, danger = false) => (
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
          aria-label={t('maint.actions')}
          data-testid={`maint-menu-${item.id}`}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--admin-ink-soft)' }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        {entry(`maint-serviced-${item.id}`, t('maint.markServiced'), onServiced)}
        {entry(`maint-del-${item.id}`, t('maint.delete'), onDelete, true)}
      </PopoverContent>
    </Popover>
  )
}

/** The remaining-until-due label (km and/or days), from the computed due. */
function remaining(m: MaintenanceView, t: (k: string, o?: Record<string, unknown>) => string): string {
  const parts: string[] = []
  if (m.due.kmRemaining !== null) parts.push(t('maint.kmLeft', { n: m.due.kmRemaining }))
  if (m.due.daysRemaining !== null) parts.push(t('maint.daysLeft', { n: m.due.daysRemaining }))
  return parts.join(' · ')
}

function MaintForm({ devices, onCreated, onCancel }: {
  devices: { id: string; name: string; plate?: string | null }[]
  onCreated: () => void
  onCancel: () => void
}) {
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
      onCreated() // parent closes the sheet; unmount resets the form
    } catch {
      setError(t('maint.saveError'))
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-3" data-testid="maint-form">
      <Field label={t('maint.device')}>
        {/* Combobox with plate hint (reference device-picker idiom) */}
        <Combobox
          value={dev}
          onChange={setDeviceId}
          data-testid="maint-device"
          aria-label={t('maint.device')}
          options={devices.map((d) => ({ value: d.id, label: d.name, ...(d.plate != null && d.plate !== '' ? { hint: d.plate } : {}) }))}
        />
      </Field>
      <Field label={t('maint.itemTitle')}><AdminInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} data-testid="maint-title" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('maint.intervalKm')}><AdminInput type="number" min={1} value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} data-testid="maint-km" /></Field>
        <Field label={t('maint.intervalDays')}><AdminInput type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} data-testid="maint-days" /></Field>
      </div>
      {/* no placeholder: a blank field baselines to the device's CURRENT odometer (never 0) */}
      <Field label={t('maint.currentOdo')}><AdminInput type="number" min={0} value={odoKm} onChange={(e) => setOdoKm(e.target.value)} data-testid="maint-odo" /></Field>
      {error !== null && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="maint-error">{error}</p>}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy} data-testid="maint-create">{t('maint.create')}</AdminButton>
      </SheetFooter>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}
