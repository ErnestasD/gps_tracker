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

  describe('partner auth (F5)', () => {
    it('findByEmailForAuth + setPassword; consumePwToken is single-use and expiry-guarded', async () => {
      const a = await db.affiliates.create(actor, { name: 'Auth Co', email: 'auth@partner.co', code: 'AUTHC1' })
      const found = await db.affiliates.findByEmailForAuth('auth@partner.co')
      expect(found).toMatchObject({ id: a.id, email: 'auth@partner.co', passwordHash: null, status: 'pending' })
      expect(await db.affiliates.findByEmailForAuth('nobody@partner.co')).toBeNull()

      await db.affiliates.setPassword(a.id, 'hash-value')
      expect((await db.affiliates.findByEmailForAuth('auth@partner.co'))?.passwordHash).toBe('hash-value')

      // a fresh token consumes ONCE
      const now = new Date()
      await db.affiliates.createPwToken(a.id, 'tokhash-1', new Date(now.getTime() + 3_600_000))
      expect(await db.affiliates.consumePwToken('tokhash-1', now)).toBe(a.id)
      expect(await db.affiliates.consumePwToken('tokhash-1', now)).toBeNull() // reused → no-op

      // an EXPIRED token never consumes
      await db.affiliates.createPwToken(a.id, 'tokhash-2', new Date(now.getTime() - 1_000))
      expect(await db.affiliates.consumePwToken('tokhash-2', now)).toBeNull()
      // an unknown token → null
      expect(await db.affiliates.consumePwToken('nope', now)).toBeNull()
    })
  })

  describe('accrueForPaidInvoice (F4 webhook path)', () => {
    it('accrues the partner cut for a referred tenant within the window, idempotently', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Win Co', email: 'win@partner.co', code: 'WINC1', commissionPct: 20, commissionMonths: 12 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Win Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_win')

      const now = new Date()
      const c = await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_win', invoiceId: 'in_win_1', amountPaidCents: 10_000, currency: 'eur', paidAt: now })
      expect(c?.amountCents).toBe(2_000) // 20% of 100.00
      expect(c?.affiliateId).toBe(aff.id)
      expect(c?.tenantId).toBe(tenant.id)
      // a duplicate invoice delivery is a no-op
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_win', invoiceId: 'in_win_1', amountPaidCents: 10_000, currency: 'eur', paidAt: now })).toBeNull()
      expect(await db.affiliates.listCommissions(aff.id)).toHaveLength(1)
    })

    it('windows from the FIRST payment: the first always accrues; a later one past commissionMonths does not', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Exp Co', email: 'exp@partner.co', code: 'EXPC1', commissionMonths: 6 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Exp Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_exp')
      // the FIRST payment always accrues (a trial delaying it must NOT shrink the window)
      const firstPaidAt = new Date(Date.now() + 2 * 31 * 24 * 3600 * 1000) // 2 months after signup
      const c1 = await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_exp', invoiceId: 'in_exp_1', amountPaidCents: 10_000, currency: 'eur', paidAt: firstPaidAt })
      expect(c1?.amountCents).toBe(2_000)
      // a payment 7 months AFTER the first is outside the 6-month window (anchored on the first)
      const late = new Date(c1!.createdAt.getTime() + 7 * 31 * 24 * 3600 * 1000)
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_exp', invoiceId: 'in_exp_2', amountPaidCents: 10_000, currency: 'eur', paidAt: late })).toBeNull()
    })

    it('resolves a referral code case-insensitively (?ref=whook1 → stored WHOOK1)', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Case Co', email: 'case@partner.co', code: 'WHOOK1' })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      expect((await db.affiliates.getActiveByCode('whook1'))?.id).toBe(aff.id)
      expect((await db.affiliates.getActiveByCode('WhOoK1'))?.id).toBe(aff.id)
    })

    it('matches EXACTLY — LIKE wildcards in a ?ref never hijack another partner (review HIGH)', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Wild Co', email: 'wild@partner.co', code: 'AUTUMN1' })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      // `_` is a LIKE single-char wildcard and `%` matches anything — under the old ILIKE lookup
      // `AUTUMN_` matched AUTUMN1 and credited a partner the visitor never referenced. Attribution is
      // now reachable anonymously (public signup), so this is real commission money.
      expect(await db.affiliates.getActiveByCode('AUTUMN_')).toBeNull()
      expect(await db.affiliates.getActiveByCode('______')).toBeNull()
      expect(await db.affiliates.getActiveByCode('%')).toBeNull()
      expect(await db.affiliates.getActiveByCode('AUTUMN%')).toBeNull()
      expect((await db.affiliates.getActiveByCode('autumn1'))?.id).toBe(aff.id) // the real code still resolves
    })

    it('rejects a second affiliate whose code differs only by case (functional unique index)', async () => {
      await db.affiliates.create(actor, { name: 'Dup A', email: 'dupa@partner.co', code: 'PROMO9' })
      await expect(db.affiliates.create(actor, { name: 'Dup B', email: 'dupb@partner.co', code: 'promo9' })).rejects.toThrow()
    })

    it('floors a fractional commission rate in the platform’s favour', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Frac Co', email: 'frac@partner.co', code: 'FRACC1', commissionPct: 33.33, commissionMonths: 12 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Frac Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_frac')
      // 33.33% of 100.00 = 33.33 → floor to 3333 cents
      const c = await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_frac', invoiceId: 'in_frac_1', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })
      expect(c?.amountCents).toBe(3_333)
    })

    it('does NOT accrue for an unreferred tenant, a suspended affiliate, or a $0 invoice', async () => {
      // unreferred tenant
      const plain = await db.tenants.create(actor, { name: 'Plain Tenant' })
      await db.tenants.setStripeCustomer(plain.id, 'cus_plain')
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_plain', invoiceId: 'in_p_1', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })).toBeNull()
      // unknown customer
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_nope', invoiceId: 'in_x', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })).toBeNull()
      // suspended affiliate ⇒ commissions stop
      const aff = await db.affiliates.create(actor, { name: 'Sus Co', email: 'sus@partner.co', code: 'SUSC1' })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Sus Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_sus')
      await db.affiliates.update(actor, aff.id, { status: 'suspended' })
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_sus', invoiceId: 'in_sus_1', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })).toBeNull()
    })
  })
})
