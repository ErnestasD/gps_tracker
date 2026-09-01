import type { Pool } from 'pg'

/**
 * Rule event → events writer (E05-4). Variant of the geofence writer that also sets the
 * originating `ruleId` and a per-rule `kind`. Raw parameterized batch INSERT over the
 * worker's pool (events are pipeline output; the events timeline UI (E05-6) reads them and
 * the notification dispatcher (E05-5) consumes them). lat/lon carry the fix coordinates —
 * on an invalid-fix IO event these are the device's last valid coords (§3.4).
 */
export interface RuleEventRow {
  tenantId: string
  accountId: string
  deviceId: bigint
  ruleId: string
  kind: string
  at: Date
  lat: number | null // null for position-less events (e.g. device_offline, E05-4b)
  lon: number | null
  payload: Record<string, unknown>
}

export async function writeRuleEvents(pool: Pool, rows: RuleEventRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const params: unknown[] = []
  const tuples = rows.map((r, i) => {
    params.push(r.tenantId, r.accountId, r.deviceId.toString(), r.ruleId, r.kind, r.at, r.lat, r.lon, JSON.stringify(r.payload))
    const b = i * 9
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`
  })
  const res = await pool.query(
    `INSERT INTO events ("tenantId","accountId","deviceId","ruleId","kind","at","lat","lon","payload") VALUES ${tuples.join(',')}`,
    params,
  )
  return res.rowCount ?? 0
}

export interface RuleEventExtend {
  deviceId: bigint
  kind: string
  ruleId: string
  /** the continuation's own moment — the breach is now known to have lasted at least this long */
  at: Date
  /** the continuation's payload, mined for a new peak */
  payload: Record<string, unknown>
}

/**
 * Extend the open event a suppressed continuation belongs to.
 *
 * The cooldown's job is to stop five alerts for one breach, and it does that well. What it also did
 * was throw away everything those suppressed occurrences knew: that the breach was still running,
 * and how bad it had become. A driver who crossed 90 and reached 155 left a row saying 95.
 *
 * One statement per continuation, and each is a no-op unless it finds a row to extend:
 *
 *  - the WINDOW is bounded by the rule's own cooldown plus slack, so a breach today never attaches
 *    itself to one last week. `endedAt IS NULL` alone would do exactly that after a quiet weekend;
 *  - `GREATEST` on the timestamp, because a late-flushed batch can arrive out of order and must
 *    never shorten a duration it was not present for;
 *  - the peak is raised with `GREATEST` too, on the numeric extracted from JSON — a slower moment
 *    inside the same breach must not overwrite the worst one.
 */
export async function extendRuleEvents(pool: Pool, rows: readonly RuleEventExtend[]): Promise<number> {
  let extended = 0
  for (const r of rows) {
    // Only overspeed has a "worst moment" worth keeping; every other kind simply gains a duration.
    // A generic peak-key mechanism would be machinery for one caller — and the SQL to build a JSON
    // key name at runtime was harder to read than the thing it generalised.
    const peak = r.kind === 'overspeed' && typeof r.payload['speedKmh'] === 'number' ? r.payload['speedKmh'] : null
    const res = await pool.query(
      `UPDATE events SET
         "endedAt" = GREATEST(COALESCE("endedAt", "at"), $4::timestamptz),
         payload = CASE WHEN $5::numeric IS NULL THEN payload ELSE
           jsonb_set(
             payload,
             '{maxSpeedKmh}',
             to_jsonb(GREATEST(
               COALESCE((payload->>'maxSpeedKmh')::numeric, (payload->>'speedKmh')::numeric, 0),
               $5::numeric
             ))
           )
         END
       WHERE id = (
         SELECT id FROM events
         WHERE "deviceId" = $1 AND kind = $2 AND "ruleId" = $3::uuid
           AND "at" <= $4::timestamptz
           AND "at" >= $4::timestamptz - ($6 || ' seconds')::interval
         ORDER BY "at" DESC
         LIMIT 1
       )`,
      [r.deviceId.toString(), r.kind, r.ruleId, r.at, peak, String(EXTEND_WINDOW_S)],
    )
    extended += res.rowCount ?? 0
  }
  return extended
}

/**
 * How far back a continuation may reach for the row it extends.
 *
 * Generous against the 300 s default cooldown, because a late-flushed batch is normal and the cost
 * of being slightly too generous is one breach absorbing a gap; the cost of being too tight is a
 * duration that resets to zero every few minutes, which is the bug this exists to fix.
 */
const EXTEND_WINDOW_S = 30 * 60
