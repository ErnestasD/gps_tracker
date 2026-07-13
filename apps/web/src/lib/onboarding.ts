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
}

export const getOnboarding = (deviceId: string, apn?: string) => {
  const q = apn !== undefined && apn !== '' ? `?apn=${encodeURIComponent(apn)}` : ''
  return getJson<OnboardingSheet>(`/v1/devices/${encodeURIComponent(deviceId)}/onboarding${q}`)
}
