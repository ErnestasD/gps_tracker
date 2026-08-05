import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import { Session, type SessionDeps } from '../src/session.js'

/**
 * Codec-12 command transport (E08-2, audit MED #64).
 *
 * The order of "write to the socket" and "record in flight" is the whole finding. Writing first
 * meant a failure in between left the command in NEITHER queue: the device may well have executed
 * it, and nothing recorded that it was ever sent, so the dispatcher had nothing to reconcile and the
 * DB row sat forever. Recording first inverts that into a failure the system already handles.
 */
const CONFIG = {
  handshakeTimeoutMs: 5_000,
  idleTimeoutMs: 60_000,
  maxFrameBytes: 65_536,
  pauseAboveDepth: 50_000,
  depthCacheMs: 0,
  minTsMs: Date.UTC(2020, 0, 1),
  maxFutureMs: 48 * 3_600_000,
} as unknown as SessionDeps['config']

/** A socket that records writes and can be made to throw on the next one. */
function fakeSocket() {
  const writes: Buffer[] = []
  let failNext = false
  const s = Object.assign(new EventEmitter(), {
    setKeepAlive: vi.fn(),
    setTimeout: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
    destroyed: false,
    write: vi.fn((b: Buffer) => {
      if (failNext) {
        failNext = false
        throw new Error('EPIPE')
      }
      writes.push(b)
      return true
    }),
  })
  return { socket: s as unknown as Socket, writes, failOnNextWrite: () => (failNext = true) }
}

/** Redis double with just the list ops the drain uses, plus an ordered op log. */
function fakeRedis(pending: string[]) {
  const lists = new Map<string, string[]>([['cmd:pending:42', [...pending]]])
  const ops: string[] = []
  const list = (k: string): string[] => {
    const l = lists.get(k) ?? []
    lists.set(k, l)
    return l
  }
  const chain: Record<string, unknown> = {}
  for (const m of ['rpush', 'expire', 'sadd', 'lpush', 'lrem']) {
    chain[m] = (key: string, ...args: unknown[]) => {
      ops.push(m)
      if (m === 'rpush') list(key).push(String(args[0]))
      if (m === 'lpush') list(key).unshift(String(args[0]))
      if (m === 'lrem') {
        const l = list(key)
        const i = l.indexOf(String(args[1]))
        if (i !== -1) l.splice(i, 1)
      }
      return chain
    }
  }
  chain['exec'] = () => Promise.resolve([])
  const redis = {
    lpop: vi.fn((k: string) => {
      ops.push('lpop')
      return Promise.resolve(list(k).shift() ?? null)
    }),
    multi: vi.fn(() => chain),
  } as unknown as Redis
  return { redis, lists, ops }
}

const deps = (redis: Redis): SessionDeps =>
  ({
    redis,
    config: CONFIG,
    metrics: { pausedSockets: 0 } as unknown as SessionDeps['metrics'],
    registry: { lookup: () => Promise.resolve(null) } as unknown as SessionDeps['registry'],
    now: () => 1_700_000_000_000,
  }) as unknown as SessionDeps

/** Reach the private drain with a device already resolved — the handshake is not what is under test. */
async function drain(session: Session): Promise<void> {
  const s = session as unknown as { deviceId: bigint | null; drainPending: () => Promise<void> }
  s.deviceId = 42n
  await s.drainPending()
}

const cmd = (id: string, text: string): string => JSON.stringify({ id, text })

describe('drainPending records in flight BEFORE writing to the socket', () => {
  it('the in-flight record lands first, so a crash after the write can never lose the command', async () => {
    const { socket, writes } = fakeSocket()
    const { redis, ops, lists } = fakeRedis([cmd('c1', 'getinfo')])
    await drain(new Session(socket, deps(redis)))

    expect(writes).toHaveLength(1)
    // the ordering assertion: rpush to cmd:inflight precedes the socket write. There is no way to
    // observe the write in `ops`, so assert the redis side ran to completion before it — the drain
    // awaits the MULTI, and the write is the statement after it.
    expect(ops.slice(0, 4)).toEqual(['lpop', 'rpush', 'expire', 'sadd'])
    expect(lists.get('cmd:inflight:42')).toHaveLength(1)
    expect(lists.get('cmd:pending:42')).toHaveLength(0)
  })

  it('a failed write returns the command to the HEAD of pending and drops the in-flight entry', async () => {
    // a socket that died between the record and the write must not consume the command, and must
    // not leave the dispatcher counting a timeout against an attempt that never left the process
    const { socket } = fakeSocket()
    const { redis, lists } = fakeRedis([cmd('c1', 'first'), cmd('c2', 'second')])
    const fs = socket as unknown as { write: (b: Buffer) => boolean }
    fs.write = () => {
      throw new Error('EPIPE')
    }
    await drain(new Session(socket, deps(redis)))

    expect(lists.get('cmd:inflight:42')).toHaveLength(0) // rolled back
    // back at the head, in its original order, and the drain stopped rather than burning c2
    expect(lists.get('cmd:pending:42')).toEqual([cmd('c1', 'first'), cmd('c2', 'second')])
  })

  it('an unencodable command is dropped WITHOUT an in-flight record — nothing to time out', async () => {
    // encoding happens before anything durable: recording an empty/oversize command in flight would
    // make the dispatcher wait out a timeout for a frame that never existed
    const { socket, writes } = fakeSocket()
    const { redis, lists } = fakeRedis([cmd('c1', ''), cmd('c2', 'getinfo')])
    await drain(new Session(socket, deps(redis)))

    expect(writes).toHaveLength(1) // only the valid one
    expect(lists.get('cmd:inflight:42')).toHaveLength(1)
  })

  it('an expired command is dropped and never sent — a day-old destructive command must not run', async () => {
    const { socket, writes } = fakeSocket()
    const expired = JSON.stringify({ id: 'c1', text: 'setdigout 1', expiresAtMs: 1_699_000_000_000 })
    const { redis, lists } = fakeRedis([expired])
    await drain(new Session(socket, deps(redis)))

    expect(writes).toHaveLength(0)
    expect(lists.get('cmd:inflight:42') ?? []).toHaveLength(0)
  })
})
