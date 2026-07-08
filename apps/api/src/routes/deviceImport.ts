import type { Redis } from 'ioredis'

import { DuplicateImeiError, type Actor, type Db, type Scope } from '@orbetra/db'

import { activateDevice } from './deviceRegistry.js'

/**
 * CSV device bulk import (E03-3). dry-run validates every row (IMEI Luhn + length,
 * dup-in-file, dup-in-db, unknown profile, account-in-scope) and returns a diff;
 * apply creates the create-rows and syncs the registry. AC[1]: 1,000 rows dry-run
 * < 10 s with a per-row error report. IMEI leading zeros preserved (String).
 */

export interface ImportRow {
  imei: string
  name: string
  profileKey: string
  accountId?: string
  plate?: string
  groupName?: string
}
export interface RowError {
  row: number
  imei: string
  reason: string
}
export interface DryRunResult {
  create: ImportRow[]
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
  // one scoped read of existing devices → imei→id map (avoids N queries; AC[1] perf)
  const existing = new Map((await db.devices.list(scope)).map((d) => [d.imei, d.id.toString()]))
  const validAccounts = new Set((await db.accounts.list(scope)).map((a) => a.id))

  rows.forEach((row, i) => {
    const rowNum = i + 2 // 1-based + header
    const fail = (reason: string) => result.errors.push({ row: rowNum, imei: row.imei, reason })
    if (!luhnValid(row.imei)) return fail('invalid IMEI (must be 15 digits, valid Luhn checksum)')
    if (row.name === '') return fail('name is required')
    if (!profileKeys.has(row.profileKey)) return fail(`unknown profile '${row.profileKey}'`)
    if (seenInFile.has(row.imei)) return fail('duplicate IMEI within the file')
    seenInFile.add(row.imei)
    // account: account-scoped caller is pinned to their own; tenant-wide must name a valid one
    const accountId = callerAccountId ?? row.accountId
    if (accountId === undefined || accountId === '') return fail('accountId is required')
    if (!validAccounts.has(accountId)) return fail('accountId not in your scope')
    const existingId = existing.get(row.imei)
    if (existingId !== undefined) result.update.push({ row: rowNum, imei: row.imei, deviceId: existingId })
    else result.create.push({ ...row, accountId })
  })
  return result
}

export interface ApplyResult {
  created: number
  errors: RowError[]
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
  // profileId → presence_rules, resolved once for the worker trip config (E04-5)
  const rulesByProfile = new Map((await db.profiles.list()).map((p) => [p.id, p.presenceRules]))
  // only the create-rows are applied; updates/errors are reported, not mutated (v1).
  // Per-row try/catch: a cross-tenant IMEI clash (global unique) surfaces as a
  // DuplicateImeiError → a per-row error, NOT a 500 that aborts the batch and loses
  // the report of what was already created (review HIGH). row 0 = surfaced at apply.
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
      })
      await activateDevice(redis, {
        id: device.id, imei: device.imei, tenantId: scope.tenantId, accountId,
        config: { presenceRules: rulesByProfile.get(profileId) ?? {}, odometerSource: device.odometerSource }, // E04-5
      })
      created++
    } catch (err) {
      if (err instanceof DuplicateImeiError) errors.push({ row: 0, imei: row.imei, reason: 'IMEI already registered' })
      else throw err
    }
  }
  return { created, errors }
}
