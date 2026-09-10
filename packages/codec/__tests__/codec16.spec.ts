import { describe, expect, it } from 'vitest'

import { FrameError } from '../src/errors.js'
import { parseFrame } from '../src/index.js'
import { extractIo16, generationTypeOf } from '../src/walk.js'

/**
 * Codec 16 — the FM63XX generation's protocol (FMB630, FM6300, FM6320).
 *
 * The golden wiki example lives in `__fixtures__/wiki/codec16.hex.json`; what it CANNOT show is why
 * this codec exists at all, because its ids all fit in a byte. These frames come from the corpus in
 * docs/protocols/teltonika-codec16.md and each pins a property that the wiki example does not reach.
 */
const asAvl = (hex: string) => {
  const parsed = parseFrame({ kind: 'avl', bytes: Buffer.from(hex, 'hex') })
  if (parsed.kind !== 'avl') throw new Error(`expected avl, got ${parsed.kind}`)
  return parsed
}

describe('codec 16: the reason it exists', () => {
  /**
   * "AVL IDs that are higher than 255 will can be used only in the Codec16 protocol"
   * — https://wiki.teltonika-gps.com/view/Teltonika_Data_Sending_Protocols
   *
   * A 1-byte id ran out; this is the answer. Decode it with Codec 8's id width and every element
   * after the first is garbage, which is the failure this test exists to make impossible.
   */
  it('decodes IO ids above 255 — unrepresentable in Codec 8', () => {
    const parsed = asAvl(
        '000000000000009F100100000164D855401800D5E3B744EC11C762023B011A060000000007200A010000010500010600' +
        '010D00010E00010F00011600011700011800011F001301010000010700000108000001090000010A0000010B0000010C' +
        '000001100000011100000112000001130000011400000115000001190000011A0000011B0000011C0000011D0000011E' +
        '000003010200000000010300000000010400000000000100000D3B',
    )
    expect(parsed.codec).toBe(16)
    expect(parsed.records).toHaveLength(1)
    const ids = [...parsed.records[0]!.io.keys()].sort((a, b) => a - b)
    const wide = ids.filter((id) => id > 255)
    expect(wide).toHaveLength(32)
    expect(wide[0]).toBe(256)
    expect(wide.at(-1)).toBe(287)
  })

  /**
   * T-4 from the research: Go and Rust implementations reject a generation type above the documented
   * 0..7 enum and abort the WHOLE packet. We do not, deliberately. An unknown trigger reason is not
   * a reason to throw away positions that decode byte-exactly — and the vendor's entire documentation
   * of the enum is the words "More information about it you can find here", where "here" is plain
   * text and not a link.
   */
  it('accepts a generation type outside the documented enum instead of dropping the packet', () => {
    const parsed = asAvl(
        '000000000000005F10020000016BDBC7833000000000000000000000000000000000000B09040200010000030002000B' +
        '00270042563A00000000016BDBC7871800000000000000000000000000000000000B05040200010000030002000B0026' +
        '0042563A00000200000F40',
    )
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]!.generationType).toBe(9) // carried, not judged
    expect(parsed.records[0]!.io.get(66)).toBe(22074n) // …and the record still decodes intact
  })

  /**
   * Generation type is NOT a proxy for "eventual vs periodic": this frame carries event id 253
   * (Green Driving Type — a genuine event) together with generation type 7 (Periodical), in every
   * record. Treating either as the other's synonym is a wrong answer that looks reasonable.
   */
  it('keeps event id and generation type orthogonal', () => {
    const parsed = asAvl(
        '00000000000003831004000001735ACE37F80000E3B9331C71E290006900E211005100FD072E16000101001603004703' +
        '00F00100150400B20000C80000EF01009000004F00005101005201005300005538006E00006F00007A03007D00007F56' +
        '00890000FD0200FE1F09004326B00044000000B5000B00B6000600427029001800540046015D00CE4EC10080000F0F00' +
        'F10000515400CD007404AB00D80F5022A100500000005400540000000000560001556800570000006000580000042000' +
        '6800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000000001735ACE' +
        '3CA80000E3B08A1C71DD29006900E311005100FD072E1600010100160300470300F00100150400B20000C80000EF0100' +
        '9000004F00005101005201005300005537006E00006F00007A03007D00007F5600890000FD0200FE1D09004326AC0044' +
        '000000B5000B00B600060042701F001800540046015D00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022' +
        'CE00500000005400540000000000560001556800570000006000580000041F006800001113006D303330300071FFFD8C' +
        '85008700000020008800000002008A000155F5008B0000B86000000001735ACE3FC80000E3A7C01C71D7C2006900E311' +
        '005100FD072E1600010100160300470300F00100150400B20000C80000EF01009000004F000051010052010053000055' +
        '37006E00006F00007A03007D00007F5600890000FD0200FE2309004326AC0044000000B5000B00B60006004270150018' +
        '00540046015E00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022E7005000000054005400000000005600' +
        '01556800570000006000580000041F006800001113006D303330300071FFFD8C85008700000020008800000002008A00' +
        '0155F5008B0000B86000000001735ACE3FFA0000E3A7C01C71D7C2006900E311005100FD072E16000101001603004703' +
        '00F00100150400B20000C80000EF01009000004F00005101005201005300005537006E00006F00007A03007D00007F56' +
        '00890000FD0300FE2309004326AC0044000000B5000B00B6000600427015001800540046015E00CE4EC10080000F0F00' +
        'F10000515400CD007404AB00D80F5022E700500000005400540000000000560001556800570000006000580000041F00' +
        '6800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000040000EB85',
    )
    expect(parsed.records).toHaveLength(4)
    for (const r of parsed.records) {
      expect(r.generationType).toBe(7)
      expect(r.eventIoId).toBe(253)
    }
  })

  /**
   * The three widths. Codec 16 uses 2-byte ids like 8E and 1-byte counts like 8 — a combination
   * neither of the others has, and the reason `walkRecords` takes a shape rather than a boolean.
   * If the counts were read as 2 bytes, this frame would not walk to its declared record count.
   */
  it('walks to exactly the declared record count', () => {
    const parsed = asAvl(
        '00000000000003831004000001735ACE37F80000E3B9331C71E290006900E211005100FD072E16000101001603004703' +
        '00F00100150400B20000C80000EF01009000004F00005101005201005300005538006E00006F00007A03007D00007F56' +
        '00890000FD0200FE1F09004326B00044000000B5000B00B6000600427029001800540046015D00CE4EC10080000F0F00' +
        'F10000515400CD007404AB00D80F5022A100500000005400540000000000560001556800570000006000580000042000' +
        '6800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000000001735ACE' +
        '3CA80000E3B08A1C71DD29006900E311005100FD072E1600010100160300470300F00100150400B20000C80000EF0100' +
        '9000004F00005101005201005300005537006E00006F00007A03007D00007F5600890000FD0200FE1D09004326AC0044' +
        '000000B5000B00B600060042701F001800540046015D00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022' +
        'CE00500000005400540000000000560001556800570000006000580000041F006800001113006D303330300071FFFD8C' +
        '85008700000020008800000002008A000155F5008B0000B86000000001735ACE3FC80000E3A7C01C71D7C2006900E311' +
        '005100FD072E1600010100160300470300F00100150400B20000C80000EF01009000004F000051010052010053000055' +
        '37006E00006F00007A03007D00007F5600890000FD0200FE2309004326AC0044000000B5000B00B60006004270150018' +
        '00540046015E00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022E7005000000054005400000000005600' +
        '01556800570000006000580000041F006800001113006D303330300071FFFD8C85008700000020008800000002008A00' +
        '0155F5008B0000B86000000001735ACE3FFA0000E3A7C01C71D7C2006900E311005100FD072E16000101001603004703' +
        '00F00100150400B20000C80000EF01009000004F00005101005201005300005537006E00006F00007A03007D00007F56' +
        '00890000FD0300FE2309004326AC0044000000B5000B00B6000600427015001800540046015E00CE4EC10080000F0F00' +
        'F10000515400CD007404AB00D80F5022E700500000005400540000000000560001556800570000006000580000041F00' +
        '6800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000040000EB85',
    )
    expect(parsed.records).toHaveLength(4)
    // every record is the same size here, so a width slip anywhere would desynchronise the rest
    const sizes = new Set(parsed.records.map((r) => r.raw.length))
    expect(sizes).toEqual(new Set([224]))
  })

})

/**
 * `extractIo16` is exported and re-reads a slice the walker has already proved consistent, so these
 * guards cannot fire through `parseFrame`. They are pinned anyway, and pinned HERE rather than
 * through a frame, because that is the only way to reach them: the day someone calls this function
 * from a replay tool or a new transport, "ends inside an element" must be an error and not a silent
 * short map. A duplicate id is the one case the walker genuinely cannot see — it counts elements,
 * not distinct ids, so two elements sharing an id would collapse the Map and pass every other check.
 */
describe('codec 16: extractIo16 defends its own bounds', () => {
  const record = (io: string) =>
    Buffer.from('0000016BDBC78330' + '00' + '00'.repeat(15) + '000B' + '05' + io, 'hex')

  it('refuses a record that ends before N of Total IO', () => {
    expect(() => extractIo16(record(''))).toThrow(FrameError)
  })

  it('refuses a record that ends before a group count', () => {
    expect(() => extractIo16(record('04'))).toThrow(/ends before the N1 count/)
  })

  it('refuses a record that ends inside an element', () => {
    // N total 1, N1 says one 1-byte element, then only the id arrives
    expect(() => extractIo16(record('01' + '01' + '0001'))).toThrow(/ends inside an N1 element/)
  })

  it('refuses a record whose ids collapse — two elements, one id', () => {
    // N total 2, two 1-byte elements that share id 1, then empty N2/N4/N8 groups so extraction runs
    // to the end: the Map keeps one entry and the declared count no longer matches
    expect(() => extractIo16(record('02' + '02' + '0001' + '07' + '0001' + '08' + '00' + '00' + '00'))).toThrow(
      /distinct ids/,
    )
  })

  it('reads the generation type, and refuses a record too short to have one', () => {
    expect(generationTypeOf(record('00' + '00000000'))).toBe(5)
    expect(() => generationTypeOf(Buffer.alloc(10))).toThrow(/too short/)
  })
})
