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

/** Time-only (HH:mm or HH:mm:ss) under the same prefs — the timeline's clock axis and its
 * second-precision readout. Cached like the date formatters; construction is the expensive part. */
function timeFormatterFor(locale: string, opts: FmtOpts, withSeconds: boolean): (d: Date) => string {
  const key = `${locale}|${withSeconds ? 'ts' : 't'}|${opts.timeFormat ?? ''}|${opts.timeZone ?? ''}`
  let f = formatters.get(key)
  if (f !== undefined) return f
  const hourCycle = opts.timeFormat === undefined ? undefined : opts.timeFormat === '12h' ? ('h12' as const) : ('h23' as const)
  const intl = safeIntl(locale, {
    hour: opts.timeFormat === '12h' ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    hourCycle: hourCycle ?? 'h23',
    ...(opts.timeZone !== undefined ? { timeZone: opts.timeZone } : {}),
  })
  f = (d) => intl.format(d)
  formatters.set(key, f)
  return f
}

export function fmtTime(iso: string, locale = 'en', opts: FmtOpts = {}, withSeconds = false): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return EMPTY
  return timeFormatterFor(locale, opts, withSeconds)(d)
}

/** Formatters bound to the current i18n language AND the live display prefs:
 * `dt` = date+time, `d` = date only, `tm`/`tms` = time (± seconds). Re-renders on language or
 * pref changes. */
export function useFmt(): {
  dt: (iso: string) => string
  d: (iso: string) => string
  tm: (iso: string) => string
  tms: (iso: string) => string
  /** "6 min ago" from an epoch-ms instant — the fleet's last-contact age. */
  ago: (ms: number) => string
} {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const prefs = useSyncExternalStore(onPrefsChange, getDisplayPrefs)
  return useMemo(() => {
    const opts: FmtOpts = {
      timeFormat: prefs.timeFormat,
      dateFormat: prefs.dateFormat,
      ...(prefs.timeZone !== 'auto' ? { timeZone: prefs.timeZone } : {}),
    }
    return {
      dt: (iso: string) => fmtDateTime(iso, lang, opts),
      d: (iso: string) => fmtDate(iso, lang, opts),
      tm: (iso: string) => fmtTime(iso, lang, opts, false),
      tms: (iso: string) => fmtTime(iso, lang, opts, true),
      // deliberately NOT timezone-formatted: an elapsed duration is the same everywhere
      ago: (ms: number) => fmtAgo(Date.now() - ms, lang),
    }
  }, [lang, prefs])
}

/**
 * "6 min ago" — how long since a device last reported.
 *
 * Added because the fleet showed a colour and a word and nothing else, so an operator could not
 * tell four minutes of silence from four hours. The colour answers "should I care", this answers
 * "how bad", and the second question is the one that decides what they do next.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled table: it declines correctly in Lithuanian
 * and Polish, where "prieš 2 minutes" and "prieš 21 minutę" are not the same word.
 *
 * A NEGATIVE age is clamped to zero rather than rendered as "in 3 minutes". Device clocks drift and
 * some run ahead — the pipeline counts it (`positions_clock_skewed_total`) — and a vehicle that
 * reports from the future is a fact about the tracker's RTC, not something to show a dispatcher.
 */
export function fmtAgo(ms: number, locale = 'en'): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return rtf.format(-s, 'second')
  const m = Math.round(s / 60)
  if (m < 60) return rtf.format(-m, 'minute')
  const h = Math.round(m / 60)
  if (h < 24) return rtf.format(-h, 'hour')
  return rtf.format(-Math.round(h / 24), 'day')
}
