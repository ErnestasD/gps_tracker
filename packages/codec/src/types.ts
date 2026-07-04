// Appendix A contract types (IMPLEMENTATION_PLAN.md) — changes require an ADR.

export interface Frame {
  kind: 'imei' | 'avl'
  bytes: Buffer
}

export interface AvlRecord {
  tsMs: number
  priority: 0 | 1 | 2
  lat: number
  lon: number
  altitude: number
  angle: number
  satellites: number
  speed: number
  eventIoId: number
  io: Map<number, bigint | Buffer>
  /** Exact wire bytes of this record (rec_hash input, invariant I3). */
  raw: Buffer
}

export type ParsedPacket =
  | { kind: 'imei'; imei: string }
  | { kind: 'avl'; codec: 8 | 0x8e | 16; records: AvlRecord[]; rawFallback?: boolean }
  | { kind: 'cmdResponse'; codec: 12 | 13 | 14; text: string; nack?: boolean }

export interface TeltonikaCodec {
  /** Streaming framer — one instance per TCP connection. */
  feed(chunk: Buffer): Frame[]
  /** Parse a complete frame. Throws CrcError | FrameError. */
  parse(frame: Frame): ParsedPacket
  encodeAck(count: number): Buffer
  encodeImeiReply(accept: boolean): Buffer
  encodeCodec12(cmd: string): Buffer
  decodeCodec12(frame: Frame): string
}
