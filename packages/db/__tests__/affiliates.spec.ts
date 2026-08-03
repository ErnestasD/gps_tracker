import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

/**
 * Affiliate program repo (W9). Proves the migration applies and the core management + attribution +
 * commission-accrual flows: create → activate → attribute by code (only ACTIVE codes) → accrue a
 * commission idempotently on the source invoice → mark it paid.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actor = { userId: '00000000-0000-0000-0000-00000000000f' }

let container: StartedTestContainer
let db: Db

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  db = createDb(url)
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

describe('affiliates repo', () => {
  it('creates an affiliate with a referral code + default commission terms', async () => {
    const a = await db.affiliates.create(actor, { name: 'Acme Partners', email: 'acme@partner.co', code: 'ACME10' })
    expect(a.status).toBe('pending')
    expect(Number(a.commissionPct)).toBe(20)
    expect(a.commissionMonths).toBe(12)
    expect((await db.affiliates.get(a.id))?.email).toBe('acme@partner.co')
  })

  it('throws a typed AffiliateConflictError naming the clashing field (email vs code)', async () => {
    await db.affiliates.create(actor, { name: 'Uniq', email: 'uniq@partner.co', code: 'UNIQ1' })
    // a duplicate email → field 'email' (a real DB fault would instead propagate, not masquerade as 409)
    await expect(db.affiliates.create(actor, { name: 'X', email: 'uniq@partner.co', code: 'OTHER1' }))
      .rejects.toMatchObject({ name: 'AffiliateConflictError', field: 'email' })
    // a duplicate code → field 'code' (the route retries an AUTO-generated code clash on this signal)
    await expect(db.affiliates.create(actor, { name: 'X', email: 'other@partner.co', code: 'UNIQ1' }))
      .rejects.toMatchObject({ name: 'AffiliateConflictError', field: 'code' })
  })

  it('getActiveByCode attributes ONLY an active affiliate (pending/suspended never attribute)', async () => {
    const a = await db.affiliates.create(actor, { name: 'Beta', email: 'beta@partner.co', code: 'BETA20', commissionPct: 25, commissionMonths: 6 })
    // pending → no attribution
    expect(await db.affiliates.getActiveByCode('BETA20')).toBeNull()
    await db.affiliates.update(actor, a.id, { status: 'active' })
    const found = await db.affiliates.getActiveByCode('BETA20')
    expect(found?.id).toBe(a.id)
    expect(Number(found?.commissionPct)).toBe(25)
    // suspended → attribution stops
    await db.affiliates.update(actor, a.id, { status: 'suspended' })
    expect(await db.affiliates.getActiveByCode('BETA20')).toBeNull()
  })

  it('accrues a commission idempotently on the source invoice and marks it paid', async () => {
    const aff = await db.affiliates.create(actor, { name: 'Ref Co', email: 'ref@partner.co', code: 'REF30' })
    // a referred tenant generates the payment
    const tenant = await db.tenants.create(actor, { name: 'Referred Tenant' })

    const c1 = await db.affiliates.accrueCommission({ affiliateId: aff.id, tenantId: tenant.id, amountCents: 300, currency: 'eur', sourceInvoiceId: 'in_123' })
    expect(c1?.amountCents).toBe(300)
    expect(c1?.status).toBe('pending')
    // a duplicate webhook delivery for the SAME invoice must NOT double-accrue
    const dup = await db.affiliates.accrueCommission({ affiliateId: aff.id, tenantId: tenant.id, amountCents: 300, currency: 'eur', sourceInvoiceId: 'in_123' })
    expect(dup).toBeNull()
    expect(await db.affiliates.listCommissions(aff.id)).toHaveLength(1)

    const paid = await db.affiliates.setCommissionStatus(c1!.id, 'paid')
    expect(paid?.status).toBe('paid')
  })
})
