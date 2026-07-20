/**
 * Notification message builder (E05-5). PURE. Turns a persisted rule event into a
 * channel-agnostic subject + plain-text body; channel drivers wrap it (email HTML via
 * renderBrandedEmail, Telegram as-is).
 *
 * The caller (notifyWorker) resolves and passes a NotifyContext (device label, account timezone,
 * tenant brand) so the message shows the VEHICLE (not a raw IMEI), the time in the ACCOUNT zone
 * (rule 7), and the tenant's white-label brand (not a hardcoded platform name).
 *
 * TODO(account-settings): body text is English and speeds are km/h. The per-user language + speed
 * unit (mph vs km/h) is device-local on the web (localStorage) and unknown to the server — when
 * accounts carry a locale + unit preference, thread it through here. See format/localize.ts.
 */
import { escapeHtml, renderBrandedEmail, type Branding } from '@orbetra/shared'

import { formatWithZone } from '../format/localize.js'

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
  /** tenant product brand for the subject (white-label); 'Orbetra' when unknown */
  brand?: string | undefined
  /** full tenant branding (logo/color/productName/supportEmail) for the branded HTML email body.
   *  Absent/blank ⇒ renderBrandedEmail falls back to `tenantName` + the default accent. */
  branding?: Branding | undefined
  /** tenant name — the fallback product name for renderBrandedEmail when branding has no productName. */
  tenantName?: string | undefined
}

const TITLES: Record<string, string> = {
  overspeed: 'Overspeed',
  low_battery: 'Low battery',
  ignition: 'Ignition',
  din_change: 'Input change',
  power_cut: 'Power cut',
  panic: 'Panic / SOS',
  device_offline: 'Device offline',
  geofence: 'Geofence',
  fuel_theft: 'Fuel theft',
}

/** Readable fallback for an unknown kind: 'some_kind' → 'Some kind' (never leak a raw slug). */
function humanize(kind: string): string {
  const s = kind.replace(/_/g, ' ').trim()
  return s === '' ? kind : s.charAt(0).toUpperCase() + s.slice(1)
}

export function notificationMessage(kind: string, deviceId: string, payload: Record<string, unknown>, at: Date, ctx: NotifyContext = {}): NotifyMessage {
  const brand = ctx.brand && ctx.brand.trim() !== '' ? ctx.brand : 'Orbetra'
  const device = ctx.deviceLabel && ctx.deviceLabel.trim() !== '' ? ctx.deviceLabel : deviceId
  const title = TITLES[kind] ?? humanize(kind)
  const detail = summarize(kind, payload)
  const subject = `[${brand}] ${title} — ${device}`
  const when = formatWithZone(at, ctx.timezone)
  const text = [`${title} alert`, `Device: ${device}`, `When: ${when}`, ...(detail ? [detail] : [])].join('\n')
  const html = renderAlertHtml(subject, title, device, when, detail, ctx)
  return { subject, text, html }
}

/**
 * Build the white-label branded HTML body for an alert email — the same content as `text` (title,
 * device, timestamp, detail) as escaped HTML paragraphs, wrapped in the tenant's brand shell.
 * FAIL SAFE: a missing/blank branding falls back to the tenant name + default accent (handled by
 * renderBrandedEmail); any render error returns `undefined` so the email still sends plain text and
 * the worker never crashes (rule: a formatting fault must never drop the notification).
 */
function renderAlertHtml(subject: string, title: string, device: string, when: string, detail: string, ctx: NotifyContext): string | undefined {
  try {
    const p = (label: string, value: string): string =>
      `<p style="margin:0 0 8px"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`
    const bodyHtml = [
      `<h2 style="margin:0 0 12px;font-size:16px">${escapeHtml(title)} alert</h2>`,
      p('Device', device),
      p('When', when),
      ...(detail ? [`<p style="margin:0 0 8px">${escapeHtml(detail)}</p>`] : []),
    ].join('')
    const tenantName = ctx.tenantName && ctx.tenantName.trim() !== '' ? ctx.tenantName : brandName(ctx)
    return renderBrandedEmail(ctx.branding ?? {}, tenantName, { subject, bodyHtml })
  } catch {
    return undefined // never let a template fault drop the email — fall back to plain text
  }
}

/** Product/tenant name for the branded shell fallback (mirrors the subject brand). */
function brandName(ctx: NotifyContext): string {
  return ctx.brand && ctx.brand.trim() !== '' ? ctx.brand : 'Orbetra'
}

/** One-line, human-readable detail per kind (mirrors the web eventSummary). English for v1
 *  (TODO(account-settings) above); speeds carry an explicit km/h label. */
function summarize(kind: string, p: Record<string, unknown>): string {
  switch (kind) {
    case 'overspeed':
      return `Speed ${num(p['speedKmh'])} km/h over limit ${num(p['limitKmh'])} km/h`
    case 'low_battery':
      return `Battery ${num(p['volts'])} V below ${num(p['thresholdV'])} V`
    case 'ignition':
      return `Ignition turned ${p['ignition'] ? 'on' : 'off'}`
    case 'din_change':
      return `Digital input 1 ${p['din1'] ? 'active' : 'inactive'}`
    case 'power_cut':
      return 'External power lost'
    case 'panic':
      return 'SOS / panic button triggered'
    case 'device_offline':
      return `No fix for ${num(p['offlineH'])} h (threshold ${num(p['thresholdH'])} h)`
    case 'geofence': {
      const name = typeof p['name'] === 'string' && p['name'] !== '' ? p['name'] : 'geofence'
      const t = p['transition'] === 'enter' ? 'entered' : p['transition'] === 'exit' ? 'exited' : ''
      return t === '' ? name : `${t} ${name}`
    }
    case 'fuel_theft': {
      const unit = p['unit'] === 'liters' ? 'L' : '%'
      return `Fuel dropped ${num(p['drop'])} ${unit} (baseline ${num(p['baseline'])} ${unit}, now ${num(p['to'])} ${unit})`
    }
    default:
      return ''
  }
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '—'
}
