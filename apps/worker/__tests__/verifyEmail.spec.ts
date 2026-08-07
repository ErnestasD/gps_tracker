import { describe, expect, it } from 'vitest'

import { renderVerifyEmail } from '../src/notify/verifyEmail.js'

/**
 * The mail that ACTIVATES a self-serve signup (audit MED #67). It is not a convenience: until its
 * link is clicked the account cannot authenticate at all, which is what stops signup's free branch
 * from answering "does this address exist" through a follow-up login.
 */
const base = { verifyUrl: 'https://app.orbetra.test/verify-email?token=abc123', expiresHours: 48, brand: 'Orbetra' }

describe('renderVerifyEmail', () => {
  it('carries the activation link in both the HTML button and the plain-text body', () => {
    const { html, text, subject } = renderVerifyEmail({ ...base, locale: 'en' })
    expect(subject).toMatch(/activate/i)
    for (const body of [html, text]) expect(body).toContain('https://app.orbetra.test/verify-email?token=abc123')
  })

  it('says the account is UNUSABLE until the link is clicked — the recipient must not wait for nothing', () => {
    const { text } = renderVerifyEmail({ ...base, locale: 'en' })
    expect(text).toMatch(/cannot be signed in to/i)
    expect(text).toContain('48 hours')
  })

  it('tells a recipient who did NOT sign up that ignoring it is safe and self-cleaning', () => {
    // a stranger can type anyone's address, so this mail reaches people who did nothing
    const { text } = renderVerifyEmail({ ...base, locale: 'en' })
    expect(text).toMatch(/didn't sign up/i)
    expect(text).toMatch(/removed by itself/i)
  })

  it('localizes to the four shipped languages and falls back to en', () => {
    expect(renderVerifyEmail({ ...base, locale: 'lt' }).subject).toContain('aktyvuotumėte')
    expect(renderVerifyEmail({ ...base, locale: 'de' }).subject).toContain('aktivieren')
    expect(renderVerifyEmail({ ...base, locale: 'pl' }).subject).toContain('aktywować')
    expect(renderVerifyEmail({ ...base, locale: 'xx' }).subject).toMatch(/activate/i)
  })

  it('escapes tenant-supplied branding and a hostile URL', () => {
    const { html } = renderVerifyEmail({
      ...base,
      verifyUrl: 'https://app.test/verify-email?token="><script>alert(1)</script>',
      locale: 'en',
      brand: '<script>alert(1)</script>',
      tenantName: '<img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
  })

  it('honours a valid branding accent and ignores a malformed one', () => {
    expect(renderVerifyEmail({ ...base, locale: 'en', branding: { primary: '#123ABC' } }).html).toContain('#123ABC')
    expect(renderVerifyEmail({ ...base, locale: 'en', branding: { primary: 'red; }' } }).html).toContain('#5253DA') // the product accent, same as --accent in the app
  })
})

describe('the activation mail is OURS, not the recipient’s own company', () => {
  it('a self-serve tenant name never becomes the brand — that reads like phishing', async () => {
    // `brand = productName ?? tenantName`, and a self-serve tenant is named after the company the
    // customer just typed. So the first mail we ever send them — the one asking them to click a link
    // — was headed with THEIR OWN company name.
    const { sendAuthEmail } = await import('../src/jobs/authEmailWorker.js')
    const sent: { subject: string; html: string }[] = []
    const pool = { query: () => Promise.resolve({ rows: [{ name: "Jonas's fleet", branding: {} }] }) } as unknown as Parameters<typeof sendAuthEmail>[0]['pool']
    const transport = { send: (_to: string, subject: string, _text: string, html: string) => { sent.push({ subject, html }); return Promise.resolve() } }
    await sendAuthEmail({ pool, transport }, {
      kind: 'verify-email',
      email: 'jonas@fleet.test',
      tenantId: '00000000-0000-0000-0000-0000000000aa',
      locale: 'en',
      verifyUrl: 'https://app.orbetra.test/verify-email?token=abc',
      expiresHours: 48,
    })
    expect(sent[0]!.html).toContain('Orbetra')
    expect(sent[0]!.html).not.toContain("Jonas's fleet")
  })

  it('…but a real WHITE-LABEL product name still wins — a TSP’s end user must never see ours', async () => {
    const { sendAuthEmail } = await import('../src/jobs/authEmailWorker.js')
    const sent: { html: string }[] = []
    const pool = { query: () => Promise.resolve({ rows: [{ name: 'Reseller UAB', branding: { productName: 'FleetPro' } }] }) } as unknown as Parameters<typeof sendAuthEmail>[0]['pool']
    const transport = { send: (_to: string, _s: string, _t: string, html: string) => { sent.push({ html }); return Promise.resolve() } }
    await sendAuthEmail({ pool, transport }, {
      kind: 'verify-email',
      email: 'end@user.test',
      tenantId: '00000000-0000-0000-0000-0000000000bb',
      locale: 'en',
      verifyUrl: 'https://app.example/verify-email?token=abc',
      expiresHours: 48,
    })
    expect(sent[0]!.html).toContain('FleetPro')
    expect(sent[0]!.html).not.toContain('Orbetra')
  })
})

/**
 * Every auth link is built by the API from the single global APP_BASE_URL, so a white-label mail
 * kept its promise and then opened a page that broke it: dash.orbetra.com resolves as NOT
 * white-labelled, so it shows our wordmark and (since the AuthShell change) a link to orbetra.com —
 * on the one screen a reseller's customers are guaranteed to reach.
 */
describe('auth links land on the TENANT\u2019s host when it has one', () => {
  /** a pool that answers the branding SELECT and the tenant_domains SELECT differently */
  const poolWith = (domains: { domain: string }[], branding: Record<string, unknown> = { productName: 'FleetPro' }) =>
    ({
      query: (sql: string) =>
        Promise.resolve({ rows: sql.includes('tenant_domains') ? domains : [{ name: 'Reseller UAB', branding }] }),
    }) as unknown as Parameters<typeof import('../src/jobs/authEmailWorker.js').sendAuthEmail>[0]['pool']

  const send = async (pool: unknown, verifyUrl: string) => {
    const { sendAuthEmail } = await import('../src/jobs/authEmailWorker.js')
    const sent: string[] = []
    const transport = { send: (_to: string, _s: string, text: string) => { sent.push(text); return Promise.resolve() } }
    await sendAuthEmail({ pool: pool as never, transport }, {
      kind: 'verify-email', email: 'end@user.test', tenantId: '00000000-0000-0000-0000-0000000000bb',
      locale: 'en', verifyUrl, expiresHours: 48,
    })
    return sent[0]!
  }

  it('swaps the ORIGIN and keeps the token untouched', async () => {
    const text = await send(poolWith([{ domain: 'fleet.reseller.lt' }]), 'http://dash.orbetra.test/verify-email?token=abc123')
    expect(text).toContain('https://fleet.reseller.lt/verify-email?token=abc123')
    expect(text).not.toContain('dash.orbetra.test')
  })

  it('picks the OLDEST verified domain, so the link is stable as a tenant adds more', async () => {
    // the query orders by createdAt asc and takes one; this pins that the FIRST row is used
    const text = await send(poolWith([{ domain: 'first.reseller.lt' }, { domain: 'later.reseller.lt' }]), 'https://dash.orbetra.test/verify-email?token=t')
    expect(text).toContain('first.reseller.lt')
    expect(text).not.toContain('later.reseller.lt')
  })

  it('keeps the platform link when the tenant has NO verified domain', async () => {
    const text = await send(poolWith([]), 'https://dash.orbetra.test/verify-email?token=t')
    expect(text).toContain('https://dash.orbetra.test/verify-email?token=t')
  })

  it('a lookup fault or an unparseable link never costs the mail its link', async () => {
    const dead = { query: (sql: string) => (sql.includes('tenant_domains') ? Promise.reject(new Error('pool down')) : Promise.resolve({ rows: [{ name: 'R', branding: {} }] })) }
    expect(await send(dead, 'https://dash.orbetra.test/verify-email?token=t')).toContain('https://dash.orbetra.test/verify-email?token=t')
    const { onTenantHost } = await import('../src/jobs/authEmailWorker.js')
    expect(onTenantHost('not a url', 'fleet.reseller.lt')).toBe('not a url')
    expect(onTenantHost('https://a.test/x', null)).toBe('https://a.test/x')
  })
})
