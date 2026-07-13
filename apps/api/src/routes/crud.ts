import type { Context } from 'hono'
import type { Redis } from 'ioredis'

import { DomainConflictError, DomainLimitError, DuplicateImeiError, GeofenceInvalidError, GeofenceTooLargeError, MAX_DOMAINS_PER_TENANT, readFuelSeries, readPositions, type Db, type Pool } from '@orbetra/db'
import {
  ROLES,
  accountCreateSchema,
  accountUpdateSchema,
  brandingSchema,
  canGrantRole,
  deviceCreateSchema,
  domainCreateSchema,
  deviceImportSchema,
  geofenceCreateSchema,
  geofenceUpdateSchema,
  deviceUpdateSchema,
  commandCreateSchema,
  ruleCreateSchema,
  ruleUpdateSchema,
  tenantCreateSchema,
  tenantUpdateSchema,
  quarantineClaimSchema,
  userCreateSchema,
  userUpdateSchema,
  webhookCreateSchema,
  webhookUpdateSchema,
  type Role,
} from '@orbetra/shared'

import { hashPassword } from '../auth/passwords.js'
import { problem, type AuthEnv } from '../auth/middleware.js'
import { activateDevice, deactivateDevice, syncDeviceConfig } from './deviceRegistry.js'
import { removeGeofence, syncGeofence } from './geofenceRegistry.js'
import { removeRule, syncRule } from './ruleRegistry.js'
import { applyImport, dryRun, parseCsv, rowsToImport } from './deviceImport.js'
import { claimDevice, listQuarantine } from './quarantine.js'
import { scopeOf, type RouteDef } from './registry.js'
import { expectedTxt, newTxtToken, verifyDomainTxt, type TxtResolver } from './tenantSelf.js'

// Geofence Redis sync is BEST-EFFORT (E05-2 review MED-3): the DB row is the source of
// truth and is already committed, so a Redis blip must NOT 500 the request (a 500 → client
// retry → duplicate fence). A missed sync leaves the fence out of the worker cache until a
// re-save; a startup DB→Redis rehydrate is the durable backfill (follow-up).
const bestEffortSync = async (fn: () => Promise<void>): Promise<void> => {
  try {
    await fn()
  } catch (e) {
    console.error('geofence sync', e)
  }
}

export interface CrudDeps {
  db: Db
  /** Device CRUD syncs the ingest/worker Redis registries (E03-3). */
  redis: Redis
  /** DNS TXT resolver for domain verification (E03-5); injectable for tests. */
  resolveTxt: TxtResolver
  /** raw-SQL pool for positions history reads (E04-3); positions are not in Prisma.
   * Optional so manifest-only construction (apiManifest) needs no DB; the positions
   * route 503s if it is somehow reached without one. */
  pool?: Pool
  /** GDPR job enqueuers (E08-4) — BullMQ producers wired in the server entry (ADR-020
   * addendum); optional so manifest-only construction needs no Redis, routes 503 without. */
  gdpr?: {
    enqueueErase(data: { deviceId: string; tenantId: string }): Promise<void>
    enqueueExport(data: { exportId: string }): Promise<void>
    /** erase is refused until the device has been retired this long (review HIGH-1: a live
     * TCP session survives retire until idle-timeout, and stream backlog drains async — an
     * instant erase could be "resurrected" by in-flight positions). Default 60 min. */
    eraseMinRetiredMs?: number
  }
}

// Per-resource authorization (review HIGH). Reads are broad; writes are restricted;
// platform routes are platform_admin-only (assigned by scopeClass below).
const TENANT_ADMINS: Role[] = ['platform_admin', 'tsp_admin']
const ACCOUNT_WRITERS: Role[] = ['platform_admin', 'tsp_admin', 'account_manager']
const READ_POLICY: Record<string, Role[]> = {
  account: [...ROLES],
  user: TENANT_ADMINS.concat('account_manager'),
  device: [...ROLES],
  rule: [...ROLES],
  webhook: ACCOUNT_WRITERS,
  event: [...ROLES],
  branding: [...ROLES], // viewers see the theme
  domain: TENANT_ADMINS, // domains are admin config
  audit: TENANT_ADMINS, // audit trail is tenant-wide + sensitive → admins only
  geofence: [...ROLES],
  command: [...ROLES], // reading command status is broad; SENDING is a write (below)
  webhookDelivery: ACCOUNT_WRITERS, // webhook delivery log — same readers as webhooks
  usage: TENANT_ADMINS, // billing data — a tenant admin can see their own bill
  export: TENANT_ADMINS, // GDPR exports contain the account's full data — admins only
}
const WRITE_POLICY: Record<string, Role[]> = {
  account: TENANT_ADMINS,
  user: TENANT_ADMINS,
  device: ACCOUNT_WRITERS,
  rule: ACCOUNT_WRITERS,
  webhook: TENANT_ADMINS,
  geofence: ACCOUNT_WRITERS,
  command: ACCOUNT_WRITERS, // sending a Codec-12 command controls hardware → writers only
  export: TENANT_ADMINS, // requesting a GDPR export
  gdpr: TENANT_ADMINS, // device erase — irreversible data destruction
}
function rolesFor(entity: string, method: string, scopeClass: string): Role[] {
  if (scopeClass === 'platform') return ['platform_admin']
  if (method === 'get') return READ_POLICY[entity] ?? [...ROLES]
  return WRITE_POLICY[entity] ?? TENANT_ADMINS
}

/** :id is always present on an item route; narrow the noUncheckedIndexedAccess string|undefined. */
const id = (c: Context): string => c.req.param('id') ?? ''

const body = async <T>(c: Context, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): Promise<T | null> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

/**
 * Serialize repo rows to JSON-safe values. BigInt ids (events) → string; Date →
 * ISO. Kept in one place so every handler's response shape is consistent.
 */
function toJson(value: unknown): object {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as object
}
const json = (c: Context, data: unknown, status: 200 | 201 | 202 = 200): Response => {
  c.header('Cache-Control', 'no-store')
  return c.json(toJson(data), status)
}

/**
 * The route manifest (E03-2): every scoped CRUD endpoint, self-describing for the
 * isolation suite. Registration is driven from this array — the meta-test fails if
 * a live /v1 route is missing here.
 */
export function buildRoutes(deps: CrudDeps): RouteDef[] {
  const { db } = deps
  const auth = (c: Context<AuthEnv>) => c.get('auth')

  const raw: Omit<RouteDef, 'roles'>[] = [
    // ── accounts (tenant) ────────────────────────────────────────────────────
    { method: 'get', path: '/v1/accounts', scopeClass: 'tenant', entity: 'account', shape: 'collection',
      handler: async (c) => json(c, await db.accounts.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/accounts/:id', scopeClass: 'tenant', entity: 'account', shape: 'item',
      handler: async (c) => {
        const row = await db.accounts.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/accounts', scopeClass: 'tenant', entity: 'account', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, accountCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        return json(c, await db.accounts.create(scopeOf(auth(c)), { userId: auth(c).userId }, data), 201)
      } },
    { method: 'patch', path: '/v1/accounts/:id', scopeClass: 'tenant', entity: 'account', shape: 'item',
      handler: async (c) => {
        const data = await body(c, accountUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.accounts.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/accounts/:id', scopeClass: 'tenant', entity: 'account', shape: 'item',
      handler: async (c) => {
        const ok = await db.accounts.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },

    // ── users (tenant + account) ─────────────────────────────────────────────
    { method: 'get', path: '/v1/users', scopeClass: 'tenant', entity: 'user', shape: 'collection',
      handler: async (c) => json(c, await db.users.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/users/:id', scopeClass: 'tenant', entity: 'user', shape: 'item',
      handler: async (c) => {
        const row = await db.users.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/users', scopeClass: 'tenant', entity: 'user', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, userCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        // role grant authorization (review HIGH): a caller cannot mint a role above
        // its own tier, and only a platform_admin can mint a platform_admin
        if (!canGrantRole(a.role, data.role)) return problem(c, 403, 'Forbidden', 'cannot grant that role')
        // account-scoped creators can only create in their own account
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if (accountId !== null && (await db.accounts.get(scopeOf(a), accountId)) === null) {
          return problem(c, 400, 'Bad Request', 'accountId not in scope')
        }
        const created = await db.users.create(scopeOf(a), { userId: a.userId }, {
          email: data.email,
          passwordHash: await hashPassword(data.password),
          role: data.role,
          accountId,
        })
        return json(c, created, 201)
      } },
    { method: 'patch', path: '/v1/users/:id', scopeClass: 'tenant', entity: 'user', shape: 'item',
      handler: async (c) => {
        const data = await body(c, userUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        // role grant authorization on update too (review HIGH: self-promotion vector)
        if (data.role !== undefined && !canGrantRole(a.role, data.role)) {
          return problem(c, 403, 'Forbidden', 'cannot grant that role')
        }
        // accountId change must stay in scope (review MED: PATCH skipped this);
        // account-scoped callers cannot move users out of their account at all
        if (data.accountId !== undefined) {
          if (a.accountId !== undefined && data.accountId !== a.accountId) {
            return problem(c, 403, 'Forbidden', 'cannot move users across accounts')
          }
          if (data.accountId !== null && (await db.accounts.get(scopeOf(a), data.accountId)) === null) {
            return problem(c, 400, 'Bad Request', 'accountId not in scope')
          }
        }
        const { password, ...rest } = data
        const row = await db.users.update(scopeOf(a), { userId: a.userId }, id(c), {
          ...rest,
          ...(password !== undefined ? { passwordHash: await hashPassword(password) } : {}),
        })
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/users/:id', scopeClass: 'tenant', entity: 'user', shape: 'item',
      handler: async (c) => {
        const ok = await db.users.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },

    // ── devices (account) — syncs the ingest/worker Redis registries ─────────
    { method: 'get', path: '/v1/devices', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => json(c, await db.devices.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/devices/:id', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const row = await db.devices.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/devices', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, deviceCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if ((await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        // validate the (global) profile — a bad uuid would else be a P2003 500 (review MED)
        const profile = await db.profiles.get(data.profileId)
        if (profile === null) return problem(c, 400, 'Bad Request', 'unknown profileId')
        // IMEI is GLOBALLY unique — the repo throws DuplicateImeiError on ANY clash
        // (including another tenant's), translated to 409 here so a cross-tenant clash
        // is not a 500 and does not reveal the other tenant's row (review HIGH)
        let device
        try {
          device = await db.devices.create(scopeOf(a), { userId: a.userId }, { ...data, accountId })
        } catch (err) {
          if (err instanceof DuplicateImeiError) return problem(c, 409, 'Conflict', 'IMEI already registered')
          throw err
        }
        await activateDevice(deps.redis, {
          id: device.id, imei: device.imei, tenantId: a.tenantId, accountId,
          config: { presenceRules: profile.presenceRules, odometerSource: device.odometerSource }, // E04-5
        })
        return json(c, device, 201)
      } },
    { method: 'patch', path: '/v1/devices/:id', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const data = await body(c, deviceUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.devices.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        if (row === null) return problem(c, 404, 'Not Found')
        // E04-5: odometerSource / profile may have changed → re-sync the worker's trip config
        // (skip a retired device — it's out of the registry; syncing would leave an orphan key)
        if (row.retiredAt === null && (data.odometerSource !== undefined || data.profileId !== undefined)) {
          const profile = await db.profiles.get(row.profileId)
          await syncDeviceConfig(deps.redis, row.id, profile?.presenceRules, row.odometerSource)
        }
        return json(c, row)
      } },
    { method: 'delete', path: '/v1/devices/:id', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        // retire = registry teardown THEN DB soft-delete. Registry FIRST so a Redis
        // failure leaves the device consistently active-in-both (fail-safe: better a
        // reconcile-retry than a "retired" device that ingest still accepts — review MED)
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        await deactivateDevice(deps.redis, { id: device.id, imei: device.imei }) // ingest rejects next connect (AC[2])
        const row = await db.devices.retire(scope, { userId: auth(c).userId }, id(c))
        return json(c, row ?? device)
      } },
    // ── device history (E04-3, §6.6) — device-scope gated, then raw-SQL positions ──
    { method: 'get', path: '/v1/devices/:id/positions', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        // scope gate FIRST: prove the device is in the caller's tenant/account (404 else),
        // and only then read positions by the validated numeric id — never the raw :id
        const device = await db.devices.get(scopeOf(auth(c)), id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        if (deps.pool === undefined) return problem(c, 503, 'Unavailable', 'positions store not configured')
        const q = c.req.query.bind(c.req)
        return json(c, await readPositions(deps.pool, device.id, {
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('cursor') !== undefined ? { cursor: q('cursor')! } : {}),
          ...(q('limit') !== undefined ? { limit: Number(q('limit')) } : {}),
        }))
      } },
    // fuel series for the playback fuel graph (E08-3) — same gate + raw-SQL shape as positions
    { method: 'get', path: '/v1/devices/:id/fuel', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const device = await db.devices.get(scopeOf(auth(c)), id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        if (deps.pool === undefined) return problem(c, 503, 'Unavailable', 'positions store not configured')
        const q = c.req.query.bind(c.req)
        return json(c, await readFuelSeries(deps.pool, device.id, {
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('limit') !== undefined ? { limit: Number(q('limit')) } : {}),
        }))
      } },
    { method: 'get', path: '/v1/devices/:id/trips', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        const q = c.req.query.bind(c.req)
        return json(c, await db.trips.list(scope, {
          deviceId: device.id.toString(),
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('limit') !== undefined ? { take: Number(q('limit')) } : {}),
        }))
      } },

    // ── Codec-12 commands (E08-2, §3.5) — device-scope gated ──────────────────
    { method: 'get', path: '/v1/devices/:id/commands', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        return json(c, await db.commands.listForDevice(scope, device.id))
      } },
    { method: 'post', path: '/v1/devices/:id/commands', scopeClass: 'account', entity: 'command', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const device = await db.devices.get(scope, id(c)) // scope gate FIRST (404 else)
        if (device === null) return problem(c, 404, 'Not Found')
        if (device.retiredAt !== null) return problem(c, 400, 'Bad Request', 'device is retired')
        const data = await body(c, commandCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const cmd = await db.commands.create(scope, { userId: a.userId }, { deviceId: device.id, accountId: device.accountId, text: data.text })
        // transport seam (E08-2): queue for ingest to send + wake the dispatcher. Carry
        // expiresAtMs so a command still queued at 24 h is purged (never drained+executed on a
        // late reconnect — critical for destructive presets like deleterecords/cpureset).
        await bestEffortSync(async () => {
          const pendKey = `cmd:pending:${device.id.toString()}`
          await deps.redis.rpush(pendKey, JSON.stringify({ id: cmd.id, text: cmd.text, attempt: 0, expiresAtMs: Date.parse(cmd.expiresAt) }))
          await deps.redis.expire(pendKey, 24 * 3_600) // bound the list if the device never connects
          await deps.redis.sadd('cmd:active', device.id.toString())
        })
        return json(c, cmd, 201)
      } },
    { method: 'get', path: '/v1/commands/:id', scopeClass: 'account', entity: 'command', shape: 'item',
      handler: async (c) => {
        const row = await db.commands.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },

    // ── GDPR (E08-4): device-erase cascade + account data export ────────────────
    { method: 'post', path: '/v1/devices/:id/erase', scopeClass: 'account', entity: 'gdpr', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const device = await db.devices.get(scope, id(c)) // scope gate FIRST (404 else)
        if (device === null) return problem(c, 404, 'Not Found')
        // retire tears down the ingest registry — erasing a LIVE device would race new data
        if (device.retiredAt === null) return problem(c, 400, 'Bad Request', 'retire the device first')
        if (deps.gdpr === undefined) return problem(c, 503, 'Unavailable', 'gdpr queue not configured')
        // a live session survives retire until its idle timeout and the stream backlog drains
        // async — an instant erase would race in-flight positions that then resurrect after
        // the delete with NO remaining erase path (device row gone → 404 forever). Wait out
        // the window (review HIGH-1); the worker also runs a post-delete final sweep.
        const minRetiredMs = deps.gdpr.eraseMinRetiredMs ?? 60 * 60_000
        if (Date.now() - new Date(device.retiredAt).getTime() < minRetiredMs) {
          return problem(c, 409, 'Conflict', `retired too recently — erase is allowed ${Math.ceil(minRetiredMs / 60_000)} min after retire`)
        }
        await db.audit.record(scope, { userId: a.userId }, { action: 'delete', entity: 'device', entityId: device.id.toString(), before: { imei: device.imei, name: device.name, gdprErase: true } })
        await deps.gdpr.enqueueErase({ deviceId: device.id.toString(), tenantId: scope.tenantId })
        return json(c, { queued: true, deviceId: device.id.toString() }, 202)
      } },
    { method: 'post', path: '/v1/accounts/:id/export', scopeClass: 'account', entity: 'export', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const account = await db.accounts.get(scope, id(c)) // scope gate FIRST (404 else)
        if (account === null) return problem(c, 404, 'Not Found')
        if (deps.gdpr === undefined) return problem(c, 503, 'Unavailable', 'gdpr queue not configured')
        // coalesce: a pending export already covers this request — do not pile up
        // full-history files on disk (review MED-3 flood guard)
        const pending = await db.exports.findPending(scope, account.id)
        if (pending !== null) {
          // SELF-HEAL (review): if the BullMQ job was lost (Redis restart), a zombie pending
          // row would coalesce every future POST forever. Re-enqueue: BullMQ dedupes by jobId
          // if the job still exists; if it vanished, this actually runs it (idempotent).
          await deps.gdpr.enqueueExport({ exportId: pending.id })
          return json(c, pending, 200)
        }
        const job = await db.exports.create(scope, { userId: a.userId }, account.id)
        await deps.gdpr.enqueueExport({ exportId: job.id })
        return json(c, job, 201)
      } },
    // pilot leads from the public site (W9-S1) — platform sales inbox
    { method: 'get', path: '/v1/platform/leads', scopeClass: 'platform', entity: 'lead', shape: 'collection',
      handler: async (c) => json(c, await db.leads.list()) },
    { method: 'get', path: '/v1/exports', scopeClass: 'account', entity: 'export', shape: 'collection',
      handler: async (c) => json(c, await db.exports.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/exports/:id', scopeClass: 'account', entity: 'export', shape: 'item',
      handler: async (c) => {
        const row = await db.exports.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'get', path: '/v1/exports/:id/download', scopeClass: 'account', entity: 'export', shape: 'item',
      handler: async (c) => {
        const info = await db.exports.pathOf(scopeOf(auth(c)), id(c))
        if (info === null) return problem(c, 404, 'Not Found')
        if (info.status === 'expired') return problem(c, 410, 'Gone', 'export expired')
        if (info.status !== 'done' || info.path === null) return problem(c, 404, 'Not Found')
        const { createReadStream } = await import('node:fs')
        const { stat, unlink } = await import('node:fs/promises')
        if (info.expiresAt.getTime() < Date.now()) {
          // lazy expiry cleanup (review MED-3): the worker sweep is the durable one; this
          // best-effort unlink stops an expired personal-data dump lingering after a hit
          await unlink(info.path).catch(() => undefined)
          return problem(c, 410, 'Gone', 'export expired')
        }
        const st = await stat(info.path).catch(() => null)
        if (st === null) return problem(c, 410, 'Gone', 'export file removed')
        c.header('content-type', 'application/gzip')
        c.header('content-disposition', `attachment; filename="orbetra-export-${id(c)}.ndjson.gz"`)
        c.header('content-length', String(st.size))
        const nodeStream = createReadStream(info.path)
        const { Readable } = await import('node:stream')
        return c.body(Readable.toWeb(nodeStream) as ReadableStream)
      } },

    { method: 'post', path: '/v1/devices/import/preview', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => {
        const parsed = await body(c, deviceImportSchema)
        if (parsed === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const profileKeys = new Set((await db.profiles.map()).keys())
        const rows = rowsToImport(parseCsv(parsed.csv))
        const result = await dryRun(db, scopeOf(a), rows, profileKeys, a.accountId)
        return json(c, result)
      } },
    { method: 'post', path: '/v1/devices/import', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => {
        const parsed = await body(c, deviceImportSchema)
        if (parsed === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const profiles = await db.profiles.map()
        const rows = rowsToImport(parseCsv(parsed.csv))
        const result = await applyImport(db, deps.redis, scopeOf(a), { userId: a.userId }, rows, profiles, a.accountId)
        return json(c, result, 201)
      } },

    // ── rules (account) ──────────────────────────────────────────────────────
    { method: 'get', path: '/v1/rules', scopeClass: 'account', entity: 'rule', shape: 'collection',
      handler: async (c) => json(c, await db.rules.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const row = await db.rules.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/rules', scopeClass: 'account', entity: 'rule', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, ruleCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if ((await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        const rule = await db.rules.create(scopeOf(a), { userId: a.userId }, { ...data, accountId })
        await bestEffortSync(() => syncRule(deps.redis, rule)) // publish to the worker's rule cache (E05-4)
        return json(c, rule, 201)
      } },
    { method: 'patch', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const data = await body(c, ruleUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.rules.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        if (row === null) return problem(c, 404, 'Not Found')
        await bestEffortSync(() => syncRule(deps.redis, row)) // re-publish the updated rule (E05-4)
        return json(c, row)
      } },
    { method: 'delete', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const ok = await db.rules.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        if (!ok) return problem(c, 404, 'Not Found')
        await bestEffortSync(() => removeRule(deps.redis, auth(c).tenantId, id(c))) // drop from the worker's rule cache
        return json(c, { ok: true })
      } },

    // ── geofences (account-scoped, nullable account = tenant-shared, E05-1) ────
    { method: 'get', path: '/v1/geofences', scopeClass: 'account', entity: 'geofence', shape: 'collection',
      handler: async (c) => json(c, await db.geofences.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/geofences/:id', scopeClass: 'account', entity: 'geofence', shape: 'item',
      handler: async (c) => {
        const row = await db.geofences.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/geofences', scopeClass: 'account', entity: 'geofence', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, geofenceCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        // account users are pinned to their account; a tenant admin may target an account or
        // null (tenant-shared). A named account must be in scope.
        const accountId = a.accountId !== undefined ? a.accountId : (data.accountId ?? null)
        if (accountId !== null && (await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        try {
          const gf = await db.geofences.create(scopeOf(a), { userId: a.userId }, { ...data, accountId })
          await bestEffortSync(() => syncGeofence(deps.redis, gf)) // publish to the worker's geom cache (E05-2)
          return json(c, gf, 201)
        } catch (err) {
          if (err instanceof GeofenceTooLargeError || err instanceof GeofenceInvalidError) return problem(c, 400, 'Bad Request', err.message)
          throw err
        }
      } },
    { method: 'patch', path: '/v1/geofences/:id', scopeClass: 'account', entity: 'geofence', shape: 'item',
      handler: async (c) => {
        const data = await body(c, geofenceUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        try {
          const row = await db.geofences.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
          if (row === null) return problem(c, 404, 'Not Found')
          await bestEffortSync(() => syncGeofence(deps.redis, row)) // re-publish the updated geometry (E05-2)
          return json(c, row)
        } catch (err) {
          if (err instanceof GeofenceTooLargeError || err instanceof GeofenceInvalidError) return problem(c, 400, 'Bad Request', err.message)
          throw err
        }
      } },
    { method: 'delete', path: '/v1/geofences/:id', scopeClass: 'account', entity: 'geofence', shape: 'item',
      handler: async (c) => {
        const ok = await db.geofences.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        if (!ok) return problem(c, 404, 'Not Found')
        await bestEffortSync(() => removeGeofence(deps.redis, auth(c).tenantId, id(c))) // drop from the worker's geom cache
        return json(c, { ok: true })
      } },

    // ── webhooks (tenant, nullable account) ──────────────────────────────────
    { method: 'get', path: '/v1/webhooks', scopeClass: 'tenant', entity: 'webhook', shape: 'collection',
      handler: async (c) => json(c, await db.webhooks.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/webhooks/:id', scopeClass: 'tenant', entity: 'webhook', shape: 'item',
      handler: async (c) => {
        const row = await db.webhooks.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/webhooks', scopeClass: 'tenant', entity: 'webhook', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, webhookCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if (accountId !== null && (await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        return json(c, await db.webhooks.create(scopeOf(a), { userId: a.userId }, { ...data, accountId }), 201)
      } },
    { method: 'patch', path: '/v1/webhooks/:id', scopeClass: 'tenant', entity: 'webhook', shape: 'item',
      handler: async (c) => {
        const data = await body(c, webhookUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.webhooks.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/webhooks/:id', scopeClass: 'tenant', entity: 'webhook', shape: 'item',
      handler: async (c) => {
        const ok = await db.webhooks.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },

    // ── usage metering (E07-4): platform panel + a tenant's own bill ──────────
    { method: 'get', path: '/v1/platform/usage', scopeClass: 'platform', entity: 'usage', shape: 'collection',
      // platformSummary is UNSCOPED by design — reachable ONLY here (platform_admin via scopeClass)
      handler: async (c) => json(c, await db.usage.platformSummary({
        ...(c.req.query('from') !== undefined ? { from: c.req.query('from')! } : {}),
        ...(c.req.query('to') !== undefined ? { to: c.req.query('to')! } : {}),
      })) },
    { method: 'get', path: '/v1/usage', scopeClass: 'tenant', entity: 'usage', shape: 'collection',
      handler: async (c) => json(c, await db.usage.tenantSummary(scopeOf(auth(c)), {
        ...(c.req.query('from') !== undefined ? { from: c.req.query('from')! } : {}),
        ...(c.req.query('to') !== undefined ? { to: c.req.query('to')! } : {}),
      })) },

    // ── webhook deliveries (tenant, read-only log — E06-4b) ───────────────────
    { method: 'get', path: '/v1/webhook-deliveries', scopeClass: 'tenant', entity: 'webhookDelivery', shape: 'collection',
      handler: async (c) => json(c, await db.webhookDeliveries.list(scopeOf(auth(c)), {
        take: Number(c.req.query('limit') ?? 100),
        ...(c.req.query('cursor') !== undefined ? { cursor: c.req.query('cursor')! } : {}),
        ...(c.req.query('webhookId') !== undefined ? { webhookId: c.req.query('webhookId')! } : {}),
      })) },

    // ── events (account, read-only) ──────────────────────────────────────────
    { method: 'get', path: '/v1/events', scopeClass: 'account', entity: 'event', shape: 'collection',
      handler: async (c) => {
        const q = (k: string): string | undefined => c.req.query(k) ?? undefined
        // all filters are sanitized in the repo (garbage never 500s) — E05-6 timeline UI
        return json(c, await db.events.list(scopeOf(auth(c)), {
          take: Number(c.req.query('limit') ?? 100),
          ...(q('cursor') !== undefined ? { cursor: q('cursor') } : {}),
          ...(q('kind') !== undefined ? { kind: q('kind') } : {}),
          ...(q('deviceId') !== undefined ? { deviceId: q('deviceId') } : {}),
          ...(q('from') !== undefined ? { from: q('from') } : {}),
          ...(q('to') !== undefined ? { to: q('to') } : {}),
        }))
      } },
    { method: 'get', path: '/v1/events/:id', scopeClass: 'account', entity: 'event', shape: 'item',
      handler: async (c) => {
        const row = await db.events.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },

    // ── trips (account, read-only, E04-3) ────────────────────────────────────
    { method: 'get', path: '/v1/trips', scopeClass: 'account', entity: 'trip', shape: 'collection',
      handler: async (c) => {
        const q = c.req.query.bind(c.req)
        return json(c, await db.trips.list(scopeOf(auth(c)), {
          ...(q('deviceId') !== undefined ? { deviceId: q('deviceId')! } : {}),
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('limit') !== undefined ? { take: Number(q('limit')) } : {}),
        }))
      } },
    { method: 'get', path: '/v1/trips/:id', scopeClass: 'account', entity: 'trip', shape: 'item',
      handler: async (c) => {
        const row = await db.trips.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },

    // ── audit log (E03-6, tenant, read-only + admin-gated, append-only) ─────────
    { method: 'get', path: '/v1/audit', scopeClass: 'tenant', entity: 'audit', shape: 'collection',
      handler: async (c) => {
        const q = c.req.query.bind(c.req)
        return json(c, await db.audit.list(scopeOf(auth(c)), {
          take: Number(q('limit') ?? 50),
          ...(q('cursor') !== undefined ? { cursor: q('cursor')! } : {}),
          ...(q('entity') !== undefined ? { entity: q('entity')! } : {}),
          ...(q('action') !== undefined ? { action: q('action')! } : {}),
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
        }))
      } },
    { method: 'get', path: '/v1/audit/:id', scopeClass: 'tenant', entity: 'audit', shape: 'item',
      handler: async (c) => {
        if (!/^\d+$/.test(id(c))) return problem(c, 404, 'Not Found') // BigInt() would throw on non-numeric
        const row = await db.audit.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },

    // ── tenant-self branding + domains (E03-5) — tenant from auth, never a param ─
    { method: 'get', path: '/v1/tenant/branding', scopeClass: 'tenant', entity: 'branding', shape: 'collection',
      handler: async (c) => {
        const tenant = await db.tenants.get(auth(c).tenantId)
        return json(c, { branding: tenant?.branding ?? {}, name: tenant?.name })
      } },
    { method: 'patch', path: '/v1/tenant/branding', scopeClass: 'tenant', entity: 'branding', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, brandingSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const tenant = await db.tenants.updateBranding({ userId: a.userId }, a.tenantId, data)
        return json(c, { branding: tenant.branding, name: tenant.name })
      } },
    { method: 'get', path: '/v1/tenant/domains', scopeClass: 'tenant', entity: 'domain', shape: 'collection',
      handler: async (c) => json(c, await db.tenantDomains.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/tenant/domains/:id', scopeClass: 'tenant', entity: 'domain', shape: 'item',
      handler: async (c) => {
        const row = await db.tenantDomains.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/tenant/domains', scopeClass: 'tenant', entity: 'domain', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, domainCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        try {
          const row = await db.tenantDomains.create(scopeOf(a), { userId: a.userId }, data.domain.toLowerCase(), newTxtToken())
          return json(c, { ...row, txtRecord: expectedTxt(row.txtToken) }, 201)
        } catch (err) {
          if (err instanceof DomainLimitError) return problem(c, 409, 'Conflict', `domain limit reached (max ${MAX_DOMAINS_PER_TENANT})`)
          // (tenantId, domain) unique clash = this tenant already added it
          return problem(c, 409, 'Conflict', 'domain already added')
        }
      } },
    { method: 'delete', path: '/v1/tenant/domains/:id', scopeClass: 'tenant', entity: 'domain', shape: 'item',
      handler: async (c) => {
        const ok = await db.tenantDomains.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },
    { method: 'post', path: '/v1/tenant/domains/:id/verify', scopeClass: 'tenant', entity: 'domain', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const row = await db.tenantDomains.get(scopeOf(a), id(c))
        if (row === null) return problem(c, 404, 'Not Found')
        if (!(await verifyDomainTxt(deps.resolveTxt, row.domain, row.txtToken))) {
          return problem(c, 400, 'Not Verified', 'TXT record not found — check DNS and try again')
        }
        try {
          return json(c, await db.tenantDomains.setVerified(scopeOf(a), { userId: a.userId }, id(c)))
        } catch (err) {
          // another tenant proved ownership of this domain first (partial-unique guard)
          if (err instanceof DomainConflictError) return problem(c, 409, 'Conflict', 'domain already verified by another tenant')
          throw err
        }
      } },

    // ── tenants (PLATFORM) ───────────────────────────────────────────────────
    { method: 'get', path: '/v1/tenants', scopeClass: 'platform', entity: 'tenant', shape: 'collection',
      handler: async (c) => json(c, await db.tenants.list()) },
    { method: 'get', path: '/v1/tenants/:id', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        const row = await db.tenants.get(id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/tenants', scopeClass: 'platform', entity: 'tenant', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, tenantCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        return json(c, await db.tenants.create({ userId: auth(c).userId }, data), 201)
      } },
    { method: 'patch', path: '/v1/tenants/:id', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        const data = await body(c, tenantUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.tenants.update({ userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/tenants/:id', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        const ok = await db.tenants.remove({ userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },
    // accounts of a SPECIFIC tenant (platform) — the claim dialog needs the target
    // tenant's accounts, which /v1/accounts (caller-scoped) can't give
    { method: 'get', path: '/v1/tenants/:id/accounts', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => json(c, await db.accounts.list({ tenantId: id(c) })) },

    // ── quarantine (PLATFORM) — unknown-IMEI review + claim (E03-4) ───────────
    { method: 'get', path: '/v1/quarantine', scopeClass: 'platform', entity: 'quarantine', shape: 'collection',
      handler: async (c) => json(c, await listQuarantine(deps.redis)) },
    { method: 'post', path: '/v1/quarantine/:imei/claim', scopeClass: 'platform', entity: 'quarantine', shape: 'item',
      handler: async (c) => {
        const data = await body(c, quarantineClaimSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const imei = c.req.param('imei') ?? ''
        if (!/^\d{15}$/.test(imei)) return problem(c, 400, 'Bad Request', 'invalid IMEI')
        const result = await claimDevice(db, deps.redis, { userId: auth(c).userId }, { ...data, imei })
        if (!result.ok) return problem(c, result.status, result.status === 409 ? 'Conflict' : 'Bad Request', result.reason)
        return json(c, result, 201)
      } },
  ]
  // attach the allowed-roles policy uniformly (review HIGH)
  return raw.map((r) => ({ ...r, roles: rolesFor(r.entity, r.method, r.scopeClass) }))
}
