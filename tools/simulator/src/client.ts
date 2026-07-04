import { Socket, connect } from 'node:net'

import type { Scenario, ScenarioOpts } from './scenarios/types.js'

export interface RunResult {
  sentPackets: number
  ackedRecords: number
  /** Packets whose 4-byte ACK reported fewer records than sent (§3.2: real devices resend these — resend modelling arrives with bufferedFlood/chaos in E02-2). */
  underAckedPackets: number
  /** True only on an explicit 0x00 reject; connection drop before the verdict sets socketClosedByServer instead. */
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

  const base: RunResult = {
    sentPackets: 0,
    ackedRecords: 0,
    underAckedPackets: 0,
    rejectedByImei: false,
    socketClosedByServer: false,
  }
  const verdict = await reader.read(1)
  if (verdict === null) {
    socket.destroy()
    return { ...base, socketClosedByServer: true }
  }
  if (verdict[0] !== 0x01) {
    socket.destroy()
    return { ...base, rejectedByImei: true }
  }

  const result = { ...base }
  const byteDelayMs = (scenario as { byteDelayMs?: number }).byteDelayMs ?? opts.byteDelayMs ?? 0
  for await (const pkt of scenario.packets(opts)) {
    if (byteDelayMs > 0) {
      for (const byte of pkt) {
        socket.write(Buffer.from([byte]))
        await sleep(byteDelayMs)
      }
    } else {
      socket.write(pkt)
    }
    result.sentPackets++
    const ack = await reader.read(4)
    if (ack === null) {
      // server closed on us (expected for oversize/slow-loris style scenarios)
      return { ...result, socketClosedByServer: true }
    }
    const acked = ack.readUInt32BE(0)
    result.ackedRecords += acked
    // per-packet verification (§3.2): NumberOfData1 is what we claimed to send
    const sentRecords = pkt.length >= 10 && pkt.readUInt32BE(0) === 0 ? pkt[9]! : 0
    if (acked < sentRecords) result.underAckedPackets++
    if (opts.hz > 0) await sleep(1000 / opts.hz)
  }
  socket.end()
  return result
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
