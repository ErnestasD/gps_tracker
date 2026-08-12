import type { Redis } from 'ioredis'

import { avlTables, tableForModel, type AvlTable } from '@orbetra/codec'

import { FALLBACK_AVL_TABLE } from './normalize.js'

/**
 * deviceId → the AVL dictionary that decodes it, cached per shard.
 *
 * WHY THIS EXISTS. `normalize()` takes a table and, until this, nothing passed one: every device in
 * the fleet was decoded with the FMB120 fallback. For the 45 models that render that exact table
 * this is correct; for everything else it is not merely "unnamed" but MISLABELLED, which is worse,
 * because a wrong name looks like data. Id 520 is "Tamper detection Event" on a TAT100 and
 * "Agricultural State Flags P4" on FMB120; id 141 is "Battery Temperature" (Signed, −60 °C) on the
 * FMx6xx tables and "Driver 1 Cumulative Break Time" on FMB120. A customer reading a temperature
 * column has no way to tell.
 *
 * SHAPE. Same design as DeviceConfigCache and for the same reason: the decode loop is synchronous,
 * so a batch's tables must be pre-resolved with one HMGET. Profiles change on device CRUD only —
 * which rewrites `device:config` — so a TTL bounds staleness at one minute without a subscription.
 *
 * IT IS A SECOND READER OF THE SAME KEY, and that is a known duplication, not an oversight:
 * DeviceConfigCache resolves the trip config from `device:config` for the same devices in the same
 * batch. They are not merged because they are consumed at different points — this one inside
 * `process()` before the DB write, that one in the `onBatch` handler that owns the trip engine —
 * and merging means threading one cache through ConsumerDeps into main.ts's engine wiring. The cost
 * of leaving them apart is bounded and small: both cache for 60 s, so it is one extra HMGET per
 * device per minute per shard, not per batch. Worth collapsing into a single DeviceRegistryCache
 * when the trip config next needs touching; not worth a refactor of the engine wiring today.
 *
 * The cache map has no eviction. It is bounded by devices-per-shard — `imei % 16`, so ~6.2k entries
 * at 100k devices, a table name and a timestamp each — and matches the DeviceConfigCache precedent.
 * The only residue is decommissioned devices, which a worker restart clears.
 *
 * FALLBACK, NOT FAILURE, at every step: a device with no config row, a config written before
 * `avlTable` existed, a malformed value, or a table name no longer shipped all resolve to
 * FALLBACK_AVL_TABLE. Refusing to decode would drop positions, and a position decoded with slightly
 * wrong IO names is worth far more to a customer than no position at all.
 */
/** Why a device is decoding with the fallback. The reasons want different responses, so they are
 *  not collapsed: `redis_error` is an incident, `no_config` is a device the rehydrate has not
 *  reached, `unknown_table` is a bad profile row a human has to correct. */
export type AvlFallbackReason = 'no_config' | 'no_field' | 'malformed' | 'unknown_table' | 'redis_error'

export class AvlTableCache {
  private readonly cache = new Map<string, { table: AvlTable; at: number; reason?: AvlFallbackReason }>()

  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 60_000,
    /** Fired once per device whose table could not be resolved, WITH the reason. Without it the
     *  fallback is invisible: attrs still arrive, the names are just wrong, and there is nothing
     *  anywhere to distinguish that from the device reporting different parameters. */
    private readonly onFallback?: (reason: AvlFallbackReason) => void,
  ) {}

  async resolveBatch(deviceIds: readonly bigint[], now: number): Promise<Map<string, AvlTable>> {
    const ids = [...new Set(deviceIds.map((d) => d.toString()))]
    const stale = ids.filter((id) => {
      const e = this.cache.get(id)
      return e === undefined || now - e.at >= this.ttlMs
    })
    const why = new Map<string, AvlFallbackReason>()
    if (stale.length > 0) {
      // A Redis blip must not stop the pipeline: the batch decodes on the fallback and the next
      // one retries. Throwing here would dead-letter every entry in the batch as "malformed".
      let failed = false
      const raw = await this.redis.hmget('device:config', ...stale).catch(() => {
        failed = true
        return stale.map(() => null)
      })
      stale.forEach((id, i) => {
        const r = failed ? { table: FALLBACK_AVL_TABLE, reason: 'redis_error' as const } : parseTable(raw[i])
        // Report only when this device ACTUALLY decodes on the fallback — but "actually" has to
        // account for what it was already doing. Three cases, and the middle one was silent:
        //   - Redis fine            → the reason we just derived, if any.
        //   - Redis down, no cache  → it falls back now: `redis_error`.
        //   - Redis down, WITH a cached entry → it keeps whatever it had. If that was already the
        //     fallback (a device with no config row, or a bad profile), it is still decoding wrong
        //     and must keep saying so; if it was its own table, nothing fell back and it stays
        //     quiet. Reporting on the branch got the first of those wrong; reporting only on
        //     "no cache" got the second wrong for the whole outage.
        const cached = this.cache.get(id)
        const reason = failed ? (cached === undefined ? r.reason : cached.reason) : r.reason
        if (reason !== undefined) why.set(id, reason)
        // A Redis failure is NOT cached: caching it would hold the whole shard on the fallback for
        // the full TTL after the blip cleared, and the next batch is the natural retry.
        if (!failed) this.cache.set(id, { table: r.table, at: now, ...(r.reason !== undefined ? { reason: r.reason } : {}) })
      })
    }
    const out = new Map<string, AvlTable>()
    for (const id of ids) {
      out.set(id, this.cache.get(id)?.table ?? FALLBACK_AVL_TABLE)
      // Report from the OUTCOME, decided above where the information exists. Comparing the resolved
      // NAME to the fallback name — the previous attempt — is wrong for the 45 catalogued models
      // whose profile genuinely IS fmb120: during a Redis blip those kept their own correct table
      // and were still counted, on every batch, against an alert whose runbook sends the operator
      // hunting positions that are fine. `why` already knows the difference; the name does not.
      const reason = why.get(id)
      if (reason !== undefined) this.onFallback?.(reason)
    }
    return out
  }
}

/** `device:config` JSON → a table name the codec actually ships, and WHY if it is the fallback. */
function parseTable(rawValue: string | null | undefined): { table: AvlTable; reason?: AvlFallbackReason } {
  if (rawValue === null || rawValue === undefined) return { table: FALLBACK_AVL_TABLE, reason: 'no_config' }
  let parsed: { avlTable?: unknown }
  try {
    parsed = JSON.parse(rawValue) as { avlTable?: unknown }
  } catch {
    return { table: FALLBACK_AVL_TABLE, reason: 'malformed' }
  }
  if (typeof parsed.avlTable !== 'string') return { table: FALLBACK_AVL_TABLE, reason: 'no_field' }
  // Validated against the catalogue rather than trusted. `loadDictionary` answers an unknown name
  // with an EMPTY map, which would strip every IO name for that device and read, to the customer,
  // exactly like the tracker having stopped reporting them — a silent total loss where a wrong
  // profile row is meant to cost at most some wrong labels. tableForModel also accepts a model
  // code (`FMC650`), so a profile row carrying the model instead of the table still resolves.
  const table = tableForModel(parsed.avlTable) ?? knownTable(parsed.avlTable)
  return table === undefined ? { table: FALLBACK_AVL_TABLE, reason: 'unknown_table' } : { table }
}

/** The value is already a table name (`fmc650`) rather than a model code. */
let shipped: Set<string> | undefined
const knownTable = (name: string): AvlTable | undefined => {
  shipped ??= new Set(avlTables())
  const n = name.trim().toLowerCase()
  return shipped.has(n) ? n : undefined
}
