/** Affiliate ref capture (§6.9): `?ref=<code>` → cookie `tc_ref` (60 days, last touch
 * wins). The cookie is non-essential, so it is set ONLY after the visitor accepts the
 * one-line notice (PUBLIC_WEB_LOVABLE.md). Pure helpers — unit-tested. */

const COOKIE = 'tc_ref'
const DAYS_60_S = 60 * 24 * 3600

export function refFromSearch(search: string): string | null {
  const ref = new URLSearchParams(search).get('ref')
  if (ref === null) return null
  const trimmed = ref.trim().slice(0, 64)
  // codes are url-safe slugs; anything else is noise, not a referral
  return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : null
}

const SLUG = /^[a-zA-Z0-9_-]{1,64}$/

export function readRefCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) {
      const val = decodeURIComponent(v.join('='))
      // re-validate: a corrupted cookie must not make the server 400 the whole pilot post
      return SLUG.test(val) ? val : null
    }
  }
  return null
}

export function refCookieString(code: string): string {
  // Secure: the site is HTTPS+HSTS (localhost is exempt from the Secure requirement)
  return `${COOKIE}=${encodeURIComponent(code)}; Max-Age=${DAYS_60_S}; Path=/; SameSite=Lax; Secure`
}

/** Current ref for the pilot form: cookie wins (consented), else the live query param. */
export function currentRef(): string | null {
  return readRefCookie(document.cookie) ?? refFromSearch(window.location.search)
}
