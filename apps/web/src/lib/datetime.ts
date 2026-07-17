import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shared locale-aware date/time formatting, bound to the APP LANGUAGE (i18n) instead of the
 * browser locale. Replaces scattered `toLocaleString()` / `Intl.DateTimeFormat(undefined, …)`
 * call sites so timestamps follow the language the user selected in Settings.
 *
 * Scope note (CLAUDE.md rule 7): the DB stores UTC `timestamptz`; rendering in the ACCOUNT'S
 * configured time zone (via date-fns-tz) is a future story. This module fixes the LOCALE only —
 * values still render in the viewer's local time zone, exactly as before.
 */

const EMPTY = '—'

/** One formatter per locale+shape; Intl.DateTimeFormat construction is expensive in table loops. */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, dateOnly: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${dateOnly ? 'd' : 'dt'}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' })
    formatters.set(key, f)
  }
  return f
}

/** Medium date + short time in the given locale. Garbage input renders '—', never throws. */
export function fmtDateTime(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EMPTY
  return formatter(locale, false).format(d)
}

/** Medium date only in the given locale. Garbage input renders '—', never throws. */
export function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EMPTY
  return formatter(locale, true).format(d)
}

/** Formatters bound to the current i18n language: `dt` = date+time, `d` = date only. */
export function useFmt(): { dt: (iso: string) => string; d: (iso: string) => string } {
  const { i18n } = useTranslation()
  const lang = i18n.language
  return useMemo(() => ({ dt: (iso: string) => fmtDateTime(iso, lang), d: (iso: string) => fmtDate(iso, lang) }), [lang])
}
