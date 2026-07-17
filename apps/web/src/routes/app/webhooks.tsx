import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from '@/components/admin/AdminKit'
import { createWebhook, deleteWebhook, generateSecret, listDeliveries, listWebhooks, setWebhookEnabled, WEBHOOK_EVENT_KINDS } from '@/lib/webhooks'

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' })

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }
// native checkboxes stay native (e2e drives them via role=checkbox); accent-color themes them
const checkboxStyle: React.CSSProperties = { accentColor: 'var(--admin-brand)' }

/** Webhooks (E06-4 UI): tenant-admin registers HMAC-signed delivery endpoints. The signing
 * secret is generated + shown ONCE on creation; it is redacted (`***`) in every list.
 * Re-skinned onto the admin design (ADR-028): PageHeader + admin-card list/table idiom. */
export function WebhooksPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: listWebhooks })
  const deliveries = useQuery({ queryKey: ['webhook-deliveries'], queryFn: () => listDeliveries(50) })
  const [url, setUrl] = useState('')
  const [kinds, setKinds] = useState<string[]>([])
  const [freshSecret, setFreshSecret] = useState<string | null>(null)

  const refresh = () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  const create = useMutation({
    mutationFn: () => {
      const secret = generateSecret()
      return createWebhook({ accountId: null, url: url.trim(), secret, events: kinds, enabled: true }).then(() => secret)
    },
    onSuccess: (secret) => {
      setFreshSecret(secret)
      setUrl('')
      setKinds([])
      refresh()
    },
  })
  const del = useMutation({ mutationFn: (id: string) => deleteWebhook(id), onSuccess: refresh })
  const toggle = useMutation({ mutationFn: (v: { id: string; enabled: boolean }) => setWebhookEnabled(v.id, v.enabled), onSuccess: refresh })

  const toggleKind = (k: string) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))
  const validUrl = /^https?:\/\/.+/.test(url.trim())

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('webhooks.title')} description={t('webhooks.desc')} />

      {freshSecret !== null && (
        <div className="admin-card p-4" style={{ background: 'var(--admin-brand-soft)', borderColor: 'var(--admin-brand)' }} data-testid="webhook-fresh">
          <div className="mb-2 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('webhooks.created')}</div>
          <p className="mb-2 text-sm" style={{ color: 'var(--admin-warning)' }}>{t('webhooks.secretOnce')}</p>
          <code
            className="mono block overflow-x-auto rounded-md border p-2 text-xs"
            style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}
            data-testid="webhook-secret"
          >
            {freshSecret}
          </code>
          <AdminButton size="sm" variant="ghost" className="mt-2" onClick={() => setFreshSecret(null)} data-testid="webhook-dismiss">
            {t('webhooks.dismiss')}
          </AdminButton>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('webhooks.add')}
        </div>
        <div className="space-y-3 p-4">
          <div>
            <AdminLabel htmlFor="webhook-url">{t('webhooks.url')}</AdminLabel>
            <AdminInput id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" data-testid="webhook-url" className="w-full max-w-md" />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
              {t('webhooks.events')} <span className="opacity-70">({t('webhooks.emptyAll')})</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENT_KINDS.map((k) => {
                const on = kinds.includes(k)
                return (
                  <label
                    key={k}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors"
                    style={{
                      borderColor: on ? 'var(--admin-brand)' : 'var(--admin-hairline)',
                      background: on ? 'var(--admin-brand-soft)' : 'var(--admin-surface)',
                      color: 'var(--admin-ink)',
                    }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleKind(k)} style={checkboxStyle} data-testid={`webhook-kind-${k}`} />
                    {t(`events.k.${k}`, k)}
                  </label>
                )
              })}
            </div>
          </div>
          <AdminButton disabled={!validUrl || create.isPending} onClick={() => create.mutate()} data-testid="webhook-create">
            {t('webhooks.create')}
          </AdminButton>
          {create.isError && (
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="webhook-error">{t('webhooks.error')}</p>
          )}
        </div>
      </div>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('webhooks.list')}
        </div>
        {(hooks.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="webhooks-empty">{t('webhooks.empty')}</p>
        ) : (
          <ul data-testid="webhooks-list">
            {(hooks.data ?? []).map((w) => (
              <li key={w.id} className="admin-hairline-b flex flex-wrap items-center gap-3 p-4 text-sm last:border-b-0" data-testid={`webhook-${w.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="mono truncate text-sm" style={{ color: 'var(--admin-ink)' }}>{w.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.events.length === 0 ? (
                      <Badge tone="neutral">{t('webhooks.allKinds')}</Badge>
                    ) : (
                      w.events.map((k) => <Badge key={k} tone="neutral">{t(`events.k.${k}`, k)}</Badge>)
                    )}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    style={checkboxStyle}
                    data-testid={`webhook-enabled-${w.id}`}
                    onChange={(e) => toggle.mutate({ id: w.id, enabled: e.target.checked })}
                  />
                  {t('webhooks.enabled')}
                </label>
                <AdminButton variant="ghost" size="sm" style={{ color: 'var(--admin-danger)' }} data-testid={`webhook-del-${w.id}`} onClick={() => del.mutate(w.id)}>
                  {t('webhooks.delete')}
                </AdminButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('webhooks.deliveries')}
        </div>
        {(deliveries.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="deliveries-empty">{t('webhooks.noDeliveries')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="deliveries-table">
              <thead>
                <tr style={{ background: 'var(--admin-surface-sunken)' }}>
                  <th className={th} style={thStyle}>{t('webhooks.when')}</th>
                  <th className={th} style={thStyle}>{t('webhooks.event')}</th>
                  <th className={th} style={thStyle}>{t('webhooks.status')}</th>
                </tr>
              </thead>
              <tbody>
                {(deliveries.data ?? []).map((d) => (
                  <tr key={d.id} className="admin-hairline-b transition-colors last:border-b-0 hover:bg-[var(--admin-surface-sunken)]" data-testid="delivery-row">
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{fmt.format(new Date(d.at))}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--admin-ink)' }}>{t(`events.k.${d.kind}`, d.kind)}</td>
                    <td className="px-4 py-2.5">
                      <span style={{ color: d.success ? 'var(--admin-success)' : 'var(--admin-danger)' }}>
                        {d.success ? '✓' : '✗'} {d.statusCode ?? t('webhooks.noResponse')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
