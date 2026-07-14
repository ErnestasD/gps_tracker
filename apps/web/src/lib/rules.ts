import { getJson, mutate } from './client'

/** Rule kinds (mirror the Prisma RuleKind enum). */
export const RULE_KINDS = ['overspeed', 'geofence', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic', 'device_offline'] as const
export type RuleKind = (typeof RULE_KINDS)[number]

/** A rule's notification channel (mirrors packages/shared notificationChannelSchema). */
export type NotificationChannel = { type: 'email'; to: string } | { type: 'telegram'; chatId: string }

export interface Rule {
  id: string
  accountId: string
  kind: RuleKind
  name: string
  config: Record<string, unknown>
  scope: Record<string, unknown>
  channels: NotificationChannel[]
  cooldownS: number
  enabled: boolean
}

export interface RuleCreateInput {
  accountId: string
  kind: RuleKind
  name: string
  config?: Record<string, unknown>
  channels?: NotificationChannel[]
  cooldownS?: number
  enabled?: boolean
}
export type RuleUpdateInput = Partial<Omit<RuleCreateInput, 'accountId' | 'kind'>>

/** Parse a "type + value" draft into a channel, or null if invalid. Pure — unit-tested. The email
 *  regex mirrors zod's `.email()` closely enough to catch typos before the 400 round-trip. */
export function parseChannel(type: 'email' | 'telegram', value: string): NotificationChannel | null {
  const v = value.trim()
  if (v === '') return null
  if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { type: 'email', to: v } : null
  return v.length <= 64 ? { type: 'telegram', chatId: v } : null
}
/** Human label for a channel chip. */
export const channelLabel = (c: NotificationChannel): string => (c.type === 'email' ? c.to : `Telegram ${c.chatId}`)

export const listRules = () => getJson<Rule[]>('/v1/rules')
export const createRule = (data: RuleCreateInput) => mutate<Rule>('POST', '/v1/rules', data)
export const updateRule = (id: string, data: RuleUpdateInput) => mutate<Rule>('PATCH', `/v1/rules/${encodeURIComponent(id)}`, data)
export const deleteRule = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/rules/${encodeURIComponent(id)}`)

/** Which config fields a rule kind exposes in the editor. Pure — unit-tested. */
export interface ConfigField {
  key: string
  type: 'number' | 'select'
  options?: readonly string[]
  min?: number
  max?: number
  default: number | string
}
export function configFields(kind: RuleKind): ConfigField[] {
  switch (kind) {
    case 'overspeed':
      return [{ key: 'speedKmh', type: 'number', min: 1, max: 300, default: 90 }]
    case 'geofence':
      return [{ key: 'geofenceId', type: 'select', default: '' }, { key: 'on', type: 'select', options: ['enter', 'exit', 'both'], default: 'both' }]
    case 'low_battery':
      return [{ key: 'thresholdV', type: 'number', min: 1, max: 60, default: 11 }]
    case 'device_offline':
      return [{ key: 'afterH', type: 'number', min: 1, max: 168, default: 26 }]
    default:
      return [] // ignition / din_change / power_cut / panic — event-driven, no threshold
  }
}
