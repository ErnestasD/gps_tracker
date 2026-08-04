import type { AuditRepo } from './audit.js'
import type { Actor, Scope, ScopedWhereOpts } from '../scope.js'
import { scopedWhere } from '../scope.js'

/** Minimal Prisma-delegate shape the generic repo needs (cast per model). */
export interface Delegate<Row> {
  findMany(args: { where: object; orderBy?: object; take?: number; skip?: number; cursor?: object }): Promise<Row[]>
  findFirst(args: { where: object }): Promise<Row | null>
  create(args: { data: object }): Promise<Row>
  update(args: { where: object; data: object }): Promise<Row>
  delete(args: { where: object }): Promise<Row>
  /** scoped writes: the predicate travels WITH the mutation, not just a pre-check before it */
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>
  deleteMany(args: { where: object }): Promise<{ count: number }>
}

export interface GenericRepo<Row, CreateData, UpdateData> {
  list(scope: Scope, opts?: { take?: number }): Promise<Row[]>
  get(scope: Scope, id: string): Promise<Row | null>
  create(scope: Scope, actor: Actor, data: CreateData): Promise<Row>
  update(scope: Scope, actor: Actor, id: string, data: UpdateData): Promise<Row | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
}

export interface GenericConfig {
  /** Audit entity label (e.g. 'account'). */
  entity: string
  /** Scope options — nullableAccount for tenant-shared models. */
  scopeOpts?: ScopedWhereOpts
  /** Primary-key field name (default 'id'). */
  idField?: string
  /** Default list ordering. */
  orderBy?: object
  /** Force these fields onto every create (scope stamping). */
  stampCreate?: (scope: Scope) => object
  /** Fields redacted from audit before/after snapshots (secrets at rest). */
  redactFields?: string[]
  /** Fields masked in list/get RESPONSES so a secret is never returned over the API
   * (e.g. a webhook HMAC secret — rule 12). Distinct from audit redaction. */
  readRedact?: string[]
}

function redact<T extends { [k: string]: unknown }>(row: T | null, fields?: string[]): unknown {
  if (row === null || fields === undefined) return row
  const copy: { [k: string]: unknown } = { ...row }
  for (const f of fields) if (f in copy) copy[f] = '***'
  return copy
}

/**
 * Scoped CRUD over one Prisma model (E03-2). Every read/mutate routes through
 * `scopedWhere` so a caller CANNOT reach another tenant's row: get/update/remove
 * do a scoped `findFirst` by id first — a cross-scope id resolves to null (API →
 * 404), never a leak. Mutations write an audit row with before/after.
 *
 * `accounts` scopes specially (the account IS the unit) — it does not use this.
 */
export function createGenericRepo<Row extends { [k: string]: unknown }, CreateData extends object, UpdateData>(
  delegate: Delegate<Row>,
  audit: AuditRepo,
  cfg: GenericConfig,
): GenericRepo<Row, CreateData, UpdateData> {
  const idField = cfg.idField ?? 'id'
  const scopedById = (scope: Scope, id: string) => ({
    ...scopedWhere(scope, cfg.scopeOpts),
    [idField]: id,
  })
  /**
   * MUTATION scope — deliberately NOT the read scope.
   *
   * `nullableAccount` entities (webhooks, api keys) are readable by an account-scoped user via
   * "own account OR tenant-shared (null)". Reusing that predicate for update/delete meant an
   * account-scoped tenant admin could re-point or delete a TENANT-SHARED row it merely had
   * visibility of — and the worker loads webhooks with `accountId = $1 OR accountId IS NULL` for
   * every device, so a re-pointed shared hook streamed EVERY sibling account's events (device ids,
   * kinds, geofence names, timestamps) to the attacker's URL, and a delete killed the tenant's
   * integration for all accounts. Creation was already pinned, so such an admin could not make one
   * — only hijack one. The geofence repo fixed exactly this class with a separate mutate predicate;
   * this is the same fix for the generic path. Audit high.
   */
  const mutateScopedById = (scope: Scope, id: string) => ({
    ...scopedWhere(scope), // no nullableAccount branch: a shared row is NOT yours to change
    [idField]: id,
  })

  return {
    list: (scope, opts) =>
      delegate
        .findMany({
          where: scopedWhere(scope, cfg.scopeOpts),
          ...(cfg.orderBy ? { orderBy: cfg.orderBy } : {}),
          ...(opts?.take ? { take: opts.take } : {}),
        })
        .then((rows) => (cfg.readRedact ? (rows.map((r) => redact(r, cfg.readRedact)) as Row[]) : rows)),

    get: (scope, id) =>
      delegate.findFirst({ where: scopedById(scope, id) }).then((r) => (cfg.readRedact ? (redact(r, cfg.readRedact) as Row | null) : r)),

    create: async (scope, actor, data) => {
      const row = await delegate.create({
        data: { ...(cfg.stampCreate ? cfg.stampCreate(scope) : { tenantId: scope.tenantId }), ...data },
      })
      await audit.record(scope, actor, { action: 'create', entity: cfg.entity, entityId: String(row[idField]), after: redact(row, cfg.redactFields) })
      return row
    },

    update: async (scope, actor, id, data) => {
      // scoped existence check FIRST — a cross-scope id must 404, not update
      const before = await delegate.findFirst({ where: mutateScopedById(scope, id) })
      if (before === null) return null
      // An empty patch is a legitimate no-op — every Update schema is `.partial()`, so `PATCH {}`
      // (or a body whose keys zod strips) reaches here with nothing to write. `updateMany` returns
      // count 0 for an empty `data` where `update` returned the row, which would turn a 200 into a
      // 404 for the caller's OWN row — and would quietly defang the isolation suite, which PATCHes
      // `{}` on every item route. The geofence repo handles this case the same way.
      if (Object.keys(data as object).length === 0) {
        return (cfg.readRedact ? (redact(before, cfg.readRedact) as Row) : before)
      }
      // …and the write itself carries the predicate too: the pre-check alone is a TOCTOU window,
      // and `where: { id }` unscoped is one refactor away from being the only guard left
      const updated = await delegate.updateMany({ where: mutateScopedById(scope, id), data: data as object })
      if (updated.count === 0) return null
      const row = await delegate.findFirst({ where: mutateScopedById(scope, id) })
      if (row === null) return null
      await audit.record(scope, actor, {
        action: 'update',
        entity: cfg.entity,
        entityId: id,
        before: redact(before, cfg.redactFields),
        after: redact(row, cfg.redactFields),
      })
      // the API returns this straight to the caller, so the read redaction applies here too —
      // `readRedact: ['secret']` on webhooks means "never send the HMAC secret over the API",
      // and PATCH was the one path that still did (rule 12)
      return (cfg.readRedact ? (redact(row, cfg.readRedact) as Row) : row)
    },

    remove: async (scope, actor, id) => {
      const before = await delegate.findFirst({ where: mutateScopedById(scope, id) })
      if (before === null) return false
      const deleted = await delegate.deleteMany({ where: mutateScopedById(scope, id) })
      if (deleted.count === 0) return false
      await audit.record(scope, actor, { action: 'delete', entity: cfg.entity, entityId: id, before: redact(before, cfg.redactFields) })
      return true
    },
  }
}
