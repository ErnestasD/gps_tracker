import type { Scenario } from './types.js'

/**
 * Oversized-length attack (PROJECT_PLAN §3.3): header declaring a data length
 * beyond the 4096 B cap. The server must close the socket and count a frame
 * violation — nothing after the header is ever sent.
 */
export const oversize: Scenario = {
  name: 'oversize',
  *packets() {
    const evil = Buffer.alloc(8)
    evil.writeUInt32BE(0, 0)
    evil.writeUInt32BE(5000, 4)
    yield evil
  },
}
