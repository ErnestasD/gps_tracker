import type { Command, PrismaClient } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * Codec-12 command repo (E08-2). Account-scoped (a command targets one device in scope).
 * The api creates a `queued` command with a 24 h expiry (§3.5) and pushes it to the ingest
 * transport queue; the worker dispatcher drives it through sent→acked|failed|expired via raw
 * SQL. Reads are scoped; a command is never returned for another tenant/account.
 */
export interface CommandView {
  id: string
  deviceId: string
  text: string
  status: string
  response: string | null
  createdAt: string
  sentAt: string | null
  expiresAt: string
}
export interface CommandCreate {
  deviceId: bigint
  /** the target device's account (the API resolves it from the scope-gated device row). */
  accountId: string
  text: string
}
export interface CommandRepo {
  create(scope: Scope, actor: Actor, data: CommandCreate): Promise<CommandView>
  get(scope: Scope, id: string): Promise<CommandView | null>
  listForDevice(scope: Scope, deviceId: bigint): Promise<CommandView[]>
}

const EXPIRY_MS = 24 * 3_600_000
const uuid = (s: string): boolean => /^[0-9a-f-]{36}$/i.test(s)

function toView(r: Command): CommandView {
  return {
    id: r.id,
    deviceId: r.deviceId.toString(),
    text: r.text,
    status: r.status,
    response: r.response,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    expiresAt: r.expiresAt.toISOString(),
  }
}

export function createCommandRepo(prisma: PrismaClient, audit: AuditRepo): CommandRepo {
  return {
    create: async (scope, actor, data) => {
      // the API has already scope-gated the device (db.devices.get) and passes its accountId;
      // stamp the DEVICE's account so a tenant-wide caller commands the right account.
      const row = await prisma.command.create({
        data: { tenantId: scope.tenantId, accountId: data.accountId, deviceId: data.deviceId, text: data.text, expiresAt: new Date(Date.now() + EXPIRY_MS) },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'command', entityId: row.id, after: toView(row) })
      return toView(row)
    },
    get: async (scope, id) => {
      if (!uuid(id)) return null
      const row = await prisma.command.findFirst({ where: { ...scopedWhere(scope), id } })
      return row === null ? null : toView(row)
    },
    listForDevice: async (scope, deviceId) => {
      const rows = await prisma.command.findMany({ where: { ...scopedWhere(scope), deviceId }, orderBy: { createdAt: 'desc' }, take: 100 })
      return rows.map(toView)
    },
  }
}
