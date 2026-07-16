import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge, PageHeader } from '@/components/admin/AdminKit'
import { listAccounts } from '@/lib/devices'
import { listGeofences } from '@/lib/geofences'
import { ApiError } from '@/lib/http'
import { RULE_KINDS, channelLabel, configFields, createRule, deleteRule, listRules, parseChannel, updateRule, type NotificationChannel, type Rule, type RuleKind } from '@/lib/rules'

const selectCls = 'h-9 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--admin-brand)]/30'
const selectStyle: CSSProperties = { borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }

/** Rules CRUD (E05-3): create alert rules with kind-specific config; toggle/delete. */
export function RulesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['rules'], queryFn: listRules })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  const [actionError, setActionError] = useState(false)
  const [editChannelsId, setEditChannelsId] = useState<string | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['rules'] })
  const onActionErr = () => setActionError(true)
  // clear a stale error banner before each new toggle/delete so it isn't sticky
  const clearErr = () => setActionError(false)

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('rules.title')} description={t('rules.desc')} className="mb-0" />

      <RuleForm accounts={accounts.data ?? []} geofences={geofences.data ?? []} onCreated={refresh} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('rules.list')}</h2>
        {actionError && <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="rules-action-error">{t('rules.actionError')}</p>}
        {(rules.data ?? []).length === 0 ? (
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
                  <div className="mt-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('rules.cooldown')}: {r.cooldownS}s</div>
                </div>
                {(r.channels ?? []).length > 0
                  ? <Badge tone="neutral" data-testid={`rule-ch-count-${r.id}`}>{t('rules.channels.count', { n: r.channels.length })}</Badge>
                  : <span className="text-xs" style={{ color: 'var(--admin-warning)' }} data-testid={`rule-ch-none-${r.id}`}>{t('rules.channels.none')}</span>}
                <AdminButton variant="ghost" size="sm" data-testid={`rule-ch-edit-btn-${r.id}`} onClick={() => setEditChannelsId((cur) => (cur === r.id ? null : r.id))}>{t('rules.channels.edit')}</AdminButton>
                {/* enable toggle stays a real <input type=checkbox> (e2e pins rule-enabled-{id}) — styled, not swapped */}
                <label className="flex cursor-pointer items-center gap-1.5 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  <input
                    type="checkbox" checked={r.enabled} data-testid={`rule-enabled-${r.id}`}
                    className="h-4 w-4 cursor-pointer rounded accent-[var(--admin-brand)]"
                    onChange={(e) => { clearErr(); void updateRule(r.id, { enabled: e.target.checked }).then(refresh).catch(onActionErr) }}
                  />
                  {t('rules.enabled')}
                </label>
                <AdminButton variant="ghost" size="sm" style={{ background: 'transparent', color: 'var(--admin-danger)' }} data-testid={`rule-del-${r.id}`} onClick={() => { clearErr(); void deleteRule(r.id).then(refresh).catch(onActionErr) }}>{t('rules.delete')}</AdminButton>
                {editChannelsId === r.id && <RuleChannelsEdit rule={r} onSaved={refresh} onCancel={() => setEditChannelsId(null)} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function RuleForm({ accounts, geofences, onCreated }: { accounts: { id: string; name: string }[]; geofences: { id: string; name: string }[]; onCreated: () => void }) {
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
      .then(() => { setName(''); setCfg({}); setChannels([]); onCreated() })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 400 ? t('rules.invalid') : t('rules.error')))
      .finally(() => setBusy(false))
  }

  return (
    <div className="admin-card p-4 md:p-5">
      <h2 className="mb-3 font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('rules.add')}</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label={t('rules.kindLabel')}>
          <select value={kind} onChange={(e) => { setKind(e.target.value as RuleKind); setCfg({}) }} data-testid="rule-kind" className={selectCls} style={selectStyle}>
            {RULE_KINDS.map((k) => <option key={k} value={k}>{t(`rules.kind.${k}`)}</option>)}
          </select>
        </Field>
        <Field label={t('rules.name')}>
          <AdminInput value={name} onChange={(e) => setName(e.target.value)} required data-testid="rule-name" className="w-40" />
        </Field>
        {accounts.length > 1 && (
          <Field label={t('rules.account')}>
            <select value={acc} onChange={(e) => setAccountId(e.target.value)} data-testid="rule-account" className={selectCls} style={selectStyle}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {fields.map((f) => (
          <Field key={f.key} label={t(`rules.cfg.${f.key}`)}>
            {f.type === 'select' && f.key === 'geofenceId' ? (
              <select value={cfg[f.key] ?? ''} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} data-testid={`rule-cfg-${f.key}`} className={selectCls} style={selectStyle}>
                <option value="">—</option>
                {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            ) : f.type === 'select' ? (
              <select value={cfg[f.key] ?? String(f.default)} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} data-testid={`rule-cfg-${f.key}`} className={selectCls} style={selectStyle}>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
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
        <AdminButton type="submit" disabled={busy || name.trim() === '' || acc === '' || missingGeofence} data-testid="rule-create">{t('rules.create')}</AdminButton>
        {missingGeofence && <p className="w-full text-xs" style={{ color: 'var(--admin-warning)' }} data-testid="rule-need-geofence">{t('rules.needGeofence')}</p>}
        {error !== null && <p role="alert" className="w-full text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</p>}
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{label}{children}</label>
}

/** Reusable notification-channel editor (E05-5): add/remove email/telegram targets. Owns its draft
 * (type/value/error); the committed `channels` list is lifted via `onChange`. Used by the create
 * form and the per-rule inline editor. */
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
        <select value={type} onChange={(e) => { setType(e.target.value as 'email' | 'telegram' | 'webpush'); setErr(false) }} data-testid="rule-ch-type" className={selectCls} style={selectStyle}>
          <option value="email">{t('rules.channels.email')}</option>
          <option value="telegram">{t('rules.channels.telegram')}</option>
          <option value="webpush">{t('rules.channels.webpush')}</option>
        </select>
        {type !== 'webpush' && (
          <AdminInput
            value={value}
            onChange={(e) => { setValue(e.target.value); setErr(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            placeholder={type === 'email' ? t('rules.channels.emailPlaceholder') : t('rules.channels.telegramPlaceholder')}
            data-testid="rule-ch-value" className="w-52"
          />
        )}
        <AdminButton variant="ghost" size="sm" onClick={add} data-testid="rule-ch-add">{t('rules.channels.add')}</AdminButton>
      </div>
      {err && <span className="text-xs" style={{ color: 'var(--admin-danger)' }} data-testid="rule-ch-error">{t('rules.channels.invalid')}</span>}
      {channels.length > 0 && (
        <ul className="flex flex-wrap gap-1" data-testid="rule-ch-list">
          {channels.map((c) => (
            <li key={channelLabel(c)}>
              <Badge tone="neutral" className="gap-1">
                {channelLabel(c)}
                <button type="button" className="opacity-70 transition-opacity hover:opacity-100 hover:text-[var(--admin-danger)]" data-testid={`rule-ch-remove-${channelLabel(c)}`} onClick={() => onChange(channels.filter((x) => channelLabel(x) !== channelLabel(c)))}>×</button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Per-rule inline channel editor: expands from the list, saves via updateRule({ channels }). */
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
    <div className="mt-2 w-full rounded-md border p-3" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }} data-testid={`rule-ch-edit-${rule.id}`}>
      <ChannelsEditor channels={channels} onChange={setChannels} />
      <div className="mt-2 flex items-center gap-2">
        <AdminButton size="sm" disabled={busy} data-testid={`rule-ch-save-${rule.id}`} onClick={save}>{t('rules.channels.save')}</AdminButton>
        <AdminButton size="sm" variant="ghost" onClick={onCancel}>{t('rules.channels.cancel')}</AdminButton>
        {error && <span className="text-xs" style={{ color: 'var(--admin-danger)' }}>{t('rules.error')}</span>}
      </div>
    </div>
  )
}
