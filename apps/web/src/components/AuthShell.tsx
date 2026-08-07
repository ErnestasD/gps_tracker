import { useTranslation } from 'react-i18next'

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
 * It also carries the composition the marketing site's partner login already had — a real header
 * bar, a section label, a large display heading, then the card — because the two sign-in screens sat
 * side by side looking like different products. The visual language is the DASHBOARD's own tokens
 * (`--accent`, `.display`, `.mono`), not a copy of the site's: `--accent` is the tenant's colour, so
 * this composition wears their brand automatically rather than ours by construction.
 *
 * The LANGUAGE SWITCHER is here for a concrete reason. The site and the dashboard are different
 * origins, so someone reading orbetra.com in English used to land on a Lithuanian login page — the
 * link carries `?lng` now, but a switcher on the screen itself is the fix that works no matter how
 * the visitor arrived.
 */
const SITE_URL = (import.meta.env['VITE_SITE_URL'] as string | undefined) ?? 'https://orbetra.com'

export function AuthShell({ label, title, children }: { label?: string; title: string; children: React.ReactNode }) {
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
    <div className="relative flex min-h-full flex-col bg-[radial-gradient(ellipse_at_top,_#1A1F2C_0%,_#0A0E1A_60%)]">
      <header className="flex h-16 shrink-0 items-center justify-between px-5 md:px-8" style={{ borderBottom: '1px solid var(--line)' }}>
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
              className="mono rounded px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors"
              style={{ color: current === l ? 'var(--accent)' : 'var(--muted)' }}
              title={LOCALE_LABELS[l]}
            >
              {l}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {label !== undefined && (
            <span className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--muted)' }}>
              <span className="h-px w-6" style={{ background: 'var(--accent)' }} />
              {label}
            </span>
          )}
          <h1 className="display mt-3 mb-6 text-3xl font-bold" style={{ color: 'var(--text)' }}>
            {title}
          </h1>
          {children}
          {brand !== null && !brand.whiteLabel && (
            <p className="mt-6 text-center text-xs">
              <a href={SITE_URL} className="text-muted underline-offset-2 hover:text-text hover:underline" data-testid="auth-site-link">
                {t('login.backToSite')}
              </a>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
