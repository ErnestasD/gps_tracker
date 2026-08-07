import type { TenantPlan } from '@orbetra/shared'

import type { Account, Tenant } from './devices'
import { getJson, mutate } from './client'

/**
 * The platform-admin API — the surface that exists so support and sales do not run through psql.
 *
 * Every endpoint here already existed and had no screen: the panel listed tenants and their
 * device-days and nothing else, so changing a plan (the upgrade the marketing site invites people to
 * ask for), seeing WHY a customer's fleet went dark, reading the pilot enquiries the public site
 * collects, and reviewing the platform audit trail were all `docker exec … psql` operations.
 */

/** A tenant as the platform sees it: the row plus the billing/suspension state support needs. */
export interface PlatformTenant extends Tenant {
  plan: TenantPlan
  createdAt?: string
  subscriptionStatus?: string | null
  currentPeriodEnd?: string | null
  /** non-null ⇒ the fleet is CUT OFF: ingest refuses its devices until restored */
  suspendedAt?: string | null
  /** how far up the warning ladder they are (0–3); 3 means the final notice was sent */
  lapseNoticeStage?: number
}

export interface PlatformDomain {
  id: string
  domain: string
  verified: boolean
  createdAt: string
}

/** A pilot enquiry from the public site. Inbound sales — the table had no reader. */
export interface Lead {
  id: string
  name: string
  company: string
  email: string
  phone: string | null
  deviceCount: string | null
  message: string | null
  ref: string | null
  createdAt: string
}

export interface PlatformAuditEntry {
  id: string
  action: string
  entity: string
  entityId: string
  userId: string | null
  createdAt: string
}

export const getTenant = (id: string) => getJson<PlatformTenant>(`/v1/tenants/${encodeURIComponent(id)}`)
export const listTenantAccounts = (id: string) => getJson<Account[]>(`/v1/tenants/${encodeURIComponent(id)}/accounts`)
export const listTenantDomains = (id: string) => getJson<PlatformDomain[]>(`/v1/tenants/${encodeURIComponent(id)}/domains`)

/**
 * Change a tenant's plan.
 *
 * ENTITLEMENTS ONLY — this is the tier the product enforces (device ceiling, white-label, custom
 * domains, sub-accounts, API), and it does NOT touch Stripe. Moving someone to `tsp_grow` here gives
 * them the features immediately and bills them nothing; the subscription is changed in Stripe
 * separately. The screen says so, because a plan field that silently means two different things is
 * how someone ends up served for free.
 */
export const setTenantPlan = (id: string, plan: TenantPlan) =>
  mutate<PlatformTenant>('PATCH', `/v1/tenants/${encodeURIComponent(id)}`, { plan })

/** Put a suspended tenant back on the air. Rebuilds the ingest registry, then clears the flag. */
export const restoreTenant = (id: string) =>
  mutate<{ ok: boolean; restored: number; alreadyActive?: boolean }>('POST', `/v1/tenants/${encodeURIComponent(id)}/restore`)

export const listLeads = () => getJson<Lead[]>('/v1/platform/leads')
export const platformAudit = (limit = 100) => getJson<PlatformAuditEntry[]>(`/v1/platform/audit?limit=${limit}`)
