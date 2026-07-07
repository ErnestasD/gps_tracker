import { state } from './stack'

export default async function globalTeardown(): Promise<void> {
  for (const child of state.children) child.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  // exitCode === null ⇒ still running (review MED: `killed` flips on signal DELIVERY,
  // not exit, so the previous guard made this fallback dead code)
  for (const child of state.children) if (child.exitCode === null) child.kill('SIGKILL')
  await Promise.all(state.containers.map((c) => c.stop()))
}
