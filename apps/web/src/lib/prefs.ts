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

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // storage disabled — theme still applies for this session
  }
  applyTheme(theme)
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
