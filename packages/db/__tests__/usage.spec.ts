import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { createUsageRepo } from '../src/repos/usage.js'

function fakePrisma() {
  const calls: { groupBy: unknown[]; findMany: unknown[] } = { groupBy: [], findMany: [] }
  const groupBy = vi.fn((args: unknown) => {
    calls.groupBy.push(args)
    const a = args as { by: string[] }
    if (a.by[0] === 'tenantId') {
      return Promise.resolve([
        { tenantId: 't1', _count: { _all: 40 } },
        { tenantId: 't2', _count: { _all: 90 } },
      ])
    }
    return Promise.resolve([{ day: new Date('2026-07-10T00:00:00Z'), _count: { _all: 7 } }])
  })
  const findMany = vi.fn((args: unknown) => {
    calls.findMany.push(args)
    // distinct tenant+device pairs: t1 has 2 devices, t2 has 3
    return Promise.resolve([{ tenantId: 't1' }, { tenantId: 't1' }, { tenantId: 't2' }, { tenantId: 't2' }, { tenantId: 't2' }])
  })
  return { prisma: { usageDaily: { groupBy, findMany } } as unknown as PrismaClient, calls }
}

describe('E07-4 UsageRepo', () => {
  it('platformSummary aggregates device-days + distinct devices per tenant, largest first', async () => {
    const { prisma } = fakePrisma()
    const rows = await createUsageRepo(prisma).platformSummary()
    expect(rows).toEqual([
      { tenantId: 't2', deviceDays: 90, activeDevices: 3 },
      { tenantId: 't1', deviceDays: 40, activeDevices: 2 },
    ])
  })

  it('applies valid day bounds and DROPS malformed ones (never 500s)', async () => {
    const { prisma, calls } = fakePrisma()
    await createUsageRepo(prisma).platformSummary({ from: '2026-07-01', to: 'garbage' })
    const where = (calls.groupBy[0] as { where: { day?: { gte?: Date; lte?: Date } } }).where
    expect(where.day?.gte).toEqual(new Date('2026-07-01'))
    expect(where.day?.lte).toBeUndefined() // garbage 'to' dropped
  })

  it('tenantSummary is scoped by the caller tenant and maps day → YYYY-MM-DD', async () => {
    const { prisma, calls } = fakePrisma()
    const rows = await createUsageRepo(prisma).tenantSummary({ tenantId: 'ten-9' })
    expect((calls.groupBy[0] as { where: { tenantId: string } }).where.tenantId).toBe('ten-9')
    expect(rows).toEqual([{ day: '2026-07-10', deviceDays: 7 }])
  })
})
