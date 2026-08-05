import type { Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

import { enqueueRecompute, type RecomputeJob } from '../src/jobs/queue.js'

/**
 * The recompute jobId is a dedupe key, and a dedupe key that collapses two DIFFERENT requests is a
 * dropped reconciliation, not a saved job.
 */
const fakeQueue = () => {
  const added: { name: string; data: unknown; opts: { jobId?: string; delay?: number } }[] = []
  const add = vi.fn((name: string, data: unknown, opts: { jobId?: string; delay?: number }) => {
    added.push({ name, data, opts })
    return Promise.resolve({})
  })
  return { queue: { add } as unknown as Queue<RecomputeJob>, added }
}

const D = 42n
const t = (iso: string): Date => new Date(iso)

describe('enqueueRecompute jobId', () => {
  it('collapses IDENTICAL windows — the burst case a device flushing late records produces', async () => {
    const { queue, added } = fakeQueue()
    await enqueueRecompute(queue, D, t('2026-08-05T10:05:00Z'), t('2026-08-05T12:00:00Z'))
    await enqueueRecompute(queue, D, t('2026-08-05T10:41:00Z'), t('2026-08-05T12:30:00Z'))
    expect(added[0]!.opts.jobId).toBe(added[1]!.opts.jobId) // same hour on both edges → one job
  })

  it('does NOT collapse a WIDER window into a narrower one already queued', async () => {
    // REGRESSION (audit MED). The id was bucketed on `from`'s hour alone, so whichever request
    // arrived first owned it — and a later, genuinely wider reconciliation was silently discarded as
    // a duplicate. The window that actually needed rebuilding then never was, and nothing said so.
    const { queue, added } = fakeQueue()
    await enqueueRecompute(queue, D, t('2026-08-05T10:05:00Z'), t('2026-08-05T11:00:00Z'))
    await enqueueRecompute(queue, D, t('2026-08-05T10:05:00Z'), t('2026-08-05T18:00:00Z')) // seven hours more
    expect(added[1]!.opts.jobId).not.toBe(added[0]!.opts.jobId)
  })

  it('keeps different devices apart, and passes a delay through for an unsettled window', async () => {
    const { queue, added } = fakeQueue()
    await enqueueRecompute(queue, D, t('2026-08-05T10:00:00Z'), t('2026-08-05T11:00:00Z'))
    await enqueueRecompute(queue, 43n, t('2026-08-05T10:00:00Z'), t('2026-08-05T11:00:00Z'))
    expect(added[0]!.opts.jobId).not.toBe(added[1]!.opts.jobId)
    await enqueueRecompute(queue, D, t('2026-08-05T10:00:00Z'), t('2026-08-05T11:00:00Z'), { delayMs: 900_000 })
    expect(added[2]!.opts.delay).toBe(900_000)
  })
})
