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
      const before = await delegate.findFirst({ where: scopedById(scope, id) })
      if (before === null) return null
      const row = await delegate.update({ where: { [idField]: id }, data: data as object })
      await audit.record(scope, actor, {
        action: 'update',
        entity: cfg.entity,
        entityId: id,
        before: redact(before, cfg.redactFields),
        after: redact(row, cfg.redactFields),
      })
      return row
    },

    remove: async (scope, actor, id) => {
      const before = await delegate.findFirst({ where: scopedById(scope, id) })
      if (before === null) return false
      await delegate.delete({ where: { [idField]: id } })
      await audit.record(scope, actor, { action: 'delete', entity: cfg.entity, entityId: id, before: redact(before, cfg.redactFields) })
      return true
    },
  }
}
