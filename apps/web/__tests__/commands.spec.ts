import { COMMAND_PRESETS } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { hasPendingCommand, isDestructiveCommand, statusVariant } from '../src/lib/commands.js'

describe('E08-2b commands UI helpers', () => {
  it('flags cpureset and deleterecords as destructive (warning-gated)', () => {
    expect(isDestructiveCommand('cpureset')).toBe(true)
    expect(isDestructiveCommand('deleterecords')).toBe(true)
    expect(isDestructiveCommand('  DELETERECORDS  ')).toBe(true) // case/whitespace-insensitive
  })

  it('does not gate read-only or setter commands', () => {
    for (const text of ['getinfo', 'getver', 'getgps', 'getio', 'setdigout 1', 'setparam 10050:30']) {
      expect(isDestructiveCommand(text)).toBe(false)
    }
  })

  it('every shared preset resolves to a defined destructive verdict', () => {
    // presets come straight from @orbetra/shared — parity is structural; this guards the gate
    // logic against a future preset whose verb the destructive check would not understand
    const destructive = COMMAND_PRESETS.filter((p) => isDestructiveCommand(p.text)).map((p) => p.key)
    expect(destructive.sort()).toEqual(['cpureset', 'deleterecords'])
  })

  it('maps command statuses to badge variants', () => {
    expect(statusVariant('queued')).toBe('outline')
    expect(statusVariant('sent')).toBe('outline')
    expect(statusVariant('acked')).toBe('success')
    expect(statusVariant('failed')).toBe('danger')
    expect(statusVariant('expired')).toBe('danger')
    expect(statusVariant('garbage')).toBe('outline') // unknown → neutral, never throws
  })

  it('hasPendingCommand drives the poll: true only while something is queued/sent', () => {
    expect(hasPendingCommand([])).toBe(false)
    expect(hasPendingCommand([{ status: 'acked' }, { status: 'failed' }])).toBe(false)
    expect(hasPendingCommand([{ status: 'acked' }, { status: 'queued' }])).toBe(true)
    expect(hasPendingCommand([{ status: 'sent' }])).toBe(true)
  })
})
