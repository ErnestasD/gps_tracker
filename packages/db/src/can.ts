import type { Pool } from 'pg'

import type { CanView } from '@orbetra/shared'

/**
 * Latest CAN/OBD engine snapshot for a device (V2 CAN decode — display). Raw SQL over positions
 * (rule 1); the CALLER scope-gates the device (like readHealthSeries/readFuelSeries). These params
 * already flow through the pipeline into attrs from the CAN adapter (wiki FMB120 table):
 *   Engine RPM (AVL 85 CAN / 36 OBD) · Coolant Temperature (AVL 32, °C) · Engine Load (AVL 114 / 31, %)
 *   Throttle Position (AVL 41, %) · Vehicle Speed (AVL 81 / 37, km/h) · Total Mileage (AVL 87, m → km)
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 * Several ids share a dictionary NAME (RPM 36/85, Load 31/114, Speed 37/81), so normalize stores them
 * under `io_<id>` on collision — we coalesce the CAN id first, then the OBD id, then the name. jsonb
 * values are coerced defensively in JS (a ::numeric cast on garbage would 500). Returns null when the
 * device has never reported any CAN param (non-CAN vehicle).
 *
 * PERF (deferred, like readFuelSeries): the `?|` filter can't use the (device_id, fix_time) index, so
 * a non-CAN device scans its history to return null. Fine at V1 scale; add a partial index if CAN
 * fleets grow. The panel hides + React-Query caches, so a device is scanned at most once per open.
 */
const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface PgCanRow {
  fix_time: Date
  rpm: string | null
  coolant: string | null
  load: string | null
  throttle: string | null
  speed: string | null
  mileage: string | null
}

export async function readCanLatest(pool: Pool, deviceId: bigint): Promise<CanView | null> {
  // newest row that carries ANY of the CAN params
  const res = await pool.query<PgCanRow>(
    `SELECT fix_time,
            COALESCE(attrs->>'io_85', attrs->>'io_36', attrs->>'Engine RPM') AS rpm,
            COALESCE(attrs->>'io_32', attrs->>'Coolant Temperature') AS coolant,
            COALESCE(attrs->>'io_114', attrs->>'io_31', attrs->>'Engine Load') AS load,
            COALESCE(attrs->>'io_41', attrs->>'Throttle Position') AS throttle,
            COALESCE(attrs->>'io_81', attrs->>'io_37', attrs->>'Vehicle Speed') AS speed,
            COALESCE(attrs->>'io_87', attrs->>'Total Mileage') AS mileage
     FROM positions
     WHERE device_id = $1
       AND attrs ?| array['io_85','io_36','Engine RPM','io_32','Coolant Temperature','io_114','io_31','Engine Load','io_41','Throttle Position','io_81','io_37','Vehicle Speed','io_87','Total Mileage']
     ORDER BY fix_time DESC, rec_hash DESC LIMIT 1`,
    [deviceId.toString()],
  )
  const r = res.rows[0]
  if (r === undefined) return null
  const mileageM = num(r.mileage)
  return {
    fixTime: r.fix_time.toISOString(),
    rpm: num(r.rpm),
    coolantC: num(r.coolant),
    engineLoadPct: num(r.load),
    throttlePct: num(r.throttle),
    speedKmh: num(r.speed),
    totalMileageKm: mileageM === null ? null : Math.round(mileageM / 100) / 10, // m → km, one decimal
  }
}
