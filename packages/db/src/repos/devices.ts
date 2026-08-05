import type { Device, OdometerSource, PrismaClient } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { ShareLinkRepo } from './shareLinks.js'
import { toInt8OrNull } from '../bigid.js'
import { isUniqueViolation } from '../errors.js'
import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

export interface DeviceCreate {
  accountId: string
  profileId: string
  imei: string
  name: string
  plate?: string | null
  groupName?: string | null
  /** SIM MSISDN (E.164) — the number config SMS are sent to (SMS gateway). */
  simMsisdn?: string | null
  /** SIM ICCID (18–22 digits) — informational. */
  simIccid?: string | null
  odometerSource?: OdometerSource
}
export interface DeviceUpdate {
  name?: string
  plate?: string | null
  groupName?: string | null
  simMsisdn?: string | null
  simIccid?: string | null
  profileId?: string
  odometerSource?: OdometerSource
}

/**
 * An IMEI is already claimed. Two ways to get here, and the caller must not be able to tell them
 * apart — the message never says which:
 *   - another ACTIVE device in THIS tenant holds it (the partial unique index, as a P2002 which
 *     would otherwise surface as a raw 500, review HIGH);
 *   - ANY device in ANOTHER tenant holds it, retired or not (checked explicitly in `create`).
 * Retiring frees an IMEI for its OWN tenant to re-register; it never releases it to a stranger.
 * The API translates this to a 409 / per-row import error WITHOUT leaking that the IMEI exists
 * elsewhere — the API never gets to see the other tenant's row.
 */
export class DuplicateImeiError extends Error {
  constructor(readonly imei: string) {
    super(`IMEI already registered: ${imei}`)
    this.name = 'DuplicateImeiError'
  }
}

/**
 * Devices repo (E03-3). Account-scoped (non-null accountId), like rules. NOT the
 * generic repo: `Device.id` is a BigInt PK, so the route `:id` string must be
 * coerced (a bad/overflowing id resolves to null → 404, never a 500). `imei` is
 * unique among ACTIVE devices (partial index, migration 20260805150000: retiring frees the IMEI so
 * returned hardware can be re-registered) — `getByImei` is scoped so a caller can't probe another
 * tenant's
 * IMEI. Redis registry sync (registry:imei / device:tenant / device:account) is
 * NOT here — it lives in the API layer (deviceRegistry.ts); this repo is pure DB.
 */
/** The device fields the ingest/worker Redis registry needs (deviceRegistry.activateDevice shape). */
export interface RegistryDeviceRow {
  id: bigint
  imei: string
  tenantId: string
  accountId: string
  profileId: string
  odometerSource: string
}

export interface DeviceRepo {
  list(scope: Scope): Promise<Device[]>
  /** Count of NON-retired devices in scope — the denominator for the plan deviceLimit cap check. */
  countActive(scope: Scope): Promise<number>
  /** Boot registry-rehydrate ONLY (UNSCOPED, platform-level): every non-retired device with the
   *  fields ingest/worker need in Redis. Never a request path — those are always tenant-scoped. */
  listAllForRegistry(): Promise<RegistryDeviceRow[]>
  /** UNSCOPED IMEI → device id for the worker's reject drain. Two jobs: a rejection whose device
   *  was GDPR-ERASED must not be written back (the drain runs on a timer after the erase), and the
   *  row stores the resolved id so the erase can key on the device rather than on an IMEI that may
   *  belong to two rows. Includes RETIRED devices: a live TCP session survives retire until the
   *  idle timeout, so a retired device still produces rejections, and only an ABSENT row means
   *  erased. Prefers the ACTIVE row when an IMEI has been reclaimed. Never a request path: it
   *  answers only "which of these exist", for ids the caller already holds. */
  imeisIn(imeis: readonly string[]): Promise<Map<string, bigint>>
  get(scope: Scope, id: string): Promise<Device | null>
  getByImei(scope: Scope, imei: string): Promise<Device | null>
  create(scope: Scope, actor: Actor, data: DeviceCreate): Promise<Device>
  update(scope: Scope, actor: Actor, id: string, data: DeviceUpdate): Promise<Device | null>
  /** Sets retiredAt=now (soft delete); returns the row or null if out of scope. */
  retire(scope: Scope, actor: Actor, id: string): Promise<Device | null>
}

/** Parse a route id to BigInt; non-numeric/out-of-int8-range → null (caller → 404). */
const toBigId = (id: string): bigint | null => toInt8OrNull(id)

export function createDeviceRepo(prisma: PrismaClient, audit: AuditRepo, shareLinks: Pick<ShareLinkRepo, 'revokeForDevice'>): DeviceRepo {
  const scopedById = async (scope: Scope, id: string): Promise<Device | null> => {
    const bid = toBigId(id)
    if (bid === null) return null
    return prisma.device.findFirst({ where: { ...scopedWhere(scope), id: bid } })
  }
  return {
    list: (scope) => prisma.device.findMany({ where: scopedWhere(scope), orderBy: { createdAt: 'desc' } }),
    countActive: (scope) => prisma.device.count({ where: { ...scopedWhere(scope), retiredAt: null } }),
    imeisIn: async (imeis) => {
      if (imeis.length === 0) return new Map()
      // retired LAST so an active row overwrites it in the Map: after a reclaim both exist, and a
      // live rejection belongs to the device in service
      const rows = await prisma.device.findMany({
        where: { imei: { in: [...imeis] } },
        select: { imei: true, id: true, retiredAt: true },
        orderBy: [{ retiredAt: { sort: 'desc', nulls: 'last' } }],
      })
      return new Map(rows.map((r) => [r.imei, r.id]))
    },
    listAllForRegistry: () =>
      prisma.device.findMany({
        where: { retiredAt: null },
        select: { id: true, imei: true, tenantId: true, accountId: true, profileId: true, odometerSource: true },
      }),
    get: (scope, id) => scopedById(scope, id),
    // ACTIVE first: after a re-registration the same IMEI can exist on both a retired row and the
    // new one, and every caller of this wants the device that is in service today
    getByImei: (scope, imei) =>
      prisma.device.findFirst({ where: { ...scopedWhere(scope), imei }, orderBy: [{ retiredAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }] }),
    create: async (scope, actor, data) => {
      // Retiring FREES an IMEI (partial unique index, migration 20260805150000) so returned hardware
      // can be re-installed — but only by whoever had it. The physical tracker may still be wired to
      // the vehicle and transmitting, and whoever holds the IMEI in `registry:imei` receives its
      // live positions, so a reclaim by a stranger means another company's vehicle reporting into
      // their account. Global uniqueness used to make that impossible; §6.1 already notes device
      // identity is IMEI-only and spoofable, and this keeps it FORGEABLE rather than ACQUIRABLE
      // through the ordinary "Add device" form.
      //
      // The boundary is the ACCOUNT, not the tenant. A white-label TSP runs unrelated end-customers
      // as accounts — `crud.ts` says so in as many words — and `account_manager` can create devices,
      // so a tenant-only guard left the same takeover one level down: account B's manager types the
      // IMEI account A just retired and starts receiving A's vehicle. A TENANT-scoped caller
      // (tsp_admin / platform_admin, no accountId pin) may still move a device between accounts they
      // both own; that is their fleet to reorganise.
      const held = await prisma.device.findFirst({
        where: {
          imei: data.imei,
          NOT:
            scope.accountId === undefined
              ? { tenantId: scope.tenantId }
              : { AND: [{ tenantId: scope.tenantId }, { accountId: scope.accountId }] },
        },
        select: { id: true },
      })
      if (held !== null) throw new DuplicateImeiError(data.imei)
      let row
      try {
        row = await prisma.device.create({
          data: {
            tenantId: scope.tenantId,
            accountId: data.accountId,
            profileId: data.profileId,
            imei: data.imei,
            name: data.name,
            plate: data.plate ?? null,
            groupName: data.groupName ?? null,
            simMsisdn: data.simMsisdn ?? null,
            simIccid: data.simIccid ?? null,
            ...(data.odometerSource !== undefined ? { odometerSource: data.odometerSource } : {}),
          },
        })
      } catch (err) {
        // the partial unique index — another ACTIVE device in THIS tenant already holds it
        if (isUniqueViolation(err)) throw new DuplicateImeiError(data.imei)
        throw err
      }
      await audit.record(scope, actor, { action: 'create', entity: 'device', entityId: String(row.id), after: row })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      const row = await prisma.device.update({ where: { id: before.id }, data })
      await audit.record(scope, actor, { action: 'update', entity: 'device', entityId: String(row.id), before, after: row })
      return row
    },
    retire: async (scope, actor, id) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      // Public share links die with the device (audit MED). Retiring is how an operator says "this
      // vehicle is no longer ours", and a live link keeps the UNAUTHENTICATED endpoint publishing
      // its last known position to anyone holding the URL for up to 30 more days — while the UI no
      // longer lists the device, so nobody can find the link to revoke it by hand.
      //
      // FIRST, and before the idempotent short-circuit below. Nothing here is transactional: with
      // the revoke placed after the `retiredAt` write, a failure left the device retired WITH live
      // links, and the retry then returned early and never revoked them — the exact state this is
      // meant to prevent, in the one place an operator cannot see it (the UI no longer lists the
      // device). Revoking is a no-op at zero live links, so running it on an already-retired device
      // costs one query and repairs that history.
      await shareLinks.revokeForDevice(scope, actor, before.id)
      if (before.retiredAt !== null) return before // already retired — idempotent
      const row = await prisma.device.update({ where: { id: before.id }, data: { retiredAt: new Date() } })
      await audit.record(scope, actor, { action: 'update', entity: 'device', entityId: String(row.id), before, after: row })
      return row
    },
  }
}
