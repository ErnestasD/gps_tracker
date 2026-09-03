import { getJson, mutate } from './client'

import type { Account } from './devices'

/**
 * Customer-account management (the reseller surface).
 *
 * The API for all of this has existed since E03 — accounts CRUD (create gated on the `subAccounts`
 * entitlement server-side), users CRUD with role-tier grant checks — but no page ever called it: a
 * TSP who paid for sub-accounts had no way to create one (founder report, 2026-09-03, minutes after
 * the first real TSP self-checkout). `listAccounts` itself lives in lib/devices.ts, where the
 * device-onboarding picker has used it all along.
 */
export interface UserView {
  id: string
  tenantId: string
  /** null = tenant-wide (sees every account) — the reseller's own staff, not a customer login */
  accountId: string | null
  email: string
  role: 'platform_admin' | 'tsp_admin' | 'account_manager' | 'viewer'
  locale: string | null
  createdAt: string
}

export const createAccount = (data: { name: string; timezone?: string }) =>
  mutate<Account>('POST', '/v1/accounts', data)
export const renameAccount = (id: string, name: string) =>
  mutate<Account>('PATCH', `/v1/accounts/${encodeURIComponent(id)}`, { name })
export const deleteAccount = (id: string) =>
  mutate<{ ok: boolean }>('DELETE', `/v1/accounts/${encodeURIComponent(id)}`)

export const listUsers = () => getJson<UserView[]>('/v1/users')
export const createUser = (data: { email: string; password: string; role: 'account_manager' | 'viewer'; accountId: string | null }) =>
  mutate<UserView>('POST', '/v1/users', data)
export const deleteUser = (id: string) =>
  mutate<{ ok: boolean }>('DELETE', `/v1/users/${encodeURIComponent(id)}`)

/** Per-account device-days + distinct active devices for a date range (tenant-wide only). */
export interface AccountUsageRow {
  accountId: string
  deviceDays: number
  activeDevices: number
}
export const listAccountUsage = (from: string) =>
  getJson<AccountUsageRow[]>(`/v1/usage/accounts?from=${encodeURIComponent(from)}`)
