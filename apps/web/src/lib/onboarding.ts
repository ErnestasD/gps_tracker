import { getJson } from './client'

/** SMS onboarding sheet for a device (V1-nice). */
export interface OnboardingSheet {
  imei: string
  host: string
  port: number
  smsServer: string
  smsApn: string | null
  steps: string[]
  familyCaveat: boolean
  /** Whether the platform has an SMS gateway configured server-side (SMS gateway feature). When
   * true (and the device has a SIM number) the card offers a one-click "Send config SMS". Optional
   * — read defensively; WP-C adds it to the onboarding response in parallel. */
  smsEnabled?: boolean
}

export const getOnboarding = (deviceId: string, apn?: string) => {
  const q = apn !== undefined && apn !== '' ? `?apn=${encodeURIComponent(apn)}` : ''
  return getJson<OnboardingSheet>(`/v1/devices/${encodeURIComponent(deviceId)}/onboarding${q}`)
}
