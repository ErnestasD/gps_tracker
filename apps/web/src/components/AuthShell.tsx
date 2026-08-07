import { useTranslation } from 'react-i18next'

import { OrbitalFluidBg } from '@/components/OrbitalFluidBg'
import { LOCALE_LABELS, setLocale, SUPPORTED_LOCALES } from '@/lib/locale'
import { usePublicBranding } from '@/lib/publicBranding'

/**
 * The frame around every pre-auth screen (login, forgot, reset, activate).
 *
 * It answers one question in ONE place: whose product is this? All four screens used to hard-code
 * the Orbetra wordmark, so a reseller's customer landing on `fleet.reseller.lt/login` was shown OUR
 * brand on the only screen every one of their users passes through — while apps/site promises
 * "White-label domain, logo, colours. Orbetra never appears." Getting that wrong on one of four
 * pages is the likely failure mode, which is why it is a shell and not a snippet.
 *
 * IT IS THE PARTNER LOGIN. `apps/site/src/routes/partner.login.tsx` and this page are the same
 * screen with different words — same background, same section label with its rule, same card, same
 * inputs, same button — with the styles copied into `.auth-scope` (styles/index.css) rather than
 * re-invented. Two sign-in screens that looked like two products is what this replaces. Every brand
 * colour there is `var(--accent)`, so the ported look wears the TENANT's brand on their host.
 *
 * The LANGUAGE SWITCHER is here for a concrete reason. The site and the dashboard are different
 * origins, so someone reading orbetra.com in English used to land on a Lithuanian login page — the
 * link carries `?lng` now, but a switcher on the screen itself is the fix that works no matter how
 * the visitor arrived.
 */
const SITE_URL = (import.meta.env['VITE_SITE_URL'] as string | undefined) ?? 'https://orbetra.com'

export function AuthShell({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  const { t, i18n } = useTranslation()
  const brand = usePublicBranding()
  const current = i18n.language.split('-')[0]

  // brand === null is UNKNOWN (in flight, or the lookup failed) and renders NOTHING brand-specific.
  // A 200 ms flash of the wrong brand is still the wrong brand, and it is what a screenshot catches.
  // The tab is covered too now: index.html ships no title and no icon links, and the manifest comes
  // from the API branded by Host — so there is no platform identity anywhere before this resolves.
  const mark =
    brand === null ? null : brand.whiteLabel ? (
      brand.branding.logoUrl !== undefined ? (
        <img src={brand.branding.logoUrl} alt={brand.productName ?? ''} className="h-7 w-auto" data-testid="auth-tenant-logo" />
      ) : (
        <span className="display text-base font-semibold" style={{ color: 'var(--accent)' }} data-testid="auth-tenant-name">
          {brand.productName}
        </span>
      )
    ) : (
      <a href={SITE_URL} aria-label="Orbetra" data-testid="auth-home-link">
        <img src="/orbetra-wordmark.svg" alt="Orbetra" className="h-7 w-auto" />
      </a>
    )

  return (
    <div className="auth-scope relative min-h-full">
      {/* the site's own canvas, in the tenant's accent — the single biggest difference between the
          two sign-in screens before this, and the one a side-by-side screenshot leads with */}
      <OrbitalFluidBg />
      <header className="flex h-16 items-center justify-between px-6 md:px-10">
        <div className="flex items-center">{mark}</div>
        {/* the switcher is always available: someone who arrived in the wrong language must be able
            to fix it here rather than hunting for a setting behind a login they cannot read */}
        <nav className="flex items-center gap-1" aria-label={t('settings.locale')}>
          {SUPPORTED_LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              data-testid={`auth-lang-${l}`}
              aria-current={current === l}
              className="mono rounded px-2 py-1 text-[10px] uppercase tracking-[0.18em]"
              style={{ color: current === l ? 'var(--accent)' : 'var(--muted)' }}
              title={LOCALE_LABELS[l]}
            >
              {l}
            </button>
          ))}
        </nav>
      </header>

      {/* the partner login's own container, verbatim */}
      <div className="mx-auto max-w-md px-6 pt-20 pb-28 md:pt-28">
        <span className="auth-label">{label}</span>
        <h1 className="display mt-4 text-3xl font-bold md:text-4xl" style={{ color: 'var(--auth-ink)' }}>
          {title}
        </h1>
        <div className="auth-card mt-8 p-7">{children}</div>
        {brand !== null && !brand.whiteLabel && (
          <p className="mt-6 text-center text-xs">
            <a href={SITE_URL} className="underline-offset-2 hover:underline" style={{ color: 'var(--muted)' }} data-testid="auth-site-link">
              {t('login.backToSite')}
            </a>
          </p>
        )}
      </div>
    </div>
  )
}

/** A labelled input in the partner login's exact shape: mono uppercase caption over the field. */
export function AuthField({ id, label, ...input }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label htmlFor={id} className="grid gap-1.5">
      <span className="auth-field">{label}</span>
      <input id={id} className="auth-input" {...input} />
    </label>
  )
}
