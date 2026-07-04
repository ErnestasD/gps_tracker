import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { StreamFramer } from '@orbetra/codec'

import { runScenario } from '../src/client.js'
import { liveDrive } from '../src/scenarios/liveDrive.js'
import { oversize } from '../src/scenarios/oversize.js'
import type { ScenarioOpts } from '../src/scenarios/types.js'

const OPTS: ScenarioOpts = {
  imei: '356307042441013',
  seed: 7,
  hz: 0, // no pacing in tests
  count: 5,
  startMs: Date.UTC(2026, 6, 4, 12, 0, 0),
}

let server: Server | null = null
afterEach(() => {
  server?.close()
  server = null
})

function listen(s: Server): Promise<number> {
  return new Promise((resolve) => {
    s.listen(0, '127.0.0.1', () => {
      resolve((s.address() as { port: number }).port)
    })
  })
}

describe('simulator TCP client (device-side wiki flow)', () => {
  it('handshakes, streams packets, sums ACKed record counts', async () => {
    server = createServer((socket) => {
      const framer = new StreamFramer()
      let greeted = false
      socket.on('data', (chunk) => {
        for (const frame of framer.feed(chunk)) {
          if (frame.kind === 'imei') {
            greeted = true
            socket.write(Buffer.from([0x01]))
          } else if (greeted) {
            const ack = Buffer.alloc(4)
            ack.writeUInt32BE(frame.bytes[9]!) // NumberOfData1
            socket.write(ack)
          }
        }
      })
    })
    const port = await listen(server)
    const res = await runScenario(liveDrive, { ...OPTS, host: '127.0.0.1', port })
    expect(res).toEqual({
      sentPackets: 5,
      ackedRecords: 5,
      underAckedPackets: 0,
      rejectedByImei: false,
      socketClosedByServer: false,
    })
  })

  it('partial ACK (server persists fewer records) → underAckedPackets counted', async () => {
    server = createServer((socket) => {
      const framer = new StreamFramer()
      socket.on('data', (chunk) => {
        for (const frame of framer.feed(chunk)) {
          if (frame.kind === 'imei') socket.write(Buffer.from([0x01]))
          else socket.write(Buffer.alloc(4)) // ACK 0 of 1 — corrupt-CRC server behaviour
        }
      })
    })
    const port = await listen(server)
    const res = await runScenario(liveDrive, { ...OPTS, count: 3, host: '127.0.0.1', port })
    expect(res.underAckedPackets).toBe(3)
    expect(res.ackedRecords).toBe(0)
  })

  it('unknown IMEI → 0x00 reply → rejectedByImei', async () => {
    server = createServer((socket) => {
      socket.once('data', () => socket.write(Buffer.from([0x00])))
    })
    const port = await listen(server)
    const res = await runScenario(liveDrive, { ...OPTS, host: '127.0.0.1', port })
    expect(res.rejectedByImei).toBe(true)
    expect(res.sentPackets).toBe(0)
  })

  it('server closing mid-stream (oversize attack) → socketClosedByServer', async () => {
    server = createServer((socket) => {
      const framer = new StreamFramer()
      socket.on('data', (chunk) => {
        try {
          for (const frame of framer.feed(chunk)) {
            if (frame.kind === 'imei') socket.write(Buffer.from([0x01]))
          }
        } catch {
          socket.destroy() // frame violation → close, like apps/ingest will
        }
      })
    })
    const port = await listen(server)
    const res = await runScenario(oversize, { ...OPTS, count: 1, host: '127.0.0.1', port })
    expect(res.socketClosedByServer).toBe(true)
    expect(res.ackedRecords).toBe(0)
  })
})
