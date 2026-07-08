import type { Redis } from 'ioredis'

import { deviceTripConfig } from './config.js'
import type { DeviceTripConfig } from './engine.js'

/**
 * Per-device trip config cache (E04-5). The trip engine's feed() is synchronous, so the
 * worker must PRE-RESOLVE each batch's device configs (async Redis read) into a plain Map
 * before feeding. Configs change rarely (device CRUD re-syncs `device:config`), so entries
 * are cached with a short TTL — a config change is picked up within TTL, bounding both
 * Redis load and staleness. Bounded by device count.
 */
export class DeviceConfigCache {
  private readonly cache = new Map<string, { config: DeviceTripConfig | null; at: number }>()

  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 60_000,
  ) {}

  /** Resolve configs for a batch's devices into a sync lookup. `now` is injected so the
   * caller controls time (tests/determinism); pass Date.now() in production. */
  async resolveBatch(deviceIds: readonly bigint[], now: number): Promise<Map<string, DeviceTripConfig>> {
    const ids = [...new Set(deviceIds.map((d) => d.toString()))]
    const stale = ids.filter((id) => {
      const e = this.cache.get(id)
      return e === undefined || now - e.at >= this.ttlMs
    })
    if (stale.length > 0) {
      const raw = await this.redis.hmget('device:config', ...stale)
      stale.forEach((id, i) => this.cache.set(id, { config: parse(raw[i]), at: now }))
    }
    const out = new Map<string, DeviceTripConfig>()
    for (const id of ids) {
      const cfg = this.cache.get(id)?.config
      if (cfg) out.set(id, cfg)
    }
    return out
  }
}

/** Parse a `device:config` JSON value into a DeviceTripConfig, or null (→ engine default). */
function parse(raw: string | null | undefined): DeviceTripConfig | null {
  if (raw === null || raw === undefined) return null
  try {
    const j = JSON.parse(raw) as { presenceRules?: unknown; odometerSource?: unknown }
    return deviceTripConfig(j.presenceRules as Record<string, unknown> | null | undefined, j.odometerSource)
  } catch {
    return null // malformed → default, never crash the pipeline
  }
}
