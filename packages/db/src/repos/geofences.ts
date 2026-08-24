import { Prisma, type PrismaClient } from '@prisma/client'

import { MAX_GEOFENCE_VERTICES, type GeofenceView } from '@orbetra/shared'

import type { AuditRepo } from './audit.js'
import type { Actor, Scope } from '../scope.js'

/**
 * Geofence repo (E05-1). The `geom` column is `geography(Polygon,4326)` — Unsupported by
 * Prisma — so this uses parameterized `$queryRaw` (PostGIS: ST_GeomFromGeoJSON / ST_AsGeoJSON),
 * still inside packages/db and still scope-first (rule 2). accountId is nullable ⇒ a null
 * geofence is tenant-shared (visible to every account of the tenant). All geometry is
 * validated (ST_IsValid) and area-capped (≤ 10,000 km², §6.3) server-side regardless of the
 * client editor. GeoJSON goes in as a bound STRING param — never string-concatenated.
 */
export const MAX_AREA_M2 = 10_000 * 1_000_000 // 10,000 km²

/**
 * Per-tenant fence count cap (audit high). The worker evaluates EVERY fence of a tenant against
 * EVERY record, so cost is vertices × fences × records on one event loop. Bounding vertices alone
 * still lets a caller multiply by fence count instead — and POST /v1/geofences has no rate limit
 * and is reachable on a free trial. 500 is far beyond any real fleet's zone list.
 */
export const MAX_GEOFENCES_PER_TENANT = 500

/**
 * Per-tenant TOTAL vertex budget — the bound that actually matters (review high).
 *
 * The per-fence cap and the count cap MULTIPLY: 500 fences × 2 000 vertices is 1 000 000, which is
 * exactly the worst case the audit benchmarked at ~459 ms of synchronous blocking per 200-record
 * batch. Capping the factors while leaving the product untouched reduces nothing, and a
 * tenant-shared fence (accountId null) applies to every device in the tenant, so one caller really
 * can build the whole set. 50 000 keeps the per-batch ray-cast cost ~20× below that worst case
 * while still allowing e.g. 500 simple depots or 25 richly-drawn city zones.
 */
export const MAX_TENANT_GEOFENCE_VERTICES = 50_000

export class GeofenceInvalidError extends Error {
  constructor() {
    super('geometry is not a valid polygon')
    this.name = 'GeofenceInvalidError'
  }
}
export class GeofenceTooLargeError extends Error {
  constructor() {
    super('geofence area exceeds the 10,000 km² cap')
    this.name = 'GeofenceTooLargeError'
  }
}
/** Tenant is at MAX_GEOFENCES_PER_TENANT. */
export class GeofenceLimitError extends Error {
  constructor() {
    super(`geofence limit reached (${MAX_GEOFENCES_PER_TENANT} per tenant)`)
    this.name = 'GeofenceLimitError'
  }
}
/** Vertex budget exceeded — the shape is fine, it is just too expensive to evaluate per record. */
export class GeofenceTooComplexError extends Error {
  constructor(message = `geofence exceeds ${MAX_GEOFENCE_VERTICES} vertices — simplify it`) {
    super(message)
    this.name = 'GeofenceTooComplexError'
  }
}

export type GeofenceKind = 'polygon' | 'circle' | 'corridor'
export interface GeofenceCreate {
  name: string
  color?: string
  kind: GeofenceKind
  accountId?: string | null
  /** polygon/circle: the GeoJSON Polygon (zod-validated upstream). Absent for a corridor. */
  geometry?: unknown
  /** corridor (V2): GeoJSON LineString centre-line + buffer half-width (m); server buffers to a polygon. */
  line?: unknown
  bufferM?: number
}
export interface GeofenceUpdate {
  name?: string
  color?: string
  geometry?: unknown // polygon/circle redraw (kind is immutable post-create)
  /** corridor redraw: new centre-line + buffer half-width — re-buffered server-side like create */
  line?: unknown
  bufferM?: number
}

export interface GeofenceRepo {
  list(scope: Scope): Promise<GeofenceView[]>
  /** UNSCOPED boot rehydrate (no request scope): every geofence across all tenants, so the API can
   *  repopulate the `geofence:tenant:*` Redis cache after a Redis flush. */
  listAll(): Promise<GeofenceView[]>
  get(scope: Scope, id: string): Promise<GeofenceView | null>
  /** @throws GeofenceInvalidError | GeofenceTooLargeError */
  create(scope: Scope, actor: Actor, data: GeofenceCreate): Promise<GeofenceView>
  update(scope: Scope, actor: Actor, id: string, data: GeofenceUpdate): Promise<GeofenceView | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
}

interface Row {
  id: string
  tenantId: string
  accountId: string | null
  name: string
  color: string
  kind: string
  geojson: string
  createdAt: Date
}
const toView = (r: Row): GeofenceView => ({
  id: r.id,
  tenantId: r.tenantId,
  accountId: r.accountId,
  name: r.name,
  color: r.color,
  kind: r.kind as GeofenceKind,
  geometry: JSON.parse(r.geojson) as unknown,
  createdAt: r.createdAt.toISOString(),
})

const COLS = Prisma.sql`id, "tenantId", "accountId", name, color, kind::text AS kind, ST_AsGeoJSON(geom) AS geojson, "createdAt"`
// READ scope: an account-scoped caller sees their own account's fences PLUS tenant-shared (null) ones.
const scopeSql = (scope: Scope): Prisma.Sql =>
  scope.accountId !== undefined
    ? Prisma.sql`"tenantId" = ${scope.tenantId}::uuid AND ("accountId" = ${scope.accountId}::uuid OR "accountId" IS NULL)`
    : Prisma.sql`"tenantId" = ${scope.tenantId}::uuid`

// MUTATION scope (update/remove): an account-scoped caller may mutate ONLY its OWN account's fences —
// NOT the tenant-shared (null) ones. Reusing the read scope here let an account_manager PATCH/DELETE a
// shared geofence, disabling enforcement for EVERY sibling account in the tenant (cross-account
// sabotage). Create already pins accountId to the caller's account, so account users cannot make shared
// fences either — mutation now matches that asymmetry. A tenant-scoped caller is unchanged (all rows).
const mutateScopeSql = (scope: Scope): Prisma.Sql =>
  scope.accountId !== undefined
    ? Prisma.sql`"tenantId" = ${scope.tenantId}::uuid AND "accountId" = ${scope.accountId}::uuid`
    : Prisma.sql`"tenantId" = ${scope.tenantId}::uuid`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createGeofenceRepo(prisma: PrismaClient, audit: AuditRepo): GeofenceRepo {
  /** The geography expression for a create: a corridor buffers its line into a polygon (ST_Buffer on
   *  geography → metres); polygon/circle parse their GeoJSON directly. Both land as geography. */
  const geogFor = (data: GeofenceCreate): Prisma.Sql => {
    if (data.kind === 'corridor') {
      // defend non-HTTP callers (bulk import/scripts): the zod refine already guarantees this for the
      // API, but a bare repo call must NOT fall back to ST_Buffer(line, 0) → an empty, silently-dead fence
      if (data.line === undefined || typeof data.bufferM !== 'number' || data.bufferM < 10 || data.bufferM > 5_000) throw new GeofenceInvalidError()
      return Prisma.sql`ST_Buffer(ST_GeomFromGeoJSON(${JSON.stringify(data.line)})::geography, ${data.bufferM})`
    }
    if (data.geometry === undefined) throw new GeofenceInvalidError()
    return Prisma.sql`ST_GeomFromGeoJSON(${JSON.stringify(data.geometry)})::geography`
  }
  /** Validate + area-check a geography expression in the DB before persisting (the SAME guard for a
   *  raw polygon and a buffered corridor — the resulting polygon must be valid + within the area cap). */
  const guardGeog = async (geog: Prisma.Sql): Promise<void> => {
    const [chk] = await prisma.$queryRaw<{ valid: boolean; area: number; npoints: number }[]>(
      Prisma.sql`SELECT ST_IsValid(g::geometry) AS valid, ST_Area(g) AS area, ST_NPoints(g::geometry) AS npoints
                 FROM (SELECT ${geog} AS g) s`,
    )
    if (chk === undefined || !chk.valid) throw new GeofenceInvalidError()
    if (Number(chk.area) > MAX_AREA_M2) throw new GeofenceTooLargeError()
    // Vertex bound on the POST-BUFFER geography, so a corridor cannot smuggle in what the schema
    // caps on input: ST_Buffer emits ~8 segments per quarter-circle around EVERY vertex of the
    // centre-line, so a 2 000-point line becomes a ~16 000-point polygon. The worker ray-casts this
    // per record per fence on the process that hosts all 16 shard consumers (audit high).
    if (Number(chk.npoints) > MAX_GEOFENCE_VERTICES) throw new GeofenceTooComplexError()
  }
  /**
   * A buffered corridor's vertex count is a function of a DIFFERENT field than the one the schema
   * caps: ST_Buffer emits ~8 segments per quarter-circle around every centre-line vertex, so the
   * effective line cap swings between ~220 and ~650 points depending on `bufferM`. Rejecting with
   * "exceeds 2000 vertices" then names a number the caller never submitted. Simplify instead —
   * ST_SimplifyPreserveTopology keeps the shape valid and closed — and only fail if even that
   * cannot get under the budget.
   */
  const simplifyToBudget = (geog: Prisma.Sql): Prisma.Sql =>
    Prisma.sql`(
      SELECT CASE WHEN ST_NPoints(g::geometry) <= ${MAX_GEOFENCE_VERTICES} THEN g
                  ELSE ST_SimplifyPreserveTopology(g::geometry, 0.00005)::geography END
      FROM (SELECT ${geog} AS g) s)`
  const one = async (scope: Scope, id: string): Promise<GeofenceView | null> => {
    if (!UUID.test(id)) return null
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${COLS} FROM geofences WHERE ${scopeSql(scope)} AND id = ${id}::uuid`)
    return rows[0] ? toView(rows[0]) : null
  }

  return {
    list: async (scope) => {
      const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${COLS} FROM geofences WHERE ${scopeSql(scope)} ORDER BY "createdAt" DESC`)
      return rows.map(toView)
    },
    listAll: async () => {
      const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${COLS} FROM geofences`)
      return rows.map(toView)
    },
    get: one,
    create: async (scope, actor, data) => {
      const raw = geogFor(data) // polygon/circle → GeoJSON; corridor → buffered line
      const geog = data.kind === 'corridor' ? simplifyToBudget(raw) : raw
      await guardGeog(geog)
      const accountId = data.accountId ?? null
      // The count + vertex budgets and the INSERT run in ONE transaction under a per-tenant advisory
      // lock: a plain read-then-insert lets two concurrent creates both see n = 499 and both write,
      // so the cap is advisory at best (review MED). The lock is tenant-scoped, so it never
      // serializes unrelated tenants.
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`gf:${scope.tenantId}`}))`)
        const [budget] = await tx.$queryRaw<{ n: bigint; v: bigint | null }[]>(
          Prisma.sql`SELECT count(*) AS n, sum(ST_NPoints(geom::geometry)) AS v
                     FROM geofences WHERE "tenantId" = ${scope.tenantId}::uuid`,
        )
        if (Number(budget?.n ?? 0) >= MAX_GEOFENCES_PER_TENANT) throw new GeofenceLimitError()
        const [added] = await tx.$queryRaw<{ n: number }[]>(
          Prisma.sql`SELECT ST_NPoints(g::geometry) AS n FROM (SELECT ${geog} AS g) s`,
        )
        if (Number(budget?.v ?? 0) + Number(added?.n ?? 0) > MAX_TENANT_GEOFENCE_VERTICES) {
          throw new GeofenceTooComplexError(
            `tenant geofence vertex budget exhausted (${MAX_TENANT_GEOFENCE_VERTICES}) — simplify or remove existing zones`,
          )
        }
        return tx.$queryRaw<Row[]>(Prisma.sql`
          INSERT INTO geofences (id,"tenantId","accountId",name,color,kind,geom)
          VALUES (gen_random_uuid(), ${scope.tenantId}::uuid, ${accountId}::uuid, ${data.name}, ${data.color ?? '#4DA3FF'}, ${data.kind}::"GeofenceKind", ${geog})
          RETURNING ${COLS}`)
      })
      const view = toView(rows[0]!)
      await audit.record(scope, actor, { action: 'create', entity: 'geofence', entityId: view.id, after: { id: view.id, name: view.name, kind: view.kind, accountId: view.accountId } })
      return view
    },
    update: async (scope, actor, id, data) => {
      const before = await one(scope, id)
      if (before === null) return null
      // a geometry redraw must match the stored kind: a corridor re-buffers a new line (same
      // ST_Buffer path as create), polygon/circle take the drawn polygon — never cross-kind
      if (data.geometry !== undefined && before.kind === 'corridor') throw new GeofenceInvalidError()
      if (data.line !== undefined && before.kind !== 'corridor') throw new GeofenceInvalidError()
      const geomExpr =
        data.geometry !== undefined
          ? Prisma.sql`ST_GeomFromGeoJSON(${JSON.stringify(data.geometry)})::geography`
          : data.line !== undefined
            ? (() => {
                if (typeof data.bufferM !== 'number' || data.bufferM < 10 || data.bufferM > 5_000) throw new GeofenceInvalidError()
                return Prisma.sql`ST_Buffer(ST_GeomFromGeoJSON(${JSON.stringify(data.line)})::geography, ${data.bufferM})`
              })()
            : null
      if (geomExpr !== null) await guardGeog(geomExpr)
      const sets: Prisma.Sql[] = []
      if (data.name !== undefined) sets.push(Prisma.sql`name = ${data.name}`)
      if (data.color !== undefined) sets.push(Prisma.sql`color = ${data.color}`)
      if (geomExpr !== null) sets.push(Prisma.sql`geom = ${geomExpr}`)
      if (sets.length === 0) return before
      // mutateScopeSql (NOT scopeSql): an account-scoped caller must not mutate a tenant-shared fence.
      // `before` may be a shared fence they can READ, but the UPDATE then matches zero rows → 404.
      const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
        UPDATE geofences SET ${Prisma.join(sets, ', ')} WHERE ${mutateScopeSql(scope)} AND id = ${id}::uuid RETURNING ${COLS}`)
      // an account caller targeting a shared fence (or a concurrent delete) matches zero rows — return a
      // clean 404 (null) instead of dereferencing undefined into a TypeError → 500 (review LOW)
      if (rows[0] === undefined) return null
      const view = toView(rows[0])
      await audit.record(scope, actor, { action: 'update', entity: 'geofence', entityId: id, before: { name: before.name, kind: before.kind }, after: { name: view.name, kind: view.kind } })
      return view
    },
    remove: async (scope, actor, id) => {
      const before = await one(scope, id)
      if (before === null) return false
      // mutateScopeSql (NOT scopeSql): an account-scoped caller can READ a tenant-shared fence but must
      // not DELETE it (that would disable it for every sibling account). affected==0 ⇒ not theirs → 404.
      const affected = await prisma.$executeRaw(Prisma.sql`DELETE FROM geofences WHERE ${mutateScopeSql(scope)} AND id = ${id}::uuid`)
      if (affected === 0) return false
      await audit.record(scope, actor, { action: 'delete', entity: 'geofence', entityId: id, before: { name: before.name, kind: before.kind } })
      return true
    },
  }
}
