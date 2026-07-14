import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { listAccounts } from '@/lib/devices'
import { listGeofences } from '@/lib/geofences'
import { ApiError } from '@/lib/http'
import { RULE_KINDS, channelLabel, configFields, createRule, deleteRule, listRules, parseChannel, updateRule, type NotificationChannel, type RuleKind } from '@/lib/rules'

/** Rules CRUD (E05-3): create alert rules with kind-specific config; toggle/delete. */
export function RulesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['rules'], queryFn: listRules })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  const [actionError, setActionError] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['rules'] })
  const onActionErr = () => setActionError(true)
  // clear a stale error banner before each new toggle/delete so it isn't sticky
  const clearErr = () => setActionError(false)

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t('rules.title')}</h1>

      <RuleForm accounts={accounts.data ?? []} geofences={geofences.data ?? []} onCreated={refresh} />

      <Card>
        <CardHeader><CardTitle className="text-base">{t('rules.list')}</CardTitle></CardHeader>
        <CardContent>
          {actionError && <p role="alert" className="mb-2 text-sm text-danger" data-testid="rules-action-error">{t('rules.actionError')}</p>}
          {(rules.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted" data-testid="rules-empty">{t('rules.empty')}</p>
          ) : (
            <ul className="space-y-2" data-testid="rules-list">
              {(rules.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-card border border-line p-2 text-sm" data-testid={`rule-${r.id}`}>
                  <Badge variant="outline">{t(`rules.kind.${r.kind}`)}</Badge>
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="text-xs text-muted">{t('rules.cooldown')}: {r.cooldownS}s</span>
                  {(r.channels ?? []).length > 0
                    ? <Badge variant="outline" data-testid={`rule-ch-count-${r.id}`}>{t('rules.channels.count', { n: r.channels.length })}</Badge>
                    : <span className="text-xs text-warn" data-testid={`rule-ch-none-${r.id}`}>{t('rules.channels.none')}</span>}
                  <label className="ml-auto flex items-center gap-1 text-xs text-muted">
                    <input
                      type="checkbox" checked={r.enabled} data-testid={`rule-enabled-${r.id}`}
                      onChange={(e) => { clearErr(); void updateRule(r.id, { enabled: e.target.checked }).then(refresh).catch(onActionErr) }}
                    />
                    {t('rules.enabled')}
                  </label>
                  <Button variant="ghost" size="sm" data-testid={`rule-del-${r.id}`} onClick={() => { clearErr(); void deleteRule(r.id).then(refresh).catch(onActionErr) }}>{t('rules.delete')}</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
  const [chType, setChType] = useState<'email' | 'telegram'>('email')
  const [chValue, setChValue] = useState('')
  const [chError, setChError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const addChannel = () => {
    const parsed = parseChannel(chType, chValue)
    if (parsed === null) { setChError(true); return }
    // dedupe identical targets so a rule doesn't email the same address twice
    setChannels((cs) => (cs.some((c) => channelLabel(c) === channelLabel(parsed)) ? cs : [...cs, parsed]))
    setChValue(''); setChError(false)
  }

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
    <Card>
      <CardHeader><CardTitle className="text-base">{t('rules.add')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <Field label={t('rules.kindLabel')}>
            <select value={kind} onChange={(e) => { setKind(e.target.value as RuleKind); setCfg({}) }} data-testid="rule-kind" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
              {RULE_KINDS.map((k) => <option key={k} value={k}>{t(`rules.kind.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('rules.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="rule-name" className="w-40" />
          </Field>
          {accounts.length > 1 && (
            <Field label={t('rules.account')}>
              <select value={acc} onChange={(e) => setAccountId(e.target.value)} data-testid="rule-account" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          {fields.map((f) => (
            <Field key={f.key} label={t(`rules.cfg.${f.key}`)}>
              {f.type === 'select' && f.key === 'geofenceId' ? (
                <select value={cfg[f.key] ?? ''} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} data-testid={`rule-cfg-${f.key}`} className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                  <option value="">—</option>
                  {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              ) : f.type === 'select' ? (
                <select value={cfg[f.key] ?? String(f.default)} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} data-testid={`rule-cfg-${f.key}`} className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <Input type="number" min={f.min} max={f.max} value={cfg[f.key] ?? String(f.default)} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} data-testid={`rule-cfg-${f.key}`} className="w-28" />
              )}
            </Field>
          ))}
          <Field label={t('rules.cooldown')}>
            <Input type="number" min={0} max={86_400} value={cooldownS} onChange={(e) => setCooldownS(Number(e.target.value))} data-testid="rule-cooldown" className="w-24" />
          </Field>
          {/* notification channels (E05-5) — email needs SES configured on the worker; telegram
              needs the bot token + pairing. Without a channel the rule fires an event but sends nothing. */}
          <div className="flex w-full flex-col gap-1">
            <span className="text-xs text-muted">{t('rules.channels.label')}</span>
            <div className="flex flex-wrap items-end gap-2">
              <select value={chType} onChange={(e) => { setChType(e.target.value as 'email' | 'telegram'); setChError(false) }} data-testid="rule-ch-type" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                <option value="email">{t('rules.channels.email')}</option>
                <option value="telegram">{t('rules.channels.telegram')}</option>
              </select>
              <Input
                value={chValue}
                onChange={(e) => { setChValue(e.target.value); setChError(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChannel() } }}
                placeholder={chType === 'email' ? t('rules.channels.emailPlaceholder') : t('rules.channels.telegramPlaceholder')}
                data-testid="rule-ch-value" className="w-52"
              />
              <Button type="button" variant="ghost" size="sm" onClick={addChannel} data-testid="rule-ch-add">{t('rules.channels.add')}</Button>
            </div>
            {chError && <span className="text-xs text-danger" data-testid="rule-ch-error">{t('rules.channels.invalid')}</span>}
            {channels.length > 0 && (
              <ul className="flex flex-wrap gap-1" data-testid="rule-ch-list">
                {channels.map((c) => (
                  <li key={channelLabel(c)}>
                    <Badge variant="outline" className="gap-1">
                      {channelLabel(c)}
                      <button type="button" className="text-muted hover:text-danger" data-testid={`rule-ch-remove-${channelLabel(c)}`} onClick={() => setChannels((cs) => cs.filter((x) => channelLabel(x) !== channelLabel(c)))}>×</button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="submit" disabled={busy || name.trim() === '' || acc === '' || missingGeofence} data-testid="rule-create">{t('rules.create')}</Button>
          {missingGeofence && <p className="w-full text-xs text-warn" data-testid="rule-need-geofence">{t('rules.needGeofence')}</p>}
          {error !== null && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
        </form>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-muted">{label}{children}</label>
}
