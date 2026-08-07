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
  /** the column is `at`, NOT `createdAt` — the tenant audit page reads the same field. Getting it
   *  wrong renders every row's timestamp as '—' with no error anywhere, because `getJson` is an
   *  unchecked cast and `fmt.dt(undefined)` degrades quietly. */
  at: string
}

export const getTenant = (id: string) => getJson<PlatformTenant>(`/v1/tenants/${encodeURIComponent(id)}`)
export const listTenantAccounts = (id: string) => getJson<Account[]>(`/v1/tenants/${encodeURIComponent(id)}/accounts`)
export const listTenantDomains = (id: string) => getJson<PlatformDomain[]>(`/v1/tenants/${encodeURIComponent(id)}/domains`)

/**
 * Change a tenant's plan.
 *
 * ENTITLEMENTS ONLY — this is the tier the product enforces, and it does NOT touch Stripe. Moving
 * someone to `tsp_grow` here gives them the features immediately and bills them nothing.
 *
 * And STRIPE REMAINS AUTHORITATIVE: `applySubscriptionEvent` re-derives `plan` from the subscription
 * price on every `customer.subscription.*`, so a hand-set tier survives only until that customer's
 * next billing event. A grant meant to last needs the Stripe price changed as well — the screen says
 * this, because a plan that silently reverts mid-week is worse than one that never changed.
 *
 * A DOWNGRADE blocks new devices, domains and sub-accounts; it does not switch off what already
 * exists. `requireEntitlement` is chained on POST/PATCH only, and domain resolution selects on
 * `verified` without consulting the plan, so verified white-label hosts keep serving and Caddy keeps
 * issuing their certs.
 */
export const setTenantPlan = (id: string, plan: TenantPlan) =>
  mutate<PlatformTenant>('PATCH', `/v1/tenants/${encodeURIComponent(id)}`, { plan })

/** Put a suspended tenant back on the air. Rebuilds the ingest registry, then clears the flag. */
export const restoreTenant = (id: string) =>
  mutate<{ ok: boolean; restored: number; alreadyActive?: boolean }>('POST', `/v1/tenants/${encodeURIComponent(id)}/restore`)

export const listLeads = () => getJson<Lead[]>('/v1/platform/leads')
export const platformAudit = (limit = 100) => getJson<PlatformAuditEntry[]>(`/v1/platform/audit?limit=${limit}`)
