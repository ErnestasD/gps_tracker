import { useEffect, useState } from 'react'

import { refCookieString, refFromSearch, readRefCookie } from '@/lib/ref'

/** One-line consent notice for the non-essential `tc_ref` affiliate cookie (§6.9 +
 * PUBLIC_WEB_LOVABLE.md): shown only when the visitor arrived with `?ref=` and has not
 * decided yet. Umami analytics is cookieless, so this is the ONLY cookie on the site. */
const DECLINED_KEY = 'tc_ref_declined'

export function RefConsent() {
  const [ref, setRef] = useState<string | null>(null)

  useEffect(() => {
    const candidate = refFromSearch(window.location.search)
    if (candidate === null) return
    if (readRefCookie(document.cookie) !== null) return // already consented earlier
    if (sessionStorage.getItem(DECLINED_KEY) === '1') return
    setRef(candidate)
  }, [])

  if (ref === null) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(94vw,640px)] -translate-x-1/2 rounded-xl border border-[var(--hairline)] bg-[rgba(10,16,34,0.95)] px-4 py-3 text-xs text-muted-foreground shadow-lg backdrop-blur">
      <span>
        You arrived via a partner link. May we store one cookie (60 days) so your referral is credited? No tracking beyond that.
      </span>
      <span className="ml-3 inline-flex gap-2">
        <button
          className="rounded-full border border-[color:var(--brand-blue)] px-3 py-1 text-[color:var(--brand-blue)] hover:bg-[color:var(--brand-blue)]/10"
          onClick={() => {
            document.cookie = refCookieString(ref)
            setRef(null)
          }}
        >
          Accept
        </button>
        <button
          className="rounded-full border border-[var(--hairline)] px-3 py-1 hover:text-ink"
          onClick={() => {
            sessionStorage.setItem(DECLINED_KEY, '1')
            setRef(null)
          }}
        >
          No thanks
        </button>
      </span>
    </div>
  )
}
