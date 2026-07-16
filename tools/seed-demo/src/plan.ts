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
  kind: 'normal' | 'panic' | 'invalidFix' | 'fuelTheft'
  /** index into DEMO_DRIVERS — this device's regular driver taps in (AVL 78 auto-resolution demo). */
  driver?: 0 | 1
  /** emit CAN/OBD engine data so the CAN panel demo has content. */
  can?: boolean
}

export interface DemoDriver {
  name: string
  /** iButton key (hex) — reported as AVL 78 by the device, mapped to this driver by the worker. */
  ibutton: string
  account: 0 | 1
  licenseNo: string
}

export interface DemoDrive {
  imei: string
  scenario: 'liveDrive' | 'panic' | 'invalidFix' | 'fuelTheft'
  startMs: number
  count: number
  seed: number
  startDistanceM: number
  /** iButton hex reported on this drive (present ⇒ trips auto-assign to a driver). */
  ibutton?: string
  /** emit CAN/OBD params on this drive. */
  can?: boolean
}

export const DEMO_BASE_IMEI = 867000120000010n
export const DEMO_DEVICES = 12
const DAY_MS = 24 * 3_600_000
const DRIVE_RECORDS = 120 // ~2 min at 1 Hz record spacing — enough for a visible trail

const PLATE_LETTERS = ['KLM', 'JRD', 'FGH', 'BXA', 'DSK', 'LTV']

/** One driver per account, with a synthetic iButton key (never real hardware, rule 12). */
export const DEMO_DRIVERS: DemoDriver[] = [
  { name: 'Jonas Petrauskas', ibutton: '0a1b2c3d4e5f6071', account: 0, licenseNo: 'LT-8842190' },
  { name: 'Andrius Kazlauskas', ibutton: '1122334455667788', account: 1, licenseNo: 'LT-7710265' },
]

export function planDemoFleet(nowMs: number): { devices: DemoDeviceSpec[]; drives: DemoDrive[] } {
  const devices: DemoDeviceSpec[] = Array.from({ length: DEMO_DEVICES }, (_, i) => ({
    imei: (DEMO_BASE_IMEI + BigInt(i)).toString(),
    name: `${i < 8 ? 'Vilnius Van' : 'Kaunas Truck'} ${String(i + 1).padStart(2, '0')}`,
    plate: `${PLATE_LETTERS[i % PLATE_LETTERS.length]} ${String(100 + i * 7)}`,
    account: i < 8 ? 0 : 1,
    // special devices make each differentiator demo-able without hand-crafting data: a panic event,
    // an invalid-fix dashed-gap trail, and a fuel-theft alert (parked fuel drop)
    kind: i === 3 ? 'panic' : i === 5 ? 'invalidFix' : i === 7 ? 'fuelTheft' : 'normal',
    // device 0 (Vilnius) + device 8 (Kaunas) carry a driver iButton → trips auto-assign → safety
    // scores populate; device 8 is a CAN truck so the engine-data panel has content
    ...(i === 0 ? { driver: 0 as const } : i === 8 ? { driver: 1 as const, can: true } : {}),
  }))

  const driverKey = (spec: DemoDeviceSpec): string | undefined => (spec.driver === undefined ? undefined : DEMO_DRIVERS[spec.driver]!.ibutton)

  const drives: DemoDrive[] = []
  for (const [i, d] of devices.entries()) {
    const ibutton = driverKey(d)
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
          ...(ibutton !== undefined ? { ibutton } : {}),
          ...(d.can === true ? { can: true } : {}),
        })
      }
    }
    if (d.kind === 'panic') {
      drives.push({ imei: d.imei, scenario: 'panic', startMs: nowMs - 2 * 3_600_000, count: 5, seed: i, startDistanceM: i * 400 })
    }
    if (d.kind === 'invalidFix') {
      drives.push({ imei: d.imei, scenario: 'invalidFix', startMs: nowMs - 3 * 3_600_000, count: 24, seed: i, startDistanceM: i * 400 })
    }
    if (d.kind === 'fuelTheft') {
      // a short drive then a parked fuel drop → the fuel_theft rule fires
      drives.push({ imei: d.imei, scenario: 'fuelTheft', startMs: nowMs - 4 * 3_600_000, count: 30, seed: i, startDistanceM: i * 400 })
    }
  }
  // chronological send order — the pipeline sees history in a realistic sequence
  drives.sort((a, b) => a.startMs - b.startMs)
  return { devices, drives }
}
