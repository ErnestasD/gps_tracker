import { describe, expect, it } from 'vitest'

import { confirmsValue, parseGetparamReply, reportedNumber, requestedIds } from '../src/getparam.js'

/**
 * Every string in this file was captured from a real FTC887 (firmware 3.7.0) over GPRS on
 * 2026-08-18, not invented. That matters: this parser is the platform's only way to tell a write
 * the device applied from one it silently ignored, and inventing the reply format would defeat the
 * purpose of having the check at all.
 */
describe('parseGetparamReply', () => {
  it('reads the single-id reply', () => {
    expect([...parseGetparamReply('Param ID:121 Value:15', ['121'])]).toEqual([['121', '15']])
  })

  it('reads the multi-id reply, where only the FIRST pair says "Value:"', () => {
    // `getparam 102;103;106;107` on the real device answered exactly this.
    const m = parseGetparamReply('Param ID:102 Value:0;103:120;106:0;107:2', ['102','103','106','107'])
    expect(m.get('102')).toBe('0')
    expect(m.get('103')).toBe('120')
    expect(m.get('106')).toBe('0')
    expect(m.get('107')).toBe('2')
    expect(m.size).toBe(4)
  })

  it('an empty value is null, not zero — "set to nothing" and "set to 0" are different answers', () => {
    // `getparam 2001` answered this while the APN was genuinely unset. Reading it as 0 would have
    // shown a configured APN of "0" on the settings page.
    expect(parseGetparamReply('Param ID:2001 Value:', ['2001']).get('2001')).toBeNull()
    expect(reportedNumber('Param ID:2001 Value:', '2001')).toBeNull()
  })

  it('"doesn\'t exist" yields nothing at all — the model does not have the parameter', () => {
    const reply = "Param ID:2027 doesn't exist"
    expect(parseGetparamReply(reply, ['2027']).size).toBe(0)
    expect(reportedNumber(reply, '2027')).toBeNull()
  })

  it('unrecognised text yields an empty map rather than a guess', () => {
    for (const junk of ['', '   ', 'OK', 'New value 2001:internet;', 'Data Link: 1 GPRS: 1', 'Param ID: Value:5']) {
      expect(parseGetparamReply(junk, ['10050']).size, JSON.stringify(junk)).toBe(0)
    }
  })

  it('tolerates the whitespace and casing variations a firmware may emit', () => {
    expect(parseGetparamReply('param id:10050 value:300', ['10050']).get('10050')).toBe('300')
    expect(parseGetparamReply('  Param  ID:10050  Value: 300  ', ['10050']).get('10050')).toBe('300')
    expect(parseGetparamReply('Param ID:10050 Value:300;', ['10050']).get('10050')).toBe('300')
  })
})

describe('reportedNumber', () => {
  it('returns the number the device stated', () => {
    expect(reportedNumber('Param ID:10050 Value:300', '10050')).toBe(300)
    expect(reportedNumber('Param ID:102 Value:0;103:120', '103', ['102','103'])).toBe(120)
    expect(reportedNumber('Param ID:11813 Value:0', '11813')).toBe(0)
  })

  it('null for an id the reply never mentioned — never another id’s value', () => {
    expect(reportedNumber('Param ID:10050 Value:300', '10055')).toBeNull()
  })

  it('null for a non-numeric value rather than NaN', () => {
    expect(reportedNumber('Param ID:2001 Value:banga', '2001')).toBeNull()
    expect(reportedNumber('Param ID:2004 Value:185.80.129.33', '2004')).toBeNull()
  })
})

describe('confirmsValue — the check that follows every write', () => {
  it('true only when the device states exactly that number', () => {
    // The real confirmation that ended the 2026-08-18 investigation.
    expect(confirmsValue('Param ID:121 Value:15', '121', 15)).toBe(true)
    expect(confirmsValue('Param ID:11813 Value:0', '11813', 0)).toBe(true)
  })

  it('false when the device holds something else — a write that did not take must not read as success', () => {
    expect(confirmsValue('Param ID:10055 Value:120', '10055', 30)).toBe(false)
  })

  it('false when the device said nothing about it, including "doesn\'t exist" and an empty value', () => {
    expect(confirmsValue("Param ID:2027 doesn't exist", '2027', 0)).toBe(false)
    expect(confirmsValue('Param ID:10055 Value:', '10055', 0)).toBe(false)
    expect(confirmsValue('', '10055', 30)).toBe(false)
  })
})

describe('a reply is only trusted for the ids the command actually asked about', () => {
  it('a string parameter’s value cannot smuggle a reading for a tracking id', () => {
    // Teltonika string parameters may contain a semicolon, and the multi-id continuation syntax is
    // indistinguishable from one. Split blindly, a reply to `getparam 2001` would state a 2-second
    // send period the device never held — and confirmsValue, the oracle that decides whether a
    // write took, would agree. The SMS path already refuses this exact shape going the other way.
    const evil = 'Param ID:2001 Value:banga;10055:2'
    expect(parseGetparamReply(evil, ['2001']).get('2001')).toBe('banga;10055:2')
    expect(parseGetparamReply(evil, ['2001']).has('10055')).toBe(false)
    expect(reportedNumber(evil, '10055')).toBeNull()
    expect(confirmsValue(evil, '10055', 2)).toBe(false)
  })

  it('an answer about an id we did not ask for is discarded entirely', () => {
    expect(parseGetparamReply('Param ID:10055 Value:2', ['10050']).size).toBe(0)
    // …and in a multi-id reply, only the requested ids survive
    const m = parseGetparamReply('Param ID:10050 Value:2;10051:20;11813:1', ['10050', '10051'])
    expect([...m.keys()].sort()).toEqual(['10050', '10051'])
  })

  it('with no requested ids nothing is trusted — a caller that forgot gets nothing, not everything', () => {
    expect(parseGetparamReply('Param ID:10055 Value:2', []).size).toBe(0)
  })
})

describe('requestedIds', () => {
  it('reads the ids out of the command we sent', () => {
    expect(requestedIds('getparam 10050')).toEqual(['10050'])
    expect(requestedIds('getparam 10050;10051;10055')).toEqual(['10050', '10051', '10055'])
    expect(requestedIds('  GETPARAM 10050 ; 10051 ')).toEqual(['10050', '10051'])
  })

  it('is empty for anything that is not a getparam — a setparam reply proves nothing', () => {
    for (const t of ['setparam 10050:2', 'getinfo', 'getparam', 'getparam abc', '']) {
      expect(requestedIds(t), t).toEqual([])
    }
  })
})
