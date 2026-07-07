import { state } from './stack'

export default async function globalTeardown(): Promise<void> {
  for (const child of state.children) child.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  for (const child of state.children) if (!child.killed) child.kill('SIGKILL')
  await Promise.all(state.containers.map((c) => c.stop()))
}
