import { Encoder } from 'cbor-x'
import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import type { Db, RawRejectRow } from '@orbetra/db'

import { REJECT_CURSOR_KEY, runRejectDrain } from '../src/jobs/rejectDrainWorker.js'

/**
 * The `rejects` stream had no consumer and `raw_rejects` had no writer (audit MED #46), so a §3.6
 * sanity failure survived only until MAXLEN rolled over it. The record itself is correctly refused —
 * this is not data loss — but support could answer "my tracker's data is missing" only with a global
 * counter, never with "device X sent 4,000 records stamped 2019, its RTC battery is flat".
 */
const cbor = new Encoder()

const entry = (imei: string, tsMs: number, raw: Uint8Array): [Buffer, Buffer[]] => [
  Buffer.from(`${tsMs}-0`),
  [Buffer.from('p'), Buffer.from(cbor.encode({ imei, tsMs, raw, reason: 'sanity' }))],
]

/** Stream ids sort on (ms, seq) numerically — the same comparison the CAS script makes. */
const idLte = (a: string, b: string): boolean => {
  const [ams, aseq] = a.split('-').map(Number) as [number, number]
  const [bms, bseq] = b.split('-').map(Number) as [number, number]
  return ams < bms || (ams === bms && aseq <= bseq)
}

function fakes(entries: [Buffer, Buffer[]][], opts: { throwOnRead?: Error } = {}) {
  const store = new Map<string, string>()
  const inserted: RawRejectRow[][] = []
  const calls: unknown[][] = []
  let served = false
  const redis = {
    get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    del: vi.fn((k: string) => {
      store.delete(k)
      return Promise.resolve(1)
    }),
    // the CAS advance script, in JS: forward only
    eval: vi.fn((_script: string, _n: number, key: string, next: string) => {
      const cur = store.get(key)
      if (cur !== undefined && idLte(next, cur)) return Promise.resolve(0)
      store.set(key, next)
      return Promise.resolve(1)
    }),
    callBuffer: vi.fn((...args: unknown[]) => {
      calls.push(args)
      if (opts.throwOnRead) return Promise.reject(opts.throwOnRead)
      if (served) return Promise.resolve([]) // the tick loops until the stream is caught up
      served = true
      return Promise.resolve(entries)
    }),
  } as unknown as Redis
  const db = {
    rawRejects: {
      insertMany: vi.fn((rows: RawRejectRow[]) => {
        inserted.push(rows)
        return Promise.resolve(rows.length)
      }),
    },
  } as unknown as Db
  return { redis, db, store, inserted, calls }
}

describe('reject drain (rejects stream → raw_rejects)', () => {
  it('decodes each entry into a row and advances the cursor past the last id', async () => {
    const raw = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const { redis, db, store, inserted } = fakes([entry('356307042440001', 1000, raw), entry('356307042440002', 2000, raw)])
    expect(await runRejectDrain({ connection: {}, redis, db })).toBe(2)
    expect(inserted[0]!.map((r) => r.imei)).toEqual(['356307042440001', '356307042440002'])
    expect(inserted[0]![0]!.reason).toBe('sanity')
    // the raw bytes travel with the row, so the offending frame can be replayed against the parser
    expect(Buffer.from(inserted[0]![0]!.payload!).toString('hex')).toBe('deadbeef')
    expect(store.get(REJECT_CURSOR_KEY)).toBe('2000-0')
  })

  it('resumes AFTER the stored cursor — an exclusive range, never re-reading the last row', async () => {
    const { redis, db, store, calls } = fakes([entry('x', 3000, new Uint8Array())])
    store.set(REJECT_CURSOR_KEY, '2000-0')
    await runRejectDrain({ connection: {}, redis, db })
    expect(calls[0]).toEqual(['XRANGE', 'rejects', '(2000-0', '+', 'COUNT', '1000'])
  })

  it('reads BINARY (callBuffer) — the string API would mangle the CBOR payload', async () => {
    // the same reason the shard consumer reads with callBuffer; getting this wrong would produce
    // rows whose `raw` is corrupt in a way nothing else would notice
    const { redis, db, calls } = fakes([entry('x', 1000, new Uint8Array([0x80, 0xff]))])
    await runRejectDrain({ connection: {}, redis, db })
    expect(calls[0]![0]).toBe('XRANGE')
  })

  it('records an undecodable entry rather than stopping the drain', async () => {
    const bad: [Buffer, Buffer[]] = [Buffer.from('1-0'), [Buffer.from('p'), Buffer.from('not cbor at all')]]
    const { redis, db, inserted, store } = fakes([bad, entry('good', 2000, new Uint8Array())])
    expect(await runRejectDrain({ connection: {}, redis, db })).toBe(2)
    expect(inserted[0]!.map((r) => r.reason)).toEqual(['undecodable', 'sanity'])
    expect(store.get(REJECT_CURSOR_KEY)).toBe('2000-0') // …and the cursor still advances
  })

  it('a corrupt cursor self-heals instead of wedging the drain forever', async () => {
    // A value that is not a stream id makes XRANGE throw on EVERY tick, with nothing to clear it —
    // one bad write and the diagnostic tail is dead until someone notices. Re-reading a window is
    // free; staying wedged is not.
    const { redis, db, store } = fakes([], { throwOnRead: new Error('ERR Invalid stream ID specified as stream command argument') })
    store.set(REJECT_CURSOR_KEY, 'not-an-id')
    expect(await runRejectDrain({ connection: {}, redis, db })).toBe(0)
    expect(store.has(REJECT_CURSOR_KEY)).toBe(false) // reset → the next tick starts from the oldest entry
  })

  it('the cursor only moves FORWARD — an overlapping slower pass cannot drag it back', async () => {
    // The repeatable job's jobId keeps the SCHEDULE single, not the EXECUTION: a stalled BullMQ lock
    // (this process also runs the ordered pipeline) lets a second replica overlap. An unconditional
    // SET from the slower pass would re-read an already-drained window on every tick, forever.
    const { redis, db, store } = fakes([entry('x', 1000, new Uint8Array())])
    store.set(REJECT_CURSOR_KEY, '5000-0') // a faster peer already got further
    await runRejectDrain({ connection: {}, redis, db })
    expect(store.get(REJECT_CURSOR_KEY)).toBe('5000-0')
  })

  it('a tick LOOPS until the stream is caught up — one fixed batch was a rate limit, not a drain', async () => {
    // 1000 rows/min is 17/s against a 100k stream fed by a 1500 msg/s envelope: during exactly the
    // flood the table exists to explain, MAXLEN would trim past the cursor and the rows would be
    // gone, while the counter reported a healthy constant 1000/min.
    const { redis, db, calls } = fakes([entry('a', 1000, new Uint8Array()), entry('b', 2000, new Uint8Array())])
    expect(await runRejectDrain({ connection: {}, redis, db })).toBe(2)
    expect(calls.length).toBeGreaterThan(1) // read again after a full window, not once per tick
  })

  it('does NOT advance the cursor when the insert fails — the next tick retries the same window', async () => {
    // The cursor is the only thing standing between a DB blip and a permanently skipped window.
    // Duplicated diagnostic rows are the right way round; silently skipped ones are not.
    const { redis, store } = fakes([entry('x', 1000, new Uint8Array())])
    const db = { rawRejects: { insertMany: () => Promise.reject(new Error('db down')) } } as unknown as Db
    await expect(runRejectDrain({ connection: {}, redis, db })).rejects.toThrow('db down')
    expect(store.has(REJECT_CURSOR_KEY)).toBe(false)
  })

  it('an empty stream is a no-op — no insert, no cursor write', async () => {
    const { redis, db, store, inserted } = fakes([])
    expect(await runRejectDrain({ connection: {}, redis, db })).toBe(0)
    expect(inserted).toHaveLength(0)
    expect(store.has(REJECT_CURSOR_KEY)).toBe(false)
  })
})
