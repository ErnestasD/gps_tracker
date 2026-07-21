import { SMS_STATUSES } from '@orbetra/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the auth'd request core so the lib functions can be asserted for URL/method/body shape
// without a live API (mirrors how the app's lib layer is unit-tested).
const { mutate, getJson } = vi.hoisted(() => ({ mutate: vi.fn(), getJson: vi.fn() }))
vi.mock('../src/lib/client.js', () => ({ mutate, getJson }))

const { sendConfigSms, listSmsDeliveries, hasPendingSms, smsStatusVariant, canSendConfigSms } = await import('../src/lib/sms.js')

afterEach(() => {
  mutate.mockReset()
  getJson.mockReset()
})

describe('SMS gateway UI helpers', () => {
  it('hasPendingSms drives the poll: true only while something is queued', () => {
    expect(hasPendingSms([])).toBe(false)
    expect(hasPendingSms([{ status: 'sent' }, { status: 'failed' }])).toBe(false)
    expect(hasPendingSms([{ status: 'sent' }, { status: 'queued' }])).toBe(true)
  })

  it('maps delivery statuses to badge variants (queued neutral, sent success, failed danger)', () => {
    expect(smsStatusVariant('queued')).toBe('outline')
    expect(smsStatusVariant('sent')).toBe('success')
    expect(smsStatusVariant('failed')).toBe('danger')
    expect(smsStatusVariant('garbage')).toBe('outline') // unknown → neutral, never throws
  })

  it('badge helper covers every shared status without throwing', () => {
    for (const st of SMS_STATUSES) expect(['outline', 'success', 'danger']).toContain(smsStatusVariant(st))
  })

  it('canSendConfigSms: only when the platform SMS is enabled AND a SIM number is set', () => {
    expect(canSendConfigSms(true, '+37060000000')).toBe(true)
    expect(canSendConfigSms(false, '+37060000000')).toBe(false) // platform SMS off → hidden
    expect(canSendConfigSms(undefined, '+37060000000')).toBe(false) // response not loaded / WP-C absent
    expect(canSendConfigSms(true, null)).toBe(false) // no SIM saved → hidden
    expect(canSendConfigSms(true, '   ')).toBe(false) // blank/whitespace → hidden
  })
})

describe('SMS gateway request shapes', () => {
  it('sendConfigSms POSTs to the device sms endpoint, threading the APN', () => {
    void sendConfigSms('42', { apn: 'internet' })
    expect(mutate).toHaveBeenCalledWith('POST', '/v1/devices/42/sms', { apn: 'internet' })
  })

  it('sendConfigSms sends an empty body when no options are given', () => {
    void sendConfigSms('42')
    expect(mutate).toHaveBeenCalledWith('POST', '/v1/devices/42/sms', {})
  })

  it('listSmsDeliveries GETs the device sms endpoint', () => {
    void listSmsDeliveries('42')
    expect(getJson).toHaveBeenCalledWith('/v1/devices/42/sms')
  })
})
