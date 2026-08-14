import { Pool } from 'pg'

import { loadDictionary, tableForModel, type AvlTable } from '@orbetra/codec'
import { createDb } from '@orbetra/db'

/**
 * First-contact check for a REAL Teltonika tracker.
 *
 * Everything this platform knows about AVL elements is derived from Teltonika's wiki pages, and the
 * simulator that exercises the pipeline is built from those same pages. So the test suite cannot
 * detect the one class of error that matters most here: the wiki being wrong, or the firmware
 * differing from it. Only hardware can, and only once.
 *
 * This diffs what a device ACTUALLY sent against what its own dictionary promises, in both
 * directions, and says plainly whether the three things trips depend on — ignition, movement,
 * odometer — arrived and were promoted.
 *
 * Read-only: it touches nothing, so it is safe to run against a live device mid-drive.
 */
const imei = process.argv[2]
if (imei === undefined || !/^\d{15}$/.test(imei)) {
  console.error('usage: tsx tools/hw-check/src/main.ts <15-digit IMEI>')
  process.exit(2)
}

const databaseUrl = process.env['DATABASE_URL']
if (databaseUrl === undefined) {
  console.error('DATABASE_URL is not set')
  process.exit(2)
}

const db = createDb(databaseUrl)
const pool = new Pool({ connectionString: databaseUrl, max: 2 })

interface Row {
  fix_time: Date
  lat: number
  lon: number
  fix_valid: boolean
  satellites: number
  speed: number
  ignition: boolean | null
  movement: boolean | null
  odometer_m: string | null
  attrs: Record<string, unknown>
}

async function main(): Promise<void> {
  // raw SQL on purpose: this is an operator diagnostic that must work against any device on the
  // box, without a tenant scope, and the scoped repos deliberately refuse that.
  const found = (await pool.query<{ id: string; profileId: string }>(
    `SELECT id::text AS id, "profileId" FROM devices WHERE imei = $1 AND "retiredAt" IS NULL LIMIT 1`,
    [imei],
  )).rows[0]
  if (found === undefined) {
    console.error(`no ACTIVE device with IMEI ${imei}. Create it first, then power the tracker on.`)
    process.exit(1)
  }
  const profile = await db.profiles.get(found.profileId)
  const table: AvlTable = profile?.avlTable ?? 'fmb120'
  const model = profile?.model ?? profile?.key ?? '(unknown)'
  const dict = loadDictionary(table)

  const { rows } = await pool.query<Row>(
    `SELECT fix_time, lat, lon, fix_valid, satellites, speed, ignition, movement, odometer_m::text, attrs
     FROM positions WHERE device_id = $1 ORDER BY fix_time DESC LIMIT 500`,
    [found.id],
  )

  console.log(`\n=== ${imei!} — ${model}, decoding with table "${table}" (${dict.size} documented elements) ===`)
  if (profile !== null && profile.avlTable !== tableForModel(model)) {
    console.log(`  NOTE: profile says ${profile.avlTable}, the catalogue maps ${model} → ${tableForModel(model) ?? '(none)'}`)
  }
  if (rows.length === 0) {
    console.log('\nNo positions stored yet. The device has not reached `positions` — check ingest logs and registry:imei.')
    return
  }
  console.log(`${rows.length} recent positions, newest ${rows[0]!.fix_time.toISOString()}\n`)

  // ── what actually arrived ────────────────────────────────────────────────────
  const seen = new Map<string, { count: number; sample: unknown }>()
  for (const r of rows) for (const [k, v] of Object.entries(r.attrs)) {
    const e = seen.get(k) ?? { count: 0, sample: v }
    e.count += 1
    seen.set(k, e)
  }
  const byName = new Map<string, number>()
  for (const [id, e] of dict) byName.set(e.name, id)

  const named: string[] = []
  const raw: string[] = []
  for (const [key, { count, sample }] of [...seen].sort((a, b) => b[1].count - a[1].count)) {
    const line = `${key} = ${JSON.stringify(sample)}  (${count}/${rows.length} records)`
    if (key.startsWith('io_')) raw.push(line)
    else named.push(line)
  }

  console.log(`── ${named.length} parameters arrived WITH a name ──`)
  for (const l of named) console.log(`  ${l}`)

  console.log(`\n── ${raw.length} arrived as a RAW id — this is what a customer sees as a bare number ──`)
  for (const l of raw) {
    const id = Number(l.slice(3, l.indexOf(' ')))
    const known = dict.get(id)
    console.log(`  ${l}${known ? `   [the dictionary DOES name this: "${known.name}" — forced or ambiguous]` : '   [NOT in this model\'s wiki page at all]'}`)
  }

  // ── the three that decide whether trips work ─────────────────────────────────
  const withIgnition = rows.filter((r) => r.ignition !== null).length
  const withMovement = rows.filter((r) => r.movement !== null).length
  const withOdo = rows.filter((r) => r.odometer_m !== null).length
  const odoId = [...dict].find(([, e]) => e.name === 'Total Odometer')?.[0]
  console.log('\n── the three trips depend on ──')
  console.log(`  ignition (AVL 239): ${withIgnition}/${rows.length} records${withIgnition === 0 ? '   ← trips will never open on a vehicle profile' : ''}`)
  console.log(`  movement (AVL 240): ${withMovement}/${rows.length} records`)
  console.log(`  odometer (AVL ${odoId ?? '—'}): ${withOdo}/${rows.length} records${withOdo === 0 ? '   ← odometerSource "device"/"auto" will fall back to GPS' : ''}`)

  const invalid = rows.filter((r) => !r.fix_valid).length
  const zeroSats = rows.filter((r) => r.satellites === 0).length
  console.log(`\n  fix_valid=false: ${invalid}/${rows.length}  (satellites=0: ${zeroSats}) — these must never affect distance (rule 6)`)
  if (invalid !== zeroSats) console.log('  ⚠ fix_valid and satellites==0 DISAGREE — rule 6 says they must be the same set')

  // ── what the wiki promised for this model and has not appeared ───────────────
  const arrivedIds = new Set<number>()
  for (const key of seen.keys()) {
    if (key.startsWith('io_')) arrivedIds.add(Number(key.slice(3)))
    else { const id = byName.get(key); if (id !== undefined) arrivedIds.add(id) }
  }
  const missing = [...dict].filter(([id]) => !arrivedIds.has(id))
  console.log(`\n── ${missing.length} of ${dict.size} documented elements have not arrived ──`)
  console.log('  (expected: a parameter is only sent when the hardware carries it AND it is configured)')
  for (const [id, e] of missing.slice(0, 15)) console.log(`  ${id} ${e.name}`)
  if (missing.length > 15) console.log(`  … and ${missing.length - 15} more`)

  const undocumented = [...arrivedIds].filter((id) => !dict.has(id))
  console.log(`\n── ${undocumented.length} ids arrived that this model's wiki page does NOT document ──`)
  if (undocumented.length === 0) console.log('  none — the page covers everything this device sent')
  else {
    console.log('  THIS IS THE INTERESTING COLUMN: the wiki page is incomplete for this model.')
    for (const id of undocumented.sort((a, b) => a - b)) console.log(`  ${id}`)
  }
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => Promise.all([pool.end(), db.$disconnect()]))
