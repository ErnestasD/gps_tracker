import { runScenario } from './client.js'
import { corruptCrc } from './scenarios/corruptCrc.js'
import { liveDrive } from './scenarios/liveDrive.js'
import { oversize } from './scenarios/oversize.js'
import type { Scenario } from './scenarios/types.js'

const SCENARIOS: Record<string, Scenario> = {
  liveDrive,
  corruptCrc,
  oversize,
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1]!
  if (fallback !== undefined) return fallback
  console.error(`missing required --${name}`)
  process.exit(2)
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
    port: Number(arg('port', '5027')),
    hz: Number(arg('hz', '1')),
    seed: Number(arg('seed', '1')),
    count: Number(arg('count', '60')),
    startMs: Number(arg('start-ms', String(Date.now()))),
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
