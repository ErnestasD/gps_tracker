import { runScenario, type RunResult } from './client.js'
import type { Scenario, ScenarioOpts } from './scenarios/types.js'

export interface FleetOpts {
  /** Number of devices (concurrent TCP sessions in this process). */
  devices: number
  /** Delay between consecutive session starts (default 20 ms — avoids a SYN burst). */
  rampMs?: number
  /** Route offset between consecutive devices (default 60 m — spreads markers). */
  spreadM?: number
}

export interface FleetDevicePlan {
  imei: string
  seed: number
  startDistanceM: number
  startDelayMs: number
}

export interface FleetResult {
  devices: number
  rejected: number
  socketClosed: number
  /** Sessions that threw before producing a result (e.g. ECONNREFUSED). */
  failed: number
  sentPackets: number
  ackedRecords: number
  underAckedPackets: number
}

/**
 * Per-device parameter derivation, exposed for tests: device i gets imei base+i,
 * seed base+i (distinct speeds), startDistanceM i*spreadM (distinct positions —
 * the drive route always starts at 0 otherwise) and a staggered start.
 */
export function planFleet(base: ScenarioOpts, opts: FleetOpts): FleetDevicePlan[] {
  const rampMs = opts.rampMs ?? 20
  const spreadM = opts.spreadM ?? 60
  const baseImei = BigInt(base.imei)
  return Array.from({ length: opts.devices }, (_, i) => ({
    imei: (baseImei + BigInt(i)).toString(),
    seed: base.seed + i,
    startDistanceM: i * spreadM,
    startDelayMs: i * rampMs,
  }))
}

/**
 * Fleet runner (E02-6 AC: 500 simulated devices): N in-process device sessions of
 * the same scenario against one ingest. Node handles 500 client sockets in one
 * process comfortably; per-session pacing stays in runScenario.
 */
export async function runFleet(
  scenario: Scenario,
  base: ScenarioOpts & { host: string; port: number },
  opts: FleetOpts,
): Promise<FleetResult> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const runs = planFleet(base, opts).map(async (plan): Promise<RunResult> => {
    if (plan.startDelayMs > 0) await sleep(plan.startDelayMs)
    return runScenario(scenario, {
      ...base,
      imei: plan.imei,
      seed: plan.seed,
      startDistanceM: plan.startDistanceM,
    })
  })
  // allSettled (review HIGH): one connect error (e.g. per-IP cap RST) must not
  // abort the fleet and discard every other session's result
  const results = await Promise.allSettled(runs)
  return results.reduce<FleetResult>(
    (acc, r) => {
      if (r.status === 'rejected') return { ...acc, devices: acc.devices + 1, failed: acc.failed + 1 }
      return {
        devices: acc.devices + 1,
        rejected: acc.rejected + (r.value.rejectedByImei ? 1 : 0),
        socketClosed: acc.socketClosed + (r.value.socketClosedByServer ? 1 : 0),
        failed: acc.failed,
        sentPackets: acc.sentPackets + r.value.sentPackets,
        ackedRecords: acc.ackedRecords + r.value.ackedRecords,
        underAckedPackets: acc.underAckedPackets + r.value.underAckedPackets,
      }
    },
    { devices: 0, rejected: 0, socketClosed: 0, failed: 0, sentPackets: 0, ackedRecords: 0, underAckedPackets: 0 },
  )
}
