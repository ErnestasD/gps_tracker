import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminSwitch, Badge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { getCurrentUser } from '@/lib/auth'
import { listAccounts } from '@/lib/devices'
import { listGeofences } from '@/lib/geofences'
import { ApiError } from '@/lib/http'
import { RULE_KINDS, channelDisplay, channelLabel, configFields, createRule, deleteRule, listRules, parseChannel, updateRule, type NotificationChannel, type Rule, type RuleKind } from '@/lib/rules'

/** Rules CRUD (E05-3), rebuilt on the orbetra_design_new app.rules layout (ADR-028 round 2):
 * the create form lives in a right Sheet behind "Add rule", the list is Lovable card rows
 * (kind Badge + name, cooldown/account meta line, channel Badges), the enable toggle is the
 * design's AdminSwitch (round-2 control sweep; e2e drives it via role=switch + aria-checked),
 * and delete goes through a danger ConfirmDialog. Channel editing follows the drivers
 * precedent: a per-row "..." menu opens the page-level edit Sheet (rule-ch-* testids kept). */
export function RulesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // rule writes require account_manager+ (WRITE_POLICY.rule) — viewers get 403s, so hide the
  // write affordances (drivers/maintenance canWrite precedent). Reads stay open to all roles.
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const rules = useQuery({ queryKey: ['rules'], queryFn: listRules })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  const [addOpen, setAddOpen] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [editChannelsId, setEditChannelsId] = useState<string | null>(null)
  // delete/edit targets resolve against the LIVE list (devices precedent) — a refetch never
  // leaves the confirm or the channels Sheet pointed at a stale snapshot
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  const deleteFor = (rules.data ?? []).find((r) => r.id === deleteForId) ?? null
  const editChannelsFor = (rules.data ?? []).find((r) => r.id === editChannelsId) ?? null
  const refresh = () => void qc.invalidateQueries({ queryKey: ['rules'] })
  const onActionErr = () => setActionError(true)
  // clear a stale error banner before each new toggle/delete so it isn't sticky
  const clearErr = () => setActionError(false)

  const showAccount = (accounts.data ?? []).length > 1
  const accountName = (id: string | null) => (accounts.data ?? []).find((a) => a.id === id)?.name ?? null

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('rules.title')} description={t('rules.desc')} className="mb-0">
        {canWrite && (
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton data-testid="rule-add-open">
              <Plus className="h-4 w-4" aria-hidden />
              {t('rules.add')}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t('rules.addTitle')}</SheetTitle>
            </SheetHeader>
            {/* closing the sheet unmounts the form, so each open starts a fresh draft */}
            <RuleForm
              accounts={accounts.data ?? []}
              geofences={geofences.data ?? []}
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('rules.list')}</h2>
        {actionError && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="rules-action-error">{t('rules.actionError')}</p>}
        {rules.isError ? (
          <div className="admin-card">
            <p role="alert" className="py-10 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="rules-error">{t('admin.loadError')}</p>
          </div>
        ) : rules.isLoading ? (
          <div className="admin-card">
            <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="rules-loading">{t('admin.loading')}</p>
          </div>
        ) : (rules.data ?? []).length === 0 ? (
          <div className="admin-card">
            <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="rules-empty">{t('rules.empty')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="rules-list">
            {(rules.data ?? []).map((r) => (
              <li key={r.id} className="admin-card flex flex-wrap items-center gap-3 p-3 md:p-4" data-testid={`rule-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{t(`rules.kind.${r.kind}`)}</Badge>
                    <span className="truncate text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{r.name}</span>
                  </div>
                  {/* meta line (reference: cooldown · scope): the account segment shows which
                      account a rule targets on multi-account tenants; the reference's
                      triggered(30d) count has no API counterpart (no-mock-data) */}
                  <div className="mt-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                    {t('rules.cooldown')}: {t('rules.cooldownValue', { s: r.cooldownS })}
                    {showAccount && accountName(r.accountId) !== null && <> · {t('rules.account')}: {accountName(r.accountId)}</>}
                  </div>
                </div>
                {(r.channels ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1" data-testid={`rule-ch-count-${r.id}`}>
                    {r.channels.map((c) => <Badge key={channelLabel(c)} tone="neutral">{channelDisplay(t, c)}</Badge>)}
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--admin-warning)' }} data-testid={`rule-ch-none-${r.id}`}>{t('rules.channels.none')}</span>
                )}
                {/* enable toggle: AdminSwitch reflects SERVER state — it only flips after the
                    PATCH + refetch round-trips (e2e polls aria-checked on role=switch). Write
                    controls are hidden for viewers (WRITE_POLICY.rule 403s them). */}
                {canWrite && (
                  <>
                    <AdminSwitch
                      checked={r.enabled}
                      data-testid={`rule-enabled-${r.id}`}
                      label={t('rules.enabled')}
                      onCheckedChange={(v) => { clearErr(); void updateRule(r.id, { enabled: v }).then(refresh).catch(onActionErr) }}
                    />
                    <button
                      type="button"
                      aria-label={t('rules.delete')}
                      data-testid={`rule-del-${r.id}`}
                      className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                      style={{ color: 'var(--admin-danger)' }}
                      onClick={() => setDeleteForId(r.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                    <RuleRowMenu rule={r} onEditChannels={() => setEditChannelsId(r.id)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* channels edit-in-Sheet (drivers precedent: row menu → page-level Sheet, prefilled);
          key remounts the editor per rule so channel drafts never leak across targets */}
      <Sheet
        open={editChannelsFor !== null}
        onOpenChange={(o) => {
          if (!o) setEditChannelsId(null)
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('rules.channels.edit')}</SheetTitle>
          </SheetHeader>
          {editChannelsFor !== null && (
            <RuleChannelsEdit key={editChannelsFor.id} rule={editChannelsFor} onSaved={refresh} onCancel={() => setEditChannelsId(null)} />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null)
        }}
        tone="danger"
        title={t('rules.delete')}
        description={deleteFor !== null ? t('rules.deleteSure', { name: deleteFor.name }) : undefined}
        confirmLabel={t('rules.delete')}
        onConfirm={() => {
          const r = deleteFor
          if (r === null) return
          clearErr()
          void deleteRule(r.id).then(refresh).catch(onActionErr)
        }}
      />
    </div>
  )
}

/** Per-row "..." actions menu (devices/drivers precedent): channel editing opens the
 * page-level Sheet prefilled. Delete stays the inline danger icon (reference idiom). */
function RuleRowMenu({ rule, onEditChannels }: { rule: Rule; onEditChannels: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('rules.actions')}
          data-testid={`rule-menu-${rule.id}`}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--admin-ink-soft)' }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <button
          type="button"
          data-testid={`rule-ch-edit-btn-${rule.id}`}
          onClick={() => {
            setOpen(false)
            onEditChannels()
          }}
          className="block w-full rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--admin-surface-sunken)]"
          style={{ color: 'var(--admin-ink)' }}
        >
          {t('rules.channels.edit')}
        </button>
      </PopoverContent>
    </Popover>
  )
}

/** Create form inside the header Sheet (devices precedent): vertical fields, all rule-* testids
 * kept (selects became Comboboxes in the round-2 control sweep — testids sit on the triggers);
 * Cancel/Create sit in the SheetFooter. */
function RuleForm({ accounts, geofences, onCreated, onCancel }: {
  accounts: { id: string; name: string }[]
  geofences: { id: string; name: string }[]
  onCreated: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<RuleKind>('overspeed')
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [cooldownS, setCooldownS] = useState(300)
  const [cfg, setCfg] = useState<Record<string, string>>({})
  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fields = useMemo(() => configFields(kind), [kind])
  const acc = accountId || accounts[0]?.id || ''
  // a geofence rule needs a target fence — else it can never fire (review MED)
  const missingGeofence = kind === 'geofence' && !cfg['geofenceId']

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || missingGeofence) return
    setError(null)
    setBusy(true)
    // coerce config values to the field's type; an empty field falls back to the default
    const config: Record<string, unknown> = {}
    for (const f of fields) {
      const raw = cfg[f.key]
      const val = raw === undefined || raw === '' ? f.default : raw
      config[f.key] = f.type === 'number' ? Number(val) : val
    }
    createRule({ accountId: acc, kind, name: name.trim(), config, cooldownS, enabled: true, ...(channels.length > 0 ? { channels } : {}) })
      .then(() => onCreated()) // parent closes the sheet; unmount resets the form
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 400 ? t('rules.invalid') : t('rules.error')))
      .finally(() => setBusy(false))
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <Field label={t('rules.kindLabel')}>
        <Combobox
          value={kind}
          onChange={(v) => { setKind(v as RuleKind); setCfg({}) }}
          data-testid="rule-kind"
          aria-label={t('rules.kindLabel')}
          options={RULE_KINDS.map((k) => ({ value: k, label: t(`rules.kind.${k}`) }))}
        />
      </Field>
      <Field label={t('rules.name')}>
        <AdminInput value={name} onChange={(e) => setName(e.target.value)} required data-testid="rule-name" />
      </Field>
      {accounts.length > 1 && (
        <Field label={t('rules.account')}>
          <Combobox
            value={acc}
            onChange={setAccountId}
            data-testid="rule-account"
            aria-label={t('rules.account')}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      )}
      {fields.map((f) => (
        <Field key={f.key} label={t(`rules.cfg.${f.key}`)}>
          {f.type === 'select' && f.key === 'geofenceId' ? (
            <Combobox
              value={cfg[f.key] ?? ''}
              onChange={(v) => setCfg((c) => ({ ...c, [f.key]: v }))}
              data-testid={`rule-cfg-${f.key}`}
              aria-label={t(`rules.cfg.${f.key}`)}
              options={[{ value: '', label: '—' }, ...geofences.map((g) => ({ value: g.id, label: g.name }))]}
            />
          ) : f.type === 'select' ? (
            <Combobox
              value={cfg[f.key] ?? String(f.default)}
              onChange={(v) => setCfg((c) => ({ ...c, [f.key]: v }))}
              data-testid={`rule-cfg-${f.key}`}
              aria-label={t(`rules.cfg.${f.key}`)}
              // localize the option LABELS (enter/exit/both) while keeping the stored VALUES intact
              options={(f.options ?? []).map((o) => ({ value: o, label: t(`rules.cfgOpt.${f.key}.${o}`, o) }))}
            />
          ) : (
            <AdminInput type="number" min={f.min} max={f.max} value={cfg[f.key] ?? String(f.default)} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} data-testid={`rule-cfg-${f.key}`} className="w-28" />
          )}
        </Field>
      ))}
      <Field label={t('rules.cooldown')}>
        <AdminInput type="number" min={0} max={86_400} value={cooldownS} onChange={(e) => setCooldownS(Number(e.target.value))} data-testid="rule-cooldown" className="w-24" />
      </Field>
      {/* notification channels (E05-5) — email needs SES configured on the worker; telegram
          needs the bot token + pairing. Without a channel the rule fires an event but sends nothing. */}
      <ChannelsEditor channels={channels} onChange={setChannels} />
      {missingGeofence && <p className="text-xs" style={{ color: 'var(--admin-warning)' }} data-testid="rule-need-geofence">{t('rules.needGeofence')}</p>}
      {error !== null && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</p>}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={busy || name.trim() === '' || acc === '' || missingGeofence} data-testid="rule-create">{t('rules.create')}</AdminButton>
      </SheetFooter>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{label}{children}</label>
}

/** Reusable notification-channel editor (E05-5): add/remove email/telegram targets. Owns its draft
 * (type/value/error); the committed `channels` list is lifted via `onChange`. Used by the create
 * form and the per-rule edit Sheet. */
function ChannelsEditor({ channels, onChange }: { channels: NotificationChannel[]; onChange: (c: NotificationChannel[]) => void }) {
  const { t } = useTranslation()
  const [type, setType] = useState<'email' | 'telegram' | 'webpush'>('email')
  const [value, setValue] = useState('')
  const [err, setErr] = useState(false)

  const add = () => {
    // webpush carries no target — it fans out to the account's browser subscriptions (ADR-026)
    const parsed: NotificationChannel | null = type === 'webpush' ? { type: 'webpush' } : parseChannel(type, value)
    if (parsed === null) { setErr(true); return }
    // dedupe identical targets so a rule doesn't notify the same address twice
    if (!channels.some((c) => channelLabel(c) === channelLabel(parsed))) onChange([...channels, parsed])
    setValue(''); setErr(false)
  }

  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('rules.channels.label')}</span>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <Combobox
            aria-label={t('rules.channels.label')}
            value={type}
            onChange={(v) => { setType(v as 'email' | 'telegram' | 'webpush'); setErr(false) }}
            data-testid="rule-ch-type"
            options={[
              { value: 'email', label: t('rules.channels.email') },
              { value: 'telegram', label: t('rules.channels.telegram') },
              { value: 'webpush', label: t('rules.channels.webpush') },
            ]}
          />
        </div>
        {type !== 'webpush' && (
          <AdminInput
            value={value}
            onChange={(e) => { setValue(e.target.value); setErr(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            aria-label={type === 'email' ? t('rules.channels.email') : t('rules.channels.telegram')}
            placeholder={type === 'email' ? t('rules.channels.emailPlaceholder') : t('rules.channels.telegramPlaceholder')}
            data-testid="rule-ch-value" className="w-52"
          />
        )}
        <AdminButton variant="ghost" size="sm" onClick={add} data-testid="rule-ch-add">{t('rules.channels.add')}</AdminButton>
      </div>
      {err && <span role="alert" className="text-xs" style={{ color: 'var(--admin-danger)' }} data-testid="rule-ch-error">{t('rules.channels.invalid')}</span>}
      {channels.length > 0 && (
        <ul className="flex flex-wrap gap-1" data-testid="rule-ch-list">
          {channels.map((c) => (
            <li key={channelLabel(c)}>
              <Badge tone="neutral" className="gap-1">
                {channelDisplay(t, c)}
                {/* dedupe key + testid stay on the PURE channelLabel — locale changes must not move testids */}
                <button type="button" aria-label={t('rules.channels.remove', { target: channelDisplay(t, c) })} className="opacity-70 transition-opacity hover:opacity-100 hover:text-[var(--admin-danger)]" data-testid={`rule-ch-remove-${channelLabel(c)}`} onClick={() => onChange(channels.filter((x) => channelLabel(x) !== channelLabel(c)))}>×</button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Per-rule channel editor body inside the page-level Sheet: prefilled from the LIVE rule,
 * saves via updateRule({ channels }). rule-ch-edit-{id} / rule-ch-save-{id} testids kept on the
 * Sheet body / save button. */
function RuleChannelsEdit({ rule, onSaved, onCancel }: { rule: Rule; onSaved: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [channels, setChannels] = useState<NotificationChannel[]>(rule.channels ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const save = () => {
    setBusy(true); setError(false)
    updateRule(rule.id, { channels }).then(() => { onSaved(); onCancel() }).catch(() => setError(true)).finally(() => setBusy(false))
  }
  return (
    <div className="mt-2 flex flex-col gap-3" data-testid={`rule-ch-edit-${rule.id}`}>
      <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{rule.name}</p>
      <ChannelsEditor channels={channels} onChange={setChannels} />
      {error && <span role="alert" className="text-xs" style={{ color: 'var(--admin-danger)' }}>{t('rules.error')}</span>}
      <SheetFooter className="mt-2">
        <AdminButton size="sm" variant="secondary" onClick={onCancel}>{t('rules.channels.cancel')}</AdminButton>
        <AdminButton size="sm" disabled={busy} data-testid={`rule-ch-save-${rule.id}`} onClick={save}>{t('rules.channels.save')}</AdminButton>
      </SheetFooter>
    </div>
  )
}
