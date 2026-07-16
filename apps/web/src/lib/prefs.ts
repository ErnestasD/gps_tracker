/**
 * Client preferences (E03-2 Settings/Profile): theme + locale persisted to
 * localStorage and applied eagerly. Dark-first — `.light` on <html> flips the
 * tokens (styles/tokens.css). No server round-trip; these are device-local.
 */
export type Theme = 'dark' | 'light'

const THEME_KEY = 'orbetra.theme'
const LOCALE_KEY = 'orbetra.locale'

export function getTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

const THEME_EVENT = 'orbetra:theme'

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // storage disabled — theme still applies for this session
  }
  applyTheme(theme)
  // both the topbar toggle and the settings radios render theme state — broadcast so
  // neither holds a stale copy (ADR-028 review MED)
  window.dispatchEvent(new Event(THEME_EVENT))
}

/** Subscribe to theme changes made anywhere in the app. Returns the unsubscribe. */
export function onThemeChange(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb)
  return () => window.removeEventListener(THEME_EVENT, cb)
}

export function getStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_KEY)
  } catch {
    return null
  }
}

export function setStoredLocale(locale: string): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    // ignore
  }
}
