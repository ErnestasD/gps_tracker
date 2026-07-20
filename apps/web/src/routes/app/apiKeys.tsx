import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge, EmptyState, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/apiKeys'
import { useFmt } from '@/lib/datetime'
import { listAccounts } from '@/lib/devices'

/** API keys (E06-3 UI): tenant-admin mints read-only integration keys. The plaintext key is
 * shown ONCE on creation — the operator must copy it before dismissing.
 * Rebuilt on the orbetra_design_new app.api-keys layout (ADR-028 round 2): the create form
 * lives in a right Sheet behind "Create a key"; tile rows stay; revoke goes through a danger
 * ConfirmDialog. */
export function ApiKeysPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: listApiKeys })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const [addOpen, setAddOpen] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null) // the just-minted plaintext key
  const [copied, setCopied] = useState(false)
  // revoke target resolves against the LIVE list (devices precedent); only active keys are eligible
  const [revokeForId, setRevokeForId] = useState<string | null>(null)
  const revokeFor = (keys.data ?? []).find((k) => k.id === revokeForId && k.revokedAt === null) ?? null

  const refresh = () => void qc.invalidateQueries({ queryKey: ['api-keys'] })
  const revoke = useMutation({ mutationFn: (id: string) => revokeApiKey(id), onSuccess: refresh })

  const copy = () => {
    if (fresh) void navigator.clipboard?.writeText(fresh).then(() => setCopied(true)).catch(() => undefined)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('apiKeys.title')} description={t('apiKeys.desc')}>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton data-testid="apikey-add-open">
              <Plus className="h-4 w-4" aria-hidden />
              {t('apiKeys.add')}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t('apiKeys.addTitle')}</SheetTitle>
            </SheetHeader>
            {/* closing the sheet unmounts the form — each open starts fresh; the plaintext-key
                banner lives OUTSIDE so it survives the sheet closing */}
            <ApiKeyForm
              accounts={accounts.data ?? []}
              onCreated={(plaintext) => {
                setFresh(plaintext)
                setCopied(false)
                setAddOpen(false)
                refresh()
              }}
              onCancel={() => setAddOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </PageHeader>

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

      {revoke.isError && (
        <p role="alert" className="admin-card p-3 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="apikeys-action-error">{t('apiKeys.actionError')}</p>
      )}

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('apiKeys.list')}
        </div>
        {keys.isError ? (
          /* a failed load (incl. the 403 a viewer gets opening this by URL) is NOT "no keys" */
          <p role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="apikeys-error">{t('admin.loadError')}</p>
        ) : keys.isLoading ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="apikeys-loading">{t('admin.loading')}</p>
        ) : (keys.data ?? []).length === 0 ? (
          /* AdminKit EmptyState (reference app.api-keys zero-state); testid contract stays */
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title={t('apiKeys.empty')} description={t('apiKeys.emptyDesc')} data-testid="apikeys-empty" />
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
                  /* danger icon-button idiom (reference + rules/webhooks siblings); testid kept */
                  <button
                    type="button"
                    aria-label={t('apiKeys.revoke')}
                    data-testid={`apikey-revoke-${k.id}`}
                    disabled={revoke.isPending}
                    className="ml-auto grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)] disabled:opacity-50"
                    style={{ color: 'var(--admin-danger)' }}
                    onClick={() => setRevokeForId(k.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={revokeFor !== null}
        onOpenChange={(o) => {
          if (!o) setRevokeForId(null)
        }}
        tone="danger"
        title={t('apiKeys.revoke')}
        description={revokeFor !== null ? t('apiKeys.revokeSure', { name: revokeFor.name }) : undefined}
        confirmLabel={t('apiKeys.revoke')}
        onConfirm={() => {
          const k = revokeFor
          if (k === null) return
          revoke.mutate(k.id)
        }}
      />
    </div>
  )
}

/** Create form inside the header Sheet (devices precedent): name + optional account scope;
 * the plaintext key is handed to the parent exactly once via onCreated. */
function ApiKeyForm({ accounts, onCreated, onCancel }: {
  accounts: { id: string; name: string }[]
  onCreated: (plaintext: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [account, setAccount] = useState('')

  const create = useMutation({
    mutationFn: () => createApiKey({ name: name.trim(), ...(account ? { accountId: account } : {}) }),
    onSuccess: (k) => onCreated(k.key),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim() === '' || create.isPending) return
    create.mutate()
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
      <div>
        <AdminLabel htmlFor="apikey-name">{t('apiKeys.name')}</AdminLabel>
        <AdminInput id="apikey-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="apikey-name" className="w-full" />
      </div>
      {accounts.length > 1 && (
        <div>
          <AdminLabel htmlFor="apikey-account">{t('apiKeys.account')}</AdminLabel>
          <Combobox
            value={account}
            onChange={setAccount}
            data-testid="apikey-account"
            aria-label={t('apiKeys.account')}
            options={[{ value: '', label: t('apiKeys.tenantWide') }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </div>
      )}
      {create.isError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="apikey-error">{t('apiKeys.error')}</p>
      )}
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" onClick={onCancel}>{t('admin.cancel')}</AdminButton>
        <AdminButton type="submit" disabled={name.trim() === '' || create.isPending} data-testid="apikey-create">
          {t('apiKeys.create')}
        </AdminButton>
      </SheetFooter>
    </form>
  )
}
