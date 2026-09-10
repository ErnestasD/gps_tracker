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
  /**
   * Codec 16 only: the configured trigger of the IO parameter that produced this record — On Exit,
   * On Entrance, On Both, Reserved, Hysteresis, On Change, Eventual, Periodical (0..7).
   *
   * Carried, not interpreted. The vendor's entire explanation of the enum is the words "More
   * information about it you can find here", where "here" is plain text and not a link, on both the
   * live wiki and the 2020 snapshot; only values 5 and 7 have ever been seen on the wire. It is also
   * NOT a proxy for "eventual vs periodic" — a frame carrying event id 253 arrives with generation
   * type 7 (docs/protocols/teltonika-codec16.md §3.4.1).
   */
  generationType?: number
  io: Map<number, bigint | Buffer>
  /** Exact wire bytes of this record (rec_hash input, invariant I3). */
  raw: Buffer
}

export type ParsedPacket =
  | { kind: 'imei'; imei: string }
  | {
      kind: 'avl'
      codec: 8 | 0x8e | 16
      records: AvlRecord[]
    }
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
