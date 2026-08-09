import { describe, expect, it } from 'vitest'

import { sendAuthEmail } from '../src/jobs/authEmailWorker.js'
import { renderPartnerEmail } from '../src/notify/partnerEmail.js'

/**
 * A partner heard nothing before this existed. The two things that matter about these mails:
 * they say something true, and they are OURS — never dressed in a tenant's white label.
 */
describe('renderPartnerEmail', () => {
  it('names the customer on a referral and the amount on a commission', () => {
    const ref = renderPartnerEmail({ kind: 'referral', customer: 'Vilnius Logistics', portalUrl: 'https://orbetra.com/partner/dashboard', locale: 'en' })
    expect(ref.subject).toBe('Vilnius Logistics signed up through your link')
    expect(ref.html).toContain('Vilnius Logistics')
    // the referral mail must NOT imply money — nothing is owed until they pay
    expect(ref.text).toContain('commission starts when they pay')

    const com = renderPartnerEmail({ kind: 'commission', customer: 'Vilnius Logistics', amount: '€90.00', portalUrl: 'https://orbetra.com/partner/dashboard', locale: 'en' })
    expect(com.subject).toBe('You earned €90.00')
    expect(com.text).toContain('€90.00')
  })

  it('degrades to the referral wording rather than saying "You earned undefined"', () => {
    const broken = renderPartnerEmail({ kind: 'commission', customer: 'Acme', portalUrl: 'https://x/p', locale: 'en' })
    expect(broken.subject).not.toContain('undefined')
    expect(broken.subject).toBe('Acme signed up through your link')
  })

  it('escapes a customer name — the company field is user input', () => {
    const evil = renderPartnerEmail({ kind: 'referral', customer: '<script>alert(1)</script>', portalUrl: 'https://x/p', locale: 'en' })
    expect(evil.html).not.toContain('<script>')
    expect(evil.html).toContain('&lt;script&gt;')
  })

  it('renders in all four languages', () => {
    for (const locale of ['en', 'lt', 'de', 'pl']) {
      const m = renderPartnerEmail({ kind: 'commission', customer: 'Acme', amount: '€10.00', portalUrl: 'https://x/p', locale })
      expect(m.subject).toContain('€10.00')
      expect(m.html).toContain('https://x/p')
    }
    // an unknown locale falls back to English rather than rendering nothing
    expect(renderPartnerEmail({ kind: 'referral', customer: 'Acme', portalUrl: 'https://x/p', locale: 'fr' }).subject).toContain('signed up')
  })
})

describe('a partner mail is never dressed in a tenant’s brand', () => {
  it('short-circuits branding resolution — no tenant lookup, no white label, no support-email swap', async () => {
    const sent: { to: string; subject: string; html: string; support?: string | undefined }[] = []
    // If branding resolution ran, it would query this pool. A query is therefore a FAILURE: the
    // partner's address may also belong to a tenant user, and resolving it would both sign our
    // partner notice with a reseller's name and tell the partner which tenant that is.
    const pool = {
      query: () => {
        throw new Error('a partner mail must not resolve tenant branding')
      },
    } as never
    const transport = {
      send: (to: string, subject: string, _text: string, html: string, support?: string) => {
        sent.push({ to, subject, html, support })
        return Promise.resolve()
      },
    }

    const ok = await sendAuthEmail({ pool, transport }, {
      kind: 'partner',
      event: 'commission',
      email: 'partner@example.lt',
      tenantId: '', // the worker must not try to fill this in
      locale: 'lt',
      customer: 'Demo Logistics',
      amount: '90,00 €',
      portalUrl: 'https://orbetra.com/partner/dashboard',
    })

    expect(ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.support).toBeUndefined() // replies come to us, not a reseller's support desk
    expect(sent[0]?.html).toContain('Orbetra')
    expect(sent[0]?.subject).toContain('90,00 €')
  })

  it('a job that lost its recipient is a logged no-op, not a TypeError that dead-letters', async () => {
    // `to.split(...)` on undefined threw, BullMQ retried five times, and the message was gone with
    // nothing but a TypeError to say which account had been stranded. One such corpse sat in the
    // staging queue for three days before an audit found it.
    let sent = 0
    const transport = {
      send: (to: string) => {
        sent += 1
        void to
        return Promise.resolve()
      },
    }
    const ok = await sendAuthEmail({ pool: {} as never, transport }, {
      kind: 'partner',
      event: 'referral',
      // the field the corrupted job was missing
      email: undefined as unknown as string,
      tenantId: '',
      locale: 'en',
      customer: 'Acme',
      portalUrl: 'https://orbetra.com/partner/dashboard',
    })
    expect(ok).toBe(true) // handled, not thrown
    expect(sent).toBe(1) // the transport decides; it skips and logs rather than exploding
  })

  it('is a no-op, not a retry, when no transport is configured', async () => {
    const ok = await sendAuthEmail({ pool: {} as never, transport: undefined }, {
      kind: 'partner',
      event: 'referral',
      email: 'partner@example.lt',
      tenantId: '',
      locale: 'en',
      customer: 'Acme',
      portalUrl: 'https://orbetra.com/partner/dashboard',
    })
    expect(ok).toBe(false)
  })
})
