import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { ApiError } from '@/lib/http'
import {
  MAX_DOMAINS_PER_TENANT,
  addDomain,
  applyBranding,
  emitBrandingChange,
  expectedTxt,
  getBranding,
  listDomains,
  removeDomain,
  saveBranding,
  verifyDomain,
  type Branding,
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

  // live preview: apply as you type (validated inside applyBranding)
  useEffect(() => {
    applyBranding(form)
  }, [form])

  // unmount = leaving the page: revert any unsaved preview so a red draft accent (and the tab
  // title) doesn't leak app-wide for the rest of the session (a full reload was the only escape)
  useEffect(
    () => () => {
      if (savedRef.current) applyBranding(savedRef.current)
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
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
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
          <AddDomain count={(domains.data ?? []).length} onAdded={() => void qc.invalidateQueries({ queryKey: ['domains'] })} />
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
                  {/* pending domains keep their DNS TXT record visible (derived from txtToken) so a
                      returning user who navigated away can still publish it and Verify (was reachable
                      only in the transient add-response) */}
                  {!d.verified && (
                    <div className="w-full rounded-md border p-2 text-xs" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }} data-testid={`domain-txt-${d.domain}`}>
                      <p style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.txtInstruction', { domain: d.domain })}</p>
                      <code className="mono mt-1 block break-all" style={{ color: 'var(--admin-ink)' }}>{expectedTxt(d.txtToken)}</code>
                    </div>
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

function AddDomain({ count, onAdded }: { count: number; onAdded: () => void }) {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [txt, setTxt] = useState<{ domain: string; record: string } | null>(null)
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
    addDomain(domain.trim().toLowerCase())
      .then((d) => {
        setTxt({ domain: d.domain, record: d.txtRecord })
        setDomain('')
        onAdded()
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 409 ? t('branding.dupDomain') : t('branding.badDomain')))
  }

  return (
    <div className="space-y-2">
      <form onSubmit={add} className="flex gap-2">
        <AdminInput aria-label={t('branding.domainLabel')} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="fleet.example.com" data-testid="domain-input" className="max-w-xs" />
        <AdminButton type="submit" disabled={domain.trim() === '' || atCap} data-testid="domain-add">{t('branding.addDomain')}</AdminButton>
      </form>
      {atCap && (
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid="domain-limit">{t('branding.limitDomain', { max: MAX_DOMAINS_PER_TENANT })}</p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</p>
      )}
      {txt !== null && (
        <div className="rounded-md border p-3 text-xs" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }} data-testid="txt-instructions">
          <p style={{ color: 'var(--admin-ink-soft)' }}>{t('branding.txtInstruction', { domain: txt.domain })}</p>
          <code className="mono mt-1 block break-all" style={{ color: 'var(--admin-ink)' }}>{txt.record}</code>
        </div>
      )}
    </div>
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
