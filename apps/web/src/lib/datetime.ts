import { useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { getDisplayPrefs, onPrefsChange, type DateFormatPref, type TimeFormatPref } from './prefs'

/**
 * Shared locale-aware date/time formatting, bound to the APP LANGUAGE (i18n) instead of the
 * browser locale, plus the GLOBAL display preferences (settings → Rodymo nustatymai):
 * 12/24-hour clock, an explicit time zone (Intl timeZone — no date-fns-tz needed), and an
 * explicit date pattern (YYYY-MM-DD / DD.MM.YYYY / MM/DD/YYYY) assembled from Intl parts.
 *
 * Scope note (CLAUDE.md rule 7): the DB stores UTC `timestamptz`; rendering happens here at
 * the edge. Without opts the output matches the previous behavior exactly (locale defaults,
 * viewer's local zone).
 */

const EMPTY = '—'

export interface FmtOpts {
  /** '24h' | '12h'; omitted = the locale's default hour cycle (legacy behavior). */
  timeFormat?: TimeFormatPref
  /** IANA zone id; omitted = the browser's zone. Invalid ids fall back to the browser zone. */
  timeZone?: string
  /** 'ymd' | 'dmy' | 'mdy' force a fixed pattern; 'auto'/omitted = locale default. */
  dateFormat?: DateFormatPref
}

/** One formatter per locale+shape+opts; Intl.DateTimeFormat construction is expensive in table loops. */
const formatters = new Map<string, (d: Date) => string>()

/** Intl.DateTimeFormat that never throws on a bad timeZone — retries without it. */
function safeIntl(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options)
  } catch {
    const rest = { ...options }
    delete rest.timeZone
    return new Intl.DateTimeFormat(locale, rest)
  }
}

/** 'ymd' → 2026-07-14 · 'dmy' → 14.07.2026 · 'mdy' → 07/14/2026 (+ ' HH:mm'/' h:mm AM'). */
function assemble(parts: Intl.DateTimeFormatPart[], pattern: 'ymd' | 'dmy' | 'mdy', dateOnly: boolean): string {
  const get = (type: Intl.DateTimeFormatPart['type']): string => parts.find((p) => p.type === type)?.value ?? ''
  const y = get('year')
  const m = get('month')
  const d = get('day')
  const date = pattern === 'ymd' ? `${y}-${m}-${d}` : pattern === 'dmy' ? `${d}.${m}.${y}` : `${m}/${d}/${y}`
  if (dateOnly) return date
  const dayPeriod = get('dayPeriod')
  return `${date} ${get('hour')}:${get('minute')}${dayPeriod !== '' ? ` ${dayPeriod}` : ''}`
}

function formatter(locale: string, dateOnly: boolean, opts: FmtOpts): (d: Date) => string {
  const key = `${locale}|${dateOnly ? 'd' : 'dt'}|${opts.timeFormat ?? ''}|${opts.timeZone ?? ''}|${opts.dateFormat ?? ''}`
  let f = formatters.get(key)
  if (f !== undefined) return f
  // hourCycle (not hour12): 'h23' avoids the "24:00" midnight some locales produce with hour12:false
  const hourCycle = opts.timeFormat === undefined ? undefined : opts.timeFormat === '12h' ? ('h12' as const) : ('h23' as const)
  const timeZone = opts.timeZone
  const pattern = opts.dateFormat !== undefined && opts.dateFormat !== 'auto' ? opts.dateFormat : null
  if (pattern === null) {
    const intl = safeIntl(locale, {
      dateStyle: 'medium',
      ...(dateOnly ? {} : { timeStyle: 'short' }),
      ...(hourCycle !== undefined && !dateOnly ? { hourCycle } : {}),
      ...(timeZone !== undefined ? { timeZone } : {}),
    })
    f = (d) => intl.format(d)
  } else {
    const intl = safeIntl(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      // 12h clocks read '5:03 PM', 24h '17:03'
      ...(dateOnly ? {} : { hour: opts.timeFormat === '12h' ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: hourCycle ?? 'h23' }),
      ...(timeZone !== undefined ? { timeZone } : {}),
    })
    f = (d) => assemble(intl.formatToParts(d), pattern, dateOnly)
  }
  formatters.set(key, f)
  return f
}

/** Date + short time in the given locale, honoring FmtOpts. Garbage input renders '—', never throws. */
export function fmtDateTime(iso: string, locale: string, opts: FmtOpts = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EMPTY
  return formatter(locale, false, opts)(d)
}

/** Date only in the given locale, honoring FmtOpts. Garbage input renders '—', never throws. */
export function fmtDate(iso: string, locale: string, opts: FmtOpts = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EMPTY
  return formatter(locale, true, opts)(d)
}

/** Formatters bound to the current i18n language AND the live display prefs:
 * `dt` = date+time, `d` = date only. Re-renders on language or pref changes. */
export function useFmt(): { dt: (iso: string) => string; d: (iso: string) => string } {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const prefs = useSyncExternalStore(onPrefsChange, getDisplayPrefs)
  return useMemo(() => {
    const opts: FmtOpts = {
      timeFormat: prefs.timeFormat,
      dateFormat: prefs.dateFormat,
      ...(prefs.timeZone !== 'auto' ? { timeZone: prefs.timeZone } : {}),
    }
    return { dt: (iso: string) => fmtDateTime(iso, lang, opts), d: (iso: string) => fmtDate(iso, lang, opts) }
  }, [lang, prefs])
}
