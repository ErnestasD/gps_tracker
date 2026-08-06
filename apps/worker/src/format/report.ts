/**
 * Human rendering of a scheduled report result into a table for email (E06-1).
 * PURE — unit-tested. Turns raw DB rows (camelCase keys, meters/seconds, UTC ISO strings)
 * into readable labelled columns in the ACCOUNT's language, units and time zone.
 *
 * Both the LABELS and the UNITS follow the account (the account-settings debt, closed): a fleet that
 * runs the dashboard in Lithuanian and miles gets "Atstumas (mi)" here, not "Distance (km)". The
 * unit is in the column HEADER rather than in every cell — a fixed-width table where each row
 * repeats "km" is unreadable, and it is the same choice the dashboard's tables make.
 */
import { escapeHtml } from '@orbetra/shared'

import { distanceM, formatInZone, secondsToHours, speedKmh, METRIC_UNITS, type DisplayUnits } from './localize.js'
import { stringsFor, unitLabels, type WorkerStrings } from './strings.js'

type Row = Record<string, unknown>

/** One rendered column: a header label and a per-row cell formatter. */
interface Column {
  label: string
  cell: (row: Row, timezone: string) => string
}

/** How a report is rendered for one account: its language and its units. */
export interface ReportFormat {
  locale?: string | undefined
  units?: DisplayUnits | undefined
}

/** Readable report title in the account's language (the raw type slug otherwise leaks into the
 *  subject line — and an unknown/new type must still read as something, so it falls through). */
export function reportTitle(type: string, locale?: string): string {
  return stringsFor(locale).reportTitle[type] ?? type
}

// --- cell formatters -------------------------------------------------------
const int = (v: unknown): string => (typeof v === 'number' ? String(Math.round(v)) : '—')
const dist = (v: unknown, u: DisplayUnits): string => (typeof v === 'number' ? distanceM(v, u) : '—')
const hrs = (v: unknown): string => (typeof v === 'number' ? secondsToHours(v) : '—')
const spd = (v: unknown, u: DisplayUnits): string => (typeof v === 'number' ? speedKmh(v, u) : '—')
const text = (v: unknown): string => (typeof v === 'string' && v !== '' ? v : '—')
// An UNPARSEABLE timestamp is a dash, not a throw. `Intl.formatToParts` raises RangeError on an
// invalid Date, and this is the ONE cell formatter that can reach it — the HTML report is wrapped in
// a try/catch but the plain-text one is not, and it runs AFTER `claimRun` has already burned the
// period, so a single bad row would lose that report permanently instead of retrying it.
const tzTime = (v: unknown, tz: string): string => {
  if (typeof v !== 'string' || v === '') return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : formatInZone(d, tz)
}

/** Device column: prefer the joined display name, then the plate, then the raw numeric id (never blank). */
const deviceCell = (row: Row): string => text(row['deviceName'] ?? row['devicePlate'] ?? row['deviceId'])

/**
 * Ordered, user-facing columns per report type, built for ONE account's language + units.
 * Internal keys (row id, distanceSource) are omitted.
 *
 * A function rather than a constant because a label now depends on both — "Distance (mi)" and
 * "Atstumas (km)" are the same column.
 */
function columnsFor(s: WorkerStrings, u: DisplayUnits): Record<string, Column[]> {
  const l = unitLabels(s, u)
  const day: Column = { label: s.col.day, cell: (r) => text(r['day']) }
  const device: Column = { label: s.col.device, cell: (r) => deviceCell(r) }
  const distance = (key: string): Column => ({ label: s.col.distance(l.distance), cell: (r) => dist(r[key], u) })
  const maxSpeed = (key: string): Column => ({ label: s.col.maxSpeed(l.speed), cell: (r) => spd(r[key], u) })
  const idle: Column = { label: s.col.idle(l.hours), cell: (r) => hrs(r['idleS']) }
  return {
    mileage: [day, device, { label: s.col.trips, cell: (r) => int(r['trips']) }, distance('distanceM')],
    stops: [day, device, { label: s.col.stops, cell: (r) => int(r['trips']) }, idle],
    engine_hours: [day, device, { label: s.col.engine(l.hours), cell: (r) => hrs(r['seconds']) }],
    overspeed: [day, device, { label: s.col.events, cell: (r) => int(r['count']) }, maxSpeed('maxSpeedKmh')],
    geofence: [day, device, { label: s.col.enters, cell: (r) => int(r['enters']) }, { label: s.col.exits, cell: (r) => int(r['exits']) }],
    trips: [
      device,
      { label: s.col.start, cell: (r, tz) => tzTime(r['startTime'], tz) },
      { label: s.col.end, cell: (r, tz) => tzTime(r['endTime'], tz) },
      distance('distanceM'),
      maxSpeed('maxSpeed'),
      idle,
    ],
  }
}

/** Render the rows of a report as a fixed-width text table (header + a line per row).
 *  `timezone` is the account IANA zone used for any timestamp columns (rule 7);
 *  `fmt` its language + units (both default to English/metric — the pre-preferences behaviour). */
export function renderReportTable(type: string, rows: readonly Row[], timezone: string, fmt: ReportFormat = {}): string {
  const s = stringsFor(fmt.locale)
  const cols = columnsFor(s, fmt.units ?? METRIC_UNITS)[type]
  if (cols === undefined) {
    // unknown type: fall back to a labelled key/value dump (still readable, no raw table)
    return rows.map((row) => Object.entries(row).map(([k, v]) => `${k}: ${String(v)}`).join(', ')).join('\n')
  }
  if (rows.length === 0) return s.noData
  const matrix = rows.map((row) => cols.map((c) => c.cell(row, timezone)))
  const widths = cols.map((c, i) => Math.max(c.label.length, ...matrix.map((r) => r[i]!.length)))
  const line = (cells: string[]): string => cells.map((v, i) => v.padEnd(widths[i]!)).join('  ').trimEnd()
  const header = line(cols.map((c) => c.label))
  const rule = widths.map((w) => '-'.repeat(w)).join('  ')
  return [header, rule, ...matrix.map(line)].join('\n')
}

/** Render the same report rows as an HTML `<table>` for the branded email body (E05-4). Cells reuse
 *  the SAME column formatters as the plain-text table, then HTML-escape every value (rows carry
 *  device names / free-text that could contain markup). An unknown type or empty result yields a
 *  readable one-cell note rather than a broken table. */
export function renderReportTableHtml(type: string, rows: readonly Row[], timezone: string, fmt: ReportFormat = {}): string {
  const s = stringsFor(fmt.locale)
  const cols = columnsFor(s, fmt.units ?? METRIC_UNITS)[type]
  const cell = (v: string): string => `<td style="padding:6px 10px;border-bottom:1px solid #e6ebf2">${escapeHtml(v)}</td>`
  const note = (msg: string): string => `<p style="margin:0;color:#5b6b82">${escapeHtml(msg)}</p>`
  if (cols === undefined) return note(renderReportTable(type, rows, timezone, fmt)) // unknown type → labelled dump, escaped
  if (rows.length === 0) return note(s.noData)
  const th = cols.map((c) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #cfd8e3;font-size:13px">${escapeHtml(c.label)}</th>`).join('')
  const trs = rows
    .map((row) => `<tr>${cols.map((c) => cell(c.cell(row, timezone))).join('')}</tr>`)
    .join('')
  return `<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
}
