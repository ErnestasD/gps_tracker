import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { sendAuthEmail } from '../src/jobs/authEmailWorker.js'
import type { AuthEmailJob } from '../src/jobs/authEmailQueue.js'
import { renderResetEmail } from '../src/notify/passwordResetEmail.js'

const job = (over: Partial<AuthEmailJob> = {}): AuthEmailJob => ({
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
  const fakePool = (branding: unknown = null): Pool =>
    ({ query: () => Promise.resolve({ rows: [{ name: 'Acme Fleet', branding }], rowCount: 1 }) }) as unknown as Pool

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
