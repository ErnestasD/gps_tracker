import { EVENT_KINDS } from './events'
import { getJson, mutate } from './client'

/**
 * Webhooks management client (E06-4 UI). Tenant-admin only on the server. The signing
 * `secret` is set at creation (generated client-side, shown ONCE) and is REDACTED (`***`)
 * in every list/get response — the receiver verifies X-Signature with the secret it was
 * given at creation. Webhooks fire on the event kinds in `events` (empty = all kinds).
 */
export interface Webhook {
  id: string
  accountId: string | null
  url: string
  secret: string // always '***' in responses
  events: string[]
  enabled: boolean
  createdAt: string
}
export interface WebhookCreateInput {
  accountId: string | null
  url: string
  secret: string
  events?: string[]
  enabled?: boolean
}

export const WEBHOOK_EVENT_KINDS = EVENT_KINDS

export interface WebhookDelivery {
  id: string
  webhookId: string
  eventId: string
  kind: string
  statusCode: number | null
  success: boolean
  error: string | null
  at: string
}
export const listDeliveries = (limit = 50) => getJson<WebhookDelivery[]>(`/v1/webhook-deliveries?limit=${limit}`)

export const listWebhooks = () => getJson<Webhook[]>('/v1/webhooks')
export const createWebhook = (data: WebhookCreateInput) => mutate<Webhook>('POST', '/v1/webhooks', data)
export const deleteWebhook = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/webhooks/${encodeURIComponent(id)}`)
export const setWebhookEnabled = (id: string, enabled: boolean) => mutate<Webhook>('PATCH', `/v1/webhooks/${encodeURIComponent(id)}`, { enabled })

/** A 48-hex-char (24-byte) signing secret from the Web Crypto CSPRNG (meets the min-16 rule). */
export function generateSecret(): string {
  const a = new Uint8Array(24)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}
