import type { Context } from 'hono'

import type { Db } from '@orbetra/db'
import {
  accountCreateSchema,
  accountUpdateSchema,
  ruleCreateSchema,
  ruleUpdateSchema,
  tenantCreateSchema,
  tenantUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  webhookCreateSchema,
  webhookUpdateSchema,
} from '@orbetra/shared'

import { hashPassword } from '../auth/passwords.js'
import { problem, type AuthEnv } from '../auth/middleware.js'
import { scopeOf, type RouteDef } from './registry.js'

export interface CrudDeps {
  db: Db
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

  const routes: RouteDef[] = [
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
        const { password, ...rest } = data
        const row = await db.users.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), {
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
  ]
  return routes
}
