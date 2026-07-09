import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createWebhook, deleteWebhook, generateSecret, listWebhooks, setWebhookEnabled, WEBHOOK_EVENT_KINDS } from '@/lib/webhooks'

/** Webhooks (E06-4 UI): tenant-admin registers HMAC-signed delivery endpoints. The signing
 * secret is generated + shown ONCE on creation; it is redacted (`***`) in every list. */
export function WebhooksPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: listWebhooks })
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
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t('webhooks.title')}</h1>

      {freshSecret !== null && (
        <Card className="border-accent" data-testid="webhook-fresh">
          <CardHeader><CardTitle className="text-base">{t('webhooks.created')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-warn">{t('webhooks.secretOnce')}</p>
            <code className="block overflow-x-auto rounded-card border border-line bg-surface p-2 text-xs" data-testid="webhook-secret">{freshSecret}</code>
            <Button size="sm" variant="ghost" onClick={() => setFreshSecret(null)} data-testid="webhook-dismiss">{t('webhooks.dismiss')}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('webhooks.add')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('webhooks.url')}
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" data-testid="webhook-url" className="w-full max-w-md" />
          </label>
          <div>
            <div className="pb-1 text-xs text-muted">{t('webhooks.events')} <span className="opacity-70">({t('webhooks.emptyAll')})</span></div>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENT_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1 rounded-card border border-line px-2 py-1 text-xs">
                  <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} data-testid={`webhook-kind-${k}`} />
                  {t(`events.k.${k}`, k)}
                </label>
              ))}
            </div>
          </div>
          <Button disabled={!validUrl || create.isPending} onClick={() => create.mutate()} data-testid="webhook-create">{t('webhooks.create')}</Button>
          {create.isError && <p role="alert" className="text-sm text-danger" data-testid="webhook-error">{t('webhooks.error')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('webhooks.list')}</CardTitle></CardHeader>
        <CardContent>
          {(hooks.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted" data-testid="webhooks-empty">{t('webhooks.empty')}</p>
          ) : (
            <ul className="space-y-2" data-testid="webhooks-list">
              {(hooks.data ?? []).map((w) => (
                <li key={w.id} className="flex items-center gap-3 rounded-card border border-line p-2 text-sm" data-testid={`webhook-${w.id}`}>
                  <code className="truncate text-xs">{w.url}</code>
                  <span className="text-xs text-muted">{w.events.length === 0 ? t('webhooks.allKinds') : w.events.map((k) => t(`events.k.${k}`, k)).join(', ')}</span>
                  <label className="ml-auto flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" checked={w.enabled} data-testid={`webhook-enabled-${w.id}`} onChange={(e) => toggle.mutate({ id: w.id, enabled: e.target.checked })} />
                    {t('webhooks.enabled')}
                  </label>
                  <Button variant="ghost" size="sm" data-testid={`webhook-del-${w.id}`} onClick={() => del.mutate(w.id)}>{t('webhooks.delete')}</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
