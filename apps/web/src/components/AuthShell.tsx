import { ChevronDown, Eye, EyeOff, Globe } from 'lucide-react'
import { useState } from 'react'
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

/** The site's own nav, in its order. Absolute links: these pages live on the marketing site. */
const NAV = [
  ['platform', '/'],
  ['pricing', '/pricing'],
  ['resellers', '/tsp'],
  ['partners', '/partners'],
  ['contact', '/pilot'],
  ['docs', '/docs'],
] as const

/** The site's globe + code + chevron control, not four bare codes. */
function LanguagePicker() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = i18n.language.split('-')[0] ?? 'en'
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('settings.locale')}
        data-testid="auth-lang"
        className="mono flex items-center gap-1.5 rounded px-2 py-1 text-xs uppercase"
        style={{ color: 'var(--muted)' }}
      >
        <Globe className="h-3.5 w-3.5" />
        {current}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <ul
          className="absolute right-0 z-50 mt-1 min-w-[9rem] overflow-hidden rounded border py-1"
          style={{ borderColor: 'var(--auth-hairline)', background: 'rgba(10,20,40,0.98)' }}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <li key={l}>
              <button
                type="button"
                onClick={() => { setLocale(l); setOpen(false) }}
                data-testid={`auth-lang-${l}`}
                className="block w-full px-3 py-1.5 text-left text-sm"
                style={{ color: current === l ? 'var(--accent)' : 'var(--auth-ink)' }}
              >
                {LOCALE_LABELS[l]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AuthShell({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const brand = usePublicBranding()

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
      {/* THE SITE'S HEADER, not an approximation — same lockup, same links, same language control,
          same trial pill. It renders ONLY on our own hosts: it is a marketing nav, and putting it on
          `fleet.reseller.lt` would advertise their supplier to their customers on the one screen all
          of them pass through. On a tenant host the bar carries their mark and the language control,
          and nothing else. */}
      <header className="fixed inset-x-0 top-0 z-50 border-b" style={{ borderColor: 'var(--auth-hairline)', background: 'rgba(4,7,15,0.85)', backdropFilter: 'blur(8px)' }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center">{mark}</div>

          {brand !== null && !brand.whiteLabel && (
            <nav className="hidden items-center gap-8 md:flex">
              {NAV.map(([key, path]) => (
                <a key={key} href={`${SITE_URL}${path}`} className="text-sm transition-colors" style={{ color: 'var(--muted)' }}>
                  {t(`authNav.${key}`)}
                </a>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-3">
            <LanguagePicker />
            {brand !== null && !brand.whiteLabel && (
              <a href={`${SITE_URL}/signup`} className="auth-trial hidden sm:inline-flex" data-testid="auth-trial">
                {t('authNav.trial')}
              </a>
            )}
          </div>
        </div>
      </header>

      {/* the partner login's own container, verbatim */}
      <div className="mx-auto max-w-md px-6 pt-28 pb-28 md:pt-36">
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

/**
 * A labelled input in the partner login's exact shape: mono uppercase caption over the field.
 *
 * A PASSWORD field gets a reveal toggle. It is not decoration: the commonest reason a correct
 * password is rejected is a typo nobody can see, and on a phone keyboard that is most of the time.
 * The button carries an aria-label that flips with the state, so a screen reader announces which
 * way it goes rather than just "button".
 */
export function AuthField({ id, label, ...input }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const isPassword = input.type === 'password'
  return (
    <label htmlFor={id} className="grid gap-1.5">
      <span className="auth-field">{label}</span>
      <span className="relative block">
        <input
          id={id}
          className="auth-input"
          {...input}
          {...(isPassword ? { type: shown ? 'text' : 'password', style: { paddingRight: '2.75rem' } } : {})}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={t(shown ? 'login.hidePassword' : 'login.showPassword')}
            aria-pressed={shown}
            data-testid={`${id}-reveal`}
            // tabIndex -1 would hide it from the keyboard entirely; it stays reachable, after the
            // field and before submit, which is where someone checking a typo expects it
            className="absolute inset-y-0 right-0 grid w-11 place-items-center"
            style={{ color: 'var(--muted)' }}
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </span>
    </label>
  )
}
