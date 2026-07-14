import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import { removeDriverIbutton, syncDriverIbutton } from '../src/routes/driverRegistry.js'

/** Fake redis capturing hset/hdel on the driver:ibutton hash. */
function fakeRedis() {
  const hset = vi.fn(() => Promise.resolve(1))
  const hdel = vi.fn(() => Promise.resolve(1))
  return { redis: { hset, hdel } as unknown as Redis, hset, hdel }
}

const TEN = 'ten-1'
// 0xA1B2C3D4 → canonical decimal 2712847316 (what the pipeline derives from AVL 78)
const HEX = 'A1B2C3D4'
const KEY = '2712847316'

describe('V2 driverRegistry (iButton → driver Redis sync)', () => {
  it('publishes the CANONICAL decimal key so it matches the pipeline’s AVL value', async () => {
    const f = fakeRedis()
    await syncDriverIbutton(f.redis, TEN, 'drv-1', HEX, null)
    expect(f.hset).toHaveBeenCalledWith(`driver:ibutton:${TEN}`, KEY, 'drv-1')
    expect(f.hdel).not.toHaveBeenCalled()
  })

  it('drops the stale key when a driver’s iButton changes', async () => {
    const f = fakeRedis()
    await syncDriverIbutton(f.redis, TEN, 'drv-1', 'DEADBEEF', HEX) // new DEADBEEF, old A1B2C3D4
    expect(f.hdel).toHaveBeenCalledWith(`driver:ibutton:${TEN}`, KEY) // old key removed
    expect(f.hset).toHaveBeenCalledWith(`driver:ibutton:${TEN}`, BigInt('0xDEADBEEF').toString(), 'drv-1')
  })

  it('case/leading-zero variants map to the same key (no duplicate, no stale entry)', async () => {
    const f = fakeRedis()
    await syncDriverIbutton(f.redis, TEN, 'drv-1', '00a1b2c3d4', 'A1B2C3D4') // same physical key, diff spelling
    expect(f.hdel).not.toHaveBeenCalled() // old and new canonicalize identically → nothing to drop
    expect(f.hset).toHaveBeenCalledWith(`driver:ibutton:${TEN}`, KEY, 'drv-1')
  })

  it('a keyless driver contributes nothing; remove drops the mapping', async () => {
    const f = fakeRedis()
    await syncDriverIbutton(f.redis, TEN, 'drv-2', null, null)
    expect(f.hset).not.toHaveBeenCalled()
    await removeDriverIbutton(f.redis, TEN, HEX)
    expect(f.hdel).toHaveBeenCalledWith(`driver:ibutton:${TEN}`, KEY)
    await removeDriverIbutton(f.redis, TEN, null) // keyless delete → no-op
    expect(f.hdel).toHaveBeenCalledTimes(1)
  })
})
