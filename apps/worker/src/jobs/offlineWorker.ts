import { Worker, type ConnectionOptions } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { sweepOffline, type DeviceState, type OfflineRule } from '../rules/offline.js'
import { writeRuleEvents } from '../rules/writer.js'
import { DEVICE_OFFLINE_QUEUE } from './offlineQueue.js'

/** Fired-flag TTL (30 days): bounds the Redis key for decommissioned/rule-removed devices
 * and re-arms a chronically-offline device (re-alert) roughly once per TTL. */
const OFFLINE_FLAG_TTL_S = 30 * 24 * 3_600

export interface OfflineWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  /** registry/state connection (device:*, rule:*). */
  redis: Redis
  onFired?: (n: number) => void // metric hook: device_offline events written
}

/** device_offline rules grouped by accountId, loaded from the tenants that own devices. */
async function loadOfflineRules(redis: Redis, tenants: readonly string[]): Promise<Map<string, OfflineRule[]>> {
  const byAccount = new Map<string, OfflineRule[]>()
  const pipe = redis.pipeline()
  for (const t of tenants) pipe.hgetall(`rule:tenant:${t}`)
  const res = await pipe.exec()
  tenants.forEach((_t, i) => {
    const h = (res?.[i]?.[1] ?? {}) as Record<string, string>
    for (const [ruleId, val] of Object.entries(h)) {
      try {
        const j = JSON.parse(val) as { accountId: string; kind: string; enabled?: boolean; config?: Record<string, unknown> }
        if (j.kind !== 'device_offline' || j.enabled === false) continue
        const afterH = typeof j.config?.['afterH'] === 'number' ? j.config['afterH'] : undefined
        const list = byAccount.get(j.accountId) ?? []
        list.push({ ruleId, accountId: j.accountId, ...(afterH !== undefined ? { afterH } : {}) })
        byAccount.set(j.accountId, list)
      } catch {
        // malformed rule entry → skip
      }
    }
  })
  return byAccount
}

/** Read presence + profile threshold + fired-flag for the candidate devices. */
async function loadDeviceStates(
  redis: Redis,
  candidates: { deviceId: string; tenantId: string; accountId: string }[],
): Promise<{ states: DeviceState[]; flagged: Set<string> }> {
  const pipe = redis.pipeline()
  for (const d of candidates) {
    pipe.hget(`device:${d.deviceId}:last`, 'fixTimeMs')
    pipe.hget('device:config', d.deviceId)
    pipe.exists(`rule:offline:${d.deviceId}`)
  }
  const res = await pipe.exec()
  const states: DeviceState[] = []
  const flagged = new Set<string>()
  candidates.forEach((d, i) => {
    const base = i * 3
    const fixRaw = res?.[base]?.[1] as string | null | undefined
    const cfgRaw = res?.[base + 1]?.[1] as string | null | undefined
    const exists = res?.[base + 2]?.[1] as number | undefined
    let profileOfflineAfterH: number | undefined
    if (cfgRaw) {
      try {
        const c = JSON.parse(cfgRaw) as { presenceRules?: { offlineAfterH?: unknown } }
        const v = c.presenceRules?.offlineAfterH
        if (typeof v === 'number') profileOfflineAfterH = v
      } catch {
        // ignore malformed config
      }
    }
    states.push({
      deviceId: d.deviceId,
      tenantId: d.tenantId,
      accountId: d.accountId,
      lastFixMs: fixRaw != null ? Number(fixRaw) : null,
      ...(profileOfflineAfterH !== undefined ? { profileOfflineAfterH } : {}),
    })
    if (exists === 1) flagged.add(d.deviceId)
  })
  return { states, flagged }
}

/** Run one sweep: registry → offline rules → presence → events + flag updates. */
export async function runOfflineSweep(pool: Pool, redis: Redis, nowMs: number): Promise<number> {
  const [tenantMap, accountMap] = await Promise.all([redis.hgetall('device:tenant'), redis.hgetall('device:account')])
  const tenants = [...new Set(Object.values(tenantMap))]
  if (tenants.length === 0) return 0
  const rulesByAccount = await loadOfflineRules(redis, tenants)
  if (rulesByAccount.size === 0) return 0 // no device_offline rules anywhere → nothing to do

  // only devices whose account has an offline rule are candidates
  const candidates = Object.keys(tenantMap)
    .map((deviceId) => ({ deviceId, tenantId: tenantMap[deviceId]!, accountId: accountMap[deviceId] ?? '' }))
    .filter((d) => d.accountId !== '' && rulesByAccount.has(d.accountId))
  if (candidates.length === 0) return 0

  const { states, flagged } = await loadDeviceStates(redis, candidates)
  const { events, toFlag, toClear } = sweepOffline(states, rulesByAccount, flagged, nowMs)

  // Claim each device's fired-flag with SET NX BEFORE writing its event: if two sweep ticks
  // overlap (a slow sweep + the next 60 s tick landing on another replica) only the winner
  // emits, so no duplicate device_offline event (review MED). The TTL bounds the key so a
  // decommissioned device (or one whose rule was removed) doesn't leak forever, and a
  // chronically-offline device re-alerts once per TTL — also re-arming a toggled rule.
  let winners = toFlag
  if (toFlag.length > 0) {
    const claim = redis.pipeline()
    for (const id of toFlag) claim.set(`rule:offline:${id}`, String(nowMs), 'EX', OFFLINE_FLAG_TTL_S, 'NX')
    const res = await claim.exec()
    winners = toFlag.filter((_, i) => res?.[i]?.[1] === 'OK')
  }
  const won = new Set(winners)
  const wonEvents = events.filter((e) => won.has(e.deviceId.toString()))
  if (wonEvents.length > 0) await writeRuleEvents(pool, wonEvents)
  if (toClear.length > 0) {
    const pipe = redis.pipeline()
    for (const id of toClear) pipe.del(`rule:offline:${id}`)
    await pipe.exec()
  }
  return wonEvents.length
}

/** BullMQ worker running the repeatable device_offline sweep. Caller must close() on shutdown. */
export function startOfflineWorker(deps: OfflineWorkerDeps): Worker {
  return new Worker(
    DEVICE_OFFLINE_QUEUE,
    async () => {
      const n = await runOfflineSweep(deps.pool, deps.redis, Date.now())
      if (n > 0) deps.onFired?.(n)
    },
    { connection: deps.connection, concurrency: 1 }, // never overlap sweeps within a worker
  )
}
