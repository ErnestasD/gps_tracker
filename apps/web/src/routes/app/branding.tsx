import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'

import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { ApiError } from '@/lib/http'
import {
  MAX_DOMAINS_PER_TENANT,
  addDomain,
  applyBranding,
  dnsRecordsFor,
  emitBrandingChange,
  getDomainDns,
  getBranding,
  listDomains,
  removeDomain,
  saveBranding,
  verifyDomain,
  type Branding,
  type DnsRecord,
} from '@/lib/branding'

/** Branding page (E03-5): edit colors/logo/name with a live preview, and manage
 * custom domains (DNS TXT verify). tsp_admin edits their own tenant only (API-scoped).
 * Re-skinned onto the admin design (ADR-028): PageHeader + admin-card sections.
 * Round 2: domain removal goes through a danger ConfirmDialog. */
export function BrandingPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const current = useQuery({ queryKey: ['branding'], queryFn: getBranding })
  const domains = useQuery({ queryKey: ['domains'], queryFn: listDomains })

  const [form, setForm] = useState<Branding>({})
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false) // in-flight guard: no double-submit of the branding POST
  const [error, setError] = useState<string | null>(null)
  const [domainError, setDomainError] = useState(false) // verify/remove failures were swallowed
  // remove target resolves against the LIVE list (devices precedent)
  const [removeForId, setRemoveForId] = useState<string | null>(null)
  const removeFor = (domains.data ?? []).find((d) => d.id === removeForId) ?? null

  // latest SAVED branding, kept for the leave-without-saving revert below
  const savedRef = useRef<Branding | null>(null)
  useEffect(() => {
    if (current.data) {
      setForm(current.data.branding)
      savedRef.current = current.data.branding
    }
  }, [current.data])

  // live preview: apply as you type (validated inside applyBranding).
  // `whiteLabel` is TRUE here by definition — this page only renders for a tenant editing its own
  // branding, and passing false put the platform's title and favicon back on every keystroke.
  useEffect(() => {
    applyBranding(form, true)
  }, [form])

  // unmount = leaving the page: revert any unsaved preview so a red draft accent (and the tab
  // title) doesn't leak app-wide for the rest of the session (a full reload was the only escape)
  useEffect(
    () => () => {
      if (savedRef.current) applyBranding(savedRef.current, true)
    },
    [],
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return // in-flight guard: no double-submit
    setError(null)
    setSaved(false)
    setBusy(true)
    saveBranding(clean(form))
      .then(() => {
        setSaved(true)
        void qc.invalidateQueries({ queryKey: ['branding'] })
        emitBrandingChange() // refresh the always-mounted sidebar brand block (name/logo) without a reload
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 400 ? t('branding.invalid') : t('branding.error')))
      .finally(() => setBusy(false))
  }

  return (
    <div className="w-full space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('branding.title')} description={t('branding.desc')} />

      <div className="admin-card p-5">
        <h3 className="mb-4 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('branding.appearance')}
        </h3>
        <form onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <AdminLabel htmlFor="branding-productName">{t('branding.productName')}</AdminLabel>
              <AdminInput id="branding-productName" value={form.productName ?? ''} onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))} data-testid="branding-productName" />
            </div>
            <div>
              <AdminLabel htmlFor="branding-supportEmail">{t('branding.supportEmail')}</AdminLabel>
              <AdminInput id="branding-supportEmail" type="email" value={form.supportEmail ?? ''} onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))} data-testid="branding-supportEmail" />
            </div>
            {/* native color inputs are the Lovable idiom here (OS pickers; e2e fills them) —
                each is paired with an EDITABLE mono hex field (reference app.branding) that
                commits only valid #rrggbb values back into the form */}
            <div>
              <AdminLabel htmlFor="branding-primary">{t('branding.primary')}</AdminLabel>
              <div className="flex items-center gap-2">
                <input
                  id="branding-primary"
                  type="color"
                  value={form.primary ?? '#7c7df5'}
                  onChange={(e) => setForm((f) => ({ ...f, primary: e.target.value }))}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)' }}
                  data-testid="branding-primary"
                />
                <HexInput value={form.primary ?? '#7c7df5'} onCommit={(v) => setForm((f) => ({ ...f, primary: v }))} testid="branding-primary-hex" label={t('branding.primary')} />
              </div>
            </div>
            <div>
              <AdminLabel htmlFor="branding-accent">{t('branding.accent')}</AdminLabel>
              <div className="flex items-center gap-2">
                <input
                  id="branding-accent"
                  type="color"
                  value={form.accent ?? '#7c5cfc'}
                  onChange={(e) => setForm((f) => ({ ...f, accent: e.target.value }))}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)' }}
                  data-testid="branding-accent"
                />
                <HexInput value={form.accent ?? '#7c5cfc'} onCommit={(v) => setForm((f) => ({ ...f, accent: v }))} testid="branding-accent-hex" label={t('branding.accent')} />
              </div>
            </div>
            <div className="md:col-span-2">
              <AdminLabel htmlFor="branding-logoUrl">{t('branding.logoUrl')}</AdminLabel>
              <AdminInput id="branding-logoUrl" value={form.logoUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…" data-testid="branding-logoUrl" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <AdminButton type="submit" disabled={busy} data-testid="branding-save">{t('branding.save')}</AdminButton>
            {saved && (
              <span role="status" className="text-sm" style={{ color: 'var(--admin-success)' }} data-testid="branding-saved">
                {t('branding.savedMsg')}
              </span>
            )}
            {error !== null && (
              <span role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>
                {error}
              </span>
            )}
            {/* preview chip: primary straight from the form (reference shows both), accent
                bound to the LIVE --accent custom property applyBranding writes */}
            <span className="ml-auto inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs" style={{ background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)' }}>
              {t('branding.preview')}
              <span className="h-4 w-4 rounded-full" style={{ background: form.primary ?? '#7c7df5' }} data-testid="branding-swatch-primary" />
              <span className="h-4 w-4 rounded-full" style={{ background: 'var(--accent)' }} data-testid="branding-swatch" />
            </span>
          </div>
        </form>
      </div>

      <div className="admin-card p-5">
        <h3 className="mb-4 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('branding.domains')}
        </h3>
        <div className="space-y-3">
          <AddDomain
            count={(domains.data ?? []).length}
            platformDomain={current.data?.platformDomain ?? null}
            onAdded={() => void qc.invalidateQueries({ queryKey: ['domains'] })}
          />
          {domainError && (
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="domain-action-error">{t('branding.actionError')}</p>
          )}
          {domains.isError ? (
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="domains-error">{t('admin.loadError')}</p>
          ) : domains.isLoading ? (
            <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="domains-loading">{t('admin.loading')}</p>
          ) : (domains.data ?? []).length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.noDomains')}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="domains-list">
              {(domains.data ?? []).map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  style={{ borderColor: 'var(--admin-hairline)' }}
                  data-testid={`domain-${d.domain}`}
                >
                  <span className="mono text-xs" style={{ color: 'var(--admin-ink)' }}>{d.domain}</span>
                  <div className="flex items-center gap-2">
                    {d.verified ? (
                      <Badge tone="success">{t('branding.verified')}</Badge>
                    ) : (
                      <>
                        <Badge tone="warning">{t('branding.pending')}</Badge>
                        <AdminButton
                          variant="secondary"
                          size="sm"
                          data-testid={`verify-${d.domain}`}
                          onClick={() => {
                            setDomainError(false)
                            void verifyDomain(d.id).then(() => qc.invalidateQueries({ queryKey: ['domains'] })).catch(() => setDomainError(true))
                          }}
                        >
                          {t('branding.verify')}
                        </AdminButton>
                      </>
                    )}
                    <AdminButton
                      variant="ghost"
                      size="sm"
                      style={{ color: 'var(--admin-danger)' }}
                      data-testid={`domain-remove-${d.domain}`}
                      onClick={() => setRemoveForId(d.id)}
                    >
                      {t('branding.remove')}
                    </AdminButton>
                  </div>
                  {/* pending domains keep their DNS records visible (derived from txtToken) so a
                      returning user who navigated away can still publish them and Verify (was
                      reachable only in the transient add-response) */}
                  {!d.verified && (
                    <DnsRecords id={d.id} domain={d.domain} txtToken={d.txtToken} dnsTarget={current.data?.dnsTarget ?? null} dnsAddresses={current.data?.dnsAddresses ?? []} />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.certNote')}</p>
        </div>
      </div>

      <ConfirmDialog
        open={removeFor !== null}
        onOpenChange={(o) => {
          if (!o) setRemoveForId(null)
        }}
        tone="danger"
        title={t('branding.remove')}
        description={removeFor !== null ? t('branding.domainRemoveSure', { domain: removeFor.domain }) : undefined}
        confirmLabel={t('branding.remove')}
        onConfirm={() => {
          const d = removeFor
          if (d === null) return
          setDomainError(false)
          void removeDomain(d.id).then(() => qc.invalidateQueries({ queryKey: ['domains'] })).catch(() => setDomainError(true))
        }}
      />
    </div>
  )
}

/** Editable mono hex field, two-way synced with its color picker: external changes replace the
 * draft; typed values commit to the form only once they are a full valid #rrggbb. */
function HexInput({ value, onCommit, testid, label }: { value: string; onCommit: (v: string) => void; testid: string; label: string }) {
  const [draft, setDraft] = useState(value)
  // picker (or server load) changed the color → adopt it as the new draft
  useEffect(() => setDraft(value), [value])
  const valid = /^#[0-9a-fA-F]{6}$/.test(draft)
  return (
    <AdminInput
      value={draft}
      onChange={(e) => {
        const v = e.target.value
        setDraft(v)
        if (/^#[0-9a-fA-F]{6}$/.test(v)) onCommit(v)
      }}
      maxLength={7}
      aria-label={label}
      aria-invalid={!valid}
      data-testid={testid}
      className="mono w-28 text-xs"
      // caller style REPLACES AdminInput's base style object — restate all three tokens
      style={valid ? undefined : { borderColor: 'var(--admin-danger)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}
    />
  )
}

/**
 * Add a domain — in one of TWO shapes, because a reseller has two very different starting points.
 *
 * `<slug>.orbetra.com` is the zero-setup path: we own the zone, so there is no ownership to prove
 * and no DNS for the tenant to touch. It comes back verified and works within seconds. Without it, a
 * TSP who cannot get a DNS change scheduled this quarter simply cannot launch — and that was the
 * only option the product offered.
 *
 * A tenant's OWN domain still proves ownership by TXT, and now also states where to point it. That
 * second step was documented NOWHERE — not in the UI, not in the README — so the honest outcome of
 * following the instructions was a verified badge above a domain that resolved nowhere.
 */
function AddDomain({ count, platformDomain, onAdded }: { count: number; platformDomain: string | null; onAdded: () => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'own' | 'sub'>(platformDomain !== null ? 'sub' : 'own')
  const [domain, setDomain] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  // the server 409s BOTH the cap and a duplicate — the client can't tell them apart from status
  // alone, so guard the cap here and show the correct message instead of a false "already registered"
  const atCap = count >= MAX_DOMAINS_PER_TENANT

  const add = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (atCap) {
      setError(t('branding.limitDomain', { max: MAX_DOMAINS_PER_TENANT }))
      return
    }
    const wanted = mode === 'sub' && platformDomain !== null ? `${slug.trim().toLowerCase()}.${platformDomain}` : domain.trim().toLowerCase()
    addDomain(wanted)
      .then(() => {
        // The records are shown on the domain's ROW, not here. They used to be shown in both
        // places at once — the founder's screenshot has the same TXT block twice on one screen,
        // which reads as two different records to publish. The row is the durable one: it survives
        // a reload, and the add-form's copy vanished the moment you navigated away.
        setDomain('')
        setSlug('')
        onAdded()
      })
      .catch((err: unknown) => {
        // A 409 has a TRANSLATED message and keeps it — the API's problem details are English
        // only, so preferring them would have replaced four localized strings with "domain already
        // added" for every non-English operator. A 400 has no translation that says WHICH rule was
        // hit ('that name is reserved' vs '3–40 characters'), and English-but-specific beats
        // localized-but-useless there; the generic key remains the fallback.
        if (err instanceof ApiError && err.status === 409) {
          setError(err.detail === 'that name is already taken' ? t('branding.takenDomain') : t('branding.dupDomain'))
          return
        }
        const detail = err instanceof ApiError ? err.detail : undefined
        setError(detail !== undefined && detail !== '' ? detail : t('branding.badDomain'))
      })
  }

  return (
    <div className="space-y-2">
      {platformDomain !== null && (
        <div className="flex gap-4 text-sm">
          {(['sub', 'own'] as const).map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-1.5" style={{ color: 'var(--admin-ink-soft)' }}>
              <input type="radio" name="domain-mode" checked={mode === m} onChange={() => { setMode(m); setError(null) }} data-testid={`domain-mode-${m}`} />
              {m === 'sub' ? t('branding.modeSub', { domain: platformDomain }) : t('branding.modeOwn')}
            </label>
          ))}
        </div>
      )}
      {mode === 'sub' && platformDomain !== null ? (
        <>
          <form onSubmit={add} className="flex items-center gap-2">
            <AdminInput aria-label={t('branding.slugLabel')} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme" data-testid="slug-input" className="max-w-[10rem]" />
            <span className="mono text-sm" style={{ color: 'var(--admin-ink-soft)' }}>.{platformDomain}</span>
            <AdminButton type="submit" disabled={slug.trim() === '' || atCap} data-testid="slug-add">{t('branding.addDomain')}</AdminButton>
          </form>
          <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.subNote')}</p>
        </>
      ) : (
        <>
          <form onSubmit={add} className="flex gap-2">
            <AdminInput aria-label={t('branding.domainLabel')} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="fleet.example.com" data-testid="domain-input" className="max-w-xs" />
            <AdminButton type="submit" disabled={domain.trim() === '' || atCap} data-testid="domain-add">{t('branding.addDomain')}</AdminButton>
          </form>
          {/* Nothing about DNS is stated before a domain exists. It used to name the CNAME target
              here, above an empty form — an instruction with no subject, and the reader's first
              impression of a two-record setup was one record. The table appears WITH the domain,
              once both records can be shown in full. */}
        </>
      )}
      {atCap && (
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid="domain-limit">{t('branding.limitDomain', { max: MAX_DOMAINS_PER_TENANT })}</p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</p>
      )}
    </div>
  )
}

/**
 * The DNS records to publish, as a table — Type, Name, Value, each copyable.
 *
 * What was here read: "Add this TXT record to dokigo.lt" above the bare string
 * `orbetra-verify=2a129…`. Every DNS panel asks for three separate fields, so a single string with
 * an `=` in it reads as a NAME and a VALUE — the founder read it exactly that way, and a record
 * named `orbetra-verify` never verifies, with nothing anywhere to say why. The record is a TXT on
 * `_orbetra-verify.<domain>` whose value is the token alone; saying so in the shape the panel asks
 * for is the whole fix.
 *
 * The CNAME is shown beside it rather than in a sentence above the form: proving ownership and
 * pointing the domain at us are two records, and a page that mentions them a screen apart teaches
 * a one-record setup.
 */
function DnsRecords({ id, domain, txtToken, dnsTarget, dnsAddresses }: { id: string; domain: string; txtToken: string; dnsTarget: string | null; dnsAddresses: string[] }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)
  const records = dnsRecordsFor(domain, txtToken, dnsTarget, dnsAddresses)
  /**
   * What each record looks like in live DNS.
   *
   * A single Verify button could only say yes or no to the pair, so "ownership proved, routing
   * silently dropped" looked exactly like "not done yet" — and that state is reachable without any
   * mistake on the tenant's part: a CNAME on a name that already holds A/MX/TXT is discarded by
   * the zone with no error anywhere (RFC 1034 §3.6.2). Per-record status is what turns that into
   * something a person can act on.
   */
  const dns = useQuery({ queryKey: ['domain-dns', id], queryFn: () => getDomainDns(id), refetchOnWindowFocus: false })
  const stateOf = (type: DnsRecord['type']): { ok: boolean; found: string[] } | undefined =>
    dns.data === undefined ? undefined : type === 'TXT' ? dns.data.txt : dns.data.route

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    }).catch(() => undefined)
  }

  return (
    <div
      className="w-full rounded-md border p-3 text-xs"
      style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }}
      data-testid={`domain-dns-${domain}`}
    >
      <p className="font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('branding.dnsTitle')}</p>
      <p className="mt-0.5" style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.dnsIntro')}</p>

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
            {records.map((r) => (
              <tr key={`${r.type}-${r.value}`} data-testid={`dns-row-${r.type}`}>
                <td className="pr-3 align-top">
                  <span className="mono font-semibold" style={{ color: 'var(--admin-ink)' }}>
                    {/* "or" carries the whole meaning of this row: it is not a third record to
                        publish, it is the other way of doing the second one */}
                    {r.alternative === true && <span className="mr-1 font-normal" style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.dnsOr')}</span>}
                    {r.type}
                  </span>
                  <div style={{ color: 'var(--admin-ink-soft)' }}>{t(r.purposeKey)}</div>
                </td>
                <td className="pr-3 align-top">
                  <Field text={r.name} copied={copied === `${r.type}-name`} onCopy={() => copy(r.name, `${r.type}-name`)} />
                </td>
                <td className="pr-3 align-top">
                  <Field text={r.value} copied={copied === `${r.type}-value`} onCopy={() => copy(r.value, `${r.type}-value`)} />
                </td>
                <td className="align-top">
                  {dns.isLoading ? (
                    <span style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.dnsChecking')}</span>
                  ) : (
                    <Badge tone={stateOf(r.type)?.ok === true ? 'success' : 'warning'}>
                      {stateOf(r.type)?.ok === true ? t('branding.dnsFound') : t('branding.dnsMissing')}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* WHY it fails, when DNS can tell us. "Not found" alone leaves the reader guessing, and the
          obvious next move — add the record again — is the one that cannot work when the name is
          already occupied. Naming the address it resolves to is usually the rest of the diagnosis:
          an old web host, or a wildcard record quietly answering for a name nobody defined. */}
      {dns.data !== undefined && !dns.data.route.ok && (
        <div className="mt-2 flex flex-col gap-1" style={{ color: 'var(--admin-warning)' }} data-testid={`dns-why-${domain}`}>
          {dns.data.route.reason === 'occupied' && <p>{t('branding.dnsOccupied', { domain })}</p>}
          {dns.data.route.reason === 'absent' && <p>{t('branding.dnsAbsent')}</p>}
          {dns.data.route.found.length > 0 && <p>{t('branding.dnsGoesTo', { where: dns.data.route.found.join(', ') })}</p>}
        </div>
      )}

      <div className="mt-2">
        <AdminButton variant="secondary" size="sm" onClick={() => void dns.refetch()} data-testid={`dns-recheck-${domain}`}>
          {t('branding.dnsRecheck')}
        </AdminButton>
      </div>

      <ul className="mt-2 flex flex-col gap-1" style={{ color: 'var(--admin-ink-soft)' }}>
        <li>{t('branding.dnsRelative', { domain })}</li>
        <li>{t('branding.dnsApexChoice')}</li>
        <li>{t('branding.dnsMailSafe')}</li>
        <li>{t('branding.dnsKeepTxt')}</li>
      </ul>
    </div>
  )
}

/** One monospaced value with a copy button — the only interaction this table needs. */
function Field({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  const { t } = useTranslation()
  return (
    <span className="flex items-start gap-1">
      <code className="mono break-all" style={{ color: 'var(--admin-ink)' }}>{text}</code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`${t('branding.copy')}: ${text}`}
        title={copied ? t('branding.copied') : t('branding.copy')}
        className="shrink-0 rounded p-0.5 transition-colors"
        style={{ color: copied ? 'var(--admin-success)' : 'var(--admin-ink-soft)' }}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  )
}

/** Drop empty strings so a blank field doesn't fail the strict server schema. */
function clean(b: Branding): Branding {
  const out: Branding = {}
  if (b.productName) out.productName = b.productName
  if (b.supportEmail) out.supportEmail = b.supportEmail
  if (b.primary) out.primary = b.primary
  if (b.accent) out.accent = b.accent
  if (b.logoUrl) out.logoUrl = b.logoUrl
  return out
}
