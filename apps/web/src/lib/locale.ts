import { SUPPORTED_LOCALES, type Locale } from '@orbetra/shared'

import i18n from '@/i18n'

import { mutate } from './client'
import { setStoredLocale } from './prefs'

export { SUPPORTED_LOCALES }
export type { Locale }

/** Human labels for the language switcher (endonyms — each shown in its own language). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  lt: 'Lietuvių',
  pl: 'Polski',
  de: 'Deutsch',
}

/**
 * Apply a UI language everywhere from ONE call: instantly (i18next + localStorage, like the theme)
 * AND persisted server-side — a best-effort `PATCH /v1/auth/me` so the choice follows the user across
 * devices and the server can localize their emails/reports. A network/permission failure never breaks
 * the instant local switch (persistence is additive, not required).
 */
export function setLocale(locale: string): void {
  setStoredLocale(locale)
  void i18n.changeLanguage(locale)
  void mutate('PATCH', '/v1/auth/me', { locale }).catch(() => undefined)
}
