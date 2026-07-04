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
