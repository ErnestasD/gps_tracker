import { Socket, connect } from 'node:net'

import type { Scenario, ScenarioOpts } from './scenarios/types.js'

export interface RunResult {
  sentPackets: number
  ackedRecords: number
  rejectedByImei: boolean
  socketClosedByServer: boolean
}

/**
 * Device-side TCP session per wiki flow (PROJECT_PLAN §3.2):
 * send [2B len][IMEI] → read 1 B (0x01 accept / 0x00 reject) → per AVL packet:
 * write → read 4 B BE accepted-record count.
 */
export async function runScenario(
  scenario: Scenario,
  opts: ScenarioOpts & { host: string; port: number },
): Promise<RunResult> {
  const socket = connect({ host: opts.host, port: opts.port })
  const reader = new ByteReader(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })

  const imeiAscii = Buffer.from(opts.imei, 'ascii')
  const hello = Buffer.alloc(2 + imeiAscii.length)
  hello.writeUInt16BE(imeiAscii.length, 0)
  imeiAscii.copy(hello, 2)
  socket.write(hello)

  const verdict = await reader.read(1)
  if (verdict === null || verdict[0] !== 0x01) {
    socket.destroy()
    return { sentPackets: 0, ackedRecords: 0, rejectedByImei: true, socketClosedByServer: false }
  }

  let sentPackets = 0
  let ackedRecords = 0
  for await (const pkt of scenario.packets(opts)) {
    socket.write(pkt)
    sentPackets++
    const ack = await reader.read(4)
    if (ack === null) {
      // server closed on us (expected for oversize/slow-loris style scenarios)
      return { sentPackets, ackedRecords, rejectedByImei: false, socketClosedByServer: true }
    }
    ackedRecords += ack.readUInt32BE(0)
    if (opts.hz > 0) await sleep(1000 / opts.hz)
  }
  socket.end()
  return { sentPackets, ackedRecords, rejectedByImei: false, socketClosedByServer: false }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Minimal awaitable byte reader; resolves null when the socket ends first. */
class ByteReader {
  private buf = Buffer.alloc(0)
  private ended = false
  private wake: (() => void) | null = null

  constructor(socket: Socket) {
    socket.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk])
      this.wake?.()
    })
    const finish = () => {
      this.ended = true
      this.wake?.()
    }
    socket.on('end', finish)
    socket.on('close', finish)
    socket.on('error', finish)
  }

  async read(n: number): Promise<Buffer | null> {
    for (;;) {
      if (this.buf.length >= n) {
        const out = this.buf.subarray(0, n)
        this.buf = this.buf.subarray(n)
        return out
      }
      if (this.ended) return null
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
      this.wake = null
    }
  }
}
