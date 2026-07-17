import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { ApiError } from '@/lib/http'
import {
  addDomain,
  applyBranding,
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
  const [error, setError] = useState<string | null>(null)
  // remove target resolves against the LIVE list (devices precedent)
  const [removeForId, setRemoveForId] = useState<string | null>(null)
  const removeFor = (domains.data ?? []).find((d) => d.id === removeForId) ?? null

  useEffect(() => {
    if (current.data) setForm(current.data.branding)
  }, [current.data])

  // live preview: apply as you type (validated inside applyBranding)
  useEffect(() => {
    applyBranding(form)
  }, [form])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    saveBranding(clean(form))
      .then(() => {
        setSaved(true)
        void qc.invalidateQueries({ queryKey: ['branding'] })
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 400 ? t('branding.invalid') : t('branding.error')))
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
                <span className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{form.primary ?? '#7c7df5'}</span>
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
                <span className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{form.accent ?? '#7c5cfc'}</span>
              </div>
            </div>
            <div className="md:col-span-2">
              <AdminLabel htmlFor="branding-logoUrl">{t('branding.logoUrl')}</AdminLabel>
              <AdminInput id="branding-logoUrl" value={form.logoUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…" data-testid="branding-logoUrl" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <AdminButton type="submit" data-testid="branding-save">{t('branding.save')}</AdminButton>
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
            {/* preview swatch reflects the live --accent custom property */}
            <span className="ml-auto inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs" style={{ background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)' }}>
              {t('branding.preview')}
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
          <AddDomain onAdded={() => void qc.invalidateQueries({ queryKey: ['domains'] })} />
          {(domains.data ?? []).length === 0 ? (
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
                          onClick={() => void verifyDomain(d.id).then(() => qc.invalidateQueries({ queryKey: ['domains'] })).catch(() => undefined)}
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
          void removeDomain(d.id).then(() => qc.invalidateQueries({ queryKey: ['domains'] })).catch(() => undefined)
        }}
      />
    </div>
  )
}

function AddDomain({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [txt, setTxt] = useState<{ domain: string; record: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const add = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
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
        <AdminButton type="submit" disabled={domain.trim() === ''} data-testid="domain-add">{t('branding.addDomain')}</AdminButton>
      </form>
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
