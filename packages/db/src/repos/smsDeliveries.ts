import type { PrismaClient, SmsDelivery } from '@prisma/client'

import type { SmsDeliveryView } from '@orbetra/shared'

import type { Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

/**
 * SMS gateway delivery repo (SMS gateway feature). Account-scoped (an SMS targets one device in
 * scope) — mirrors the Codec-12 command repo. The API creates a `queued` row and enqueues the
 * BullMQ sms job; the worker drives it queued→sent|failed via markSent/markFailed (worker owns the
 * id it created, so those transitions are unscoped like the webhook-delivery worker writes). V1
 * ships the platform-default Twilio driver only (provider defaults 'twilio'); per-tenant creds are
 * a follow-up. Reads are scoped; a row is never returned for another tenant/account.
 */
export interface SmsDeliveryCreate {
  deviceId: bigint
  /** the target device's account (the API resolves it from the scope-gated device row). */
  accountId: string
  to: string
  body: string
  /** provider key; defaults to 'twilio' (the V1 platform driver) when omitted. */
  provider?: string
}
export interface SmsDeliveryRepo {
  create(scope: Scope, data: SmsDeliveryCreate): Promise<SmsDeliveryView>
  get(scope: Scope, id: string): Promise<SmsDeliveryView | null>
  listForDevice(scope: Scope, deviceId: bigint): Promise<SmsDeliveryView[]>
  /** Worker transition after a successful driver send (unscoped: the worker owns the id). null if gone. */
  markSent(id: string, providerMessageId: string): Promise<SmsDeliveryView | null>
  /** Worker transition after a terminal send failure (retries exhausted). null if the row is gone. */
  markFailed(id: string, error: string): Promise<SmsDeliveryView | null>
}

const uuid = (s: string): boolean => /^[0-9a-f-]{36}$/i.test(s)

function toView(r: SmsDelivery): SmsDeliveryView {
  return {
    id: r.id,
    deviceId: r.deviceId.toString(),
    to: r.to,
    body: r.body,
    provider: r.provider,
    providerMessageId: r.providerMessageId,
    status: r.status,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  }
}

export function createSmsDeliveryRepo(prisma: PrismaClient): SmsDeliveryRepo {
  return {
    create: async (scope, data) => {
      const row = await prisma.smsDelivery.create({
        data: {
          tenantId: scope.tenantId,
          accountId: data.accountId,
          deviceId: data.deviceId,
          to: data.to,
          body: data.body,
          ...(data.provider !== undefined ? { provider: data.provider } : {}),
        },
      })
      return toView(row)
    },
    get: async (scope, id) => {
      if (!uuid(id)) return null
      const row = await prisma.smsDelivery.findFirst({ where: { ...scopedWhere(scope), id } })
      return row === null ? null : toView(row)
    },
    listForDevice: async (scope, deviceId) => {
      const rows = await prisma.smsDelivery.findMany({ where: { ...scopedWhere(scope), deviceId }, orderBy: { createdAt: 'desc' }, take: 100 })
      return rows.map(toView)
    },
    markSent: async (id, providerMessageId) => {
      if (!uuid(id)) return null
      const res = await prisma.smsDelivery.updateMany({ where: { id }, data: { status: 'sent', providerMessageId, sentAt: new Date() } })
      if (res.count === 0) return null
      const row = await prisma.smsDelivery.findUnique({ where: { id } })
      return row === null ? null : toView(row)
    },
    markFailed: async (id, error) => {
      if (!uuid(id)) return null
      const res = await prisma.smsDelivery.updateMany({ where: { id }, data: { status: 'failed', error } })
      if (res.count === 0) return null
      const row = await prisma.smsDelivery.findUnique({ where: { id } })
      return row === null ? null : toView(row)
    },
  }
}
