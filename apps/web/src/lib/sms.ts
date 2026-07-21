import type { SmsDeliveryView } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Persisted SMS delivery as returned by the API (SMS gateway feature). Re-exported from
 * @orbetra/shared so the onboarding card imports one place. queued → sent | failed (terminal). */
export type { SmsDeliveryView }

/** Enqueue a config SMS to the device's SIM. With no body the server builds the device's config
 * SMS via buildOnboarding; `apn` threads the operator-entered carrier APN into that generated SMS.
 * Returns the freshly-created queued delivery row (poll listSmsDeliveries for its terminal status). */
export const sendConfigSms = (deviceId: string, opts?: { apn?: string }) =>
  mutate<SmsDeliveryView>('POST', `/v1/devices/${encodeURIComponent(deviceId)}/sms`, opts ?? {})

/** Delivery history for a device, newest first — polled while anything is still queued. */
export const listSmsDeliveries = (deviceId: string) =>
  getJson<SmsDeliveryView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/sms`)

/** True while any delivery is still queued — drives the status poll (mirrors hasPendingCommand). */
export const hasPendingSms = (list: readonly { status: string }[]): boolean =>
  list.some((d) => d.status === 'queued')

const BADGE: Record<string, 'success' | 'danger'> = { sent: 'success', failed: 'danger' }
/** Badge variant per delivery status: sent→success, failed→danger, queued/unknown→neutral (pending). */
export const smsStatusVariant = (status: string): 'success' | 'danger' | 'outline' => BADGE[status] ?? 'outline'

/** The Send-config-SMS button shows only when the platform has SMS configured (onboarding response
 * `smsEnabled`) AND the device has a saved SIM number. Read defensively — WP-C lands in parallel. */
export const canSendConfigSms = (smsEnabled: boolean | undefined, simMsisdn: string | null | undefined): boolean =>
  smsEnabled === true && typeof simMsisdn === 'string' && simMsisdn.trim() !== ''
