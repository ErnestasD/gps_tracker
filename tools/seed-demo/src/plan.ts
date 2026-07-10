/**
 * Demo fleet plan (E08-5) — PURE and deterministic so the sales demo looks the same on
 * every seed run and the spec can pin it. Synthetic 867… IMEI block (never real hardware,
 * CLAUDE.md rule 12), Lithuanian fleet naming, history spread over the last 3 days.
 */
export interface DemoDeviceSpec {
  imei: string
  name: string
  plate: string
  /** index into the demo accounts array (0 = Vilnius Fleet, 1 = Kaunas Fleet). */
  account: 0 | 1
  kind: 'normal' | 'panic' | 'invalidFix'
}

export interface DemoDrive {
  imei: string
  scenario: 'liveDrive' | 'panic' | 'invalidFix'
  startMs: number
  count: number
  seed: number
  startDistanceM: number
}

export const DEMO_BASE_IMEI = 867000120000010n
export const DEMO_DEVICES = 12
const DAY_MS = 24 * 3_600_000
const DRIVE_RECORDS = 120 // ~2 min at 1 Hz record spacing — enough for a visible trail

const PLATE_LETTERS = ['KLM', 'JRD', 'FGH', 'BXA', 'DSK', 'LTV']

export function planDemoFleet(nowMs: number): { devices: DemoDeviceSpec[]; drives: DemoDrive[] } {
  const devices: DemoDeviceSpec[] = Array.from({ length: DEMO_DEVICES }, (_, i) => ({
    imei: (DEMO_BASE_IMEI + BigInt(i)).toString(),
    name: `${i < 8 ? 'Vilnius Van' : 'Kaunas Truck'} ${String(i + 1).padStart(2, '0')}`,
    plate: `${PLATE_LETTERS[i % PLATE_LETTERS.length]} ${String(100 + i * 7)}`,
    account: i < 8 ? 0 : 1,
    // one panic + one invalid-fix device make the events timeline and the dashed-gap
    // trail demo-able without hand-crafting data
    kind: i === 3 ? 'panic' : i === 5 ? 'invalidFix' : 'normal',
  }))

  const drives: DemoDrive[] = []
  for (const [i, d] of devices.entries()) {
    // 2 drives/day over the last 3 days: morning ~08:10, afternoon ~15:40 (device-local
    // spread by index so playback ranges don't perfectly overlap)
    for (let day = 3; day >= 1; day--) {
      for (const [j, hour] of [8, 15].entries()) {
        drives.push({
          imei: d.imei,
          scenario: 'liveDrive',
          startMs: nowMs - day * DAY_MS + hour * 3_600_000 + i * 60_000 + j * 10 * 60_000,
          count: DRIVE_RECORDS,
          seed: i * 10 + j + day, // distinct speeds per drive
          startDistanceM: i * 400, // distinct route positions per device
        })
      }
    }
    if (d.kind === 'panic') {
      drives.push({ imei: d.imei, scenario: 'panic', startMs: nowMs - 2 * 3_600_000, count: 5, seed: i, startDistanceM: i * 400 })
    }
    if (d.kind === 'invalidFix') {
      drives.push({ imei: d.imei, scenario: 'invalidFix', startMs: nowMs - 3 * 3_600_000, count: 24, seed: i, startDistanceM: i * 400 })
    }
  }
  // chronological send order — the pipeline sees history in a realistic sequence
  drives.sort((a, b) => a.startMs - b.startMs)
  return { devices, drives }
}
