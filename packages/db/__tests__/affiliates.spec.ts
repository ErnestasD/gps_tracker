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

    const paid = await db.affiliates.setCommissionStatus(actor, c1!.id, 'paid')
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
      // a payment 7 months AFTER the first PAYMENT is outside the 6-month window. Measured from
      // firstPaidAt (Stripe's clock — the anchor), never from the row's createdAt: that is the DB
      // insert time, which drifts with webhook lag and would silently extend the window.
      const late = new Date(firstPaidAt.getTime() + 7 * 31 * 24 * 3600 * 1000)
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

    it('SNAPSHOTS the terms with the entry — editing the affiliate never re-prices history (§6.9)', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Snap Co', email: 'snap@partner.co', code: 'SNAPC1', commissionPct: 20, commissionMonths: 12 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Snap Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_snap')
      const paidAt = new Date()
      const c = await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_snap', invoiceId: 'in_snap_1', amountPaidCents: 10_000, currency: 'eur', paidAt })
      expect(c?.amountCents).toBe(2_000)
      expect(Number(c?.ratePct)).toBe(20) // the rate AGREED at accrual
      expect(c?.baseAmountCents).toBe(10_000) // the payment it was computed from
      expect(c?.paidAt?.getTime()).toBe(paidAt.getTime()) // Stripe's clock, not the DB insert time
      // raising the rate later must NOT change what was already earned
      await db.affiliates.update(actor, aff.id, { commissionPct: 90 })
      const stored = (await db.affiliates.listCommissions(aff.id))[0]
      expect(stored?.amountCents).toBe(2_000)
      expect(Number(stored?.ratePct)).toBe(20)
    })

    it('the earning window anchors on the FIRST PAYMENT time, not the row insert time', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Anchor Co', email: 'anchor@partner.co', code: 'ANCHR1', commissionMonths: 6 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Anchor Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_anchor')
      // the first payment happened well in the PAST (a delayed/replayed webhook writes the row now)
      const firstPaid = new Date(Date.now() - 5 * 31 * 24 * 3_600_000)
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_anchor', invoiceId: 'in_a1', amountPaidCents: 10_000, currency: 'eur', paidAt: firstPaid })).not.toBeNull()
      // 7 months after that FIRST PAYMENT is outside the 6-month window — anchoring on createdAt
      // (which is NOW) would have wrongly extended the window and over-paid
      const late = new Date(firstPaid.getTime() + 7 * 31 * 24 * 3_600_000)
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_anchor', invoiceId: 'in_a2', amountPaidCents: 10_000, currency: 'eur', paidAt: late })).toBeNull()
    })

    it('anchors on the first PAYMENT even when it accrued NOTHING (audit MED #26)', async () => {
      // the anchor used to be the earliest COMMISSION ROW, so any first payment that produced no row
      // — partner still `pending`, a 100%-off coupon, a 0% rate — silently restarted the window at
      // whichever later payment first accrued. Here the partner is suspended for the first payment
      // and reinstated for the second: under the old rule the second payment became the anchor and
      // bought a fresh full term on a customer the window should already have been counting.
      const aff = await db.affiliates.create(actor, { name: 'Late Co', email: 'late@partner.co', code: 'LATEC1', commissionMonths: 6 })
      const tenant = await db.tenants.create(actor, { name: 'Late Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_late')
      const first = new Date(Date.UTC(2026, 0, 10))
      // partner is `pending` → nothing accrues, but the window still starts here
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_late', invoiceId: 'in_late_1', amountPaidCents: 10_000, currency: 'eur', paidAt: first })).toBeNull()
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      // month 3 — inside the 6-month window measured from the FIRST payment
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_late', invoiceId: 'in_late_2', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date(Date.UTC(2026, 3, 10)) })).not.toBeNull()
      // month 8 — outside it. Anchoring on the first ACCRUAL (month 3) would have paid this.
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_late', invoiceId: 'in_late_3', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date(Date.UTC(2026, 8, 10)) })).toBeNull()
    })

    it('SNAPSHOTS commissionMonths too — an admin edit cannot re-open a closed window (audit MED #26)', async () => {
      // `ratePct` was snapshotted and the TERM was not, so editing commissionMonths re-priced history
      // in both directions: 6 → 24 restarted paying on customers whose window closed a year ago.
      const aff = await db.affiliates.create(actor, { name: 'Term Co', email: 'term@partner.co', code: 'TERMC1', commissionMonths: 6 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Term Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_term')
      const first = new Date(Date.UTC(2026, 0, 10))
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_term', invoiceId: 'in_term_1', amountPaidCents: 10_000, currency: 'eur', paidAt: first })).not.toBeNull()
      const monthNine = new Date(Date.UTC(2026, 9, 10))
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_term', invoiceId: 'in_term_2', amountPaidCents: 10_000, currency: 'eur', paidAt: monthNine })).toBeNull()
      // widening the term now must NOT retroactively re-open that closed window
      await db.affiliates.update(actor, aff.id, { commissionMonths: 24 })
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_term', invoiceId: 'in_term_3', amountPaidCents: 10_000, currency: 'eur', paidAt: monthNine })).toBeNull()
      // …and narrowing it must not retroactively close a window the partner is still inside
      await db.affiliates.update(actor, aff.id, { commissionMonths: 1 })
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_term', invoiceId: 'in_term_4', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date(Date.UTC(2026, 4, 10)) })).not.toBeNull()
    })

    it('an EARLIER payment delivered late moves the anchor BACK, never forward', async () => {
      // webhook reordering / an ops backfill: if the anchor could only ever be the first row seen,
      // a late-delivered older invoice would leave the window starting after a payment we know about
      const aff = await db.affiliates.create(actor, { name: 'Order Co', email: 'order@partner.co', code: 'ORDRC1', commissionMonths: 6 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Order Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_order')
      // the MARCH invoice is delivered first…
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_order', invoiceId: 'in_ord_mar', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date(Date.UTC(2026, 2, 10)) })).not.toBeNull()
      // …then JANUARY's arrives, which is the real first payment
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_order', invoiceId: 'in_ord_jan', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date(Date.UTC(2026, 0, 10)) })).not.toBeNull()
      // the window now runs Jan→Jul: August is outside. Had the anchor stayed on March it would
      // have paid through September.
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_order', invoiceId: 'in_ord_aug', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date(Date.UTC(2026, 7, 20)) })).toBeNull()
    })

    it('CONCURRENT first invoices still anchor on the EARLIER payment', async () => {
      // the claim is conditional, so one of the two wins and the other adopts its anchor — and if the
      // loser is the earlier payment, adopting alone leaves the window pinned to the LATER one and the
      // partner earns past the agreed term. Measured before the fix: 2 of 3 races kept March.
      const aff = await db.affiliates.create(actor, { name: 'Race Co', email: 'race@partner.co', code: 'RACEC1', commissionMonths: 6 })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Race Tenant', referredByAffiliateId: aff.id })
      await db.tenants.setStripeCustomer(tenant.id, 'cus_race')
      const jan = new Date(Date.UTC(2026, 0, 10))
      const mar = new Date(Date.UTC(2026, 2, 10))
      await Promise.all([
        db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_race', invoiceId: 'in_race_mar', amountPaidCents: 10_000, currency: 'eur', paidAt: mar }),
        db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_race', invoiceId: 'in_race_jan', amountPaidCents: 10_000, currency: 'eur', paidAt: jan }),
      ])
      // whichever won the claim, the anchor must end up on January
      const row = await db.tenants.get(tenant.id)
      expect(row?.commissionAnchorAt?.toISOString()).toBe(jan.toISOString())
      // …so an August invoice is outside the 6-month window. Anchored on March it would have paid.
      expect(await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_race', invoiceId: 'in_race_aug', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date(Date.UTC(2026, 7, 20)) })).toBeNull()
    })

    it('a tenant carrying commissions cannot be hard-deleted — the ledger survives (audit HIGH)', async () => {
      const aff = await db.affiliates.create(actor, { name: 'Ledger Co', email: 'ledger@partner.co', code: 'LEDGR1' })
      await db.affiliates.update(actor, aff.id, { status: 'active' })
      const tenant = await db.tenants.create(actor, { name: 'Ledger Tenant', referredByAffiliateId: aff.id })
      await db.affiliates.accrueCommission({ affiliateId: aff.id, tenantId: tenant.id, amountCents: 500, currency: 'eur', sourceInvoiceId: 'in_ledger_1' })
      await expect(db.tenants.remove(actor, tenant.id)).rejects.toMatchObject({ name: 'TenantHasCommissionsError' })
      expect(await db.affiliates.listCommissions(aff.id)).toHaveLength(1) // the money record is still there
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

  it('a mixed-case email is normalized on write and resolves at login (audit MED)', async () => {
    // `email` is a case-sensitive @unique and `create` stored whatever was submitted, but the login
    // handler lowercases before the lookup — so a partner created as `Jonas@Partner.lt` (the natural
    // form pasted from a contract) could set a password via the emailed link and then NEVER log in.
    // The tenant-user path already normalized on write; this one was missed on both sides.
    const a = await db.affiliates.create(actor, { name: 'Mixed Case', email: 'Jonas@Partner.LT', code: 'MIXED1' })
    expect(a.email).toBe('jonas@partner.lt')
    expect((await db.affiliates.findByEmailForAuth('jonas@partner.lt'))?.id).toBe(a.id)
    // …and the lookup itself is case-insensitive, so rows written before the migration also resolve
    expect((await db.affiliates.findByEmailForAuth('JONAS@partner.lt'))?.id).toBe(a.id)
  })
})
