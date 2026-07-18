import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { createWebhookDeliveryRepo } from '../src/repos/webhookDeliveries.js'

const row = {
  id: 5n,
  tenantId: 'ten-1',
  accountId: null,
  webhookId: 'aaaaaaaa-1111-1111-1111-111111111111',
  eventId: '42:panic:0:r1',
  kind: 'panic',
  statusCode: 200,
  success: true,
  error: null,
  at: new Date('2026-07-09T00:00:00.000Z'),
}

function fakePrisma() {
  let captured: { where: Record<string, unknown>; take: number; cursor?: unknown; skip?: number } | undefined
  const findMany = vi.fn((args: typeof captured) => {
    captured = args
    return Promise.resolve([row])
  })
  return { prisma: { webhookDelivery: { findMany } } as unknown as PrismaClient, captured: () => captured }
}

describe('E06-4b WebhookDeliveryRepo', () => {
  it('scopes by tenantId and maps the row to a view (bigint→string, Date→ISO)', async () => {
    const { prisma, captured } = fakePrisma()
    const out = await createWebhookDeliveryRepo(prisma).list({ tenantId: 'ten-1' })
    expect(captured()!.where).toEqual({ tenantId: 'ten-1' })
    expect(out[0]).toEqual({ id: '5', webhookId: row.webhookId, eventId: '42:panic:0:r1', kind: 'panic', statusCode: 200, success: true, error: null, at: '2026-07-09T00:00:00.000Z' })
  })

  it('ACCOUNT-scopes an account caller (their account + tenant-shared), not just tenant (cross-account leak fix)', async () => {
    const { prisma, captured } = fakePrisma()
    await createWebhookDeliveryRepo(prisma).list({ tenantId: 'ten-1', accountId: 'acc-A' })
    // an account_manager must NOT see a sibling account's delivery rows: account-scoped +
    // null (tenant-shared) only — mirrors the webhooks repo (nullableAccount)
    expect(captured()!.where).toEqual({ tenantId: 'ten-1', accountId: { in: ['acc-A', null] } })
  })

  it('applies a valid webhookId filter but drops a malformed one', async () => {
    const { prisma, captured } = fakePrisma()
    await createWebhookDeliveryRepo(prisma).list({ tenantId: 't' }, { webhookId: 'aaaaaaaa-1111-1111-1111-111111111111' })
    expect(captured()!.where).toMatchObject({ webhookId: 'aaaaaaaa-1111-1111-1111-111111111111' })
    await createWebhookDeliveryRepo(prisma).list({ tenantId: 't' }, { webhookId: "'; DROP TABLE" })
    expect(captured()!.where).toEqual({ tenantId: 't' }) // garbage dropped, no filter
  })

  it('clamps take and only paginates on a numeric cursor', async () => {
    const { prisma, captured } = fakePrisma()
    await createWebhookDeliveryRepo(prisma).list({ tenantId: 't' }, { take: 99_999, cursor: 'abc' })
    expect(captured()!.take).toBe(500) // clamped
    expect(captured()!.cursor).toBeUndefined() // non-numeric cursor ignored
    await createWebhookDeliveryRepo(prisma).list({ tenantId: 't' }, { take: 0, cursor: '5' })
    expect(captured()!.take).toBe(1) // floored to 1
    expect(captured()!.cursor).toEqual({ id: 5n })
    expect(captured()!.skip).toBe(1)
  })

  it('pruneOlderThan batches until a partial batch and returns the total deleted', async () => {
    const returns = [2, 2, 1] // full, full, partial → stop
    let i = 0
    const executeRaw = vi.fn(() => Promise.resolve(returns[i++] ?? 0))
    const prisma = { $executeRaw: executeRaw } as unknown as PrismaClient
    const cutoff = new Date('2026-07-01T00:00:00.000Z')
    const total = await createWebhookDeliveryRepo(prisma).pruneOlderThan(cutoff, 2)
    expect(total).toBe(5)
    expect(executeRaw).toHaveBeenCalledTimes(3) // stopped on the partial batch (1 < 2)
  })

  it('pruneOlderThan stops immediately when the first batch is already partial (nothing old)', async () => {
    const executeRaw = vi.fn(() => Promise.resolve(0))
    const prisma = { $executeRaw: executeRaw } as unknown as PrismaClient
    const total = await createWebhookDeliveryRepo(prisma).pruneOlderThan(new Date(), 5_000)
    expect(total).toBe(0)
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })
})
