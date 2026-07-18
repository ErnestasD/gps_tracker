import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import i18n from './i18n'
import './styles/index.css'
import { setUnauthorizedHandler } from './lib/client'
import { applyTheme, getStoredLocale, getTheme } from './lib/prefs'
import { router } from './router'

// apply device-local prefs before first paint (E03-2 Settings)
applyTheme(getTheme())
const storedLocale = getStoredLocale()
if (storedLocale !== null) void i18n.changeLanguage(storedLocale)

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
