import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminCheckbox, AdminInput, AdminLabel, AdminSwitch, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useFmt } from '@/lib/datetime'
import { createWebhook, deleteWebhook, generateSecret, listDeliveries, listWebhooks, setWebhookEnabled, WEBHOOK_EVENT_KINDS } from '@/lib/webhooks'

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

/** Webhooks (E06-4 UI): tenant-admin registers HMAC-signed delivery endpoints. The signing
 * secret is generated + shown ONCE on creation; it is redacted (`***`) in every list.
 * Rebuilt on the orbetra_design_new app.webhooks layout (ADR-028 round 2): the create form
 * lives in a right Sheet behind "Add a webhook", rows are Lovable tiles (icon chip, mono URL,
 * kind Badges), the enable toggle is the design's AdminSwitch (round-2 control sweep; the e2e
 * spec drives it via role=switch + aria-checked), delete goes through ConfirmDialog. */
export function WebhooksPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const qc = useQueryClient()
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: listWebhooks })
  const deliveries = useQuery({ queryKey: ['webhook-deliveries'], queryFn: () => listDeliveries(50) })
  const [addOpen, setAddOpen] = useState(false)
  const [freshSecret, setFreshSecret] = useState<string | null>(null)
  // delete target resolves against the LIVE list (devices precedent)
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  const deleteFor = (hooks.data ?? []).find((w) => w.id === deleteForId) ?? null

  const refresh = () => void qc.invalidateQueries({ queryKey: ['webhooks'] })
  const del = useMutation({ mutationFn: (id: string) => deleteWebhook(id), onSuccess: refresh })
  const toggle = useMutation({ mutationFn: (v: { id: string; enabled: boolean }) => setWebhookEnabled(v.id, v.enabled), onSuccess: refresh })

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('webhooks.title')} description={t('webhooks.desc')}>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton data-testid="webhook-add-open">
              <Plus className="h-4 w-4" aria-hidden />
              {t('webhooks.add')}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t('webhooks.addTitle')}</SheetTitle>
            </SheetHeader>
            {/* closing the sheet unmounts the form — each open starts a fresh draft; the
                fresh-secret banner lives OUTSIDE so it survives the sheet closing */}
            <WebhookForm
              onCreated={(secret) => {
                setFreshSecret(secret)
                setAddOpen(false)
                refresh()
              }}
              onCancel={() => setAddOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </PageHeader>

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

      {(del.isError || toggle.isError) && (
        <p role="alert" className="admin-card p-3 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="webhooks-action-error">
          {t('webhooks.actionError')}
        </p>
      )}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('webhooks.list')}
        </div>
        {hooks.isError ? (
          <p role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="webhooks-error">{t('admin.loadError')}</p>
        ) : hooks.isLoading ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="webhooks-loading">{t('admin.loading')}</p>
        ) : (hooks.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="webhooks-empty">{t('webhooks.empty')}</p>
        ) : (
          <ul data-testid="webhooks-list">
            {(hooks.data ?? []).map((w) => (
              <li key={w.id} className="admin-hairline-b flex flex-wrap items-center gap-3 p-4 text-sm last:border-b-0" data-testid={`webhook-${w.id}`}>
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={
                    w.enabled
                      ? { background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' }
                      : { background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)' }
                  }
                  aria-hidden
                >
                  <WebhookIcon className="h-4 w-4" />
                </div>
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
                <AdminSwitch
                  checked={w.enabled}
                  onCheckedChange={(v) => toggle.mutate({ id: w.id, enabled: v })}
                  label={t('webhooks.enabled')}
                  data-testid={`webhook-enabled-${w.id}`}
                />
                <button
                  type="button"
                  aria-label={t('webhooks.delete')}
                  data-testid={`webhook-del-${w.id}`}
                  className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                  style={{ color: 'var(--admin-danger)' }}
                  onClick={() => setDeleteForId(w.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('webhooks.deliveries')}
        </div>
        {deliveries.isError ? (
          <p role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="deliveries-error">{t('admin.loadError')}</p>
        ) : deliveries.isLoading ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="deliveries-loading">{t('admin.loading')}</p>
        ) : (deliveries.data ?? []).length === 0 ? (
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
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{dt(d.at)}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--admin-ink)' }}>{t(`events.k.${d.kind}`, d.kind)}</td>
                    <td className="px-4 py-2.5">
                      {/* Badge tone idiom (reference app.webhooks status cell) instead of the pre-redesign colored glyph */}
                      <Badge tone={d.success ? 'success' : 'danger'}>
                        {d.success ? '✓' : '✗'} {d.statusCode ?? t('webhooks.noResponse')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null)
        }}
        tone="danger"
        title={t('webhooks.delete')}
        description={deleteFor !== null ? t('webhooks.deleteSure', { url: deleteFor.url }) : undefined}
        confirmLabel={t('webhooks.delete')}
        onConfirm={() => {
          const w = deleteFor
          if (w === null) return
          del.mutate(w.id)
        }}
      />
    </div>
  )
}

/** Create form inside the header Sheet (devices precedent). The HMAC secret is minted
 * client-side and handed to the parent exactly once via onCreated. */
function WebhookForm({ onCreated, onCancel }: { onCreated: (secret: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [kinds, setKinds] = useState<string[]>([])

  const create = useMutation({
    mutationFn: () => {
      const secret = generateSecret()
      return createWebhook({ accountId: null, url: url.trim(), secret, events: kinds, enabled: true }).then(() => secret)
    },
    onSuccess: (secret) => onCreated(secret),
  })

  const toggleKind = (k: string) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))
  const validUrl = /^https?:\/\/.+/.test(url.trim())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!validUrl || create.isPending) return
    create.mutate()
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <div>
        <AdminLabel htmlFor="webhook-url">{t('webhooks.url')}</AdminLabel>
        <AdminInput id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" data-testid="webhook-url" className="w-full" />
      </div>
      <div>
        <div className="mb-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
          {t('webhooks.events')} <span className="opacity-70">({t('webhooks.emptyAll')})</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {WEBHOOK_EVENT_KINDS.map((k) => {
            const on = kinds.includes(k)
            return (
              <div
                key={k}
                className="flex items-center rounded-md border px-2 py-1 text-xs transition-colors"
                style={{
                  borderColor: on ? 'var(--admin-brand)' : 'var(--admin-hairline)',
                  background: on ? 'var(--admin-brand-soft)' : 'var(--admin-surface)',
                  color: 'var(--admin-ink)',
                }}
              >
                {/* design AdminCheckbox (role=checkbox + aria-checked — Playwright check() contract) */}
                <AdminCheckbox checked={on} onCheckedChange={() => toggleKind(k)} label={t(`events.k.${k}`, k)} data-testid={`webhook-kind-${k}`} />
              </div>
            )
          })}
        </div>
      </div>
      {create.isError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="webhook-error">{t('webhooks.error')}</p>
      )}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={!validUrl || create.isPending} data-testid="webhook-create">
          {t('webhooks.create')}
        </AdminButton>
      </SheetFooter>
    </form>
  )
}
