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
 * FALLBACK, NOT FAILURE, at every step: a device with no config row, a config written before
 * `avlTable` existed, a malformed value, or a table name no longer shipped all resolve to
 * FALLBACK_AVL_TABLE. Refusing to decode would drop positions, and a position decoded with slightly
 * wrong IO names is worth far more to a customer than no position at all.
 */
export class AvlTableCache {
  private readonly cache = new Map<string, { table: AvlTable; at: number }>()

  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 60_000,
  ) {}

  async resolveBatch(deviceIds: readonly bigint[], now: number): Promise<Map<string, AvlTable>> {
    const ids = [...new Set(deviceIds.map((d) => d.toString()))]
    const stale = ids.filter((id) => {
      const e = this.cache.get(id)
      return e === undefined || now - e.at >= this.ttlMs
    })
    if (stale.length > 0) {
      // A Redis blip must not stop the pipeline: the batch decodes on the fallback and the next
      // one retries. Throwing here would dead-letter every entry in the batch as "malformed".
      const raw = await this.redis.hmget('device:config', ...stale).catch(() => stale.map(() => null))
      stale.forEach((id, i) => this.cache.set(id, { table: parseTable(raw[i]), at: now }))
    }
    const out = new Map<string, AvlTable>()
    for (const id of ids) out.set(id, this.cache.get(id)?.table ?? FALLBACK_AVL_TABLE)
    return out
  }
}

/** `device:config` JSON → a table name the codec actually ships. */
function parseTable(rawValue: string | null | undefined): AvlTable {
  if (rawValue === null || rawValue === undefined) return FALLBACK_AVL_TABLE
  try {
    const j = JSON.parse(rawValue) as { avlTable?: unknown }
    if (typeof j.avlTable !== 'string') return FALLBACK_AVL_TABLE
    // Validated against the catalogue rather than trusted. `loadDictionary` answers an unknown name
    // with an EMPTY map, which would strip every IO name for that device and read, to the customer,
    // exactly like the tracker having stopped reporting them — a silent total loss where a wrong
    // profile row is meant to cost at most some wrong labels. tableForModel also accepts a model
    // code (`FMC650`), so a profile row carrying the model instead of the table still resolves.
    return tableForModel(j.avlTable) ?? knownTable(j.avlTable) ?? FALLBACK_AVL_TABLE
  } catch {
    return FALLBACK_AVL_TABLE
  }
}

/** The value is already a table name (`fmc650`) rather than a model code. */
let shipped: Set<string> | undefined
const knownTable = (name: string): AvlTable | undefined => {
  shipped ??= new Set(avlTables())
  const n = name.trim().toLowerCase()
  return shipped.has(n) ? n : undefined
}
