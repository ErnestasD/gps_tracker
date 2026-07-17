import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/admin/Combobox'
import type { Device } from '@/lib/devices'
import { TTL_OPTIONS, createShare, expiryLabel, listShares, revokeShare, shareUrl, type CreatedShare } from '@/lib/share'

/**
 * Temporary public share links for one device (V1-nice). Mint an expiring, revocable URL that
 * shows the device's live position with no login; list + revoke existing links. The full token
 * is shown ONCE (freshly created) — thereafter only the prefix, since the server stores a hash.
 */
export function ShareCard({ device }: { device: Device }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [ttl, setTtl] = useState(24)
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState<CreatedShare | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const shares = useQuery({ queryKey: ['shares', device.id], queryFn: () => listShares(device.id) })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['shares', device.id] })

  const create = async () => {
    setBusy(true)
    try {
      const created = await createShare(device.id, ttl, label.trim() || undefined)
      setFresh(created)
      setLabel('')
      refresh()
    } catch {
      // surfaced via the disabled state; a hard failure leaves the form untouched
    } finally {
      setBusy(false)
    }
  }

  const freshUrl = fresh ? shareUrl(fresh.token, window.location.origin) : ''
  const copy = () => {
    if (!fresh) return
    void navigator.clipboard?.writeText(freshUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const revoke = async (id: string) => {
    await revokeShare(id).catch(() => undefined)
    if (fresh?.view.id === id) setFresh(null)
    refresh()
  }

  const now = Date.now()
  const active = (shares.data ?? []).filter((s) => s.revokedAt === null)

  return (
    <Card data-testid={`share-card-${device.imei}`}>
      <CardHeader>
        <CardTitle className="text-base">{t('devices.share.title', { name: device.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">{t('devices.share.blurb')}</p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">{t('devices.share.ttl')}</span>
            <div className="w-40">
              <Combobox
                value={String(ttl)}
                data-testid="share-ttl"
                aria-label={t('devices.share.ttl')}
                onChange={(v) => setTtl(Number(v))}
                options={TTL_OPTIONS.map((o) => ({ value: String(o.hours), label: t(`devices.share.ttlOpt.${o.key}`) }))}
              />
            </div>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">{t('devices.share.label')}</span>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} data-testid="share-label" placeholder={t('devices.share.labelPlaceholder')} />
          </label>
          <Button onClick={() => void create()} disabled={busy} data-testid="share-create">
            {t('devices.share.create')}
          </Button>
        </div>

        {fresh && (
          <div className="rounded-card border border-line bg-surface2 p-3" data-testid="share-fresh">
            <p className="mb-1 text-xs text-muted">{t('devices.share.freshHint')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap text-xs">{freshUrl}</code>
              <Button size="sm" variant="ghost" onClick={copy} data-testid="share-copy">
                {copied ? t('devices.share.copied') : t('devices.share.copy')}
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted">{t('devices.share.active')}</p>
          {shares.isLoading ? (
            <p className="text-sm text-muted">{t('devices.share.loading')}</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-muted">{t('devices.share.none')}</p>
          ) : (
            <ul className="space-y-1" data-testid="share-list">
              {active.map((s) => {
                const exp = expiryLabel(s.expiresAt, now)
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <code className="text-xs">{s.prefix}…</code>
                      {s.label && <span className="text-muted">{s.label}</span>}
                      <Badge variant={exp.expired ? 'outline' : 'success'}>
                        {exp.expired ? t('devices.share.expired') : t(`devices.share.expiresIn.${exp.unit}`, { n: exp.value })}
                      </Badge>
                    </span>
                    <Button size="sm" variant="ghost" className="text-danger" data-testid={`share-revoke-${s.id}`} onClick={() => void revoke(s.id)}>
                      {t('devices.share.revoke')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
