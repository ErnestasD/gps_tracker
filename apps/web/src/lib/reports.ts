import { mutate } from './client'
import { kmToMi, kmhToMph, round1 } from './units'
import type { DistanceUnit, SpeedUnit } from './prefs'

/**
 * Reports client (E06-2). Runs a report via the E06-1 sync API and renders/exports the rows.
 * CSV export is client-side (Blob download) — no server round-trip, no R2. The async
 * server-side XLSX export (BullMQ → R2 signed URL) is a follow-up (needs R2 credentials).
 */
export const REPORT_TYPES = ['mileage', 'trips', 'stops', 'overspeed', 'geofence', 'engine_hours'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export interface ReportRequest {
  from: string
  to: string
  deviceId?: string
  accountId?: string
}
export interface ReportResult {
  type: ReportType
  rows: Record<string, unknown>[]
}

export interface Column {
  /** row-object key the value is read from */
  key: string
  /** i18n key suffix under reports.col.* */
  label: string
  /** unit-suffixed header for CSV/PDF exports; defaults to `key` */
  csvKey?: string
  /** display-unit conversion applied to the cell value before render/export */
  convert?: (v: unknown) => unknown
  /** whole-row resolver (takes precedence over key/convert) — used to render a friendly label
   * from sibling row fields, e.g. the device name/plate instead of the raw numeric device id. */
  fromRow?: (row: Record<string, unknown>) => unknown
  /** cell is a UTC ISO timestamp — route it through dateColumns() so it honors the display prefs */
  datetime?: boolean
}

/** Column layout per report type — drives both the table and the CSV. */
export const COLUMNS: Record<ReportType, Column[]> = {
  mileage: [c('day'), dev(), c('trips'), c('distanceM')],
  stops: [c('day'), dev(), c('trips'), c('idleS')],
  engine_hours: [c('day'), dev(), hours('seconds')],
  overspeed: [c('day'), dev(), c('count'), c('maxSpeedKmh')],
  geofence: [c('day'), dev(), c('enters'), c('exits')],
  trips: [c('day'), dev(), ts('startTime'), ts('endTime'), c('distanceM'), c('maxSpeed'), c('idleS')],
}
function c(key: string): Column {
  return { key, label: key }
}
function ts(key: string): Column {
  return { key, label: key, datetime: true }
}
/** The device column renders the vehicle NAME (+ plate when present), not the internal numeric id.
 * deviceName/devicePlate are joined into the report rows server-side; read defensively so an older
 * server payload (id only) still renders the id rather than an empty cell. */
function dev(): Column {
  return { key: 'deviceId', label: 'deviceId', fromRow: deviceLabel }
}
export function deviceLabel(row: Record<string, unknown>): unknown {
  const name = typeof row['deviceName'] === 'string' && row['deviceName'] !== '' ? row['deviceName'] : null
  const plate = typeof row['devicePlate'] === 'string' && row['devicePlate'] !== '' ? row['devicePlate'] : null
  if (name === null) return row['deviceId'] // server hasn't joined the name → fall back to the id
  return plate !== null ? `${name} (${plate})` : name
}
/** The engine-hours report stores raw seconds; render it as hours (1 decimal) under an (h) header
 * so the "Engine hours" report actually reads in hours, not five-digit second counts. */
function hours(key: string): Column {
  return { key, label: 'hoursH', csvKey: 'hoursH', convert: (v) => (typeof v === 'number' ? round1(v / 3600) : v) }
}

/** Apply the datetime display formatter (useFmt().dt — honors timeZone/12h/dateFormat prefs) to
 * every `datetime` column, for the table, CSV and PDF alike. Without this the trips report leaks
 * raw UTC ISO strings ('2026-07-14T06:32:11.000Z') — the one display site the prefs never reached. */
export function dateColumns(columns: Column[], fmt: (iso: string) => string): Column[] {
  return columns.map((col) =>
    col.datetime === true ? { ...col, convert: (v) => (typeof v === 'string' && v !== '' ? fmt(v) : v) } : col,
  )
}

export interface ReportUnitPrefs {
  distance: DistanceUnit
  speed: SpeedUnit
}

/** COLUMNS with display-unit conversion applied (pure — unit-tested): `distanceM` renders as
 * km/mi and speed columns as km/h or mph, with unit-suffixed headers for the table, CSV and
 * PDF (header says which unit the numbers are in). Non-numeric cells pass through untouched. */
export function unitColumns(columns: Column[], u: ReportUnitPrefs): Column[] {
  return columns.map((col) => {
    if (col.key === 'distanceM') {
      const mi = u.distance === 'mi'
      const label = mi ? 'distanceMi' : 'distanceKm'
      return { ...col, label, csvKey: label, convert: (v) => (typeof v === 'number' ? round1(mi ? kmToMi(v / 1000) : v / 1000) : v) }
    }
    if (col.key === 'maxSpeedKmh' || col.key === 'maxSpeed') {
      const mph = u.speed === 'mph'
      const label = mph ? 'maxSpeedMph' : 'maxSpeedKmh'
      return { ...col, label, csvKey: label, convert: (v) => (typeof v === 'number' && mph ? Math.round(kmhToMph(v)) : v) }
    }
    return col
  })
}

/** A column's cell value for the given row, with its row resolver / unit conversion applied. */
export const cellValue = (col: Column, row: Record<string, unknown>): unknown =>
  col.fromRow !== undefined ? col.fromRow(row) : col.convert !== undefined ? col.convert(row[col.key]) : row[col.key]

export const runReport = (type: ReportType, req: ReportRequest) => mutate<ReportResult>('POST', `/v1/reports/${encodeURIComponent(type)}`, req)

/** Serialize rows to RFC-4180 CSV (quote fields containing "/,/CR/LF). Pure — unit-tested.
 * `headers` (localized labels, one per column) overrides the raw slug header row so the exported
 * CSV matches the on-screen table; omitted ⇒ the legacy `csvKey ?? key` slugs. */
export function toCsv(columns: Column[], rows: Record<string, unknown>[], headers?: string[]): string {
  const esc = (v: unknown): string => {
    let s = typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
    // CSV formula-injection guard: a cell starting with = + - @ (or a tab/CR) becomes a live
    // formula in Excel/Sheets. Device/driver names are now free text in exports (review LOW) —
    // neutralize by prefixing an apostrophe so spreadsheets treat it as literal text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map((col, i) => esc(headers?.[i] ?? col.csvKey ?? col.key)).join(',')
  const body = rows.map((r) => columns.map((col) => esc(cellValue(col, r))).join(',')).join('\r\n')
  return rows.length > 0 ? `${header}\r\n${body}` : header
}

/** Trigger a browser download of a CSV string (no server). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Report rows → a PDF-table matrix { head, body } (pure; unit-tested). Cells are stringified like
 * CSV. `headers` (localized labels) overrides the raw slug header row; omitted ⇒ `csvKey ?? key`. */
export function toPdfTable(columns: Column[], rows: Record<string, unknown>[], headers?: string[]): { head: string[][]; body: string[][] } {
  const cell = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v))
  return {
    head: [columns.map((col, i) => headers?.[i] ?? col.csvKey ?? col.key)],
    body: rows.map((r) => columns.map((col) => cell(cellValue(col, r)))),
  }
}

/**
 * Make a string safe for jsPDF's built-in Helvetica, which is WinAnsi (Latin-1) only.
 *
 * German umlauts and é/ó render fine; Lithuanian and Polish Latin-Extended letters (ą č ž ł …) do
 * not, and an unmapped character is not a fallback glyph but a TOFU BOX — the customer's own fleet
 * name, printed as ▯▯▯, in the document they hand to an accountant.
 *
 * WHY NOT EMBED A UNICODE FONT. jsPDF embeds TTF and nothing else, and this repo ships only
 * woff/woff2 (via @fontsource, subsetted per script), which it cannot parse. `tools/woff2ttf`
 * converts woff→TTF with no dependency and works — but @fontsource splits `latin` and `latin-ext`
 * into DIFFERENT files, and neither covers the other: the latin-ext subset genuinely has `ą` and no
 * lowercase `a`. A single font covering both means adding a licensed TTF binary to the repo (a
 * ~100 KB asset and a licence decision), which is a founder call, not a refactor. The tool is kept
 * so that swap is a one-liner the day the asset lands.
 *
 * SO: transliterate, but do it for EVERY script, not a hand-listed few. NFD splits a letter from its
 * combining marks, so `ř` → `r`, `ő` → `o`, `ā` → `a` — a Czech or Hungarian customer loses their
 * diacritics exactly like a Lithuanian one instead of getting boxes. Anything still outside WinAnsi
 * after that becomes `?`, which at least reads as a missing character rather than a broken document.
 * The on-screen table and the UTF-8 CSV keep full Unicode; this is the PDF path only. Newlines and
 * tabs pass through: jspdf-autotable treats `\n` as a cell line break, so mapping it to `?` would
 * print a literal question mark in the middle of a free-text note.
 */
const WINANSI_SAFE = /^[\n\t\r\u0020-\u007e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]$/

export function pdfSafe(s: string): string {
  let out = ''
  // NFC FIRST. Text arrives decomposed from macOS filenames and CSV device imports, and a standalone
  // combining mark would otherwise reach the fallback as its own code point: `'Gerät'.normalize(
  // 'NFD')` came out `Gera?t` — the exact German umlaut this function exists to protect.
  for (const ch of s.normalize('NFC')) {
    // WinAnsi FIRST, on the ORIGINAL character. Stripping accents up front would have cost a German
    // customer their umlauts (`Gerät` → `Gerat`) to fix a Lithuanian one's — ä ö ü é are Latin-1 and
    // print perfectly; only what Helvetica cannot draw is worth degrading.
    if (WINANSI_SAFE.test(ch)) {
      out += ch
      continue
    }
    // base letter + combining marks: drop the marks and keep the letter, if that lands in WinAnsi
    const stripped = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    if (stripped !== '' && [...stripped].every((c) => WINANSI_SAFE.test(c))) {
      out += stripped
      continue
    }
    // a bare combining mark (one that NFC could not attach to anything) contributes nothing — it is
    // an accent with no letter, and printing `?` for it would invent a character
    if (/\p{Diacritic}/u.test(ch)) continue
    // letters NFD cannot decompose — a stroke or a bar is part of the glyph, not a mark
    out += HARD_FOLD[ch] ?? '?'
  }
  return out
}

/** Letters NFD cannot decompose — a stroke or a bar is part of the glyph, not a combining mark.
 *  (æ, œ, ø and the umlauts are absent on purpose: WinAnsi has them, so they never reach here.) */
const HARD_FOLD: Record<string, string> = {
  ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T',
  ı: 'i', ĸ: 'k', ŉ: 'n', ſ: 's', ŀ: 'l', Ŀ: 'L', ə: 'e', ɵ: 'o',
}

export interface PdfMeta {
  /** localized document title */
  title: string
  /** localized "Generated …" subtitle (already formatted in the account/display timezone) */
  subtitle?: string
  /** localized column header labels (one per column) */
  headers?: string[]
}

/** Render a report to a PDF (client-side, jsPDF + autotable — ADR-025) and download it. Title,
 * subtitle and column headers arrive pre-localized; all text is transliterated to WinAnsi (pdfSafe)
 * so LT/PL diacritics don't render as tofu in jsPDF's built-in font. */
export async function downloadPdf(filename: string, meta: PdfMeta, columns: Column[], rows: Record<string, unknown>[]): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text(pdfSafe(meta.title), 14, 16)
  if (meta.subtitle !== undefined) {
    doc.setFontSize(9)
    doc.text(pdfSafe(meta.subtitle), 14, 22)
  }
  const table = toPdfTable(columns, rows, meta.headers)
  const head = table.head.map((r) => r.map(pdfSafe))
  const body = table.body.map((r) => r.map(pdfSafe))
  autoTable(doc, { head, body, startY: 26, styles: { fontSize: 8 }, headStyles: { fillColor: [77, 163, 255] } })
  doc.save(filename)
}
