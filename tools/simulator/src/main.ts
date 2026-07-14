import { runScenario } from './client.js'
import { runFleet } from './fleet.js'
import { bufferedFlood } from './scenarios/bufferedFlood.js'
import { corruptCrc } from './scenarios/corruptCrc.js'
import { invalidFix } from './scenarios/invalidFix.js'
import { panic } from './scenarios/panic.js'
import { fuelTheft } from './scenarios/fuelTheft.js'
import { slowLoris } from './scenarios/slowLoris.js'
import { liveDrive } from './scenarios/liveDrive.js'
import { oversize } from './scenarios/oversize.js'
import type { Scenario } from './scenarios/types.js'

const SCENARIOS: Record<string, Scenario> = {
  liveDrive,
  corruptCrc,
  oversize,
  bufferedFlood,
  invalidFix,
  panic,
  fuelTheft,
  slowLoris,
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1]!
  if (fallback !== undefined) return fallback
  console.error(`missing required --${name}`)
  process.exit(2)
}

/** Numeric flag with garbage-in guard (review LOW: NaN silently became NaN coords). */
function numArg(name: string, fallback: string): number {
  const n = Number(arg(name, fallback))
  if (!Number.isFinite(n)) {
    console.error(`--${name} must be a number, got '${arg(name, fallback)}'`)
    process.exit(2)
  }
  return n
}

async function main(): Promise<void> {
  const scenarioName = arg('scenario')
  const scenario = SCENARIOS[scenarioName]
  if (!scenario) {
    console.error(`unknown scenario '${scenarioName}' (have: ${Object.keys(SCENARIOS).join(', ')})`)
    process.exit(2)
  }
  const opts = {
    imei: arg('imei', '356307042441013'),
    host: arg('host', '127.0.0.1'),
    port: numArg('port', '5027'),
    hz: numArg('hz', '1'),
    seed: numArg('seed', '1'),
    count: numArg('count', '60'),
    startMs: numArg('start-ms', String(Date.now())),
  }
  const devices = numArg('devices', '1')
  if (!Number.isInteger(devices) || devices < 1) {
    console.error(`--devices must be a positive integer, got '${devices}'`)
    process.exit(2)
  }
  if (devices > 1) {
    // fleet mode (E02-6): N concurrent sessions, imei/seed/route-offset derived per device
    const fleetOpts = { devices, rampMs: numArg('ramp-ms', '20'), spreadM: numArg('spread-m', '60') }
    console.log(`sim ${scenario.name} → ${opts.host}:${opts.port} devices=${devices} baseImei=${opts.imei} seed=${opts.seed} count=${opts.count}/device`)
    const fleet = await runFleet(scenario, opts, fleetOpts)
    console.log(JSON.stringify(fleet))
    if (fleet.rejected > 0 || fleet.failed > 0) process.exit(1)
    return
  }
  console.log(`sim ${scenario.name} → ${opts.host}:${opts.port} imei=${opts.imei} seed=${opts.seed} count=${opts.count}`)
  const result = await runScenario(scenario, opts)
  console.log(JSON.stringify(result))
  // non-zero when the device was rejected outright (helps e2e assertions)
  if (result.rejectedByImei) process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
