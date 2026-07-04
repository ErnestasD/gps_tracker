import { describe, expect, it } from 'vitest'

import { rawStreamPayloadSchema } from '../src/records.js'

const valid = {
  deviceId: 42n,
  imei: '356307042441013',
  serverTimeMs: 1,
  tsMs: 1,
  priority: 2,
  lat: 54.7,
  lon: 25.3,
  altitude: 100,
  angle: 90,
  satellites: 8,
  speed: 50,
  eventIoId: 1,
  io: [[239, 1n]],
  raw: new Uint8Array([1]),
}

describe('rawStreamPayload contract (ingest → worker, ADR-015)', () => {
  it('accepts the shape ingest produces (bigint or number deviceId)', () => {
    expect(rawStreamPayloadSchema.parse(valid).deviceId).toBe(42n)
    expect(rawStreamPayloadSchema.parse({ ...valid, deviceId: 42 }).deviceId).toBe(42n)
  })

  it('rejects out-of-spec priority and missing raw', () => {
    expect(() => rawStreamPayloadSchema.parse({ ...valid, priority: 3 })).toThrow()
    const withoutRaw: Partial<typeof valid> = { ...valid }
    delete withoutRaw.raw
    expect(() => rawStreamPayloadSchema.parse(withoutRaw)).toThrow()
  })
})
