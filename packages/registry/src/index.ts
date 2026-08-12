import type { Redis } from 'ioredis'

import { tenantDevicesKey } from '@orbetra/shared'

/**
 * The device REGISTRY contract — the Redis bridge between device CRUD and the raw pipeline.
 *
 * ingest reads `registry:imei` (imei → deviceId) on handshake and refuses anything absent; the
 * worker's LiveState reads `device:tenant` + `device:account` before publishing. A created device is
 * invisible to the pipeline until it is activated here; a torn-down one is refused on its next
 * connect. That makes this file the switch that decides whether a tracker's data is accepted at all.
 *
 * IT LIVES IN ITS OWN PACKAGE because it now has TWO writers. It began as `apps/api/src/routes/
 * deviceRegistry.ts`, which was right while device CRUD was the only thing that touched it — but
 * billing suspension (audit MED #22) has to tear the same keys down from the WORKER, and apps cannot
 * import each other. The alternative was a second copy of the key names and the delete-if-mine Lua
 * in another app, which is exactly how two writers of one contract drift apart: the first bug of
 * that shape (a blind HDEL stealing a reclaimed IMEI's mapping) cost a device its entire data feed
 * with nothing in the UI to show for it.
 */
export { tenantDevicesKey } from '@orbetra/shared'

export interface RegistryDevice {
  id: bigint
  imei: string
  tenantId: string
  accountId: string
  /** Trip config for the worker (E04-5): the device's profile presence_rules + odometerSource.
   *  Absent ⇒ the worker's trip engine uses defaults. */
  config?: { presenceRules: unknown; odometerSource: string; avlTable?: string }
}

/** The minimum a teardown needs — id and imei identify the mapping, tenantId the index member. */
export interface RegistryRef {
  id: bigint
  imei: string
  tenantId: string
}

export async function activateDevice(redis: Redis, d: RegistryDevice): Promise<void> {
  const id = d.id.toString()
  // If this device was previously registered to a DIFFERENT tenant, drop it from that tenant's
  // index — otherwise the old owner keeps a member pointing at a device it no longer owns. Read
  // first, outside the MULTI: a CRUD write, not a hot path.
  const prevTenant = await redis.hget('device:tenant', id)
  const m = redis
    .multi()
    .hset('registry:imei', d.imei, id)
    .hset('device:tenant', id, d.tenantId)
    .hset('device:account', id, d.accountId)
    .sadd(tenantDevicesKey(d.tenantId), id)
  if (prevTenant !== null && prevTenant !== d.tenantId) m.srem(tenantDevicesKey(prevTenant), id)
  if (d.config !== undefined) {
    m.hset('device:config', id, deviceConfigValue(d.config))
  }
  await m.exec()
}

/**
 * The `device:config` VALUE — one writer for a shape three call sites and a boot rehydrate produce.
 *
 * `avlTable` is the device profile's dictionary, and it is the only thing that tells the worker HOW
 * TO READ this model's IO elements. Without it every device is decoded with the FMB120 fallback,
 * which for an FMx6xx or a TAT is not "unnamed" but MISLABELLED — id 520 is "Tamper detection Event"
 * on a TAT100 and "Agricultural State Flags P4" on FMB120, and a Signed temperature read as
 * unsigned turns −3 °C into 65533. Optional because a config written before this field existed must
 * keep working: the worker falls back rather than refusing to decode.
 */
export const deviceConfigValue = (c: { presenceRules: unknown; odometerSource: string; avlTable?: string }): string =>
  JSON.stringify({
    presenceRules: c.presenceRules ?? {},
    odometerSource: c.odometerSource,
    ...(c.avlTable !== undefined ? { avlTable: c.avlTable } : {}),
  })

/** Update ONLY the worker trip config for a device (E04-5) — used when a PATCH changes
 * odometerSource or profile without re-activating the whole registry entry. */
export async function syncDeviceConfig(
  redis: Redis,
  id: bigint,
  presenceRules: unknown,
  odometerSource: string,
  avlTable?: string,
): Promise<void> {
  await redis.hset('device:config', id.toString(), deviceConfigValue({ presenceRules, odometerSource, avlTable }))
}

/**
 * Remove `registry:imei[imei]` ONLY when it still points at this device.
 *
 * A blind HDEL is keyed on the IMEI, not on who owns it — and since retiring frees an IMEI, a repeat
 * DELETE on an already-retired device would tear down the mapping of the LIVE device that reclaimed
 * it (audit review HIGH). That device stays `retiredAt = NULL` and looks active in the UI while
 * ingest answers its handshake with 0x00, quarantines it, and after a few rejects closes the socket
 * on sight: no positions, no trips, no alerts, and nothing to distinguish it from a device that
 * simply went offline. Only an API restart repairs it, because the boot rehydrate is the sole other
 * writer of that key.
 */
const HDEL_IF_MINE = `if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then return redis.call('HDEL', KEYS[1], ARGV[1]) end
return 0`

export interface DeactivateOptions {
  /**
   * Keep `device:{id}:last` — the device's most recent fix.
   *
   * RETIREMENT drops it: the device is gone and its last position should not linger on a map. A
   * billing SUSPENSION must not, because nothing can rebuild that key: `activateDevice` never writes
   * it and neither does the boot rehydrate — only the worker's LiveState does, on the next incoming
   * fix. Dropping it would mean a customer who pays gets their devices back and still sees a blank
   * map until every vehicle happens to report, which for a parked van on an ignition-triggered
   * profile is days — while the email we just sent them promises "within a minute".
   */
  keepLastFix?: boolean
}

export async function deactivateDevice(redis: Redis, d: RegistryRef, opts: DeactivateOptions = {}): Promise<void> {
  const id = d.id.toString()
  // The index entry is keyed by tenant, and the caller ALWAYS knows the tenant — it just read the
  // device row through a scoped repo. Deriving it from `device:tenant` instead would skip the SREM
  // whenever that hash row was already gone (a partially-applied earlier teardown, a Redis flush
  // before a rehydrate), stranding the member permanently: the index only ever grows, and nothing
  // else prunes it.
  await redis.eval(HDEL_IF_MINE, 1, 'registry:imei', d.imei, id)
  const m = redis.multi().hdel('device:tenant', id).hdel('device:account', id).hdel('device:config', id)
  if (opts.keepLastFix !== true) m.del(`device:${id}:last`)
  await m.srem(tenantDevicesKey(d.tenantId), id).exec()
}

/**
 * SUSPEND a whole tenant: stop the pipeline accepting anything from its devices (audit MED #22).
 *
 * The teardown is per device and reuses `deactivateDevice`, so the delete-if-mine guard applies to
 * every one of them — a suspension must never steal the `registry:imei` mapping of a device that
 * some OTHER tenant has since reclaimed. Returns how many were handed in, which is what the log
 * reports; the METRIC counts tenants, from the durable flag, not from this walk.
 *
 * What this deliberately does NOT do: touch a single row of the tenant's data. Positions, trips,
 * events and reports all stay, the customer can still sign in and read them, and paying restores the
 * feed within one webhook. Suspension stops the meter running; it is not a deletion.
 */
export async function suspendTenantDevices(redis: Redis, devices: readonly RegistryRef[]): Promise<number> {
  // `keepLastFix` — see DeactivateOptions. A suspension is reversible and must LOOK reversible: the
  // last known position is what makes the map non-empty the second the fleet is restored.
  for (const d of devices) await deactivateDevice(redis, d, { keepLastFix: true })
  return devices.length
}

/**
 * A device row as the DB hands it back (`tenants.registryDevicesFor`): FLAT, with the trip config as
 * two sibling columns rather than a nested object.
 */
export interface TenantDeviceRow {
  id: bigint
  imei: string
  tenantId: string
  accountId: string
  presenceRules: unknown
  odometerSource: string
  /** The profile's AVL dictionary — see `deviceConfigValue`. Optional ONLY so an older caller still
   *  compiles; a restore that omits it puts the tenant's whole fleet on the decoding fallback. */
  avlTable?: string
}

/**
 * RESTORE a suspended tenant — the exact inverse of a suspension, run the moment a payment lands or
 * a platform admin overrides.
 *
 * It takes the FLAT row and nests the config itself, which is the whole point. `RegistryDevice.config`
 * is optional, so handing the flat rows straight to `activateDevice` typechecks perfectly and simply
 * skips `device:config` — the fleet comes back on the air with default presence rules and GPS
 * odometry instead of CAN, which nobody notices because data is flowing. Three call sites each did
 * this mapping by hand and the third one forgot; doing it once here means a fourth cannot.
 *
 * Idempotent: re-activating a device that is already present is a no-op.
 */
export async function restoreTenantDevices(redis: Redis, devices: readonly TenantDeviceRow[]): Promise<number> {
  for (const d of devices) {
    await activateDevice(redis, {
      id: d.id,
      imei: d.imei,
      tenantId: d.tenantId,
      accountId: d.accountId,
      config: { presenceRules: d.presenceRules, odometerSource: d.odometerSource, avlTable: d.avlTable },
    })
  }
  return devices.length
}
