import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * ONE command that re-reads Teltonika and reports what moved: `pnpm catalogue:refresh`.
 *
 * Two generators, one job. `gen` rewrites the AVL dictionaries (what a device SENDS — the names
 * behind every parameter row in the UI) and `gen:params` rewrites the configurable-parameter
 * catalogue (what a device can be SET to — the settings sliders and, since the CAN work, the
 * element list every customer toggles). Teltonika edits both pages without telling anyone; a
 * catalogue that is only refreshed when somebody remembers is a catalogue that is quietly wrong.
 *
 * WHY THIS IS A CI JOB AND NOT A CRON ON THE SERVER — the distinction matters, because a server
 * cron here would look like it worked and do nothing:
 *   - `packages/shared/params/deviceParams.json` is `import`ed by `deviceSettings.ts`, so it is
 *     BUNDLED at build time. Rewriting the file on a running host changes nothing until a rebuild.
 *   - `packages/codec/dictionaries/*.json` are read with `readFileSync` but cached per process for
 *     its lifetime, and they ship inside the image anyway.
 * So the output of a refresh is a CHANGE TO THE REPOSITORY, which then reaches devices through a
 * normal deploy — reviewable, revertable, and visible in the diff. That is what the nightly
 * workflow does with this command.
 *
 * Both generators already refuse to write a run that LOSES models or parameters (a Teltonika
 * challenge page or a layout change reads as a catastrophic diff otherwise). This wrapper does not
 * soften that: it lets the refusal fail the job so a human looks, rather than accepting a silent
 * downgrade of what we tell customers their hardware can do.
 */
const TOOL = resolve(import.meta.dirname, '..')

function run(script: string, args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync('pnpm', ['exec', 'tsx', script, ...args], {
      cwd: TOOL,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

function main(): void {
  // `--fresh` on both: the point of a scheduled refresh is to re-read the wiki, and the cache is
  // exactly what would make a nightly run report "nothing changed" forever.
  const fresh = process.argv.includes('--no-fresh') ? [] : ['--fresh']
  const steps: [string, string[]][] = [
    ['AVL dictionaries (what devices send)', ['src/main.ts', ...fresh]],
    ['device parameters (what devices can be set to)', ['src/params.ts', ...fresh]],
  ]
  const failed: string[] = []
  for (const [label, [script, ...args]] of steps) {
    console.log(`\n── ${label} ──`)
    const { ok, output } = run(script!, args)
    console.log(output.trim())
    if (!ok) failed.push(label)
  }
  if (failed.length > 0) {
    console.error(`\ncatalogue refresh FAILED for: ${failed.join(', ')}`)
    console.error('A generator refuses to write when a run loses models or parameters — read its')
    console.error('message above. Either the wiki genuinely dropped them (re-run the generator with')
    console.error('--accept-regression, deliberately) or the fetch hit a challenge page (re-run).')
    process.exit(1)
  }
  console.log('\ncatalogue refresh complete — `git status` shows what Teltonika changed.')
}

main()
