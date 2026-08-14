export class FrameError extends Error {
  constructor(
    message: string,
    readonly frame?: Buffer,
  ) {
    super(message)
    this.name = 'FrameError'
  }
}

export class CrcError extends Error {
  constructor(
    message: string,
    readonly frame: Buffer,
  ) {
    super(message)
    this.name = 'CrcError'
  }
}

/**
 * The frame is STRUCTURALLY sound — framed, CRC-verified, and its two NumberOfData bytes agree —
 * but our decoder cannot read the records inside it.
 *
 * This is a different fault from a `FrameError`, and the difference decides the ACK. A CRC or
 * framing error is transient: retransmission genuinely fixes it, so ACKing 0 is right. A frame
 * whose CONTENT we cannot decode is a property of the bytes, and the device will re-send exactly
 * the same bytes forever — its ACK cursor never advances, and its own buffer eventually overwrites
 * its OLDEST unsent records. One poison packet then costs a customer everything queued behind it,
 * silently. The trigger we can actually reach is a repeated AVL IO id in one record, which our own
 * walker accepts and the wrapped parser refuses.
 *
 * So this carries the DECLARED record count, which the caller ACKs after parking the frame — the
 * same contract the codec-16 path already uses, for the same reason. The count is safe to trust
 * here precisely because the structural checks passed before this was thrown.
 */
export class UndecodableRecordsError extends FrameError {
  constructor(
    message: string,
    readonly declaredCount: number,
    frame?: Buffer,
  ) {
    super(message, frame)
    this.name = 'UndecodableRecordsError'
  }
}

