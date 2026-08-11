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
  | {
      kind: 'avl'
      codec: 8 | 0x8e | 16
      records: AvlRecord[]
      /**
       * Records that framed and CRC-verified but could not be decoded, with the reason.
       *
       * A per-record failure used to throw out of the whole packet, discarding every good record
       * beside it. That is not loss while the failure is transient — the count mismatch makes the
       * device resend — but a DETERMINISTIC failure resends identically forever, and the device's
       * own buffer eventually overwrites its oldest records. Isolating the bad one lets the caller
       * persist what it can and park the rest, which is what codec 16 already does and what the
       * protocol honours.
       */
      badRecords?: { index: number; reason: string; raw: Buffer }[]
      /** codec 16: framing+CRC verified but records are not decoded yet — park the frame, do not drop it */
      rawFallback?: boolean
      /**
       * NumberOfData1 the device claims — ACK this, or the device resends forever.
       *
       * Set for codec 16 (nothing decoded) AND for a codec 8/8E packet carrying `badRecords`: in
       * both cases `records.length` is smaller than what the device sent, and ACKing the smaller
       * number under-ACKs and invites the resend the isolation exists to stop.
       */
      declaredCount?: number
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
