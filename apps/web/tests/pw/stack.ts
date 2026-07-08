import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { StartedTestContainer } from 'testcontainers'

/** Shared stack constants + helpers for global-setup/teardown/spec (one process). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../..')
export const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
export const INGEST_PORT = 5127
export const API_PORT = 3110
export const WEB_PORT = 4173
export const E2E_EMAIL = 'e2e@orbetra.test'
export const E2E_PASSWORD = 'e2e-correct-horse-battery'
/** platform_admin for the quarantine flow (E03-4). */
export const PLATFORM_EMAIL = 'platform@orbetra.test'
export const PLATFORM_PASSWORD = 'platform-correct-horse-battery'
export const E2E_JWT_SECRET = 'e2e-jwt-secret-e2e-jwt-secret-e2e!' // ≥32 chars
/** An IMEI outside the seeded fleet — drives quarantine (unknown to ingest). */
export const UNKNOWN_IMEI = '356307042449500'
export const BASE_IMEI = '356307042441013'
export const DEVICES = 3
/** Extra device reserved for the invalid-fix trail test (seeded, outside the fleet). */
export const TRAIL_IMEI = (BigInt(BASE_IMEI) + BigInt(DEVICES)).toString()
export const SEEDED_DEVICES = DEVICES + 1

export interface StackState {
  containers: StartedTestContainer[]
  children: ChildProcess[]
  redisUrl: string
  databaseUrl: string
}

export const state: StackState = { containers: [], children: [], redisUrl: '', databaseUrl: '' }

export function spawnChild(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  logName: string,
): ChildProcess {
  const logDir = process.env['PW_STACK_LOG_DIR'] ?? mkdtempSync(join(tmpdir(), 'orbetra-e2e-'))
  process.env['PW_STACK_LOG_DIR'] = logDir
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chunks: string[] = []
  child.stdout?.on('data', (d: Buffer) => chunks.push(d.toString()))
  child.stderr?.on('data', (d: Buffer) => chunks.push(d.toString()))
  child.on('exit', () => writeFileSync(join(logDir, `${logName}.log`), chunks.join('')))
  state.children.push(child)
  return child
}

export async function waitHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

export async function waitTcp(port: number, timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    const ok = await new Promise<boolean>((res) => {
      const sock = connect({ host: '127.0.0.1', port }, () => {
        sock.destroy()
        res(true)
      })
      sock.on('error', () => res(false))
    })
    if (ok) return
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for tcp :${port}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

export function runToExit(cmd: string, args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: { ...process.env, ...env }, stdio: 'inherit' })
    child.on('exit', (code) => res(code ?? 1))
    child.on('error', rej)
  })
}

/** Like runToExit but captures stdout (seed scripts print result JSON). */
export function runCapture(cmd: string, args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
    const chunks: string[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
    child.on('exit', (code) => res({ code: code ?? 1, stdout: chunks.join('') }))
    child.on('error', rej)
  })
}
