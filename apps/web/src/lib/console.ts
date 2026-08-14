import { getJson, mutate } from './client'

/**
 * Platform console API (founder decision 2026-08-14).
 *
 * Every call here is cross-tenant and answers `platform_admin` only — the server enforces that via
 * the route's platform scope class, so a non-admin reaching these paths gets a 403 rather than a
 * filtered result. Nothing in this file is reachable from a tenant screen.
 */
export interface ConsoleOverview {
  tenants: {
    total: number
    byPlan: Record<string, number>
    payingByPlan: Record<string, number>
    suspended: number
    lapsing: number
    trialing: number
    paying: number
    enterprise: number
  }
  users: { total: number; activeLast30d: number; neverLoggedIn: number; disabled: number }
  devices: { total: number; active: number; retired: number }
  revenue: { monthlyEurAtList: number; pricedTenants: number; unpricedTenants: number }
  growth: { tenantsLast30d: number; usersLast30d: number }
  partners: { total: number; active: number; referredTenants: number }
}

export interface ConsoleUser {
  id: string
  email: string
  role: string
  tenantId: string
  tenantName: string
  accountId: string | null
  locale: string
  createdAt: string
  lastLoginAt: string | null
  emailVerifiedAt: string | null
  disabledAt: string | null
}

export interface ConsoleBillingRow {
  tenantId: string
  tenantName: string
  plan: string
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  stripeCustomerId: string | null
  subscriptionPriceId: string | null
  activeDevices: number
  suspendedAt: string | null
}

export interface ConsoleLapse {
  tenantId: string
  tenantName: string
  plan: string
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  lapseNoticeStage: number
  lapseNoticeFor: string | null
  suspendedAt: string | null
  activeDevices: number
  billingEmail: string | null
}

export interface ConsoleFailure {
  kind: 'webhook' | 'sms' | 'email'
  tenantId: string
  tenantName: string
  count: number
  lastAt: string | null
  lastError: string | null
}

export interface ConsoleAlert {
  name: string
  severity: string
  component: string | null
  summary: string | null
  description: string | null
  startsAt: string | null
  state: string | null
}

export const consoleOverview = () => getJson<ConsoleOverview>('/v1/platform/overview')
export const consoleUsers = (search: string) =>
  getJson<ConsoleUser[]>(`/v1/platform/users?limit=500${search.trim() === '' ? '' : `&search=${encodeURIComponent(search.trim())}`}`)
export const setUserDisabled = (id: string, disabled: boolean) =>
  mutate<ConsoleUser>('PATCH', `/v1/platform/users/${encodeURIComponent(id)}`, { disabled })
export const consoleBilling = () => getJson<ConsoleBillingRow[]>('/v1/platform/billing')
export const consoleLapses = () => getJson<ConsoleLapse[]>('/v1/platform/lapses')
export const consoleErrors = (hours: number) => getJson<ConsoleFailure[]>(`/v1/platform/errors?hours=${hours}`)
export const consoleAlerts = () => getJson<{ configured: boolean; alerts: ConsoleAlert[]; error?: string }>('/v1/platform/alerts')
