import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/apiKeys'
import { listAccounts } from '@/lib/devices'

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** API keys (E06-3 UI): tenant-admin mints read-only integration keys. The plaintext key is
 * shown ONCE on creation — the operator must copy it before dismissing. */
export function ApiKeysPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: listApiKeys })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const [name, setName] = useState('')
  const [account, setAccount] = useState('')
  const [fresh, setFresh] = useState<string | null>(null) // the just-minted plaintext key
  const [copied, setCopied] = useState(false)

  const refresh = () => void qc.invalidateQueries({ queryKey: ['api-keys'] })
  const create = useMutation({
    mutationFn: () => createApiKey({ name: name.trim(), ...(account ? { accountId: account } : {}) }),
    onSuccess: (k) => {
      setFresh(k.key)
      setCopied(false)
      setName('')
      refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => revokeApiKey(id), onSuccess: refresh })

  const copy = () => {
    if (fresh) void navigator.clipboard?.writeText(fresh).then(() => setCopied(true)).catch(() => undefined)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t('apiKeys.title')}</h1>

      {fresh !== null && (
        <Card className="border-accent" data-testid="apikey-fresh">
          <CardHeader><CardTitle className="text-base">{t('apiKeys.created')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-warn">{t('apiKeys.copyNow')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-card border border-line bg-surface p-2 text-xs" data-testid="apikey-value">{fresh}</code>
              <Button size="sm" variant="secondary" onClick={copy} data-testid="apikey-copy">{copied ? t('apiKeys.copied') : t('apiKeys.copy')}</Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)} data-testid="apikey-dismiss">{t('apiKeys.dismiss')}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('apiKeys.add')}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('apiKeys.name')}
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="apikey-name" className="w-48" />
            </label>
            {(accounts.data ?? []).length > 1 && (
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t('apiKeys.account')}
                <select value={account} onChange={(e) => setAccount(e.target.value)} data-testid="apikey-account" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
                  <option value="">{t('apiKeys.tenantWide')}</option>
                  {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            <Button disabled={name.trim() === '' || create.isPending} onClick={() => create.mutate()} data-testid="apikey-create">{t('apiKeys.create')}</Button>
          </div>
          {create.isError && <p role="alert" className="mt-2 text-sm text-danger" data-testid="apikey-error">{t('apiKeys.error')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('apiKeys.list')}</CardTitle></CardHeader>
        <CardContent>
          {(keys.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted" data-testid="apikeys-empty">{t('apiKeys.empty')}</p>
          ) : (
            <ul className="space-y-2" data-testid="apikeys-list">
              {(keys.data ?? []).map((k) => (
                <li key={k.id} className="flex items-center gap-3 rounded-card border border-line p-2 text-sm" data-testid={`apikey-${k.id}`}>
                  <span className="truncate font-medium">{k.name}</span>
                  <code className="text-xs text-muted">{k.prefix}…</code>
                  {k.revokedAt !== null ? <Badge variant="outline">{t('apiKeys.revoked')}</Badge> : <Badge variant="default">{t('apiKeys.active')}</Badge>}
                  <span className="text-xs text-muted">{k.lastUsedAt ? `${t('apiKeys.lastUsed')}: ${fmt.format(new Date(k.lastUsedAt))}` : t('apiKeys.neverUsed')}</span>
                  {k.revokedAt === null && (
                    <Button variant="ghost" size="sm" className="ml-auto" data-testid={`apikey-revoke-${k.id}`} disabled={revoke.isPending} onClick={() => revoke.mutate(k.id)}>{t('apiKeys.revoke')}</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
