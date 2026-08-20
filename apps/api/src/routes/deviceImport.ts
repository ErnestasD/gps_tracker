import type { Redis } from 'ioredis'

import { DuplicateImeiError, type Actor, type Db, type Scope } from '@orbetra/db'
import { deviceCreateSchema } from '@orbetra/shared'

import { activateDevice } from './deviceRegistry.js'

/**
 * CSV device bulk import (E03-3). dry-run validates every row (IMEI Luhn + length,
 * dup-in-file, dup-in-db, unknown profile, account-in-scope) and returns a diff;
 * apply creates the create-rows and syncs the registry. AC[1]: 1,000 rows dry-run
 * < 10 s with a per-row error report. IMEI leading zeros preserved (String).
 */

/**
 * Hard cap on rows per import request (audit HIGH). The 2 MB byte cap on the CSV field alone
 * bounds nothing useful: a 2 MB file of tiny rows is ~60k IMEIs, and applyImport does ONE
 * sequential DB insert + Redis activate PER row, so an unbounded row count lets a single request
 * hold a pooled connection for minutes and starve every other tenant. AC[1] targets 1,000 rows,
 * so that is the supported ceiling; anything larger is rejected 400 before any work.
 */
export const MAX_IMPORT_ROWS = 1_000

export interface ImportRow {
  imei: string
  name: string
  profileKey: string
  accountId?: string
  plate?: string
  groupName?: string
  simMsisdn?: string
}
/** Consecutive unexpected row failures that mean the environment is broken, not the file. */
const MAX_CONSECUTIVE_FAILURES = 5

// SIM columns are optional; validated only when present. Same rules as the single-device schema
// (entities.ts) so a bulk import and a manual add accept exactly the same values.
const SIM_MSISDN_RE = /^\+[1-9]\d{6,14}$/
export interface RowError {
  row: number
  imei: string
  reason: string
}
export interface DryRunResult {
  /** `row` is the CSV line number, carried through so an apply-time failure can name it */
  create: (ImportRow & { row: number })[]
  update: { row: number; imei: string; deviceId: string }[]
  errors: RowError[]
}

/** Minimal RFC4180-ish CSV parse: quoted fields, commas/newlines inside quotes,
 * doubled "" escapes, CR/LF. Header row required; maps by column name. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      field = ''
      if (record.length > 1 || record[0] !== '') rows.push(record)
      record = []
    } else field += ch
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    if (record.length > 1 || record[0] !== '') rows.push(record)
  }
  if (rows.length === 0) return []
  const header = rows[0]!.map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, idx) => (obj[h] = (r[idx] ?? '').trim()))
    return obj
  })
}

/** Luhn (mod-10) check over a 15-digit IMEI (last digit is the check digit). */
export function luhnValid(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    let d = imei.charCodeAt(i) - 48
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

export function rowsToImport(records: Record<string, string>[]): ImportRow[] {
  return records.map((r) => ({
    imei: r['imei'] ?? '',
    name: r['name'] ?? '',
    profileKey: r['profileKey'] ?? r['profile'] ?? '',
    ...(r['accountId'] ? { accountId: r['accountId'] } : {}),
    ...(r['plate'] ? { plate: r['plate'] } : {}),
    ...(r['groupName'] ? { groupName: r['groupName'] } : {}),
    ...(r['simMsisdn'] ? { simMsisdn: r['simMsisdn'] } : {}),
  }))
}

export async function dryRun(
  db: Db,
  scope: Scope,
  rows: ImportRow[],
  profileKeys: Set<string>,
  callerAccountId: string | undefined,
): Promise<DryRunResult> {
  const result: DryRunResult = { create: [], update: [], errors: [] }
  const seenInFile = new Set<string>()
  // one scoped read of existing devices → imei→id map (avoids N queries; AC[1] perf).
  // ACTIVE rows only: retiring frees an IMEI, so a retired row must not classify a returned tracker
  // as an "update" — bulk re-registration is the whole point of freeing it, and it silently did
  // nothing and reported `created: 0` with no error. `list` orders createdAt DESC and a later Map
  // entry wins, so a retired row would also have beaten the live one and pointed the operator at a
  // dead device id (audit review MED).
  const existing = new Map(
    (await db.devices.list(scope)).filter((d) => d.retiredAt === null).map((d) => [d.imei, d.id.toString()]),
  )
  const validAccounts = new Set((await db.accounts.list(scope)).map((a) => a.id))

  rows.forEach((row, i) => {
    const rowNum = i + 2 // 1-based + header
    const fail = (reason: string) => result.errors.push({ row: rowNum, imei: row.imei, reason })
    if (!luhnValid(row.imei)) return fail('invalid IMEI (must be 15 digits, valid Luhn checksum)')
    if (row.name === '') return fail('name is required')
    if (!profileKeys.has(row.profileKey)) return fail(`unknown profile '${row.profileKey}'`)
    if (seenInFile.has(row.imei)) return fail('duplicate IMEI within the file')
    seenInFile.add(row.imei)
    // optional SIM columns — validated only when supplied (same rules as the manual add)
    if (row.simMsisdn !== undefined && !SIM_MSISDN_RE.test(row.simMsisdn)) return fail('invalid simMsisdn (E.164, e.g. +37060000000)')
    // account: account-scoped caller is pinned to their own; tenant-wide must name a valid one
    const accountId = callerAccountId ?? row.accountId
    if (accountId === undefined || accountId === '') return fail('accountId is required')
    if (!validAccounts.has(accountId)) return fail('accountId not in your scope')
    // The SAME schema a manual add uses (audit MED). The checks above cover the CSV-specific
    // shape; everything else — name length, plate/groupName bounds, the exact IMEI rule — was
    // enforced only for single-device creates, so a bulk import could push values the API would
    // have refused one at a time, straight at the DB.
    const parsed = deviceCreateSchema.safeParse({
      accountId,
      profileId: '00000000-0000-0000-0000-000000000000', // resolved from profileKey at apply
      imei: row.imei,
      name: row.name,
      ...(row.plate !== undefined ? { plate: row.plate } : {}),
      ...(row.groupName !== undefined ? { groupName: row.groupName } : {}),
      ...(row.simMsisdn !== undefined ? { simMsisdn: row.simMsisdn } : {}),
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return fail(`${issue?.path.join('.') ?? 'row'}: ${issue?.message ?? 'invalid'}`)
    }
    const existingId = existing.get(row.imei)
    if (existingId !== undefined) result.update.push({ row: rowNum, imei: row.imei, deviceId: existingId })
    else result.create.push({ ...row, accountId, row: rowNum })
  })
  return result
}

export interface ApplyResult {
  created: number
  errors: RowError[]
  /** Set when the run stopped early on a run of unexpected failures — the environment is broken,
   *  not the file, and the remaining rows were never attempted. */
  aborted?: true
}

export async function applyImport(
  db: Db,
  redis: Redis,
  scope: Scope,
  actor: Actor,
  rows: ImportRow[],
  profiles: Map<string, string>, // key → profileId
  callerAccountId: string | undefined,
): Promise<ApplyResult> {
  const dr = await dryRun(db, scope, rows, new Set(profiles.keys()), callerAccountId)
  const errors = [...dr.errors]
  let created = 0
  let consecutiveFailures = 0
  // profileId → the worker's per-device config, resolved once (E04-5 presence rules + the AVL
  // dictionary that decodes this model). `all()`, NOT `list()`: the CSV resolves profiles through
  // `profiles.map()`, which includes the four legacy family keys, so a device imported onto one of
  // them would come back from `list()` as undefined and run on default rules with no table.
  const cfgByProfile = new Map((await db.profiles.all()).map((p) => [p.id, { presenceRules: p.presenceRules, avlTable: p.avlTable }]))
  // Only the create-rows are applied; updates/errors are reported, not mutated (v1).
  //
  // EVERY per-row failure is a per-row error, not just a duplicate IMEI (audit MED). Rethrowing
  // anything else aborted the loop mid-batch: the devices already created stayed created — they are
  // real, and rolling them back would be worse — while the caller got a 500 and NO report of which
  // ones. An operator then had no way to tell what to retry. The row number is carried from the dry
  // run so the error names the CSV line rather than a placeholder 0.
  for (const row of dr.create) {
    const profileId = profiles.get(row.profileKey)
    const accountId = callerAccountId ?? row.accountId
    if (profileId === undefined || accountId === undefined) continue
    try {
      const device = await db.devices.create(scope, actor, {
        accountId,
        profileId,
        imei: row.imei,
        name: row.name,
        plate: row.plate ?? null,
        groupName: row.groupName ?? null,
        simMsisdn: row.simMsisdn ?? null,
      })
      created++ // the row is real from here on — count it before the registry sync
      // OUTSIDE the create's failure accounting: a Redis blip here leaves a device that exists in
      // the DB (holding its IMEI) but is missing from `registry:imei`, so ingest quarantines it. The
      // old catch reported that as "could not be created", and the operator's retry then hit
      // "IMEI already registered" for a device they were told never existed. The API's boot
      // rehydrate repairs the registry, so the honest report is "created, not yet reachable".
      try {
        await activateDevice(redis, {
          id: device.id, imei: device.imei, tenantId: scope.tenantId, accountId,
          config: { presenceRules: cfgByProfile.get(profileId)?.presenceRules ?? {}, odometerSource: device.odometerSource, avlTable: cfgByProfile.get(profileId)?.avlTable }, // E04-5
        })
      } catch (err) {
        console.error('device import: created but not activated', { imei: row.imei, row: row.row }, err)
        errors.push({ row: row.row, imei: row.imei, reason: 'created, but not yet reachable by the pipeline — retry not needed' })
      }
      // A ROW THAT LANDED PROVES THE ENVIRONMENT IS ALIVE. The reset used to live only in the
      // DuplicateImei branch below, so successes never cleared the counter and the tally was of
      // TOTAL unexpected failures, not CONSECUTIVE ones: a long file with a handful of scattered
      // faults aborted mid-way and reported an outage that was not happening.
      consecutiveFailures = 0
    } catch (err) {
      if (err instanceof DuplicateImeiError) {
        errors.push({ row: row.row, imei: row.imei, reason: 'IMEI already registered' })
      } else {
        // unexpected: log it in full (an import that half-worked must be diagnosable) and report a
        // generic reason — the message may name a constraint or another tenant's data
        console.error('device import row failed', { imei: row.imei, row: row.row }, err)
        errors.push({ row: row.row, imei: row.imei, reason: 'could not be created' })
        // A run of these is an OUTAGE, not a data problem: a dead pool or a statement timeout would
        // otherwise turn into 1000 per-row "could not be created" entries and an HTTP 201, telling
        // the operator their CSV is bad when the database is down. Stop and hand back what landed.
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return { created, errors, aborted: true }
        continue
      }
      consecutiveFailures = 0
    }
  }
  return { created, errors }
}
