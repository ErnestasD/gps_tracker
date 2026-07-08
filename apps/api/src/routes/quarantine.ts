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
  | { ok: false; status: 400 | 409; reason: string }

/**
 * Claim: create the device in the TARGET tenant's scope (NOT the admin's own),
 * validating the account belongs to that tenant, then activate the registry and
 * drop the IMEI from quarantine. Idempotent ZREM/DEL — a claim of an IMEI no
 * longer in quarantine still creates the device.
 */
export async function claimDevice(db: Db, redis: Redis, actor: Actor, input: ClaimInput): Promise<ClaimResult> {
  const scope = { tenantId: input.tenantId } // platform admin acts on the target tenant
  if ((await db.accounts.get(scope, input.accountId)) === null) {
    return { ok: false, status: 400, reason: 'accountId not in the target tenant' }
  }
  // validate the (global) profile so a bad uuid is a clean 400, not a P2003 500 (review MED)
  const profile = await db.profiles.get(input.profileId)
  if (profile === null) {
    return { ok: false, status: 400, reason: 'unknown profileId' }
  }
  let device
  try {
    device = await db.devices.create(scope, actor, {
      accountId: input.accountId,
      profileId: input.profileId,
      imei: input.imei,
      name: input.name,
    })
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
}
