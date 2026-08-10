import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { sendAuthEmail } from '../src/jobs/authEmailWorker.js'
import type { AuthEmailJob, PasswordResetEmailJob } from '../src/jobs/authEmailQueue.js'
import { renderResetEmail } from '../src/notify/passwordResetEmail.js'

const job = (over: Partial<PasswordResetEmailJob> = {}): AuthEmailJob => ({
  kind: 'password-reset',
  email: 'u@orbetra.test',
  tenantId: 't1',
  locale: 'en',
  resetUrl: 'https://app.orbetra.test/reset-password?token=abc123',
  expiresMinutes: 60,
  ...over,
})

describe('renderResetEmail', () => {
  it('embeds the reset link in both the HTML button and the plain-text body', () => {
    const { html, text, subject } = renderResetEmail({ resetUrl: 'https://app.orbetra.test/reset-password?token=abc123', expiresMinutes: 60, locale: 'en', brand: 'Orbetra' })
    expect(subject).toBe('Reset your password')
    expect(html).toContain('href="https://app.orbetra.test/reset-password?token=abc123"')
    expect(text).toContain('https://app.orbetra.test/reset-password?token=abc123')
    expect(text).toContain('60')
  })

  it('localizes the subject (lt/de/pl) and falls back to en for an unknown locale', () => {
    expect(renderResetEmail({ resetUrl: 'https://x/y', expiresMinutes: 60, locale: 'lt', brand: 'B' }).subject).toBe('Atstatykite slaptažodį')
    expect(renderResetEmail({ resetUrl: 'https://x/y', expiresMinutes: 60, locale: 'de', brand: 'B' }).subject).toBe('Passwort zurücksetzen')
    expect(renderResetEmail({ resetUrl: 'https://x/y', expiresMinutes: 60, locale: 'pl', brand: 'B' }).subject).toBe('Zresetuj hasło')
    expect(renderResetEmail({ resetUrl: 'https://x/y', expiresMinutes: 60, locale: 'xx', brand: 'B' }).subject).toBe('Reset your password')
  })

  it('escapes a hostile reset URL so it cannot break out of the href/text', () => {
    const evil = 'https://app.orbetra.test/reset-password?token=a"><script>x'
    const { html } = renderResetEmail({ resetUrl: evil, expiresMinutes: 60, locale: 'en', brand: 'Orbetra' })
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })
})

describe('sendAuthEmail', () => {
  /**
   * Answers PER QUERY, not one canned row for everything.
   *
   * It used to return `{ name, branding }` to any SQL at all, which quietly made the new
   * suppression check ("is this address dead?") answer YES for every message — the branding test
   * failed with `expected false to be true` and told you nothing about why. A stub that agrees with
   * every question cannot catch a caller asking a new one.
   */
  const fakePool = (branding: unknown = null, suppressed = false): Pool =>
    ({
      query: (sql: string) =>
        Promise.resolve(
          sql.includes('email_suppressions')
            ? { rows: suppressed ? [{ address: 'x' }] : [], rowCount: suppressed ? 1 : 0 }
            : { rows: [{ name: 'Acme Fleet', branding }], rowCount: 1 },
        ),
    }) as unknown as Pool

  it('never mails an address SES told us is dead', async () => {
    // the whole point of the bounce feedback loop: one send path, checked once, so no producer can
    // forget. A suppressed address is a no-op — not a retry, and not a bounce we pay for again.
    const send = vi.fn<(to: string, subject: string, text: string, html?: string) => Promise<void>>(() => Promise.resolve())
    const sent = await sendAuthEmail({ pool: fakePool(null, true), transport: { send } }, job())
    expect(sent).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('renders the branded message and sends it via the transport', async () => {
    const send = vi.fn<(to: string, subject: string, text: string, html?: string) => Promise<void>>(() => Promise.resolve())
    const sent = await sendAuthEmail({ pool: fakePool({ productName: 'AcmeTrack', primary: '#112233' }), transport: { send } }, job())
    expect(sent).toBe(true)
    expect(send).toHaveBeenCalledOnce()
    const [to, subject, text, html] = send.mock.calls[0]!
    expect(to).toBe('u@orbetra.test')
    expect(subject).toBe('Reset your password')
    expect(text).toContain('AcmeTrack') // white-label brand in the plain-text footer
    expect(html).toContain('AcmeTrack')
  })

  it('is a no-op (no throw) when the transport is not configured', async () => {
    const sent = await sendAuthEmail({ pool: fakePool(), transport: undefined }, job())
    expect(sent).toBe(false)
  })
})
