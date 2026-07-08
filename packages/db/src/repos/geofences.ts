import { Prisma, type PrismaClient } from '@prisma/client'

import type { GeofenceView } from '@orbetra/shared'

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

export interface GeofenceCreate {
  name: string
  color?: string
  kind: 'polygon' | 'circle'
  accountId?: string | null
  geometry: unknown // GeoJSON Polygon (zod-validated shape upstream)
}
export interface GeofenceUpdate {
  name?: string
  color?: string
  kind?: 'polygon' | 'circle'
  geometry?: unknown
}

export interface GeofenceRepo {
  list(scope: Scope): Promise<GeofenceView[]>
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
  kind: r.kind as 'polygon' | 'circle',
  geometry: JSON.parse(r.geojson) as unknown,
  createdAt: r.createdAt.toISOString(),
})

const COLS = Prisma.sql`id, "tenantId", "accountId", name, color, kind::text AS kind, ST_AsGeoJSON(geom) AS geojson, "createdAt"`
const scopeSql = (scope: Scope): Prisma.Sql =>
  scope.accountId !== undefined
    ? Prisma.sql`"tenantId" = ${scope.tenantId}::uuid AND ("accountId" = ${scope.accountId}::uuid OR "accountId" IS NULL)`
    : Prisma.sql`"tenantId" = ${scope.tenantId}::uuid`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createGeofenceRepo(prisma: PrismaClient, audit: AuditRepo): GeofenceRepo {
  /** Validate + area-check a GeoJSON polygon in the DB before persisting. */
  const guard = async (geometry: unknown): Promise<void> => {
    const json = JSON.stringify(geometry)
    const [chk] = await prisma.$queryRaw<{ valid: boolean; area: number }[]>(
      Prisma.sql`SELECT ST_IsValid(g) AS valid, ST_Area(g::geography) AS area FROM (SELECT ST_GeomFromGeoJSON(${json}) AS g) s`,
    )
    if (chk === undefined || !chk.valid) throw new GeofenceInvalidError()
    if (Number(chk.area) > MAX_AREA_M2) throw new GeofenceTooLargeError()
  }
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
    get: one,
    create: async (scope, actor, data) => {
      await guard(data.geometry)
      const json = JSON.stringify(data.geometry)
      const accountId = data.accountId ?? null
      const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
        INSERT INTO geofences (id,"tenantId","accountId",name,color,kind,geom)
        VALUES (gen_random_uuid(), ${scope.tenantId}::uuid, ${accountId}::uuid, ${data.name}, ${data.color ?? '#4DA3FF'}, ${data.kind}::"GeofenceKind", ST_GeomFromGeoJSON(${json})::geography)
        RETURNING ${COLS}`)
      const view = toView(rows[0]!)
      await audit.record(scope, actor, { action: 'create', entity: 'geofence', entityId: view.id, after: { id: view.id, name: view.name, kind: view.kind, accountId: view.accountId } })
      return view
    },
    update: async (scope, actor, id, data) => {
      const before = await one(scope, id)
      if (before === null) return null
      if (data.geometry !== undefined) await guard(data.geometry)
      const sets: Prisma.Sql[] = []
      if (data.name !== undefined) sets.push(Prisma.sql`name = ${data.name}`)
      if (data.color !== undefined) sets.push(Prisma.sql`color = ${data.color}`)
      if (data.kind !== undefined) sets.push(Prisma.sql`kind = ${data.kind}::"GeofenceKind"`)
      if (data.geometry !== undefined) sets.push(Prisma.sql`geom = ST_GeomFromGeoJSON(${JSON.stringify(data.geometry)})::geography`)
      if (sets.length === 0) return before
      const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
        UPDATE geofences SET ${Prisma.join(sets, ', ')} WHERE ${scopeSql(scope)} AND id = ${id}::uuid RETURNING ${COLS}`)
      const view = toView(rows[0]!)
      await audit.record(scope, actor, { action: 'update', entity: 'geofence', entityId: id, before: { name: before.name, kind: before.kind }, after: { name: view.name, kind: view.kind } })
      return view
    },
    remove: async (scope, actor, id) => {
      const before = await one(scope, id)
      if (before === null) return false
      await prisma.$executeRaw(Prisma.sql`DELETE FROM geofences WHERE ${scopeSql(scope)} AND id = ${id}::uuid`)
      await audit.record(scope, actor, { action: 'delete', entity: 'geofence', entityId: id, before: { name: before.name, kind: before.kind } })
      return true
    },
  }
}
