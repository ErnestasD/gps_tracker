/**
 * Human rendering of a scheduled report result into a plain-text table for email (E06-1).
 * PURE — unit-tested. Turns raw DB rows (camelCase keys, meters/seconds, UTC ISO strings)
 * into readable labelled columns with display units + account-timezone timestamps.
 *
 * TODO(account-settings): labels are English and units are canonical metric (km, km/h, h) with
 * the unit in the column header. The per-user unit/language preference is device-local on the web
 * and unknown to the server — see format/localize.ts.
 */
import { formatInZone, metersToKm, secondsToHours } from './localize.js'

type Row = Record<string, unknown>

/** One rendered column: a header label and a per-row cell formatter. */
interface Column {
  label: string
  cell: (row: Row, timezone: string) => string
}

/** Readable report title per type (the raw type slug otherwise leaks into the subject). */
const REPORT_TITLES: Record<string, string> = {
  mileage: 'Mileage',
  stops: 'Stops',
  engine_hours: 'Engine hours',
  overspeed: 'Overspeed',
  geofence: 'Geofence',
  trips: 'Trips',
}
export function reportTitle(type: string): string {
  return REPORT_TITLES[type] ?? type
}

// --- cell formatters -------------------------------------------------------
const int = (v: unknown): string => (typeof v === 'number' ? String(Math.round(v)) : '—')
const km = (v: unknown): string => (typeof v === 'number' ? metersToKm(v) : '—')
const hrs = (v: unknown): string => (typeof v === 'number' ? secondsToHours(v) : '—')
const kmh = (v: unknown): string => (typeof v === 'number' ? String(Math.round(v * 10) / 10) : '—')
const text = (v: unknown): string => (typeof v === 'string' && v !== '' ? v : '—')
const tzTime = (v: unknown, tz: string): string => (typeof v === 'string' && v !== '' ? formatInZone(new Date(v), tz) : '—')

/** Device column: prefer the joined display name, then the plate, then the raw numeric id (never blank). */
const deviceCell = (row: Row): string => text(row['deviceName'] ?? row['devicePlate'] ?? row['deviceId'])

const day: Column = { label: 'Day', cell: (r) => text(r['day']) }
const device: Column = { label: 'Device', cell: (r) => deviceCell(r) }

/** Ordered, user-facing columns per report type. Internal keys (row id, distanceSource) are omitted. */
const COLUMNS: Record<string, Column[]> = {
  mileage: [day, device, { label: 'Trips', cell: (r) => int(r['trips']) }, { label: 'Distance (km)', cell: (r) => km(r['distanceM']) }],
  stops: [day, device, { label: 'Stops', cell: (r) => int(r['trips']) }, { label: 'Idle (h)', cell: (r) => hrs(r['idleS']) }],
  engine_hours: [day, device, { label: 'Engine (h)', cell: (r) => hrs(r['seconds']) }],
  overspeed: [day, device, { label: 'Events', cell: (r) => int(r['count']) }, { label: 'Max speed (km/h)', cell: (r) => kmh(r['maxSpeedKmh']) }],
  geofence: [day, device, { label: 'Entries', cell: (r) => int(r['enters']) }, { label: 'Exits', cell: (r) => int(r['exits']) }],
  trips: [
    device,
    { label: 'Start', cell: (r, tz) => tzTime(r['startTime'], tz) },
    { label: 'End', cell: (r, tz) => tzTime(r['endTime'], tz) },
    { label: 'Distance (km)', cell: (r) => km(r['distanceM']) },
    { label: 'Max speed (km/h)', cell: (r) => kmh(r['maxSpeed']) },
    { label: 'Idle (h)', cell: (r) => hrs(r['idleS']) },
  ],
}

/** Render the rows of a report as a fixed-width text table (header + a line per row).
 *  `timezone` is the account IANA zone used for any timestamp columns (rule 7). */
export function renderReportTable(type: string, rows: readonly Row[], timezone: string): string {
  const cols = COLUMNS[type]
  if (cols === undefined) {
    // unknown type: fall back to a labelled key/value dump (still readable, no raw table)
    return rows.map((row) => Object.entries(row).map(([k, v]) => `${k}: ${String(v)}`).join(', ')).join('\n')
  }
  if (rows.length === 0) return '(no data in this period)'
  const matrix = rows.map((row) => cols.map((c) => c.cell(row, timezone)))
  const widths = cols.map((c, i) => Math.max(c.label.length, ...matrix.map((r) => r[i]!.length)))
  const line = (cells: string[]): string => cells.map((v, i) => v.padEnd(widths[i]!)).join('  ').trimEnd()
  const header = line(cols.map((c) => c.label))
  const rule = widths.map((w) => '-'.repeat(w)).join('  ')
  return [header, rule, ...matrix.map(line)].join('\n')
}
