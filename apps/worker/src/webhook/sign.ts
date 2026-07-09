import { createHmac } from 'node:crypto'

/**
 * Webhook payload signing (E06-4, §6.5). The delivery carries
 * `X-Signature: sha256=<hex>` = HMAC-SHA256 of the EXACT request body bytes with the
 * webhook's secret, so the receiver can verify authenticity + integrity. PURE.
 */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}
