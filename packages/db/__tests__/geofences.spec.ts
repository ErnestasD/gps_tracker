import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, GeofenceInvalidError, GeofenceTooLargeError, type Db } from '../src/index.js'

/**
 * Geofence repo — corridor (V2). A corridor stores a ST_Buffer'd route line as its `geom`
 * geography(Polygon), so the SAME point-in-polygon engine (worker, E05-2) evaluates it with
 * zero worker changes: the view's `geometry` is the resulting buffered Polygon. We prove:
 *   - a corridor create buffers a LineString into a valid Polygon (kind persists as 'corridor')
 *   - the buffered polygon is area-capped like any other geofence (huge buffer ⇒ TooLarge)
 *   - a plain polygon still works (regression) and an invalid polygon is rejected.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000e' }

let container: StartedTestContainer
let db: Db

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  db = createDb(url)
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

async function seedTenant(name: string) {
  const tenant = await db.tenants.create(actor, { name })
  const account = await db.accounts.create({ tenantId: tenant.id }, actor, { name: `${name} Acct` })
  return { aScope: { tenantId: tenant.id, accountId: account.id }, accountId: account.id }
}

// A short Vilnius-area route (~1 km). Buffered by 100 m ⇒ a valid, small corridor polygon.
const ROUTE = { type: 'LineString', coordinates: [[25.27, 54.687], [25.28, 54.69], [25.29, 54.688]] } as const

describe('geofence repo — corridor (V2)', () => {
  it('buffers a corridor line into a valid Polygon and persists kind=corridor', async () => {
    const { aScope, accountId } = await seedTenant('Corridor Co')
    const gf = await db.geofences.create(aScope, actor, { name: 'A1 route', kind: 'corridor', accountId, line: ROUTE, bufferM: 100 })
    expect(gf.kind).toBe('corridor')
    // stored geom is the buffered polygon — the worker/point-in-polygon engine sees a Polygon
    const geom = gf.geometry as { type: string; coordinates: unknown[] }
    expect(geom.type).toBe('Polygon')
    expect(geom.coordinates.length).toBeGreaterThanOrEqual(1)
    // it round-trips through get()
    expect((await db.geofences.get(aScope, gf.id))?.kind).toBe('corridor')
  })

  it('area-caps a corridor: a 5 km buffer on a long line exceeds 10,000 km²', async () => {
    const { aScope, accountId } = await seedTenant('Big Corridor Co')
    // a long trans-country line; 5 km half-width ⇒ ~10 km wide × very long ⇒ over the cap
    const longLine = { type: 'LineString', coordinates: [[10, 50], [30, 50], [30, 60], [10, 60]] }
    await expect(
      db.geofences.create(aScope, actor, { name: 'too big', kind: 'corridor', accountId, line: longLine, bufferM: 5_000 }),
    ).rejects.toBeInstanceOf(GeofenceTooLargeError)
  })

  it('rejects a bare corridor call with a missing/out-of-range buffer (non-HTTP caller guard)', async () => {
    const { aScope, accountId } = await seedTenant('Bad Buffer Co')
    // the API's zod refine catches this, but a direct repo call must not ST_Buffer(line, 0) → empty fence
    await expect(
      db.geofences.create(aScope, actor, { name: 'no buf', kind: 'corridor', accountId, line: ROUTE }),
    ).rejects.toBeInstanceOf(GeofenceInvalidError)
    await expect(
      db.geofences.create(aScope, actor, { name: 'zero buf', kind: 'corridor', accountId, line: ROUTE, bufferM: 0 }),
    ).rejects.toBeInstanceOf(GeofenceInvalidError)
  })

  it('still creates a plain polygon and rejects an invalid one (regression)', async () => {
    const { aScope, accountId } = await seedTenant('Poly Co')
    const square = { type: 'Polygon', coordinates: [[[25.26, 54.67], [25.3, 54.67], [25.3, 54.7], [25.26, 54.7], [25.26, 54.67]]] }
    const ok = await db.geofences.create(aScope, actor, { name: 'square', kind: 'polygon', accountId, geometry: square })
    expect(ok.kind).toBe('polygon')
    // a self-intersecting bow-tie ring is not ST_IsValid
    const bowtie = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] }
    await expect(
      db.geofences.create(aScope, actor, { name: 'bad', kind: 'polygon', accountId, geometry: bowtie }),
    ).rejects.toBeInstanceOf(GeofenceInvalidError)
  })
})

/**
 * The audit trail has to say WHICH change happened, and a redraw is the change this entity mostly
 * gets. The snapshot used to be {name, kind} only, so moving a polygon wrote a row whose two sides
 * were byte-identical — the page rendered "no field changes recorded" over a real edit (9 such rows
 * on the founder's tenant, which is how this was found).
 */
describe('geofence audit — a redraw is a change the trail can see', () => {
  const square = (x: number) => ({
    type: 'Polygon',
    coordinates: [[[x, 54.67], [x + 0.04, 54.67], [x + 0.04, 54.7], [x, 54.7], [x, 54.67]]],
  })

  it('records the redraw, the colour and the name — never two identical sides', async () => {
    const { aScope, accountId } = await seedTenant('Redraw Co')
    const gf = await db.geofences.create(aScope, actor, { name: 'yard', kind: 'polygon', accountId, geometry: square(25.26) })
    await db.geofences.update(aScope, actor, gf.id, { geometry: square(25.4) }) // shape only
    await db.geofences.update(aScope, actor, gf.id, { color: '#FF0000' }) // colour only

    const rows = (await db.audit.list(aScope, { take: 50 })).filter((r) => r.entity === 'geofence' && r.action === 'update')
    expect(rows.length).toBe(2)
    for (const r of rows) expect(JSON.stringify(r.before)).not.toBe(JSON.stringify(r.after))
    const [colourRow, shapeRow] = rows // list is id desc: colour is the newer one
    expect((shapeRow!.after as { geometryChanged?: boolean }).geometryChanged).toBe(true)
    expect((colourRow!.after as { color?: string }).color).toBe('#FF0000')
    // the polygon itself never lands in the trail — it would be unreadable, and the fact is enough
    expect(JSON.stringify(shapeRow!.after)).not.toContain('coordinates')
  })
})
