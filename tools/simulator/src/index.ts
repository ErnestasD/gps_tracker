// @orbetra/simulator — Teltonika device emulator (E02-1). CLI entry: src/main.ts
export { runScenario } from './client.js'
export { liveDrive } from './scenarios/liveDrive.js'
export { corruptCrc } from './scenarios/corruptCrc.js'
export { oversize } from './scenarios/oversize.js'
export type { Scenario, ScenarioOpts } from './scenarios/types.js'
