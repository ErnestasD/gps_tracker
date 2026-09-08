import { KB } from '@orbetra/kb'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, Badge } from '@/components/admin/AdminKit'
import { DNS_POLL_MS, Field, Hint } from '@/components/admin/DnsKit'
import { HelpLink } from '@/components/kb/HelpLink'
import { ApiError } from '@/lib/api'
import {
  fqdn,
  getSendingDomain,
  getSendingDomainDns,
  removeSendingDomain,
  setSendingDomain,
  shouldAttemptVerify,
  verifySendingDomain,
} from '@/lib/branding'

/**
 * "Send mail from your own address" — the last vendor-named line in a reseller's mail (ADR-036).
 *
 * Everything inside the message was already theirs — logo, colours, links, the display name in the
 * inbox row — while the `From:` address read `hello@orbetra.com` on every activation, every password
 * reset and every alert, because the platform had exactly one sending identity and every tenant
 * borrowed it.
 *
 * ── Built to match the custom-domain panel, deliberately ─────────────────────────────────────────
 * This shipped first as a plainer table: click-the-text to copy, no status column, no explanations,
 * and a Check button the reader had to press. Two DNS setup tables on ONE screen, asking the same
 * person for the same kind of record and behaving differently, is a difference a reader reads as
 * meaning something. So it is the same table now: per-record live status, the same ⓘ, the same copy
 * affordance, the same twenty-second poll, and the same promise that the panel is watching rather
 * than waiting to be asked.
 *
 * ── The three states this card has to render calmly ──────────────────────────────────────────────
 * NOT SET is the ordinary state of every tenant and must not look like an error. PENDING is the long
 * one — DKIM can take an hour after the records are published — and must say that mail is still
 * being delivered meanwhile, or a reseller watching a pending badge assumes their alerts have
 * stopped. UNAVAILABLE is when the platform holds no credentials to manage identities at all, read
 * from the LOAD rather than from a 503 on submit, so the form is never a waste of their time.
 */
export function SendingDomainCard() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [domain, setDomain] = useState('')
  const [mailbox, setMailbox] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const current = useQuery({ queryKey: ['sendingDomain'], queryFn: getSendingDomain })
  const state = current.data
  const row = state?.identity ?? null
  const verified = row?.status === 'verified'
  // Deliberately does NOT invalidate ['sendingDomainDns']: the advance below reads that query, and
  // a success handler that refreshes its own trigger is how the first version of this card could
  // re-enter itself. The poll refreshes it on its own schedule.
  const done = () => void qc.invalidateQueries({ queryKey: ['sendingDomain'] })

  /**
   * Polled, not asked for — the same rule the custom-domain panel follows.
   *
   * A Check button makes the reader responsible for knowing when their provider has finished
   * propagating, which is a thing they cannot know. Paused in a hidden tab: a setup panel left open
   * in a background window overnight should not be a stream of DNS lookups nobody is waiting on.
   */
  const dns = useQuery({
    // keyed by DOMAIN: the query is disabled while there is no row, and a disabled query KEEPS its
    // cached data. Without the domain in the key, deleting a sending domain and adding another
    // showed the OLD domain's results against the new domain's records — a green Found on a record
    // that had never been published, which is worse than no status at all.
    queryKey: ['sendingDomainDns', row?.domain ?? ''],
    queryFn: getSendingDomainDns,
    enabled: row !== null && state?.configured === true,
    refetchOnWindowFocus: !verified,
    refetchInterval: verified ? false : DNS_POLL_MS,
    refetchIntervalInBackground: false,
  })

  const fail = (err: unknown) => {
    // a 503 mid-flight means the credential went away between the load and the click; the refetch
    // is what puts the card back into its unavailable state, so nothing to set here
    if (err instanceof ApiError && err.status === 503) {
      done()
      return
    }
    // 502 is OUR fault (a broken IAM policy, an AWS outage) and must not read as "check your
    // domain", which sends the reader to re-type something that was never wrong.
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

  /**
   * Advance on its own — once per completed poll, never per render.
   *
   * `dataUpdatedAt` changes exactly once per finished fetch whatever came back, so it is a tick
   * counter that cannot be moved by the shape of the payload. The decision itself is
   * `shouldAttemptVerify` in lib/branding, where it is unit-tested; this is only the plumbing.
   *
   * Errors surface through `fail`, the same handler the other mutations use. An earlier version
   * swallowed them, which meant a 409 — this domain is verified by another tenant and can NEVER
   * verify for you — rendered as four green badges and a spinner, for ever.
   *
   * ── And there is no Check button ─────────────────────────────────────────────────────────────
   * There was, briefly, and it was the thing that gave the panel away: a spinner saying "checking
   * automatically" beside a button asking to be pressed says one of the two is lying. Pressing it
   * could not help either — the wait is SES deciding, on its own clock, up to an hour after the
   * records resolve, and asking twice does not make it decide sooner. The custom-domain panel this
   * one is built to match has never had one.
   */
  const lastAttempt = useRef(0)
  useEffect(() => {
    if (row === null) return
    const decision = shouldAttemptVerify({
      configured: state?.configured === true,
      status: row.status,
      ownershipOk: dns.data?.txt.ok ?? false,
      fetchedAt: dns.dataUpdatedAt,
      lastAttemptFor: lastAttempt.current,
    })
    if (!decision) return
    lastAttempt.current = dns.dataUpdatedAt
    check.mutate()
  }, [dns.dataUpdatedAt, dns.data, row, state, check])

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    }).catch(() => undefined)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  /** Ownership first and, until it resolves, ALONE — SES has not minted the selectors yet. */
  const records = row === null ? [] : [
    {
      type: 'TXT' as const,
      name: fqdn(row.ownershipRecord.name),
      value: row.ownershipRecord.value,
      ok: dns.data?.txt.ok ?? false,
      hintKey: 'sending.hintTxt',
    },
    // joined by NAME, not by array index. The two halves come from two separate requests, and the
    // API returns the name on every row precisely so they do not have to be lined up by position.
    ...row.dkimRecords.map((r) => ({
      type: 'CNAME' as const,
      name: fqdn(r.name),
      value: fqdn(r.value),
      ok: dns.data?.dkim.find((d) => d.name === r.name)?.ok ?? false,
      hintKey: 'sending.hintDkim',
    })),
  ]

  return (
    <div className="admin-card p-5" data-testid="sending-domain-card">
      <div className="mb-1 flex items-center gap-1">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('sending.title')}</h3>
        <HelpLink slug={KB.emailsToYourCustomers} anchor="not-yet" testId="sending-doc-help" />
      </div>
      <p className="mb-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('sending.desc')}</p>

      {current.isLoading ? (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sending-loading">{t('admin.loading')}</p>
      ) : current.isError ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="sending-load-error">{t('admin.loadError')}</p>
      ) : state?.configured === false ? (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sending-unavailable">{t('sending.unavailable')}</p>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <code className="mono text-sm" style={{ color: 'var(--admin-ink)' }} data-testid="sending-address">{row.address}</code>
              <Badge tone={verified ? 'success' : row.status === 'failed' ? 'danger' : 'neutral'} data-testid="sending-status">
                {t(`sending.status.${row.status}`)}
              </Badge>
            </span>
            <AdminButton variant="secondary" onClick={() => drop.mutate()} disabled={drop.isPending} data-testid="sending-remove">
              {t('sending.remove')}
            </AdminButton>
          </div>

          {!verified && (
            <div
              className="w-full rounded-md border p-3 text-xs"
              style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }}
              data-testid="sending-dns"
            >
              <p style={{ color: 'var(--admin-ink-soft)' }}>
                {t(row.dkimRecords.length === 0 ? 'sending.ownershipNote' : 'sending.pendingNote')}
              </p>

              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--admin-ink-soft)' }}>
                      <th className="pr-3 font-medium">{t('branding.dnsType')}</th>
                      <th className="pr-3 font-medium">{t('branding.dnsName')}</th>
                      <th className="pr-3 font-medium">{t('branding.dnsValue')}</th>
                      <th className="font-medium">{t('branding.dnsStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => (
                      <tr key={r.name} data-testid={`sending-dns-row-${i}`}>
                        <td className="pr-3 align-top">
                          <span className="inline-flex items-center gap-1">
                            <span className="mono font-semibold" style={{ color: 'var(--admin-ink)' }}>{r.type}</span>
                            <Hint label={t('branding.dnsWhatIs')} body={t(r.hintKey)} testId={`sending-hint-${i}`} />
                          </span>
                        </td>
                        <td className="pr-3 align-top">
                          <Field text={r.name} copied={copied === `${i}-name`} onCopy={() => copy(r.name, `${i}-name`)} />
                        </td>
                        <td className="pr-3 align-top">
                          <Field text={r.value} copied={copied === `${i}-value`} onCopy={() => copy(r.value, `${i}-value`)} />
                        </td>
                        <td className="align-top">
                          {/* A failed lookup is NOT "Not found". `isLoading` is false once the first
                              fetch has settled, error included, so a 500 or a dropped connection
                              used to paint "Not found" against records the tenant had published
                              correctly — the panel asserting a DNS fact it does not have. */}
                          {dns.isLoading || dns.isError ? (
                            <span style={{ color: 'var(--admin-ink-soft)' }}>
                              {dns.isError ? t('branding.dnsUnknown') : t('branding.dnsChecking')}
                            </span>
                          ) : (
                            <Badge tone={r.ok ? 'success' : 'warning'}>
                              {r.ok ? t('branding.dnsFound') : t('branding.dnsMissing')}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* WHY it fails, when DNS can tell us — the only prose here, and only when there is
                  something wrong to say. `stale` is the one that had to be named: re-adding the
                  domain mints a NEW token, so the record the tenant already published is still
                  sitting there under the right name, looking exactly right. */}
              {dns.data?.txt.reason === 'stale' && (
                <p className="mt-2" style={{ color: 'var(--admin-warning)' }} data-testid="sending-dns-stale">{t('branding.dnsStale')}</p>
              )}

              <div className="mt-2 flex items-center gap-1.5" style={{ color: 'var(--admin-ink-soft)' }} data-testid="sending-dns-watching">
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
                {t('branding.dnsWatching')}
              </div>
              <p className="mt-2" style={{ color: 'var(--admin-ink-soft)' }}>{t('sending.slowNote')}</p>
            </div>
          )}

        </div>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="sending-error">{error}</p>
      )}
    </div>
  )
}
