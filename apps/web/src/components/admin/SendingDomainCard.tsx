import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge } from '@/components/admin/AdminKit'
import { ApiError } from '@/lib/api'
import { getSendingDomain, removeSendingDomain, setSendingDomain, verifySendingDomain } from '@/lib/branding'

/**
 * "Send mail from your own address" — the last vendor-named line in a reseller's mail (ADR-036).
 *
 * Everything inside the message was already theirs — logo, colours, links, the display name in the
 * inbox row — while the `From:` address read `hello@orbetra.com` on every activation, every password
 * reset and every alert, because the platform had exactly one sending identity and every tenant
 * borrowed it.
 *
 * ── The three states this card has to render calmly ──────────────────────────────────────────────
 * NOT SET is the ordinary state of every tenant and must not look like an error. PENDING is the long
 * one — DKIM can take an hour after the records are published — and must say that mail is still
 * being delivered meanwhile, or a reseller watching a pending badge assumes their alerts have
 * stopped. UNAVAILABLE is when the platform holds no credentials to manage identities at all
 * (503), which is a supported deployment shape and not a fault of theirs.
 */
export function SendingDomainCard() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [domain, setDomain] = useState('')
  const [mailbox, setMailbox] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** 503 from any call ⇒ this deployment cannot manage identities; the card explains rather than errors */
  const [unavailable, setUnavailable] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const current = useQuery({ queryKey: ['sendingDomain'], queryFn: getSendingDomain })
  const done = () => void qc.invalidateQueries({ queryKey: ['sendingDomain'] })

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 503) {
      setUnavailable(true)
      return
    }
    // 502 is OUR fault (a broken IAM policy, an AWS outage) and must not read as "check your domain",
    // which sends the reader to re-type something that was never wrong.
    if (err instanceof ApiError && err.status === 502) {
      setError(t('sending.upstreamError'))
      return
    }
    const detail = err instanceof ApiError ? err.detail : undefined
    setError(detail !== undefined && detail !== '' ? detail : t('sending.badDomain'))
  }

  const save = useMutation({
    mutationFn: () => setSendingDomain(domain.trim().toLowerCase(), mailbox.trim().toLowerCase()),
    onSuccess: () => { setDomain(''); setMailbox(''); setError(null); done() },
    onError: fail,
  })
  const check = useMutation({ mutationFn: verifySendingDomain, onSuccess: done, onError: fail })
  const drop = useMutation({ mutationFn: removeSendingDomain, onSuccess: done, onError: fail })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(value)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const row = current.data ?? null

  return (
    <div className="admin-card p-5" data-testid="sending-domain-card">
      <h3 className="mb-1 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('sending.title')}</h3>
      <p className="mb-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('sending.desc')}</p>

      {unavailable ? (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sending-unavailable">{t('sending.unavailable')}</p>
      ) : current.isLoading ? (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sending-loading">{t('admin.loading')}</p>
      ) : row === null ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2" data-testid="sending-form">
          <AdminInput aria-label={t('sending.mailboxLabel')} value={mailbox} onChange={(e) => setMailbox(e.target.value)} placeholder="alerts" data-testid="sending-mailbox" className="max-w-[9rem]" />
          <span className="pb-2 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>@</span>
          <AdminInput aria-label={t('sending.domainLabel')} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" data-testid="sending-domain" className="max-w-xs" />
          <AdminButton type="submit" disabled={domain.trim() === '' || mailbox.trim() === '' || save.isPending} data-testid="sending-save">
            {t('sending.add')}
          </AdminButton>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-sm" style={{ color: 'var(--admin-ink)' }} data-testid="sending-address">{row.address}</span>
            <Badge tone={row.status === 'verified' ? 'success' : row.status === 'failed' ? 'danger' : 'neutral'} data-testid="sending-status">
              {t(`sending.status.${row.status}`)}
            </Badge>
          </div>

          {row.status !== 'verified' && (
            <>
              {/* The reassurance that stops a support ticket: a pending sending domain does not stop
                  mail. It goes out on our address exactly as it did before they started. */}
              <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sending-pending-note">{t('sending.pendingNote')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="sending-dkim">
                  <thead>
                    <tr style={{ color: 'var(--admin-ink-soft)' }}>
                      <th className="pb-1 pr-3 font-normal">{t('sending.recordType')}</th>
                      <th className="pb-1 pr-3 font-normal">{t('sending.recordName')}</th>
                      <th className="pb-1 font-normal">{t('sending.recordValue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.dkimRecords.map((r) => (
                      <tr key={r.name}>
                        <td className="pr-3 align-top">CNAME</td>
                        <td className="pr-3 align-top">
                          <button type="button" className="mono break-all text-left underline-offset-2 hover:underline" onClick={() => copy(r.name)}>
                            {copied === r.name ? t('sending.copied') : r.name}
                          </button>
                        </td>
                        <td className="align-top">
                          <button type="button" className="mono break-all text-left underline-offset-2 hover:underline" onClick={() => copy(r.value)}>
                            {copied === r.value ? t('sending.copied') : r.value}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('sending.slowNote')}</p>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {row.status !== 'verified' && (
              <AdminButton variant="secondary" onClick={() => check.mutate()} disabled={check.isPending} data-testid="sending-verify">
                {t('sending.verify')}
              </AdminButton>
            )}
            <AdminButton variant="secondary" onClick={() => drop.mutate()} disabled={drop.isPending} data-testid="sending-remove">
              {t('sending.remove')}
            </AdminButton>
          </div>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="sending-error">{error}</p>
      )}
    </div>
  )
}
