import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Plus, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
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

const statusOf = (d: Device): 'active' | 'retired' => (d.retiredAt === null ? 'active' : 'retired')

/** Devices page (E03-3), rebuilt on the orbetra_design_new app.devices layout (ADR-028 round 2):
 * PageHeader actions open right Sheets (CSV import wizard + create form), the list is the shared
 * DataTable (search / status filter / sort / pagination), per-row actions live in a "..." popover
 * menu, and destructive retire/erase go through ConfirmDialog. Sub-cards (health/CAN/onboarding/
 * commands/share) still toggle below the table, unchanged. */
export function DevicesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [retireError, setRetireError] = useState<string | null>(null)
  const [commandsForId, setCommandsForId] = useState<string | null>(null)
  const [healthForId, setHealthForId] = useState<string | null>(null)
  const [shareForId, setShareForId] = useState<string | null>(null)
  const [onboardForId, setOnboardForId] = useState<string | null>(null)
  // destructive flows (retire / GDPR erase, E08-4) are gated by ConfirmDialog (ADR-028 round 2);
  // the pending target is an ID resolved against the LIVE list below, never a snapshot
  const [retireForId, setRetireForId] = useState<string | null>(null)
  const [eraseForId, setEraseForId] = useState<string | null>(null)
  const [eraseQueued, setEraseQueued] = useState(false)
  const [eraseError, setEraseError] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['devices'] })
  const isAdmin = ['platform_admin', 'tsp_admin'].includes(getCurrentUser()?.role ?? '')
  // derive the panel's device from the LIVE list (never a snapshot): a retire or refetch
  // closes/updates the panel instead of leaving a stale device you can still command
  const commandsFor: Device | null = (devices.data ?? []).find((d) => d.id === commandsForId && d.retiredAt === null) ?? null
  const healthFor: Device | null = (devices.data ?? []).find((d) => d.id === healthForId && d.retiredAt === null) ?? null
  const shareFor: Device | null = (devices.data ?? []).find((d) => d.id === shareForId && d.retiredAt === null) ?? null
  const onboardFor: Device | null = (devices.data ?? []).find((d) => d.id === onboardForId && d.retiredAt === null) ?? null
  const retireFor: Device | null = (devices.data ?? []).find((d) => d.id === retireForId && d.retiredAt === null) ?? null
  const eraseFor: Device | null = (devices.data ?? []).find((d) => d.id === eraseForId && d.retiredAt !== null) ?? null

  const columns: Column<Device>[] = [
    {
      key: 'name',
      header: t('devices.name'),
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          {r.plate !== null && r.plate !== '' && (
            <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
              {r.plate}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'imei',
      header: t('devices.imei'),
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.imei}</span>,
    },
    {
      key: 'status',
      header: t('devices.status'),
      sortable: true,
      sortValue: statusOf,
      filterValue: statusOf,
      filterOptions: [
        { value: 'active', label: t('devices.active') },
        { value: 'retired', label: t('devices.retired') },
      ],
      // colored status dot inside the Badge (Lovable tile-row idiom)
      cell: (r) =>
        r.retiredAt === null ? (
          <Badge tone="success">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
            {t('devices.active')}
          </Badge>
        ) : (
          <Badge tone="neutral">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
            {t('devices.retired')}
          </Badge>
        ),
    },
    {
      key: 'odometer',
      header: t('devices.odometer'),
      // round-2 control sweep: the inline cell select is a Combobox too; the e2e spec asserts
      // the picked source via the trigger's data-value instead of selectOption/toHaveValue
      cell: (r) => (
        <div className="w-32">
          <Combobox
            value={r.odometerSource}
            disabled={r.retiredAt !== null}
            aria-label={t('devices.odometer')}
            data-testid={`odometer-${r.imei}`}
            onChange={(v) => void updateDevice(r.id, { odometerSource: v as OdometerSource }).then(refresh).catch(() => undefined)}
            options={ODOMETER_SOURCES.map((src) => ({ value: src, label: t(`devices.odo.${src}`) }))}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 md:px-8 md:py-8">
      <PageHeader className="mb-2" title={t('devices.title')} description={t('devices.desc')}>
        <Sheet open={importOpen} onOpenChange={setImportOpen}>
          <SheetTrigger asChild>
            <AdminButton variant="secondary" data-testid="import-open">
              <Upload className="h-4 w-4" aria-hidden />
              {t('devices.import.open')}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>{t('devices.import.title')}</SheetTitle>
            </SheetHeader>
            <ImportSheetBody onImported={refresh} />
          </SheetContent>
        </Sheet>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton data-testid="device-add-open">
              <Plus className="h-4 w-4" aria-hidden />
              {t('devices.add')}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t('devices.addTitle')}</SheetTitle>
            </SheetHeader>
            <CreateDeviceForm
              accounts={accounts.data ?? []}
              profiles={profiles.data ?? []}
              onCreated={() => {
                refresh()
                setAddOpen(false)
              }}
              onCancel={() => setAddOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </PageHeader>

      {retireError !== null && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="retire-error">
          {t('devices.retireError', { imei: retireError })}
        </p>
      )}
      {eraseQueued && (
        <p role="status" className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="erase-queued">
          {t('devices.eraseQueued')}
        </p>
      )}
      {eraseError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="erase-error">
          {t('devices.eraseError')}
        </p>
      )}

      {devices.isLoading ? (
        <div className="admin-card space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : devices.isError ? (
        <p className="text-sm" style={{ color: 'var(--admin-danger)' }}>{t('devices.loadError')}</p>
      ) : (
        <DataTable
          data-testid="devices-table"
          data={devices.data ?? []}
          columns={columns}
          searchKeys={['name', 'plate', 'imei']}
          pageSize={12}
          emptyLabel={t('devices.empty')}
          rowTestId={(d) => `device-${d.imei}`}
          rowAction={(d) => (
            <RowMenu
              device={d}
              isAdmin={isAdmin}
              onHealth={() => setHealthForId((cur) => (cur === d.id ? null : d.id))}
              onOnboard={() => setOnboardForId((cur) => (cur === d.id ? null : d.id))}
              onCommands={() => setCommandsForId((cur) => (cur === d.id ? null : d.id))}
              onShare={() => setShareForId((cur) => (cur === d.id ? null : d.id))}
              onRetire={() => setRetireForId(d.id)}
              onErase={() => setEraseForId(d.id)}
            />
          )}
        />
      )}

      {/* key remounts the panel per device — armed/text state must NEVER survive a device
          switch (a confirm armed for device A must not send with one click on device B) */}
      {healthFor !== null && <HealthCard key={healthFor.id} device={healthFor} />}
      {healthFor !== null && <CanCard key={`can-${healthFor.id}`} device={healthFor} />}
      {onboardFor !== null && <OnboardingCard key={onboardFor.id} device={onboardFor} />}
      {commandsFor !== null && <CommandsCard key={commandsFor.id} device={commandsFor} />}
      {shareFor !== null && <ShareCard key={shareFor.id} device={shareFor} />}

      {getCurrentUser()?.role === 'platform_admin' && <QuarantineSection />}

      <ConfirmDialog
        open={retireFor !== null}
        onOpenChange={(o) => {
          if (!o) setRetireForId(null)
        }}
        tone="danger"
        title={t('devices.retire')}
        description={retireFor !== null ? t('devices.retireSure', { name: retireFor.name, imei: retireFor.imei }) : undefined}
        confirmLabel={t('devices.retire')}
        onConfirm={() => {
          const d = retireFor
          if (d === null) return
          setRetireError(null)
          void retireDevice(d.id)
            .then(refresh)
            .catch(() => setRetireError(d.imei))
        }}
      />
      <ConfirmDialog
        open={eraseFor !== null}
        onOpenChange={(o) => {
          if (!o) setEraseForId(null)
        }}
        tone="danger"
        title={t('devices.erase')}
        description={eraseFor !== null ? t('devices.eraseSure', { name: eraseFor.name }) : undefined}
        confirmLabel={t('devices.eraseConfirm')}
        onConfirm={() => {
          const d = eraseFor
          if (d === null) return
          setEraseQueued(false)
          setEraseError(false)
          void eraseDevice(d.id)
            .then(() => setEraseQueued(true))
            .catch(() => setEraseError(true))
        }}
      />
    </div>
  )
}

/** Per-row "..." actions menu (Lovable rowAction idiom): sub-card toggles for active devices,
 * retire behind ConfirmDialog; retired devices expose GDPR erase (admin-only). */
function RowMenu({
  device,
  isAdmin,
  onHealth,
  onOnboard,
  onCommands,
  onShare,
  onRetire,
  onErase,
}: {
  device: Device
  isAdmin: boolean
  onHealth: () => void
  onOnboard: () => void
  onCommands: () => void
  onShare: () => void
  onRetire: () => void
  onErase: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const active = device.retiredAt === null
  if (!active && !isAdmin) return null // a retired device has no non-admin actions

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
          aria-label={t('devices.actions')}
          data-testid={`row-menu-${device.imei}`}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--admin-ink-soft)' }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        {active ? (
          <>
            {item(`health-${device.imei}`, t('devices.healthBtn'), onHealth)}
            {item(`onboarding-${device.imei}`, t('devices.onboard'), onOnboard)}
            {item(`commands-${device.imei}`, t('devices.commands'), onCommands)}
            {item(`share-${device.imei}`, t('devices.share.button'), onShare)}
            <div className="admin-hairline-t my-1" aria-hidden />
            {item(`retire-${device.imei}`, t('devices.retire'), onRetire, true)}
          </>
        ) : (
          item(`erase-${device.imei}`, t('devices.erase'), onErase, true)
        )}
      </PopoverContent>
    </Popover>
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

function CreateDeviceForm({
  accounts,
  profiles,
  onCreated,
  onCancel,
}: {
  accounts: { id: string; name: string }[]
  profiles: { id: string; key: string; name: string }[]
  onCreated: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [imei, setImei] = useState('')
  const [name, setName] = useState('')
  const [plate, setPlate] = useState('')
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
    createDevice({ accountId: acc, profileId: prof, imei, name, plate: plate.trim() === '' ? null : plate.trim(), odometerSource })
      .then(() => onCreated()) // parent closes the sheet; unmount resets the form
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 409 ? t('devices.dupImei') : t('devices.createError'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <Field label={t('devices.imei')}>
        <AdminInput value={imei} onChange={(e) => setImei(e.target.value)} required pattern="\d{15}" placeholder={t('devices.imeiPh')} data-testid="device-imei" />
      </Field>
      <Field label={t('devices.name')}>
        <AdminInput value={name} onChange={(e) => setName(e.target.value)} required data-testid="device-name" />
      </Field>
      <Field label={t('devices.plate')}>
        <AdminInput value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={32} data-testid="device-plate" />
      </Field>
      {/* round-2 control sweep: Comboboxes (reference app.devices form); the CSV-import e2e
          reads the default account id from the trigger's data-value */}
      <Field label={t('devices.account')}>
        <Combobox value={acc} onChange={setAccountId} data-testid="device-account" aria-label={t('devices.account')}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <Field label={t('devices.profile')}>
        <Combobox value={prof} onChange={setProfileId} data-testid="device-profile" aria-label={t('devices.profile')}
          options={profiles.map((pr) => ({ value: pr.id, label: pr.name }))} />
      </Field>
      <Field label={t('devices.odometer')}>
        <Combobox value={odometerSource} onChange={(v) => setOdometerSource(v as OdometerSource)} data-testid="device-odometer" aria-label={t('devices.odometer')}
          options={ODOMETER_SOURCES.map((src) => ({ value: src, label: t(`devices.odo.${src}`) }))} />
      </Field>
      {error !== null && (
        <p role="alert" data-testid="device-error" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</p>
      )}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy || imei === '' || name === '' || acc === '' || prof === ''} data-testid="device-create">
          {t('devices.create')}
        </AdminButton>
      </SheetFooter>
    </form>
  )
}

/** CSV import wizard (dry-run → apply) inside the header Sheet. Same flow/testids as before;
 * closing the sheet unmounts it, so each open starts a fresh wizard. */
function ImportSheetBody({ onImported }: { onImported: () => void }) {
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
    <div className="mt-2 space-y-3">
      <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('devices.import.hint')}</p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={6}
        aria-label={t('devices.import.title')}
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
  )
}
