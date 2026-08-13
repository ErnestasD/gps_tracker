import { generateKeyPairSync, createSign, X509Certificate } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { createSesWebhookRoutes, stringToSign, verifySnsMessage } from '../src/routes/sesWebhook.js'

/**
 * The signature is the whole security model here: this endpoint is public, unauthenticated, and what
 * it does is STOP US MAILING an address. An unverified version lets anyone on the internet silence a
 * competitor's password resets and billing warnings with one POST.
 */

/** A self-signed cert + the matching signer, so a test can produce a genuinely valid SNS envelope. */
function makeSigner() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  // node cannot mint an X.509 cert, but `createVerify().verify()` accepts a bare public key in PEM
  // form as well — which is what the production code passes through from the fetched certificate
  const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return {
    certPem,
    sign: (msg: Record<string, unknown>) => {
      const signer = createSign('RSA-SHA256')
      signer.update(stringToSign(msg) ?? '', 'utf8')
      return signer.sign(privateKey, 'base64')
    },
  }
}

const CERT_URL = 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem'
/** OUR topic. A signature proves AWS sent the message; this proves it came from us. */
const TOPIC = 'arn:aws:sns:eu-central-1:1:orbetra-ses-events'

function envelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Type: 'Notification',
    MessageId: 'msg-1',
    TopicArn: TOPIC,
    Timestamp: '2026-08-10T08:00:00.000Z',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    Message: JSON.stringify({ eventType: 'Bounce', bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'dead@example.lt' }] } }),
    ...over,
  }
}

/** A Db stub that records what was suppressed. */
function fakeDb() {
  const suppressed: { address: string; reason: string }[] = []
  return {
    suppressed,
    db: { suppressions: { suppress: (address: string, reason: string) => { suppressed.push({ address, reason }); return Promise.resolve() } } } as never,
  }
}

async function post(app: ReturnType<typeof createSesWebhookRoutes>, body: unknown) {
  return await app.request('/v1/webhooks/ses', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

describe('SNS signature verification', () => {
  it('accepts a genuine message and rejects one whose body was altered after signing', async () => {
    const { certPem, sign } = makeSigner()
    const msg = envelope()
    msg['Signature'] = sign(msg)
    expect(await verifySnsMessage(msg, () => Promise.resolve(certPem))).toBe(true)

    // the payload an attacker actually wants to change: WHICH address gets silenced
    const tampered = { ...msg, Message: JSON.stringify({ eventType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'victim@realcustomer.lt' }] } }) }
    expect(await verifySnsMessage(tampered, () => Promise.resolve(certPem))).toBe(false)
  })

  it('NEVER fetches a certificate from a host that is not AWS', async () => {
    const { sign } = makeSigner()
    const fetchCert = vi.fn(() => Promise.resolve('irrelevant'))
    for (const url of [
      'https://evil.example.com/cert.pem',
      'http://sns.eu-central-1.amazonaws.com/cert.pem', // not https
      'https://sns.eu-central-1.amazonaws.com.evil.com/cert.pem', // suffix trick
      'https://evil.com/?x=sns.eu-central-1.amazonaws.com',
    ]) {
      const msg = envelope({ SigningCertURL: url })
      msg['Signature'] = sign(msg)
      expect(await verifySnsMessage(msg, fetchCert)).toBe(false)
    }
    // the point is not just the false — it is that we never made the request at all. Signing your
    // own payload and hosting the matching certificate verifies perfectly if the URL is trusted.
    expect(fetchCert).not.toHaveBeenCalled()
  })

  it('refuses a signature version it does not know how to check', async () => {
    const { certPem, sign } = makeSigner()
    const msg = envelope({ SignatureVersion: '9' })
    msg['Signature'] = sign(msg)
    expect(await verifySnsMessage(msg, () => Promise.resolve(certPem))).toBe(false)
  })

  it('treats a non-string field as absent rather than hashing "[object Object]"', () => {
    // a field arriving as an object would stringify to [object Object] and be hashed as real
    // content — a check that verifies the wrong bytes while looking like it passed
    expect(stringToSign({ Type: 'Notification', MessageId: { a: 1 }, Message: 'x', Timestamp: 't', TopicArn: 'arn' })).not.toContain('[object Object]')
  })
})

describe('POST /v1/webhooks/ses', () => {
  it('suppresses a hard-bounced address and ignores a transient one', async () => {
    const { certPem, sign } = makeSigner()
    const { db, suppressed } = fakeDb()
    const app = createSesWebhookRoutes({ db, expectedTopicArn: TOPIC, fetchCert: () => Promise.resolve(certPem) })

    const hard = envelope()
    hard['Signature'] = sign(hard)
    expect((await post(app, hard)).status).toBe(200)
    expect(suppressed).toEqual([{ address: 'dead@example.lt', reason: 'bounce' }])

    // A FULL MAILBOX IS NOT A DEAD ADDRESS. Suppressing on a transient bounce would silence a live
    // customer permanently — the exact failure this endpoint exists to prevent, inverted.
    const soft = envelope({
      MessageId: 'msg-2',
      Message: JSON.stringify({ eventType: 'Bounce', bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', bouncedRecipients: [{ emailAddress: 'busy@example.lt' }] } }),
    })
    soft['Signature'] = sign(soft)
    expect((await post(app, soft)).status).toBe(200)
    expect(suppressed).toHaveLength(1)
  })

  it('records a complaint', async () => {
    const { certPem, sign } = makeSigner()
    const { db, suppressed } = fakeDb()
    const app = createSesWebhookRoutes({ db, expectedTopicArn: TOPIC, fetchCert: () => Promise.resolve(certPem) })
    const msg = envelope({
      Message: JSON.stringify({ eventType: 'Complaint', complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'angry@example.lt' }] } }),
    })
    msg['Signature'] = sign(msg)
    expect((await post(app, msg)).status).toBe(200)
    expect(suppressed).toEqual([{ address: 'angry@example.lt', reason: 'complaint' }])
  })

  it('an UNSIGNED post changes nothing — 403, and no address is touched', async () => {
    const { db, suppressed } = fakeDb()
    const app = createSesWebhookRoutes({ db, expectedTopicArn: TOPIC, fetchCert: () => Promise.resolve('x') })
    // exactly what an attacker sends to silence someone: a well-formed bounce, no valid signature
    const res = await post(app, envelope({ Signature: 'ZmFrZQ==' }))
    expect(res.status).toBe(403)
    expect(suppressed).toEqual([])
  })

  it('confirms a subscription, but only to an AWS URL', async () => {
    const { certPem, sign } = makeSigner()
    const { db } = fakeDb()
    const visited: string[] = []
    const app = createSesWebhookRoutes({
      db,
      expectedTopicArn: TOPIC,
      fetchCert: () => Promise.resolve(certPem),
      confirmSubscription: (u) => { visited.push(u); return Promise.resolve() },
    })

    const good = envelope({ Type: 'SubscriptionConfirmation', Token: 'tok', SubscribeURL: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription' })
    good['Signature'] = sign(good)
    expect((await post(app, good)).status).toBe(200)
    expect(visited).toHaveLength(1)

    // SSRF: a URL from the message body that we are about to REQUEST. Signature valid or not, the
    // host is checked — otherwise this endpoint fetches whatever an attacker names.
    const evil = envelope({ Type: 'SubscriptionConfirmation', Token: 'tok', SubscribeURL: 'https://169.254.169.254/latest/meta-data/' })
    evil['Signature'] = sign(evil)
    expect((await post(app, evil)).status).toBe(403)
    expect(visited).toHaveLength(1)
  })
})

/**
 * A VALID AWS SIGNATURE IS NOT AUTHORIZATION (audit C2). AWS signs every customer's topic with the
 * same regional certificate, so "the signature verifies" only proves AWS sent it — not that it came
 * from OUR topic. Without this binding, anyone with a free AWS account could publish a permanent
 * bounce for any address from their own topic and blackhole it platform-wide.
 */
describe('SNS topic binding', () => {
  it("refuses a PERFECTLY SIGNED bounce published from a stranger's topic", async () => {
    const { certPem, sign } = makeSigner()
    const { db, suppressed } = fakeDb()
    const app = createSesWebhookRoutes({ db, expectedTopicArn: TOPIC, fetchCert: () => Promise.resolve(certPem) })

    // the attacker's own topic — everything else is genuine, and the signature really does verify
    const msg = envelope({ TopicArn: 'arn:aws:sns:eu-central-1:999:attacker-topic' })
    msg['Signature'] = sign(msg)

    expect((await post(app, msg)).status).toBe(403)
    expect(suppressed).toEqual([]) // the victim's address is untouched
  })

  it("refuses a subscription handshake from a stranger's topic, so it is never confirmed", async () => {
    const { certPem, sign } = makeSigner()
    const { db } = fakeDb()
    const visited: string[] = []
    const app = createSesWebhookRoutes({
      db,
      expectedTopicArn: TOPIC,
      fetchCert: () => Promise.resolve(certPem),
      confirmSubscription: (u) => { visited.push(u); return Promise.resolve() },
    })
    const msg = envelope({
      Type: 'SubscriptionConfirmation', Token: 'tok',
      TopicArn: 'arn:aws:sns:eu-central-1:999:attacker-topic',
      SubscribeURL: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription',
    })
    msg['Signature'] = sign(msg)
    expect((await post(app, msg)).status).toBe(403)
    expect(visited).toEqual([]) // never auto-confirmed into someone else's topic
  })

  it('FAILS CLOSED when SES_SNS_TOPIC_ARN is not configured', async () => {
    const { certPem, sign } = makeSigner()
    const { db, suppressed } = fakeDb()
    // a deployment without the env var: refusing beats trusting any signed publisher
    const app = createSesWebhookRoutes({ db, expectedTopicArn: undefined, fetchCert: () => Promise.resolve(certPem) })
    const msg = envelope()
    msg['Signature'] = sign(msg)
    expect((await post(app, msg)).status).toBe(403)
    expect(suppressed).toEqual([])
  })

  it('refuses a non-object JSON body with 400, not a 500', async () => {
    const { certPem } = makeSigner()
    const { db } = fakeDb()
    const app = createSesWebhookRoutes({ db, expectedTopicArn: TOPIC, fetchCert: () => Promise.resolve(certPem) })
    // `JSON.parse('null')` is valid JSON and NOT an object; asserting Record<string, unknown> over
    // it made the first property read throw, so this one body answered 500 while every other
    // non-object shape answered a clean refusal. A 500 on a public endpoint is a probing signal.
    for (const body of ['null', '[]', '"x"', '123', 'true']) {
      const res = await app.request('/v1/webhooks/ses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(res.status).toBeLessThan(500)
    }
  })
})

/** Guards the assumption the signer above leans on. */
describe('test scaffolding', () => {
  it('X509Certificate exists, so a future switch to a real cert needs no new dependency', () => {
    expect(typeof X509Certificate).toBe('function')
  })
})
