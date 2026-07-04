/**
 * CRC-16/IBM (aka ARC): polynomial 0x8005 reflected (0xA001), init 0, no final xor.
 * Spec: https://wiki.teltonika-gps.com/view/Codec — "CRC-16/IBM", computed over
 * Codec ID .. Number of Data 2 (the Data Field Length span).
 * Implemented independently of the wrapped npm parser so the two verify each other.
 */
export function crc16ibm(buf: Uint8Array): number {
  let crc = 0
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return crc
}
