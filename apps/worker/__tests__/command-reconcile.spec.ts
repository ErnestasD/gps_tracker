import { describe, expect, it } from 'vitest'

import { reconcile, type Inflight } from '../src/commands/reconcile.js'

const T0 = 1_800_000_000_000
const cmd = (id: string, o: Partial<Inflight> = {}): Inflight => ({ id, text: `t-${id}`, attempt: 0, sentAtMs: T0, ...o })

describe('E08-2 reconcile (Codec-12 command correlation)', () => {
  it('pairs responses to in-flight commands in FIFO order', () => {
    const r = reconcile([cmd('a'), cmd('b')], [{ text: 'A ok', nack: false }, { text: 'B ok', nack: false }], T0 + 1000)
    expect(r.acked).toEqual([{ id: 'a', response: 'A ok' }, { id: 'b', response: 'B ok' }])
    expect(r.consumedResponses).toBe(2)
    expect(r.remaining).toEqual([])
  })

  it('a nack fails that command instead of acking', () => {
    const r = reconcile([cmd('a')], [{ text: '', nack: true }], T0 + 1000)
    expect(r.acked).toEqual([])
    expect(r.failed).toEqual([{ id: 'a', reason: 'device rejected (nack)' }])
  })

  it('an unanswered command within the window stays in-flight', () => {
    const r = reconcile([cmd('a')], [], T0 + 10_000) // 10s < 30s
    expect(r.remaining.map((c) => c.id)).toEqual(['a'])
    expect(r.failed).toEqual([])
    expect(r.resend).toEqual([])
  })

  it('a timed-out command with retries left is resent (attempt+1)', () => {
    const r = reconcile([cmd('a', { attempt: 0 })], [], T0 + 31_000)
    expect(r.resend).toEqual([{ id: 'a', text: 't-a', attempt: 1, sentAtMs: T0 }])
    expect(r.failed).toEqual([])
  })

  it('a timed-out command on its last attempt fails (max 3)', () => {
    const r = reconcile([cmd('a', { attempt: 2 })], [], T0 + 31_000)
    expect(r.failed).toEqual([{ id: 'a', reason: 'timeout (max retries)' }])
    expect(r.resend).toEqual([])
  })

  it('mixed: first acked by a response, second still pending', () => {
    const r = reconcile([cmd('a'), cmd('b', { sentAtMs: T0 + 5000 })], [{ text: 'A', nack: false }], T0 + 6000)
    expect(r.acked).toEqual([{ id: 'a', response: 'A' }])
    expect(r.remaining.map((c) => c.id)).toEqual(['b'])
    expect(r.consumedResponses).toBe(1)
  })

  it('extra responses beyond in-flight are not consumed (kept for the next tick)', () => {
    const r = reconcile([cmd('a')], [{ text: 'A', nack: false }, { text: '?', nack: false }], T0 + 1000)
    expect(r.acked).toHaveLength(1)
    expect(r.consumedResponses).toBe(1) // second response left in the buffer
  })

  it('a non-retryable command (isRetryable→false) FAILS on timeout instead of resending', () => {
    // e.g. cpureset/deleterecords: the >30s silence looks like a timeout, but a blind retry
    // would re-run the destructive op — so it must fail, never resend (review MED).
    const r = reconcile([cmd('a', { text: 'deleterecords', attempt: 0 })], [], T0 + 31_000, { isRetryable: (t) => t !== 'deleterecords' })
    expect(r.resend).toEqual([])
    expect(r.failed).toEqual([{ id: 'a', reason: 'timeout (non-retryable command)' }])
  })
})
