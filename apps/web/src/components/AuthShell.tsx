import { useTranslation } from 'react-i18next'

import { usePublicBranding } from '@/lib/publicBranding'

/**
 * The frame around every pre-auth screen (login, forgot, reset, activate).
 *
 * It exists to answer one question in ONE place: whose product is this? All four screens used to
 * hard-code the Orbetra wordmark, so a reseller's customer landing on `fleet.reseller.lt/login` was
 * shown OUR brand on the only screen every one of their users passes through — while apps/site
 * promises "White-label domain, logo, colours. Orbetra never appears." Getting that wrong on one of
 * four pages is the likely failure mode, which is why it is a shell and not a snippet.
 *
 * It is also where the link BACK to the marketing site lives, for the same reason and with the same
 * switch: on our own hosts a visitor who lands on the login page with no account has nowhere to go
 * and no way to find out what this is, so the wordmark and a footer line lead to orbetra.com. On a
 * tenant's host that link would advertise their supplier to their customers, so nothing renders.
 */
const SITE_URL = (import.meta.env['VITE_SITE_URL'] as string | undefined) ?? 'https://orbetra.com'

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const brand = usePublicBranding()

  // in flight: the card renders without a mark rather than flashing OURS and swapping — a 200 ms
  // flash of the wrong brand is still the wrong brand, and it is what a screenshot catches.
  // KNOWN GAP: the tab is not covered. index.html ships `<title>Orbetra</title>`, our favicon and
  // the PWA manifest name, and `applyBranding` only replaces them once this fetch resolves — so a
  // tenant's tab does flash ours. Closing it needs the branding resolved server-side into the HTML
  // (the SPA is served by `vite preview`, which cannot), so it is a real limitation, not an
  // oversight. The BACKGROUND is likewise deliberately the product gradient rather than the
  // tenant's `primary`: an arbitrary hex behind a login card fails contrast far more often than it
  // flatters, and nothing in the branding schema constrains it to a background-safe colour.
  const mark =
    brand === null ? null : brand.whiteLabel ? (
      brand.branding.logoUrl !== undefined ? (
        <img src={brand.branding.logoUrl} alt={brand.productName ?? ''} className="mb-3 h-8 w-auto" data-testid="auth-tenant-logo" />
      ) : (
        <span className="mb-3 text-lg font-semibold" style={{ color: 'var(--accent)' }} data-testid="auth-tenant-name">
          {brand.productName}
        </span>
      )
    ) : (
      <a href={SITE_URL} aria-label="Orbetra" data-testid="auth-home-link">
        <img src="/orbetra-wordmark.svg" alt="Orbetra" className="mb-3 h-8 w-auto" />
      </a>
    )

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,_#1A1F2C_0%,_#0A0E1A_60%)] p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center">{mark}</div>
        {children}
        {brand !== null && !brand.whiteLabel && (
          <p className="mt-6 text-center text-xs">
            <a href={SITE_URL} className="text-muted underline-offset-2 hover:text-text hover:underline" data-testid="auth-site-link">
              {t('login.backToSite')}
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
