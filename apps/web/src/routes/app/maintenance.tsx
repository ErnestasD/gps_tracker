import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, MoreHorizontal, Plus, Trash2, Wrench } from 'lucide-react'
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
import { applyPlan, createPlan, deletePlan, docVariant, listDocuments, listPlans, type MaintenancePlanView, type PlanItemInput } from '@/lib/fleet'
import { useFmt } from '@/lib/datetime'
import { kmToMi, miToKm, useUnits, type Units } from '@/lib/units'

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
  const u = useUnits()
  const { d } = useFmt()
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
            // display-only conversion: the stored interval stays km (input fields too)
            r.intervalKm !== null ? (u.prefs.unitDistance === 'mi' ? t('maint.everyMi', { n: Math.round(kmToMi(r.intervalKm)) }) : t('maint.everyKm', { n: r.intervalKm })) : null,
            r.intervalDays !== null ? t('maint.everyDays', { n: r.intervalDays }) : null,
            r.intervalEngineH !== null ? t('maint.everyEngineH', { n: r.intervalEngineH }) : null,
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
          {remaining(r, t, u) || '—'}
        </span>
      ),
    },
    {
      key: 'forecast',
      header: t('maint.forecast'),
      hideOnMobile: true,
      align: 'right',
      sortable: true,
      sortValue: (r) => r.predictedDueAt ?? '9999',
      // km-forecast from the 30-day average daily km (FLEET-1 F2); day-based dues are exact
      cell: (r) => (
        <span className="text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>
          {r.predictedDueAt !== null ? d(r.predictedDueAt) : '—'}
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

      {canWrite && <PlansSection devices={devices.data ?? []} onApplied={refresh} />}
      <ExpiringDocsSection deviceName={deviceName} />

      {/* mark-serviced re-baselines the countdown AND writes a service-log row (FLEET-1 F2) —
          the sheet captures the optional cost/vendor/notes that ride into history */}
      <Sheet open={servicedFor !== null} onOpenChange={(o) => { if (!o) setServicedForId(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('maint.markServiced')}</SheetTitle>
          </SheetHeader>
          {servicedFor !== null && (
            <ServicedForm
              key={servicedFor.id}
              item={servicedFor}
              onDone={() => { setServicedForId(null); refresh() }}
              onCancel={() => setServicedForId(null)}
              onError={() => { setServicedForId(null); onActionErr() }}
              clearErr={clearErr}
            />
          )}
        </SheetContent>
      </Sheet>
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

/** The remaining-until-due label (km/mi and/or days), from the computed due. Distance is
 * display-converted per the unit pref; the underlying values stay km. */
function remaining(m: MaintenanceView, t: (k: string, o?: Record<string, unknown>) => string, u: Units): string {
  const parts: string[] = []
  if (m.due.kmRemaining !== null) {
    parts.push(u.prefs.unitDistance === 'mi' ? t('maint.miLeft', { n: Math.round(kmToMi(m.due.kmRemaining)) }) : t('maint.kmLeft', { n: m.due.kmRemaining }))
  }
  if (m.due.daysRemaining !== null) parts.push(t('maint.daysLeft', { n: m.due.daysRemaining }))
  if (m.due.engineHRemaining !== null) parts.push(t('maint.hLeft', { n: m.due.engineHRemaining }))
  return parts.join(' · ')
}

function MaintForm({ devices, onCreated, onCancel }: {
  devices: { id: string; name: string; plate?: string | null }[]
  onCreated: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const u = useUnits()
  // the form reads in the display distance unit; storage stays km, so convert mi → km on submit
  const mi = u.prefs.unitDistance === 'mi'
  // ROUNDED, because both fields are `z.number().int()` server-side. Unrounded, a miles account
  // could never create a distance reminder at all: 5000 mi → 8046.72 km → 400, with the form
  // showing only its generic save error. The same rounding also accepts a km user typing "1000.5".
  const toKm = (v: string): number => Math.round(mi ? miToKm(Number(v)) : Number(v))
  const [deviceId, setDeviceId] = useState('')
  const [title, setTitle] = useState('')
  const [intervalKm, setIntervalKm] = useState('')
  const [intervalDays, setIntervalDays] = useState('')
  const [intervalEngineH, setIntervalEngineH] = useState('')
  const [odoKm, setOdoKm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dev = deviceId || devices[0]?.id || ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (title.trim() === '' || dev === '') { setError(t('maint.needFields')); return }
    const km = intervalKm.trim() === '' ? null : toKm(intervalKm)
    const days = intervalDays.trim() === '' ? null : Number(intervalDays)
    const engineH = intervalEngineH.trim() === '' ? null : Number(intervalEngineH)
    if (km === null && days === null && engineH === null) { setError(t('maint.needInterval')); return }
    setBusy(true)
    try {
      // only send an explicit odometer baseline when the operator typed one; otherwise the server
      // baselines a km reminder to the device's CURRENT odometer (full interval remaining), never 0
      await createMaintenance({
        deviceId: dev, title: title.trim(),
        intervalKm: km, intervalDays: days, intervalEngineH: engineH,
        ...(km !== null && odoKm.trim() !== '' ? { lastServiceOdoKm: toKm(odoKm) } : {}),
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
        <Field label={mi ? t('maint.intervalMi') : t('maint.intervalKm')}><AdminInput type="number" min={1} value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} data-testid="maint-km" /></Field>
        <Field label={t('maint.intervalDays')}><AdminInput type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} data-testid="maint-days" /></Field>
      </div>
      {/* engine hours (FLEET-1 F2) — for machinery where km is meaningless; hours are derived
          from trips server-side, starting at 0 from creation unless a baseline is set later */}
      <Field label={t('maint.intervalEngineH')}><AdminInput type="number" min={1} value={intervalEngineH} onChange={(e) => setIntervalEngineH(e.target.value)} data-testid="maint-engineh" /></Field>
      {/* no placeholder: a blank field baselines to the device's CURRENT odometer (never 0) */}
      <Field label={mi ? t('maint.currentOdoMi') : t('maint.currentOdo')}><AdminInput type="number" min={0} value={odoKm} onChange={(e) => setOdoKm(e.target.value)} data-testid="maint-odo" /></Field>
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

/** FLEET-1 F2: the serviced form — one confirm that re-baselines the reminder and records the
 * completed service (cost/vendor/notes optional) into the vehicle's history. */
function ServicedForm({ item, onDone, onCancel, onError, clearErr }: {
  item: MaintenanceView & { deviceName: string }
  onDone: () => void
  onCancel: () => void
  onError: () => void
  clearErr: () => void
}) {
  const { t } = useTranslation()
  const [costEur, setCostEur] = useState('')
  const [vendor, setVendor] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    clearErr()
    void markServiced(item.id, item.currentOdoKm, {
      costCents: costEur.trim() === '' ? null : Math.round(Number(costEur) * 100),
      vendor: vendor.trim() === '' ? null : vendor.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
    })
      .then(onDone)
      .catch(onError)
      .finally(() => setBusy(false))
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3" data-testid="serviced-form">
      <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('maint.servicedSure', { title: item.title })}</p>
      <Field label={t('maint.servicedCost')}><AdminInput type="number" min={0} step="0.01" value={costEur} onChange={(e) => setCostEur(e.target.value)} data-testid="serviced-cost" /></Field>
      <Field label={t('maint.servicedVendor')}><AdminInput value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={160} data-testid="serviced-vendor" /></Field>
      <Field label={t('maint.servicedNotes')}><AdminInput value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} data-testid="serviced-notes" /></Field>
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy} data-testid="serviced-confirm">{t('maint.markServiced')}</AdminButton>
      </SheetFooter>
    </form>
  )
}

/** FLEET-1 F2: maintenance plan templates — define interval sets once, apply to many vehicles.
 * Apply is idempotent per (device, title), so re-running over the fleet never duplicates. */
function PlansSection({ devices, onApplied }: {
  devices: { id: string; name: string; plate?: string | null }[]
  onApplied: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const plans = useQuery({ queryKey: ['maintenance-plans'], queryFn: listPlans })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['maintenance-plans'] })
  const [createOpen, setCreateOpen] = useState(false)
  const [applyFor, setApplyFor] = useState<MaintenancePlanView | null>(null)
  const [deleteFor, setDeleteFor] = useState<MaintenancePlanView | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const intervalLabel = (i: PlanItemInput): string =>
    [
      i.intervalKm != null ? t('maint.everyKm', { n: i.intervalKm }) : null,
      i.intervalDays != null ? t('maint.everyDays', { n: i.intervalDays }) : null,
      i.intervalEngineH != null ? t('maint.everyEngineH', { n: i.intervalEngineH }) : null,
    ].filter((x) => x !== null).join(' · ')

  return (
    <div className="admin-card space-y-3 p-4" data-testid="maint-plans">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('maint.plans')}</div>
          <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('maint.plansDesc')}</p>
        </div>
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetTrigger asChild>
            <AdminButton variant="secondary" data-testid="plan-add-open"><Plus className="h-4 w-4" aria-hidden />{t('maint.planAdd')}</AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader><SheetTitle>{t('maint.planAdd')}</SheetTitle></SheetHeader>
            <PlanForm onCreated={() => { refresh(); setCreateOpen(false) }} onCancel={() => setCreateOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
      {(plans.data ?? []).length === 0 && !plans.isLoading && (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('maint.plansEmpty')}</p>
      )}
      <div className="space-y-1">
        {(plans.data ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--admin-hairline)' }} data-testid={`plan-${p.id}`}>
            <span className="font-medium">{p.name}</span>
            <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
              {p.items.map((i) => `${i.title} (${intervalLabel(i)})`).join(' · ')}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <AdminButton variant="secondary" data-testid={`plan-apply-${p.id}`} onClick={() => setApplyFor(p)}>{t('maint.planApply')}</AdminButton>
              <button type="button" aria-label={t('maint.delete')} data-testid={`plan-del-${p.id}`}
                onClick={() => setDeleteFor(p)}
                className="grid h-7 w-7 place-items-center rounded transition-colors hover:bg-[var(--admin-surface-sunken)]">
                <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--admin-danger)' }} aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
      {applied !== null && <p className="text-xs" style={{ color: 'var(--admin-success)' }} data-testid="plan-applied">{applied}</p>}
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--admin-danger)' }}>{t('maint.actionError')}</p>}

      <Sheet open={applyFor !== null} onOpenChange={(o) => { if (!o) setApplyFor(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>{applyFor !== null ? t('maint.planApplyTitle', { name: applyFor.name }) : ''}</SheetTitle></SheetHeader>
          {applyFor !== null && (
            <PlanApplyForm
              key={applyFor.id}
              devices={devices}
              onApply={async (deviceIds) => {
                setError(false)
                try {
                  const res = await applyPlan(applyFor.id, deviceIds)
                  setApplied(t('maint.planApplied', { created: res.created, skipped: res.skipped }))
                  setApplyFor(null)
                  onApplied()
                } catch { setError(true) }
              }}
              onCancel={() => setApplyFor(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => { if (!o) setDeleteFor(null) }}
        tone="danger"
        title={t('maint.planDelete')}
        description={deleteFor !== null ? t('maint.planDeleteSure', { name: deleteFor.name }) : undefined}
        confirmLabel={t('maint.delete')}
        onConfirm={() => {
          const p = deleteFor
          if (p === null) return
          setError(false)
          void deletePlan(p.id).then(refresh).catch(() => setError(true))
        }}
      />
    </div>
  )
}

/** Plan create form: up to five interval rows (a plan bigger than that is usually two plans). */
function PlanForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const empty = { title: '', km: '', days: '', engineH: '' }
  const [name, setName] = useState('')
  const [rows, setRows] = useState([{ ...empty }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setRow = (idx: number, patch: Partial<typeof empty>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const items: PlanItemInput[] = []
    for (const r of rows) {
      if (r.title.trim() === '') continue
      const item: PlanItemInput = {
        title: r.title.trim(),
        intervalKm: r.km.trim() === '' ? null : Number(r.km),
        intervalDays: r.days.trim() === '' ? null : Number(r.days),
        intervalEngineH: r.engineH.trim() === '' ? null : Number(r.engineH),
      }
      if (item.intervalKm === null && item.intervalDays === null && item.intervalEngineH === null) {
        setError(t('maint.needInterval')); return
      }
      items.push(item)
    }
    if (name.trim() === '' || items.length === 0) { setError(t('maint.needFields')); return }
    setBusy(true)
    try {
      await createPlan({ name: name.trim(), items })
      onCreated()
    } catch { setError(t('maint.saveError')) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-3" data-testid="plan-form">
      <Field label={t('maint.planName')}><AdminInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="plan-name" /></Field>
      {rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-md border p-2" style={{ borderColor: 'var(--admin-hairline)' }}>
          <Field label={t('maint.itemTitle')}><AdminInput value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} maxLength={120} data-testid={`plan-item-title-${i}`} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('maint.intervalKm')}><AdminInput type="number" min={1} value={r.km} onChange={(e) => setRow(i, { km: e.target.value })} data-testid={`plan-item-km-${i}`} /></Field>
            <Field label={t('maint.intervalDays')}><AdminInput type="number" min={1} value={r.days} onChange={(e) => setRow(i, { days: e.target.value })} /></Field>
            <Field label={t('maint.intervalEngineH')}><AdminInput type="number" min={1} value={r.engineH} onChange={(e) => setRow(i, { engineH: e.target.value })} /></Field>
          </div>
        </div>
      ))}
      {rows.length < 5 && (
        <AdminButton variant="secondary" onClick={() => setRows((rs) => [...rs, { ...empty }])} data-testid="plan-item-add">
          <Plus className="h-4 w-4" aria-hidden />{t('maint.planAddItem')}
        </AdminButton>
      )}
      {error !== null && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="plan-error">{error}</p>}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy} data-testid="plan-create">{t('maint.create')}</AdminButton>
      </SheetFooter>
    </form>
  )
}

/** Device multi-select for plan apply: check the vehicles (or all) the plan lands on. */
function PlanApplyForm({ devices, onApply, onCancel }: {
  devices: { id: string; name: string; plate?: string | null }[]
  onApply: (deviceIds: string[]) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allChecked = checked.size === devices.length && devices.length > 0

  return (
    <div className="mt-2 flex flex-col gap-3" data-testid="plan-apply-form">
      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--admin-ink)' }}>
        <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(devices.map((d) => d.id)))} data-testid="plan-apply-all" />
        {t('maint.planApplyAll', { n: devices.length })}
      </label>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2" style={{ borderColor: 'var(--admin-hairline)' }}>
        {devices.map((d) => (
          <label key={d.id} className="flex items-center gap-2 text-sm" style={{ color: 'var(--admin-ink)' }}>
            <input type="checkbox" checked={checked.has(d.id)} onChange={() => toggle(d.id)} data-testid={`plan-apply-dev-${d.id}`} />
            {d.name}{d.plate != null && d.plate !== '' ? ` (${d.plate})` : ''}
          </label>
        ))}
      </div>
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton
          disabled={busy || checked.size === 0}
          data-testid="plan-apply-confirm"
          onClick={() => { setBusy(true); void onApply([...checked]).finally(() => setBusy(false)) }}
        >
          {t('maint.planApplyN', { n: checked.size })}
        </AdminButton>
      </SheetFooter>
    </div>
  )
}

/** FLEET-1 F3: fleet-wide expiring documents — the "act this month" list (due_soon + overdue). */
function ExpiringDocsSection({ deviceName }: { deviceName: (id: string) => string }) {
  const { t } = useTranslation()
  const { d } = useFmt()
  const docs = useQuery({ queryKey: ['documents', 'expiring'], queryFn: () => listDocuments('soon') })
  if (docs.isLoading || (docs.data ?? []).length === 0) return null
  return (
    <div className="admin-card space-y-2 p-4" data-testid="expiring-docs">
      <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('maint.expiringDocs')}</div>
      <div className="space-y-1">
        {(docs.data ?? []).map((doc) => (
          <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--admin-hairline)' }} data-testid={`expdoc-${doc.id}`}>
            <span className="font-medium">{deviceName(doc.deviceId)}</span>
            <span style={{ color: 'var(--admin-ink-soft)' }}>{t(`fleet.docKind.${doc.kind}`)} · {doc.title}</span>
            <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{d(doc.validTo)}</span>
            <Badge variant={docVariant(doc.due.status)}>
              {doc.due.status === 'overdue' ? t('fleet.docOverdue', { n: -doc.due.daysRemaining }) : t('fleet.docDays', { n: doc.due.daysRemaining })}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  )
}
