import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Check, Copy, Info, Loader2 } from 'lucide-react'

import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ApiError } from '@/lib/http'
import {
  MAX_DOMAINS_PER_TENANT,
  addDomain,
  applyBranding,
  clean,
  dnsRecordsFor,
  docsLink,
  emitBrandingChange,
  getDomainDns,
  getBranding,
  listDomains,
  removeBrandAsset,
  removeDomain,
  saveBranding,
  stripDataUrl,
  uploadBrandAsset,
  verifyDomain,
  type BrandAsset,
  type Branding,
  type DnsRecord,
  type DomainDns,
} from '@/lib/branding'
import { MAX_BRAND_ASSET_BYTES, type BrandAssetRejection } from '@orbetra/shared'

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
  // Uploads run in the image fields, and a save started while one is in flight can undo it — so the
  // page owns the count and Save is disabled for the whole of it. A count, not a flag: there are two
  // image fields and either can be busy.
  const [assetBusy, setAssetBusy] = useState(0)
  const busyAll = busy || assetBusy > 0
  const onAssetBusy = (b: boolean) => setAssetBusy((n) => Math.max(0, n + (b ? 1 : -1)))
  const [error, setError] = useState<string | null>(null)
  const [domainError, setDomainError] = useState(false) // verify/remove failures were swallowed
  // remove target resolves against the LIVE list (devices precedent)
  const [removeForId, setRemoveForId] = useState<string | null>(null)
  const removeFor = (domains.data ?? []).find((d) => d.id === removeForId) ?? null

  // latest SAVED branding, kept for the leave-without-saving revert below
  const savedRef = useRef<Branding | null>(null)
  // Has the user typed since the last load/save? An upload invalidates the branding query to refresh
  // the asset list, and without this the refetch that follows overwrote whatever they had typed in
  // the meantime with server state — silently, mid-edit.
  const dirtyRef = useRef(false)
  useEffect(() => {
    if (current.data) {
      savedRef.current = current.data.branding
      if (!dirtyRef.current) setForm(current.data.branding)
    }
  }, [current.data])
  /** Every field edit goes through this, so `dirty` cannot fall out of step with the form. */
  const edit = (patch: Partial<Branding>) => {
    dirtyRef.current = true
    setForm((f) => ({ ...f, ...patch }))
  }

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

  /**
   * Adopt branding the SERVER just wrote (an upload or a removal).
   *
   * Both the form and the saved baseline are reseated, and that pair is the point: PATCH replaces
   * the whole branding object from `form`, so leaving a stale `form` here would make the very next
   * Save undo the upload. Reseating `savedRef` too keeps the leave-the-page revert honest — the
   * upload IS saved, and reverting to a baseline taken before it would put the old image back.
   */
  const applySaved = (b: Branding) => {
    setForm(b)
    savedRef.current = b
    dirtyRef.current = false
    void qc.invalidateQueries({ queryKey: ['branding'] })
    emitBrandingChange()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Covers uploads too, not just a double-click on Save. An upload writes branding server-side;
    // a PATCH racing it would send a `form` that predates the new path and — because PATCH replaces
    // the whole jsonb — delete the image that had just been stored, and report success.
    if (busyAll) return
    setError(null)
    setSaved(false)
    setBusy(true)
    saveBranding(clean(form))
      .then(() => {
        setSaved(true)
        // the form now matches the server, so let a refetch reseat it again — otherwise the page
        // would stay "dirty" for the rest of the session and ignore every later load.
        dirtyRef.current = false
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
              <AdminInput id="branding-productName" value={form.productName ?? ''} onChange={(e) => edit({ productName: e.target.value })} data-testid="branding-productName" />
            </div>
            <div>
              <AdminLabel htmlFor="branding-supportEmail">{t('branding.supportEmail')}</AdminLabel>
              <AdminInput id="branding-supportEmail" type="email" value={form.supportEmail ?? ''} onChange={(e) => edit({ supportEmail: e.target.value })} data-testid="branding-supportEmail" />
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
                  onChange={(e) => edit({ primary: e.target.value })}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)' }}
                  data-testid="branding-primary"
                />
                <HexInput value={form.primary ?? '#7c7df5'} onCommit={(v) => edit({ primary: v })} testid="branding-primary-hex" label={t('branding.primary')} />
              </div>
            </div>
            <div>
              <AdminLabel htmlFor="branding-accent">{t('branding.accent')}</AdminLabel>
              <div className="flex items-center gap-2">
                <input
                  id="branding-accent"
                  type="color"
                  value={form.accent ?? '#7c5cfc'}
                  onChange={(e) => edit({ accent: e.target.value })}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)' }}
                  data-testid="branding-accent"
                />
                <HexInput value={form.accent ?? '#7c5cfc'} onCommit={(v) => edit({ accent: v })} testid="branding-accent-hex" label={t('branding.accent')} />
              </div>
            </div>
            <BrandImageField
              slot="logo"
              label={t('branding.logoUrl')}
              hint={t('branding.logoHint')}
              value={form.logoUrl ?? ''}
              asset={(current.data?.assets ?? []).find((a) => a.slot === 'logo')}
              onChange={(v) => edit({ logoUrl: v })}
              onStored={applySaved}
              onBusyChange={onAssetBusy}
            />
            <BrandImageField
              slot="favicon"
              label={t('branding.faviconUrl')}
              hint={t('branding.faviconHint')}
              value={form.faviconUrl ?? ''}
              placeholderValue={form.logoUrl ?? ''}
              asset={(current.data?.assets ?? []).find((a) => a.slot === 'favicon')}
              onChange={(v) => edit({ faviconUrl: v })}
              onStored={applySaved}
              onBusyChange={onAssetBusy}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <AdminButton type="submit" disabled={busyAll} data-testid="branding-save">{t('branding.save')}</AdminButton>
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
                    <DnsRecords
                      id={d.id}
                      domain={d.domain}
                      txtToken={d.txtToken}
                      dnsTarget={current.data?.dnsTarget ?? null}
                      dnsAddresses={current.data?.dnsAddresses ?? []}
                      platformDomain={current.data?.platformDomain ?? null}
                      onVerified={() => void qc.invalidateQueries({ queryKey: ['domains'] })}
                    />
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
function DnsRecords({ id, domain, txtToken, dnsTarget, dnsAddresses, platformDomain, onVerified }: { id: string; domain: string; txtToken: string; dnsTarget: string | null; dnsAddresses: string[]; platformDomain: string | null; onVerified: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)

  /**
   * What each record looks like in live DNS.
   *
   * A single Verify button could only say yes or no to the pair, so "ownership proved, routing
   * silently dropped" looked exactly like "not done yet" — and that state is reachable without any
   * mistake on the tenant's part.
   */
  /**
   * Polled, not asked for.
   *
   * There was a "Check DNS" button, which makes the reader responsible for knowing when their
   * provider has finished propagating — a thing they cannot know. It watches on its own now, and
   * when both records land it verifies the domain without a click: the status simply becomes
   * Verified while they are looking at it.
   *
   * Paused in a hidden tab. A setup panel left open in a background window for a day should not
   * be a stream of DNS lookups nobody is waiting on.
   */
  const dns = useQuery({
    queryKey: ['domain-dns', id],
    queryFn: () => getDomainDns(id),
    refetchOnWindowFocus: true,
    refetchInterval: DNS_POLL_MS,
    refetchIntervalInBackground: false,
  })

  const verifying = useRef(false)
  useEffect(() => {
    if (dns.data === undefined || !dns.data.txt.ok || !dns.data.route.ok) return
    // once — the poll keeps firing, and a verify per tick would be a mutation storm
    if (verifying.current) return
    verifying.current = true
    verifyDomain(id).then(onVerified).catch(() => {
      // the server re-checks DNS itself and may still disagree; let the next poll try again
      verifying.current = false
    })
  }, [dns.data, id, onVerified])

  /**
   * Which routing record to show — ONE, not both.
   *
   * The guess is the shape of the address, and live DNS corrects it: `occupied` means the name
   * already answers with an A or MX, which is proof a CNAME cannot go there whatever the name
   * looks like. That covers the case dot-counting gets wrong (`example.co.uk`) without any
   * public-suffix machinery, and it corrects itself the first time the check runs.
   */
  const override = dns.data?.route.reason === 'occupied' ? ('a' as const) : undefined
  const records = dnsRecordsFor(domain, txtToken, dnsTarget, dnsAddresses, override)

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
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('branding.dnsTitle')}</span>
        {/* Every general explanation lives here rather than under the table. A setup panel that
            ends in five paragraphs reads as an apology for itself; the reader wants the values. */}
        <Hint label={t('branding.dnsHelpTitle')} body={t('branding.dnsHelp', { domain })} testId={`dns-help-${domain}`} />
      </div>
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
                  <span className="inline-flex items-center gap-1">
                    <span className="mono font-semibold" style={{ color: 'var(--admin-ink)' }}>{r.type}</span>
                    <Hint label={t('branding.dnsWhatIs')} body={t(r.hintKey)} testId={`dns-hint-${r.type}`} />
                    <DocLink href={docsLink(platformDomain, r.docAnchor)} label={t('branding.dnsLearn')} testId={`dns-doc-${r.type}`} />
                  </span>
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
                    <Badge tone={statusOf(dns.data, r.type) ? 'success' : 'warning'}>
                      {statusOf(dns.data, r.type) ? t('branding.dnsFound') : t('branding.dnsMissing')}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* WHY it fails, when DNS can tell us — the only prose left, and it appears only when there
          is something wrong to say. */}
      {dns.data !== undefined && !dns.data.route.ok && (
        <div className="mt-2 flex flex-col gap-1" style={{ color: 'var(--admin-warning)' }} data-testid={`dns-why-${domain}`}>
          {dns.data.route.reason === 'doubled' && (
            <p>{t('branding.dnsDoubled', { domain, where: `${domain}.${domain.split('.').slice(1).join('.')}` })}</p>
          )}
          {dns.data.route.reason === 'absent' && <p>{t('branding.dnsAbsent')}</p>}
          {dns.data.route.found.length > 0 && <p>{t('branding.dnsGoesTo', { where: dns.data.route.found.join(', ') })}</p>}
        </div>
      )}

      {/* the panel is watching — said plainly, because a screen that changes on its own without
          saying it is doing so reads as a screen that has frozen */}
      <div className="mt-2 flex items-center gap-1.5" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`dns-watching-${domain}`}>
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('branding.dnsWatching')}
      </div>
    </div>
  )
}

/** How often the panel looks at DNS while a domain is still pending. A provider takes minutes. */
const DNS_POLL_MS = 20_000

/** The ↗ beside a record: the same explanation, at length, on the public docs page. */
function DocLink({ href, label, testId }: { href: string | null; label: string; testId: string }) {
  if (href === null) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      data-testid={testId}
      className="grid h-4 w-4 shrink-0 place-items-center rounded transition-colors hover:bg-[var(--admin-hairline)]"
      style={{ color: 'var(--admin-ink-soft)' }}
    >
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </a>
  )
}

/** TXT reads the ownership check; anything else is the routing check. */
function statusOf(dns: DomainDns | undefined, type: DnsRecord['type']): boolean {
  if (dns === undefined) return false
  return type === 'TXT' ? dns.txt.ok : dns.route.ok
}

/**
 * An ⓘ that opens its explanation.
 *
 * A Popover rather than a tooltip: this text is the difference between a working setup and a
 * broken one, and hover is not a gesture a phone has.
 */
function Hint({ label, body, testId }: { label: string; body: string; testId: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--admin-hairline)]"
          style={{ color: 'var(--admin-ink-soft)' }}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs">
        <div className="mb-1 font-semibold" style={{ color: 'var(--admin-ink)' }}>{label}</div>
        {/* the copy carries its own paragraph breaks — rendering them keeps the popover readable */}
        {body.split('\n\n').map((para) => (
          <p key={para.slice(0, 24)} className="mt-1 first:mt-0" style={{ color: 'var(--admin-ink-soft)' }}>{para}</p>
        ))}
      </PopoverContent>
    </Popover>
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

/**
 * One brand image: a URL to type, a file to upload, or both.
 *
 * The two coexist because they answer different situations. A tenant with a CDN already hosting
 * their assets types a URL and is done; one without anywhere to put a file — which is most
 * resellers — uploads it here. Uploading writes the served path into the same field, so everything
 * downstream (favicon, sidebar, manifest, mail) reads ONE value and never has to ask where it came
 * from.
 */
/**
 * Which message each server-side refusal gets. Exhaustive by type: a new `BrandAssetRejection` in
 * @orbetra/shared fails this build until it is given a message, which is the point of the union.
 *
 * Grouped rather than one string per reason — a reseller uploading a wordmark does not need to be
 * told which of nine SVG constructs we objected to, only that the file is not one we can serve. The
 * distinctions that matter to them are: too big, wrong format, unsafe.
 */
const UPLOAD_ERROR: Record<BrandAssetRejection, string> = {
  too_large: 'branding.tooLarge',
  too_many_pixels: 'branding.tooManyPixels',
  empty: 'branding.badFormat',
  mime_mismatch: 'branding.badFormat',
  not_svg: 'branding.badFormat',
  script: 'branding.unsafeFile',
  event_handler: 'branding.unsafeFile',
  javascript_url: 'branding.unsafeFile',
  foreign_object: 'branding.unsafeFile',
  embedded_content: 'branding.unsafeFile',
  entity: 'branding.unsafeFile',
  doctype_subset: 'branding.unsafeFile',
  remote_reference: 'branding.unsafeFile',
}

/** The server's `detail` IS the reason — it is one of the union's values. Anything else (a network
 *  fault, a 500, a future reason this build predates) falls back to the generic message. */
function uploadErrorKey(e: unknown): string {
  const detail = e instanceof ApiError ? e.detail : undefined
  return (detail !== undefined && UPLOAD_ERROR[detail as BrandAssetRejection]) || 'branding.uploadError'
}

function BrandImageField({ slot, label, hint, value, placeholderValue, asset, onChange, onStored, onBusyChange }: {
  slot: 'logo' | 'favicon'
  label: string
  hint: string
  value: string
  /** shown greyed when this field is empty and something else supplies the image (favicon → logo) */
  placeholderValue?: string
  asset: BrandAsset | undefined
  onChange: (v: string) => void
  onStored: (b: Branding) => void
  /** the page disables Save while this is true — an upload and a save must never overlap */
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusyLocal] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const shown = value !== '' ? value : (placeholderValue ?? '')
  const setBusy = (b: boolean) => {
    setBusyLocal(b)
    onBusyChange(b)
  }

  const upload = (file: File) => {
    setErr(null)
    // Checked here as well as on the server so the common mistakes cost nothing and read clearly.
    // The server's answer is still the authority — it re-derives the type from the bytes, which a
    // browser's `file.type` (taken from the extension) does not.
    if (file.type !== 'image/png' && file.type !== 'image/svg+xml') return setErr(t('branding.badFormat'))
    if (file.size > MAX_BRAND_ASSET_BYTES) return setErr(t('branding.tooLarge'))
    setBusy(true)
    const reader = new FileReader()
    reader.onerror = () => { setErr(t('branding.uploadError')); setBusy(false) }
    reader.onload = () => {
      // readAsDataURL always resolves to a string; the union is the API's, not a real case.
      if (typeof reader.result !== 'string') { setErr(t('branding.uploadError')); setBusy(false); return }
      uploadBrandAsset(slot, file.type, stripDataUrl(reader.result))
        .then((r) => onStored(r.branding))
        .catch((e: unknown) => setErr(t(uploadErrorKey(e))))
        .finally(() => setBusy(false))
    }
    reader.readAsDataURL(file)
  }

  const drop = () => {
    setErr(null)
    setBusy(true)
    removeBrandAsset(slot)
      .then((r) => onStored(r.branding))
      .catch(() => setErr(t('branding.uploadError')))
      .finally(() => setBusy(false))
  }

  return (
    <div className="md:col-span-2">
      <AdminLabel htmlFor={`branding-${slot}Url`}>{label}</AdminLabel>
      <AdminInput
        id={`branding-${slot}Url`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://…"
        data-testid={`branding-${slot}Url`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {shown !== '' && (
          <img
            src={shown}
            alt=""
            className="h-8 w-auto max-w-[8rem] rounded border object-contain"
            style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)', opacity: value === '' ? 0.5 : 1 }}
            data-testid={`branding-${slot}-preview`}
          />
        )}
        <input
          type="file"
          accept="image/png,image/svg+xml"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
          aria-label={`${label}: ${t('branding.upload')}`}
          data-testid={`branding-${slot}-upload`}
          className="text-xs"
          style={{ color: 'var(--admin-ink-soft)' }}
        />
        {asset !== undefined && (
          <button type="button" onClick={drop} disabled={busy} className="text-xs underline" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`branding-${slot}-remove`}>
            {t('branding.removeUpload')}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--admin-ink-faint)' }}>{hint}</p>
      {err !== null && (
        <span role="alert" className="text-xs" style={{ color: 'var(--admin-danger)' }}>{err}</span>
      )}
    </div>
  )
}

