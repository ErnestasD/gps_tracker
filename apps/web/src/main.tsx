import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import i18n from './i18n'
import './styles/index.css'
import { setUnauthorizedHandler } from './lib/client'
import { SUPPORTED_LOCALES } from '@orbetra/shared'

import { applyTheme, getStoredLocale, getTheme, setStoredLocale } from './lib/prefs'
import { router } from './router'

// apply device-local prefs before first paint (E03-2 Settings)
applyTheme(getTheme())
/**
 * `?lng` BEATS the stored preference, and is then stored itself.
 *
 * This line used to be `changeLanguage(getStoredLocale())` unconditionally, which ran AFTER
 * i18next's detector had already honoured the query string — so a visitor who picked German on
 * orbetra.com and clicked through arrived at a login page in whatever they had chosen months ago.
 * The parameter was read and then overwritten, one statement later, by this file.
 *
 * A language in the URL is a choice made seconds ago on another origin; the stored one is a choice
 * made at some point in the past. The explicit one wins — and is persisted, so it also survives the
 * next navigation inside the SPA, where there is no query string to read.
 */
const urlLocale = new URLSearchParams(window.location.search).get('lng')
const wanted = urlLocale !== null && (SUPPORTED_LOCALES as readonly string[]).includes(urlLocale) ? urlLocale : getStoredLocale()
if (wanted !== null) {
  setStoredLocale(wanted)
  void i18n.changeLanguage(wanted)
}

// Mid-session auth recovery (R4 HIGH): when a REST call's refresh finally fails, bounce the whole
// app to /login. Previously only the map's WS path recovered — every other page froze on a
// stale/empty view with no login prompt. router.navigate is idempotent under a burst of 401s.
setUnauthorizedHandler(() => void router.navigate({ to: '/login' }))

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

// App-shell SW (E02-6 PWA AC). Dev is exempt — vite serves modules the SW must not cache.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
