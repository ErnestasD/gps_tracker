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

// ── Display preferences (global: time/date format, time zone, units) ────────
// Device-local like theme/locale: localStorage + a single change event so every
// subscribed formatter (useFmt/useUnits) re-renders instantly on change.

export type TimeFormatPref = '24h' | '12h'
export type DateFormatPref = 'auto' | 'ymd' | 'dmy' | 'mdy'
export type SpeedUnit = 'kmh' | 'mph'
export type DistanceUnit = 'km' | 'mi'
export type VolumeUnit = 'l' | 'gal'

export interface DisplayPrefs {
  timeFormat: TimeFormatPref
  /** 'auto' = browser zone; otherwise an IANA zone id (rendered via Intl timeZone). */
  timeZone: string
  dateFormat: DateFormatPref
  unitSpeed: SpeedUnit
  unitDistance: DistanceUnit
  unitVolume: VolumeUnit
}

const PREFS_KEY = 'orbetra.prefs'
const PREFS_EVENT = 'orbetra:prefs'

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  timeFormat: '24h',
  timeZone: 'auto',
  dateFormat: 'auto',
  unitSpeed: 'kmh',
  unitDistance: 'km',
  unitVolume: 'l',
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/** Unknown JSON → a valid DisplayPrefs (each field falls back independently). */
function sanitizePrefs(v: unknown): DisplayPrefs {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  return {
    timeFormat: oneOf(o['timeFormat'], ['24h', '12h'], DEFAULT_DISPLAY_PREFS.timeFormat),
    timeZone: typeof o['timeZone'] === 'string' && o['timeZone'] !== '' ? o['timeZone'] : 'auto',
    dateFormat: oneOf(o['dateFormat'], ['auto', 'ymd', 'dmy', 'mdy'], DEFAULT_DISPLAY_PREFS.dateFormat),
    unitSpeed: oneOf(o['unitSpeed'], ['kmh', 'mph'], DEFAULT_DISPLAY_PREFS.unitSpeed),
    unitDistance: oneOf(o['unitDistance'], ['km', 'mi'], DEFAULT_DISPLAY_PREFS.unitDistance),
    unitVolume: oneOf(o['unitVolume'], ['l', 'gal'], DEFAULT_DISPLAY_PREFS.unitVolume),
  }
}

// cached so getDisplayPrefs is referentially stable between changes — required by
// useSyncExternalStore (a fresh object per getSnapshot would render-loop)
let prefsCache: DisplayPrefs | null = null

export function getDisplayPrefs(): DisplayPrefs {
  if (prefsCache !== null) return prefsCache
  let stored: unknown = null
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    stored = raw === null ? null : JSON.parse(raw)
  } catch {
    stored = null // storage disabled / corrupt JSON → defaults
  }
  prefsCache = sanitizePrefs(stored)
  return prefsCache
}

export function setDisplayPref<K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]): void {
  const next = { ...getDisplayPrefs(), [key]: value }
  prefsCache = next
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    // storage disabled — prefs still apply for this session via the cache
  }
  window.dispatchEvent(new Event(PREFS_EVENT))
}

/** Subscribe to display-pref changes (this tab via the event, other tabs via 'storage').
 * Returns the unsubscribe. */
export function onPrefsChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFS_KEY || e.key === null) {
      prefsCache = null // another tab wrote — drop the cache so the next read re-parses
      cb()
    }
  }
  window.addEventListener(PREFS_EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(PREFS_EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
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
