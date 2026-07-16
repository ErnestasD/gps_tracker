import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
 * custom domains (DNS TXT verify). tsp_admin edits their own tenant only (API-scoped). */
export function BrandingPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const current = useQuery({ queryKey: ['branding'], queryFn: getBranding })
  const domains = useQuery({ queryKey: ['domains'], queryFn: listDomains })

  const [form, setForm] = useState<Branding>({})
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">{t('branding.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('branding.appearance')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('branding.productName')}>
              <Input value={form.productName ?? ''} onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))} data-testid="branding-productName" />
            </Field>
            <Field label={t('branding.supportEmail')}>
              <Input type="email" value={form.supportEmail ?? ''} onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))} data-testid="branding-supportEmail" />
            </Field>
            <Field label={t('branding.primary')}>
              <input type="color" value={form.primary ?? '#7c7df5'} onChange={(e) => setForm((f) => ({ ...f, primary: e.target.value }))} className="h-9 w-full rounded-card border border-line bg-surface" data-testid="branding-primary" />
            </Field>
            <Field label={t('branding.accent')}>
              <input type="color" value={form.accent ?? '#7c5cfc'} onChange={(e) => setForm((f) => ({ ...f, accent: e.target.value }))} className="h-9 w-full rounded-card border border-line bg-surface" data-testid="branding-accent" />
            </Field>
            <Field label={t('branding.logoUrl')}>
              <Input value={form.logoUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…" data-testid="branding-logoUrl" />
            </Field>
            <div className="col-span-full flex items-center gap-3">
              <Button type="submit" data-testid="branding-save">{t('branding.save')}</Button>
              {saved && <span className="text-sm text-success" data-testid="branding-saved">{t('branding.savedMsg')}</span>}
              {error !== null && <span role="alert" className="text-sm text-danger">{error}</span>}
              {/* preview swatch reflects the live --accent */}
              <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
                {t('branding.preview')} <span className="h-5 w-5 rounded-full bg-accent" data-testid="branding-swatch" />
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('branding.domains')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AddDomain onAdded={() => void qc.invalidateQueries({ queryKey: ['domains'] })} />
          {(domains.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t('branding.noDomains')}</p>
          ) : (
            <ul className="space-y-2" data-testid="domains-list">
              {(domains.data ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded-card border border-line p-2 text-sm" data-testid={`domain-${d.domain}`}>
                  <span className="font-mono text-xs">{d.domain}</span>
                  <div className="flex items-center gap-2">
                    {d.verified ? (
                      <Badge variant="success">{t('branding.verified')}</Badge>
                    ) : (
                      <>
                        <Badge variant="warn">{t('branding.pending')}</Badge>
                        <Button variant="secondary" size="sm" data-testid={`verify-${d.domain}`} onClick={() => void verifyDomain(d.id).then(() => qc.invalidateQueries({ queryKey: ['domains'] })).catch(() => undefined)}>
                          {t('branding.verify')}
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => void removeDomain(d.id).then(() => qc.invalidateQueries({ queryKey: ['domains'] })).catch(() => undefined)}>
                      {t('branding.remove')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">{t('branding.certNote')}</p>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
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
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="fleet.example.com" data-testid="domain-input" className="max-w-xs" />
        <Button type="submit" size="sm" disabled={domain.trim() === ''} data-testid="domain-add">{t('branding.addDomain')}</Button>
      </form>
      {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
      {txt !== null && (
        <div className="rounded-card border border-line bg-surface-2 p-3 text-xs" data-testid="txt-instructions">
          <p className="text-muted">{t('branding.txtInstruction', { domain: txt.domain })}</p>
          <code className="mt-1 block break-all font-mono text-text">{txt.record}</code>
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
