import type { Context } from 'hono'
import type { Redis } from 'ioredis'

import { DuplicateImeiError, type Db } from '@orbetra/db'
import {
  ROLES,
  accountCreateSchema,
  accountUpdateSchema,
  canGrantRole,
  deviceCreateSchema,
  deviceImportSchema,
  deviceUpdateSchema,
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
import { activateDevice, deactivateDevice } from './deviceRegistry.js'
import { applyImport, dryRun, parseCsv, rowsToImport } from './deviceImport.js'
import { claimDevice, listQuarantine } from './quarantine.js'
import { scopeOf, type RouteDef } from './registry.js'

export interface CrudDeps {
  db: Db
  /** Device CRUD syncs the ingest/worker Redis registries (E03-3). */
  redis: Redis
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
}
const WRITE_POLICY: Record<string, Role[]> = {
  account: TENANT_ADMINS,
  user: TENANT_ADMINS,
  device: ACCOUNT_WRITERS,
  rule: ACCOUNT_WRITERS,
  webhook: TENANT_ADMINS,
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
const json = (c: Context, data: unknown, status: 200 | 201 = 200): Response => {
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
        if ((await db.profiles.get(data.profileId)) === null) return problem(c, 400, 'Bad Request', 'unknown profileId')
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
        await activateDevice(deps.redis, { id: device.id, imei: device.imei, tenantId: a.tenantId, accountId })
        return json(c, device, 201)
      } },
    { method: 'patch', path: '/v1/devices/:id', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const data = await body(c, deviceUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.devices.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
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
        return json(c, await db.rules.create(scopeOf(a), { userId: a.userId }, { ...data, accountId }), 201)
      } },
    { method: 'patch', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const data = await body(c, ruleUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.rules.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const ok = await db.rules.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
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

    // ── events (account, read-only) ──────────────────────────────────────────
    { method: 'get', path: '/v1/events', scopeClass: 'account', entity: 'event', shape: 'collection',
      handler: async (c) => {
        const take = Number(c.req.query('limit') ?? 100)
        const cursor = c.req.query('cursor')
        return json(c, await db.events.list(scopeOf(auth(c)), { take, ...(cursor !== undefined ? { cursor } : {}), ...(c.req.query('kind') !== undefined ? { kind: c.req.query('kind')! } : {}) }))
      } },
    { method: 'get', path: '/v1/events/:id', scopeClass: 'account', entity: 'event', shape: 'item',
      handler: async (c) => {
        const row = await db.events.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
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
