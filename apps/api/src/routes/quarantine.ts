import type { Redis } from 'ioredis'

import type { Actor, Db } from '@orbetra/db'
import { DuplicateImeiError } from '@orbetra/db'

import { activateDevice } from './deviceRegistry.js'

/**
 * Quarantine list + claim (E03-4, PLATFORM level). Unknown IMEIs land in Redis via
 * ingest (`quarantine:imei` zset score=last-seen ms, `quarantine:rejects:{imei}`
 * counter). platform_admin reviews the list and claims a device INTO a chosen
 * tenant/account/profile — which is the E03-3 device-create + registry-activate
 * path, then removes the IMEI from quarantine.
 */

export interface QuarantineEntry {
  imei: string
  lastSeenMs: number
  rejects: number
}

/** Newest-first list with per-IMEI reject counts (single pipeline for the counters). */
export async function listQuarantine(redis: Redis, limit = 200): Promise<QuarantineEntry[]> {
  const raw = await redis.zrevrange('quarantine:imei', 0, limit - 1, 'WITHSCORES')
  const entries: { imei: string; lastSeenMs: number }[] = []
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ imei: raw[i]!, lastSeenMs: Number(raw[i + 1]) })
  }
  if (entries.length === 0) return []
  const pipe = redis.pipeline()
  for (const e of entries) pipe.get(`quarantine:rejects:${e.imei}`)
  const counts = await pipe.exec()
  return entries.map((e, i) => ({
    ...e,
    rejects: Number((counts?.[i]?.[1] as string | null) ?? 0),
  }))
}

export interface ClaimInput {
  imei: string
  tenantId: string
  accountId: string
  profileId: string
  name: string
}

export type ClaimResult =
  | { ok: true; deviceId: string }
  | { ok: false; status: 400 | 403 | 409; reason: string }

/**
 * Claim: create the device in the TARGET tenant's scope (NOT the admin's own),
 * validating the account belongs to that tenant, then activate the registry and
 * drop the IMEI from quarantine. Idempotent ZREM/DEL — a claim of an IMEI no
 * longer in quarantine still creates the device.
 *
 * The zset stays a HINT for the ordinary claim, and is a PRECONDITION for exactly one thing:
 * overriding a retired holder in another tenant. See the comment at the create call.
 */
export async function claimDevice(db: Db, redis: Redis, actor: Actor, input: ClaimInput): Promise<ClaimResult> {
  const scope = { tenantId: input.tenantId } // platform admin acts on the target tenant
  if ((await db.accounts.get(scope, input.accountId)) === null) {
    return { ok: false, status: 400, reason: 'accountId not in the target tenant' }
  }
  // tenant-plan device cap (WP2): a claim assigns a device INTO the target tenant, so it is bound
  // by THAT tenant's plan (not the platform admin's). Direct plans cap non-retired devices; TSP
  // plans are uncapped (deviceLimit null).
  // …and it takes the SAME per-tenant lock as POST /v1/devices and the CSV import. Without it the
  // lock only serialized single-create against single-create, so a claim racing an import — or two
  // claims — could each pass at limit-1 and overshoot the cap permanently, since nothing re-checks
  // it after creation. Audit MED.
  const cap = (await db.tenants.getEntitlements(input.tenantId)).deviceLimit
  const capLock = cap === null ? null : `device:create:${input.tenantId}`
  if (capLock !== null && (await redis.set(capLock, '1', 'EX', 10, 'NX')) === null) {
    return { ok: false, status: 409, reason: 'device_create_in_progress' }
  }
  try {
    if (cap !== null && (await db.devices.countActive(scope)) + 1 > cap) {
      return { ok: false, status: 403, reason: 'device_limit_reached' }
    }
    // validate the (global) profile so a bad uuid is a clean 400, not a P2003 500 (review MED)
    const profile = await db.profiles.get(input.profileId)
    if (profile === null) {
      return { ok: false, status: 400, reason: 'unknown profileId' }
    }
    let device
    try {
      // A RETIRED holder in ANOTHER tenant blocks this path unless the IMEI is currently in
      // quarantine (audit 2026-08-11 #2). An ACTIVE one always blocks — enforced by the global
      // partial unique index, with the repo predicate as defence in depth.
      //
      // Be precise about what the quarantine check buys, because every looser wording of this
      // comment has been wrong. It is NOT proof of possession. Over TCP the IMEI is the only
      // identity on the handshake, and over UDP the source and the IMEI are both attacker-chosen
      // (`apps/ingest/src/registry.ts`), so one datagram from anywhere creates an entry with no
      // device behind it. Nor does membership mean "transmitting right now": the zset has no TTL —
      // it is trimmed by RANK to the newest 10 000 — so an entry persists until that many other
      // unknown IMEIs push it out. And the honest case is indistinguishable from the abusive one: a
      // tracker retired but never uninstalled is rejected by ingest and quarantined exactly like a
      // squatted IMEI.
      //
      // All the check buys is that this override cannot be aimed at a hold AT REST: a platform
      // admin cannot quietly reassign an IMEI nothing has ever sent us. Deciding who owns the
      // hardware is an off-platform judgement — an invoice, a serial, a phone call — and this flag
      // is how that decision gets carried out. Without it there was no way to carry it out at all:
      // retiring a device kept its IMEI blocked platform-wide forever, and deleting the squatting
      // tenant fails on a RESTRICT foreign key, so a customer who could not onboard their own
      // hardware waited for someone to run manual SQL.
      //
      // Known consequence, worth stating rather than discovering: because the trim is by rank, a
      // flood of 10 000 unknown IMEIs evicts a genuine victim's entry and denies them this remedy
      // until their tracker is seen again. That is a reason to keep the remedy operator-driven, not
      // a reason to trust the zset.
      const inQuarantine = (await redis
        .zscore('quarantine:imei', input.imei)
        .catch((e: unknown) => {
          // a blip disables the override — the safe direction, but not a silent one: the caller
          // gets a 409 that is indistinguishable from a genuine conflict unless this is logged
          console.error('quarantine: membership check unavailable, retired-holder override disabled', input.imei, e)
          return null
        })) !== null
      device = await db.devices.create(scope, actor, {
        accountId: input.accountId,
        profileId: input.profileId,
        imei: input.imei,
        name: input.name,
      }, { overrideRetiredHolder: inQuarantine })
    } catch (err) {
      if (err instanceof DuplicateImeiError) return { ok: false, status: 409, reason: 'IMEI already registered' }
      throw err
    }
    await activateDevice(redis, {
      id: device.id, imei: device.imei, tenantId: input.tenantId, accountId: input.accountId,
      config: { presenceRules: profile.presenceRules, odometerSource: device.odometerSource }, // E04-5
    })
    await redis.multi().zrem('quarantine:imei', input.imei).del(`quarantine:rejects:${input.imei}`).exec()
    return { ok: true, deviceId: device.id.toString() }
  } finally {
    if (capLock !== null) await redis.del(capLock).catch(() => undefined)
  }
}
