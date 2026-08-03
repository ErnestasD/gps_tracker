import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { currentRef, refCookieString, refFromSearch } from '@/lib/ref'

/** Site-wide cookie consent (successor of the old one-line RefConsent). The ONLY
 * non-essential cookie is the `tc_ref` affiliate cookie (§6.9): it is written
 * exclusively after an explicit "accept", and dropped again on "essential". All ref
 * parsing/validation lives in lib/ref.ts (unit-tested) — this file only decides WHEN
 * the cookie may be written. */
export type ConsentChoice = 'accepted' | 'essential' | null

const STORAGE_KEY = 'orbetra_cookie_consent'
/** A ?ref= seen before the visitor decided — kept for the session so navigating away
 * from the landing URL doesn't lose the referral if they accept later. */
const PENDING_KEY = 'tc_ref_pending'

type ConsentValue = {
  choice: ConsentChoice
  ready: boolean
  setChoice: (c: Exclude<ConsentChoice, null>) => void
  reopen: () => void
  bannerOpen: boolean
}

const ConsentContext = createContext<ConsentValue>({
  choice: null,
  ready: false,
  setChoice: () => {},
  reopen: () => {},
  bannerOpen: false,
})

function stashPendingRef(code: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, code)
  } catch {
    /* ignore */
  }
}

function takePendingRef(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    return v
  } catch {
    return null
  }
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ConsentChoice>(null)
  const [ready, setReady] = useState(false)
  const [forced, setForced] = useState(false)

  useEffect(() => {
    let stored: ConsentChoice = null
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY) as ConsentChoice
      if (raw === 'accepted' || raw === 'essential') stored = raw
    } catch {
      /* ignore */
    }
    if (stored) setChoiceState(stored)
    // ?ref= arrival (always a full page load): consented → write now (last touch wins);
    // undecided → stash until the banner is answered; declined → ignore.
    const ref = refFromSearch(window.location.search)
    if (ref !== null) {
      if (stored === 'accepted') document.cookie = refCookieString(ref)
      else if (stored === null) stashPendingRef(ref)
    }
    setReady(true)
  }, [])

  const setChoice = useCallback((c: Exclude<ConsentChoice, null>) => {
    setChoiceState(c)
    setForced(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, c)
    } catch {
      /* ignore */
    }
    if (c === 'essential') {
      takePendingRef()
      document.cookie = 'tc_ref=; Max-Age=0; Path=/' // drop the optional referral cookie
    } else {
      const ref = refFromSearch(window.location.search) ?? takePendingRef()
      if (ref !== null && refFromSearch(`?ref=${ref}`) !== null) document.cookie = refCookieString(ref)
    }
  }, [])

  const value = useMemo<ConsentValue>(
    () => ({
      choice,
      ready,
      setChoice,
      reopen: () => setForced(true),
      bannerOpen: ready && (forced || choice === null),
    }),
    [choice, ready, setChoice, forced],
  )

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
}

export function useConsent() {
  return useContext(ConsentContext)
}

/** Referral code for form posts: consented cookie wins, else the live ?ref= param
 * (passing the live param through a POST stores no cookie, so no consent needed). */
export function readRefCode(): string | null {
  if (typeof document === 'undefined') return null
  return currentRef()
}
