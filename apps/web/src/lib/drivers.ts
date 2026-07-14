import type { DriverScoreView } from '@orbetra/shared'

import { getJson, mutate } from './client'
import { ApiError } from './http'

export type { DriverScoreView } from '@orbetra/shared'

/** Driver registry record (mirrors packages/shared DriverView). */
export interface Driver {
  id: string
  accountId: string
  name: string
  licenseNo: string | null
  ibutton: string | null
  phone: string | null
  notes: string | null
  active: boolean
  createdAt: string
}

export interface DriverInput {
  accountId?: string
  name: string
  licenseNo?: string | null
  ibutton?: string | null
  phone?: string | null
  notes?: string | null
  active?: boolean
}

export const listDrivers = () => getJson<Driver[]>('/v1/drivers')
export const createDriver = (data: DriverInput) => mutate<Driver>('POST', '/v1/drivers', data)
export const updateDriver = (id: string, data: Omit<DriverInput, 'accountId'>) => mutate<Driver>('PATCH', `/v1/drivers/${encodeURIComponent(id)}`, data)
export const deleteDriver = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/drivers/${encodeURIComponent(id)}`)

/** Driver safety scores over the default window (last 30 days) — V2, read-computed server-side. */
export const listDriverScores = () => getJson<DriverScoreView[]>('/v1/driver-scores')

/** Badge variant for a 0–100 safety score (or null = no data). Pure — unit-tested. */
export function scoreVariant(score: number | null): 'success' | 'warn' | 'danger' | 'outline' {
  if (score === null) return 'outline'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warn'
  return 'danger'
}

/** True when the API rejected an iButton as already-taken (409) — surfaced as a field error. */
export const isIbuttonConflict = (err: unknown): boolean => err instanceof ApiError && err.status === 409

/** Client-side iButton validation mirroring the server regex (hex 8–32). Empty = allowed (null).
 *  Pure — unit-tested. Returns the normalized upper-case value, null when empty, or false when
 *  malformed (false is the invalid sentinel — a literal 'invalid' would collapse into `string`). */
export function normalizeIbutton(raw: string): string | null | false {
  const v = raw.trim()
  if (v === '') return null
  return /^[0-9a-fA-F]{8,32}$/.test(v) ? v.toUpperCase() : false
}
