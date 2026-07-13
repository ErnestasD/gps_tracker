import type { Lead, PrismaClient } from '@prisma/client'

/**
 * Pilot-request leads (W9-S1, §6.9). Leads arrive from the PUBLIC site before any
 * tenant exists, so the table is deliberately unscoped: `create` is called by the
 * public endpoint (rate-limited + honeypotted upstream), `list` only ever behind the
 * platform_admin gate. No update/delete — a lead trail is append-only sales history.
 *
 * NOTE for a future leads UI: name/company/message are stored RAW (public input). The JSON
 * API is safe, but any HTML rendering MUST escape them (stored-XSS) — never dangerouslySetInnerHTML.
 */
export interface LeadView {
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
export interface LeadCreate {
  name: string
  company: string
  email: string
  phone?: string | null
  deviceCount?: string | null
  message?: string | null
  ref?: string | null
}
export interface LeadRepo {
  /** UNSCOPED create — public pilot form (the api layer validates + rate-limits). */
  create(data: LeadCreate): Promise<LeadView>
  /** UNSCOPED read — platform_admin only (enforced by the route's scopeClass). */
  list(take?: number): Promise<LeadView[]>
}

function toView(r: Lead): LeadView {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    email: r.email,
    phone: r.phone,
    deviceCount: r.deviceCount,
    message: r.message,
    ref: r.ref,
    createdAt: r.createdAt.toISOString(),
  }
}

export function createLeadRepo(prisma: PrismaClient): LeadRepo {
  return {
    create: async (data) => {
      const row = await prisma.lead.create({
        data: {
          name: data.name,
          company: data.company,
          email: data.email,
          phone: data.phone ?? null,
          deviceCount: data.deviceCount ?? null,
          message: data.message ?? null,
          ref: data.ref ?? null,
        },
      })
      return toView(row)
    },
    list: async (take = 200) => {
      const rows = await prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(take, 1), 500) })
      return rows.map(toView)
    },
  }
}
