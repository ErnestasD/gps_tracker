import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from '@/components/admin/AdminKit'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/apiKeys'
import { useFmt } from '@/lib/datetime'
import { listAccounts } from '@/lib/devices'

const selectStyle: React.CSSProperties = {
  borderColor: 'var(--admin-hairline)',
  background: 'var(--admin-surface)',
  color: 'var(--admin-ink)',
}

/** API keys (E06-3 UI): tenant-admin mints read-only integration keys. The plaintext key is
 * shown ONCE on creation — the operator must copy it before dismissing.
 * Re-skinned onto the admin design (ADR-028): PageHeader + tile-row list idiom. */
export function ApiKeysPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
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
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('apiKeys.title')} description={t('apiKeys.desc')} />

      {fresh !== null && (
        <div role="status" className="admin-card p-4" style={{ background: 'var(--admin-brand-soft)', borderColor: 'var(--admin-brand)' }} data-testid="apikey-fresh">
          <div className="mb-2 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('apiKeys.created')}</div>
          <p className="mb-2 text-sm" style={{ color: 'var(--admin-warning)' }}>{t('apiKeys.copyNow')}</p>
          <div className="flex items-center gap-2">
            <code
              className="mono flex-1 overflow-x-auto rounded-md border p-2 text-xs"
              style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}
              data-testid="apikey-value"
            >
              {fresh}
            </code>
            <AdminButton size="sm" variant="secondary" onClick={copy} data-testid="apikey-copy">
              {copied ? t('apiKeys.copied') : t('apiKeys.copy')}
            </AdminButton>
          </div>
          <AdminButton size="sm" variant="ghost" className="mt-2" onClick={() => setFresh(null)} data-testid="apikey-dismiss">
            {t('apiKeys.dismiss')}
          </AdminButton>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('apiKeys.add')}
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <AdminLabel htmlFor="apikey-name">{t('apiKeys.name')}</AdminLabel>
              <AdminInput id="apikey-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="apikey-name" className="w-48" />
            </div>
            {(accounts.data ?? []).length > 1 && (
              <div>
                <AdminLabel htmlFor="apikey-account">{t('apiKeys.account')}</AdminLabel>
                <select id="apikey-account" value={account} onChange={(e) => setAccount(e.target.value)} data-testid="apikey-account" className="h-9 rounded-md border px-2 text-sm" style={selectStyle}>
                  <option value="">{t('apiKeys.tenantWide')}</option>
                  {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            <AdminButton disabled={name.trim() === '' || create.isPending} onClick={() => create.mutate()} data-testid="apikey-create">
              {t('apiKeys.create')}
            </AdminButton>
          </div>
          {create.isError && (
            <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="apikey-error">{t('apiKeys.error')}</p>
          )}
        </div>
      </div>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('apiKeys.list')}
        </div>
        {(keys.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="apikeys-empty">{t('apiKeys.empty')}</p>
        ) : (
          <ul data-testid="apikeys-list">
            {(keys.data ?? []).map((k) => (
              <li key={k.id} className="admin-hairline-b flex flex-wrap items-center gap-3 p-4 text-sm last:border-b-0" data-testid={`apikey-${k.id}`}>
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={
                    k.revokedAt !== null
                      ? { background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)' }
                      : { background: 'var(--admin-brand-soft)', color: 'var(--admin-brand)' }
                  }
                >
                  <KeyRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" style={{ color: k.revokedAt !== null ? 'var(--admin-ink-soft)' : 'var(--admin-ink)' }}>{k.name}</div>
                  <div className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{k.prefix}…</div>
                </div>
                {k.revokedAt !== null ? <Badge tone="neutral">{t('apiKeys.revoked')}</Badge> : <Badge tone="success">{t('apiKeys.active')}</Badge>}
                <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  {k.lastUsedAt ? `${t('apiKeys.lastUsed')}: ${dt(k.lastUsedAt)}` : t('apiKeys.neverUsed')}
                </span>
                {k.revokedAt === null && (
                  <AdminButton
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    style={{ color: 'var(--admin-danger)' }}
                    data-testid={`apikey-revoke-${k.id}`}
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(k.id)}
                  >
                    {t('apiKeys.revoke')}
                  </AdminButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
