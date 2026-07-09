/**
 * Notification message builder (E05-5). PURE. Turns a persisted rule event into a
 * channel-agnostic subject + plain-text body; channel drivers wrap it (email HTML via
 * renderBrandedEmail, Telegram as-is). Kept minimal/English for v1 — localized templates
 * are a follow-up (the account's language would drive them).
 */
export interface NotifyMessage {
  subject: string
  text: string
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
}

export function notificationMessage(kind: string, deviceId: string, payload: Record<string, unknown>, at: Date): NotifyMessage {
  const title = TITLES[kind] ?? kind
  const detail = summarize(kind, payload)
  const subject = `[Orbetra] ${title} — device ${deviceId}`
  const text = [`${title} alert`, `Device: ${deviceId}`, `When: ${at.toISOString()}`, ...(detail ? [detail] : [])].join('\n')
  return { subject, text }
}

/** One-line, human-readable detail per kind (mirrors the web eventSummary). */
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
    case 'device_offline':
      return `No fix for ${num(p['offlineH'])} h (threshold ${num(p['thresholdH'])} h)`
    default:
      return ''
  }
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '—'
}
