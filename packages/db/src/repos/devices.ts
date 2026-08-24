import type { Device, FuelType, OdometerSource, PrismaClient, VehicleStatus } from '@prisma/client'

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
  odometerSource?: OdometerSource
  // vehicle profile (FLEET-1 F1)
  make?: string | null
  vehicleModel?: string | null
  year?: number | null
  vin?: string | null
  fuelType?: FuelType | null
  vehicleStatus?: VehicleStatus
  purchaseDate?: Date | null
  purchasePriceCents?: number | null
  driverId?: string | null
}
export interface DeviceUpdate {
  name?: string
  plate?: string | null
  groupName?: string | null
  simMsisdn?: string | null
  profileId?: string
  odometerSource?: OdometerSource
  // vehicle profile (FLEET-1 F1)
  make?: string | null
  vehicleModel?: string | null
  year?: number | null
  vin?: string | null
  fuelType?: FuelType | null
  vehicleStatus?: VehicleStatus
  purchaseDate?: Date | null
  purchasePriceCents?: number | null
  driverId?: string | null
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

/** Bound on the displaced-holder audit fan-out; more than a handful means something is very wrong. */
const MAX_DISPLACED_HOLDERS = 20

/**
 * Permission to take an IMEI whose only other holders are RETIRED rows.
 *
 * The cross-tenant hold exists for data protection, not identifier hygiene: a retired tracker may
 * still be wired to a vehicle and transmitting, and whoever holds the IMEI in `registry:imei`
 * receives its live positions. That is why the hold must never expire on a timer — a timer would
 * hand any tracker its owner retired but never uninstalled to whoever waited long enough.
 *
 * What the hold lacked was a way OUT, and that is what made it a weapon: `countActive` filters
 * `retiredAt: null` while the hold predicate does not, so create→retire in a loop squatted IMEIs
 * against every other tenant for free, from a trial account, permanently — deleting the squatting
 * tenant fails on a RESTRICT foreign key, so releasing one meant manual SQL (audit 2026-08-11 #2).
 *
 * ★ THIS FLAG IS OPERATOR DISCRETION, NOT EVIDENCE. Say so plainly, because the first version of
 * this comment claimed the opposite and review proved it false. The one caller requires the IMEI to
 * be in quarantine, and quarantine membership is NOT proof of possession: any TCP client can put an
 * arbitrary IMEI there by opening a Teltonika handshake — the IMEI *is* the identity on that path,
 * there is no credential (`apps/ingest/src/session.ts`). Worse, the honest case and the abusive one
 * produce the SAME entry: a device someone retired without uninstalling is rejected by ingest and
 * quarantined exactly like a squatted one. Membership only proves that somebody, somewhere, was
 * seen sending this IMEI at some point — the zset has no TTL, it is trimmed by rank — and never
 * who should own it. That question is settled off-platform, by a human looking at an invoice, and
 * this flag is how they carry out that decision.
 *
 * An ACTIVE holder is refused regardless, and note where that guarantee really lives: the global
 * partial unique index `devices_imei_active_key ON devices(imei) WHERE "retiredAt" IS NULL`
 * (migration 20260805150000) makes two live rows on one IMEI a database impossibility. The
 * predicate below narrows to `retiredAt: null` as defence in depth on top of that, not instead
 * of it.
 */
export interface ImeiHoldOverride {
  overrideRetiredHolder?: boolean
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
  /** Boot registry-rehydrate ONLY (UNSCOPED, platform-level): every non-retired device OF AN
   *  UNSUSPENDED TENANT, with the fields ingest/worker need in Redis. The suspension predicate is
   *  load-bearing, not hygiene — see the query. Never a request path; those are tenant-scoped. */
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
  /**
   * @param opts.overrideRetiredHolder Let the create proceed when the IMEI is held ONLY by RETIRED
   * rows in other tenants. An ACTIVE holder still refuses, always — see `ImeiHoldOverride`.
   */
  create(scope: Scope, actor: Actor, data: DeviceCreate, opts?: ImeiHoldOverride): Promise<Device>
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
    listAllForRegistry: async () => {
      // Two queries because `Device` carries `tenantId` without a relation field, so Prisma cannot
      // express this as a nested filter. Suspended tenants are a handful at most; this runs once,
      // at boot.
      const suspended = await prisma.tenant.findMany({ where: { suspendedAt: { not: null } }, select: { id: true } })
      return prisma.device.findMany({
        // …and NOT a suspended tenant's. Billing suspension IS the removal of these Redis keys
        // (`suspendTenantDevices` → `deactivateDevice`), while `suspendedAt` is the durable record.
        // Rebuilding the registry from `devices` alone put every cut-off fleet back on the air on
        // any API restart: the customer we had just emailed "your fleet has been stopped" watched
        // their vehicles reappear, the admin panel still said suspended, and we metered the traffic.
        // Nothing re-asserted the teardown until the DAILY lapse sweep — and a tenant suspended by
        // a platform admin is never on the lapsed list at all, so for those the resurrection was
        // permanent. It also bypassed `POST /v1/tenants/:id/restore`, which exists precisely to make
        // putting a fleet back a deliberate, audited act.
        where: { retiredAt: null, ...(suspended.length > 0 ? { tenantId: { notIn: suspended.map((t) => t.id) } } : {}) },
        select: { id: true, imei: true, tenantId: true, accountId: true, profileId: true, odometerSource: true },
      })
    },
    get: (scope, id) => scopedById(scope, id),
    // ACTIVE first: after a re-registration the same IMEI can exist on both a retired row and the
    // new one, and every caller of this wants the device that is in service today
    getByImei: (scope, imei) =>
      prisma.device.findFirst({ where: { ...scopedWhere(scope), imei }, orderBy: [{ retiredAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }] }),
    create: async (scope, actor, data, opts) => {
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
      //
      // `overrideRetiredHolder` (platform_admin claiming out of quarantine) narrows this to ACTIVE
      // holders only. It is a narrowing of WHICH rows block, never a bypass: the predicate is
      // re-evaluated with `retiredAt: null` rather than skipped, so a squatter who parks a retired
      // row beside a live device cannot use the override as a skeleton key.
      const held = await prisma.device.findFirst({
        where: {
          imei: data.imei,
          ...(opts?.overrideRetiredHolder === true ? { retiredAt: null } : {}),
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
            ...(data.odometerSource !== undefined ? { odometerSource: data.odometerSource } : {}),
            // vehicle profile (FLEET-1 F1) — all optional; absent stays at column defaults
            make: data.make ?? null,
            vehicleModel: data.vehicleModel ?? null,
            year: data.year ?? null,
            vin: data.vin ?? null,
            fuelType: data.fuelType ?? null,
            ...(data.vehicleStatus !== undefined ? { vehicleStatus: data.vehicleStatus } : {}),
            purchaseDate: data.purchaseDate ?? null,
            purchasePriceCents: data.purchasePriceCents ?? null,
            driverId: data.driverId ?? null,
          },
        })
      } catch (err) {
        // the partial unique index — another ACTIVE device in THIS tenant already holds it
        if (isUniqueViolation(err)) throw new DuplicateImeiError(data.imei)
        throw err
      }
      await audit.record(scope, actor, { action: 'create', entity: 'device', entityId: String(row.id), after: row })
      // A transfer with no record on the LOSING side is how a support dispute becomes unresolvable:
      // the gaining tenant gets the device-create entry above, and the tenant whose hold was
      // released would otherwise have nothing at all. Filed in THEIR scope so their own admins can
      // read it, with the platform admin who decided it as the actor.
      //
      // AFTER the create, never before: audit_log is append-only with no update or delete, so a row
      // written ahead of a create that then fails on the unique index is a permanent record of a
      // release that never happened, and nothing can retract it.
      //
      // The payload deliberately does NOT name the gaining tenant. `DuplicateImeiError` above
      // promises the API never reveals that an IMEI exists elsewhere, and in the squat case the
      // displaced tenant IS the attacker — handing them the victim's tenant id through their own
      // audit feed (READ_POLICY.audit = TENANT_ADMINS) would undo that in the one case it matters.
      if (opts?.overrideRetiredHolder === true) {
        // EVERYTHING here is best-effort, and the try has to cover the QUERY as well as the writes.
        // The device row is COMMITTED by this point. Letting anything throw out of here hands the
        // caller a 500 for a device that exists and holds the IMEI, while the registry activation
        // and the quarantine cleanup in the caller never run — the admin retries and meets their
        // own new row as a 409 for something they were told had failed. A missing breadcrumb is the
        // smaller loss. (An earlier version caught only the individual audit writes and left the
        // findMany bare, which is the same orphan one level down.)
        try {
          const found = await prisma.device.findMany({
            where: {
              imei: data.imei,
              retiredAt: { not: null },
              NOT:
                scope.accountId === undefined
                  ? { tenantId: scope.tenantId }
                  : { AND: [{ tenantId: scope.tenantId }, { accountId: scope.accountId }] },
            },
            select: { id: true, tenantId: true },
            // ordered and over-fetched by one: without an order the surviving 20 were an arbitrary
            // subset, so past the bound some tenants lost their record with nothing saying so
            orderBy: { id: 'asc' },
            take: MAX_DISPLACED_HOLDERS + 1,
          })
          if (found.length > MAX_DISPLACED_HOLDERS) {
            console.warn('devices: more retired holders than the audit fan-out bound; the rest are released without a record', {
              imei: data.imei, bound: MAX_DISPLACED_HOLDERS,
            })
          }
          const displaced = found.slice(0, MAX_DISPLACED_HOLDERS)
        for (const d of displaced) {
          await audit
            .record({ tenantId: d.tenantId }, actor, {
              action: 'update',
              entity: 'device',
              entityId: String(d.id),
              before: { imeiHold: 'held' },
              after: { imeiHold: 'released', reason: 'released by a platform administrator' },
            })
            .catch((e: unknown) => console.error('devices: could not record the released IMEI hold', { deviceId: String(d.id), imei: data.imei }, e))
        }
        } catch (e: unknown) {
          console.error('devices: could not record the released IMEI holds', { imei: data.imei }, e)
        }
      }
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
