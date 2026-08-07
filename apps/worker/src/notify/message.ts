/**
 * Notification message builder (E05-5). PURE. Turns a persisted rule event into a
 * channel-agnostic subject + plain-text body; channel drivers wrap it (email HTML via
 * renderBrandedEmail, Telegram as-is).
 *
 * The caller (notifyWorker) resolves and passes a NotifyContext (device label, account timezone,
 * language, units, tenant brand) so the message shows the VEHICLE (not a raw IMEI), the time in the
 * ACCOUNT zone (rule 7), the speeds in the units that account chose, all in its language, under the
 * tenant's white-label brand.
 */
import { escapeHtml, renderBrandedEmail, METRIC_UNITS, type Branding, type DisplayUnits } from '@orbetra/shared'

import { formatWithZone, speedPair, volumeL } from '../format/localize.js'
import { stringsFor, unitLabels, type WorkerStrings } from '../format/strings.js'

export interface NotifyMessage {
  subject: string
  text: string
  /** White-label branded HTML body for the email channel (E05-4). Absent when it could not be
   *  built — the email then sends plain `text` only. Telegram/webpush ignore it. */
  html?: string | undefined
}

/** Per-message context resolved by the worker from the device/account/tenant registry. */
export interface NotifyContext {
  /** device display name or plate; falls back to the raw device id when unresolved */
  deviceLabel?: string | undefined
  /** account IANA zone for the timestamp (rule 7); UTC when unknown */
  timezone?: string | undefined
  /** account language (en|lt|de|pl) — anything else renders English */
  locale?: string | undefined
  /** account display units; metric when unknown */
  units?: DisplayUnits | undefined
  /** tenant product brand for the subject (white-label); 'Orbetra' when unknown */
  brand?: string | undefined
  /** full tenant branding (logo/color/productName/supportEmail) for the branded HTML email body.
   *  Absent/blank ⇒ renderBrandedEmail falls back to `tenantName` + the default accent. */
  branding?: Branding | undefined
  /** tenant name — the fallback product name for renderBrandedEmail when branding has no productName. */
  tenantName?: string | undefined
}

/** Readable fallback for an unknown kind: 'some_kind' → 'Some kind' (never leak a raw slug).
 *  Language-neutral by necessity — a kind this build has never seen has no translation. */
function humanize(kind: string): string {
  const s = kind.replace(/_/g, ' ').trim()
  return s === '' ? kind : s.charAt(0).toUpperCase() + s.slice(1)
}

export function notificationMessage(kind: string, deviceId: string, payload: Record<string, unknown>, at: Date, ctx: NotifyContext = {}): NotifyMessage {
  const s = stringsFor(ctx.locale)
  const units = ctx.units ?? METRIC_UNITS
  const brand = ctx.brand && ctx.brand.trim() !== '' ? ctx.brand : 'Orbetra'
  const device = ctx.deviceLabel && ctx.deviceLabel.trim() !== '' ? ctx.deviceLabel : deviceId
  const title = s.alertTitle[kind] ?? humanize(kind)
  const detail = summarize(kind, payload, s, units)
  const subject = `[${brand}] ${title} — ${device}`
  const when = formatWithZone(at, ctx.timezone)
  const heading = s.alertHeading(title)
  const text = [heading, `${s.labelDevice}: ${device}`, `${s.labelWhen}: ${when}`, ...(detail ? [detail] : [])].join('\n')
  const html = renderAlertHtml(subject, heading, device, when, detail, s, ctx)
  return { subject, text, html }
}

/**
 * Build the white-label branded HTML body for an alert email — the same content as `text` (heading,
 * device, timestamp, detail) as escaped HTML paragraphs, wrapped in the tenant's brand shell.
 * FAIL SAFE: a missing/blank branding falls back to the tenant name + default accent (handled by
 * renderBrandedEmail); any render error returns `undefined` so the email still sends plain text and
 * the worker never crashes (rule: a formatting fault must never drop the notification).
 */
function renderAlertHtml(subject: string, heading: string, device: string, when: string, detail: string, s: WorkerStrings, ctx: NotifyContext): string | undefined {
  try {
    const p = (label: string, value: string): string =>
      `<p style="margin:0 0 8px"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`
    const bodyHtml = [
      `<h2 style="margin:0 0 12px;font-size:16px">${escapeHtml(heading)}</h2>`,
      p(s.labelDevice, device),
      p(s.labelWhen, when),
      ...(detail ? [`<p style="margin:0 0 8px">${escapeHtml(detail)}</p>`] : []),
    ].join('')
    const tenantName = ctx.tenantName && ctx.tenantName.trim() !== '' ? ctx.tenantName : brandName(ctx)
    // the footer ("you received this because…") follows the same language as the body
    return renderBrandedEmail(ctx.branding ?? {}, tenantName, { subject, bodyHtml, locale: ctx.locale })
  } catch {
    return undefined // never let a template fault drop the email — fall back to plain text
  }
}

/** Product/tenant name for the branded shell fallback (mirrors the subject brand). */
function brandName(ctx: NotifyContext): string {
  return ctx.brand && ctx.brand.trim() !== '' ? ctx.brand : 'Orbetra'
}

/** One-line, human-readable detail per kind (mirrors the web eventSummary), in the account's
 *  language and units — speeds and volumes carry the label that matches the number. */
function summarize(kind: string, p: Record<string, unknown>, s: WorkerStrings, u: DisplayUnits): string {
  const l = unitLabels(s, u)
  switch (kind) {
    case 'overspeed': {
      // formatted as a PAIR: rounded independently, an integer mph speed and limit one km/h apart
      // print the same number and the alert contradicts itself — see speedPair
      const sp = p['speedKmh']
      const lim = p['limitKmh']
      if (typeof sp !== 'number' || typeof lim !== 'number') return s.detail.overspeed(num(sp), num(lim), l.speed)
      const pair = speedPair(sp, lim, u)
      return s.detail.overspeed(pair.speed, pair.limit, l.speed)
    }
    case 'low_battery':
      return s.detail.lowBattery(num(p['volts']), num(p['thresholdV']), s.unit.v)
    // truthy, not `=== true`: the rule engine writes these from raw IO values, so a `1` must read
    // as on exactly as it did before this became a boolean argument
    case 'ignition':
      return s.detail.ignition(Boolean(p['ignition']))
    case 'din_change':
      return s.detail.dinChange(Boolean(p['din1']))
    case 'power_cut':
      return s.detail.powerCut
    case 'panic':
      return s.detail.panic
    case 'device_offline':
      return s.detail.deviceOffline(num(p['offlineH']), num(p['thresholdH']), s.unit.h)
    case 'geofence': {
      // null, not a fallback WORD: several languages inflect the noun after "into"/"out of", so the
      // nameless sentence has to be written per language rather than assembled — see strings.ts
      const name = typeof p['name'] === 'string' && p['name'] !== '' ? p['name'] : null
      const t = p['transition'] === 'enter' ? 'enter' : p['transition'] === 'exit' ? 'exit' : null
      return s.detail.geofence(name, t)
    }
    case 'fuel_theft': {
      // A percentage is not a volume: only the litres variant converts to gallons. Converting a
      // "fuel dropped 25 %" into gallons would be arithmetic on a ratio.
      const isVolume = p['unit'] === 'liters'
      const label = isVolume ? l.volume : '%'
      const val = (v: unknown): string => (typeof v !== 'number' ? '—' : isVolume ? volumeL(v, u) : num(v))
      return s.detail.fuelTheft(val(p['drop']), val(p['baseline']), val(p['to']), label)
    }
    default:
      return ''
  }
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '—'
}
