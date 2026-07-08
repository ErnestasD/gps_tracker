import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/http'
import {
  claimDevice,
  listProfiles,
  listTenantAccounts,
  listTenants,
  listQuarantine,
  type QuarantineEntry,
} from '@/lib/devices'

/**
 * Quarantine section (E03-4, platform_admin only): unknown IMEIs that hit ingest.
 * Claim assigns tenant → account → profile → the device is created and the registry
 * populated (E03-3 path), so the next connect from that IMEI is accepted.
 */
export function QuarantineSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const quarantine = useQuery({ queryKey: ['quarantine'], queryFn: listQuarantine, refetchInterval: 5_000 })
  const [claiming, setClaiming] = useState<QuarantineEntry | null>(null)

  return (
    <Card data-testid="quarantine-card">
      <CardHeader>
        <CardTitle className="text-base">{t('quarantine.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {quarantine.isLoading ? (
          <p className="text-sm text-muted">…</p>
        ) : (quarantine.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t('quarantine.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="quarantine-table">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">{t('quarantine.imei')}</th>
                  <th className="py-2 pr-4 font-medium">{t('quarantine.attempts')}</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {(quarantine.data ?? []).map((e) => (
                  <tr key={e.imei} className="border-b border-line/50" data-testid={`quarantine-${e.imei}`}>
                    <td className="py-2 pr-4 font-mono text-xs">{e.imei}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="warn">{e.rejects}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <Button variant="secondary" size="sm" data-testid={`claim-${e.imei}`} onClick={() => setClaiming(e)}>
                        {t('quarantine.claim')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {claiming !== null && (
        <ClaimDialog
          entry={claiming}
          onClose={() => setClaiming(null)}
          onClaimed={() => {
            setClaiming(null)
            void qc.invalidateQueries({ queryKey: ['quarantine'] })
            void qc.invalidateQueries({ queryKey: ['devices'] })
          }}
        />
      )}
    </Card>
  )
}

function ClaimDialog({ entry, onClose, onClaimed }: { entry: QuarantineEntry; onClose: () => void; onClaimed: () => void }) {
  const { t } = useTranslation()
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: listTenants })
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })
  const [tenantId, setTenantId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tid = tenantId || tenants.data?.[0]?.id || ''
  const accounts = useQuery({ queryKey: ['tenant-accounts', tid], queryFn: () => listTenantAccounts(tid), enabled: tid !== '' })
  const acc = accountId || accounts.data?.[0]?.id || ''
  const prof = profileId || profiles.data?.[0]?.id || ''

  const submit = () => {
    setBusy(true)
    setError(null)
    claimDevice(entry.imei, { tenantId: tid, accountId: acc, profileId: prof, name })
      .then(onClaimed)
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 409 ? t('quarantine.dupImei') : t('quarantine.claimError'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="claim-dialog">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-base">{t('quarantine.claimTitle', { imei: entry.imei })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('quarantine.tenant')}
            <select value={tid} onChange={(e) => { setTenantId(e.target.value); setAccountId('') }} className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text" data-testid="claim-tenant">
              {(tenants.data ?? []).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('quarantine.account')}
            <select value={acc} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text" data-testid="claim-account">
              {(accounts.data ?? []).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('quarantine.profile')}
            <select value={prof} onChange={(e) => setProfileId(e.target.value)} className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text" data-testid="claim-profile">
              {(profiles.data ?? []).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('quarantine.name')}
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="claim-name" />
          </label>
          {error !== null && <p role="alert" data-testid="claim-error" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>{t('quarantine.cancel')}</Button>
            <Button size="sm" disabled={busy || tid === '' || acc === '' || prof === '' || name === ''} onClick={submit} data-testid="claim-submit">
              {t('quarantine.claim')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
