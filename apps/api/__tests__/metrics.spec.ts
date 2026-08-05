import { describe, expect, it } from 'vitest'

import { createApiProm, createApp, type ApiDeps } from '../src/app.js'
import { TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * The `/metrics` surface itself. Every counter in this file was added because something failed
 * silently, and the audit's own recurring finding was the next step of that story: counters that
 * exist in code, are incremented in code, and are exported by NOTHING — so nobody is ever paged.
 *
 * The wiring is three separate places (created with `registers: [registry]`, returned on `ApiProm`,
 * incremented at the call site) and only the last one has tests. This spec pins the first two: a
 * dropped registration or a renamed series fails here rather than in an incident.
 *
 * prom-client emits zero-valued counters, so a series is present from boot without being touched —
 * which is exactly what makes an alert on it trustworthy.
 */
// No containers: /metrics is registered before authMiddleware and reads only the registry, so the
// route itself needs nothing from redis or the db. `createApp` does walk `deps` while WIRING routes
// (it reads `deps.db.auth`, hands repos to the route factories, …), so deps is a self-returning
// proxy: any property access yields another proxy rather than undefined. Nothing is ever CALLED —
// the request under test never leaves the registry.
const stub: unknown = new Proxy(() => undefined, {
  get: (_t, prop) => (prop === 'jwtSecret' ? TEST_JWT_SECRET : stub),
  apply: () => stub,
})
const bareDeps = stub as ApiDeps

const metricsText = async (prom = createApiProm()): Promise<string> => {
  const res = await createApp(bareDeps, prom).request('/metrics')
  expect(res.status).toBe(200)
  return res.text()
}

describe('/metrics', () => {
  it('exports every series an alert rule depends on, from boot, before any traffic', async () => {
    const body = await metricsText()
    for (const series of [
      'ws_clients',
      'ws_slow_consumer_dropped_total',
      'auth_lockout_tripped_total',
      'argon2_queue_depth',
      'sms_quota_rejected_total',
      'billing_webhook_unmatched_total',
      'http_requests_total',
      'http_request_duration_seconds',
    ]) {
      expect(body, `${series} is not exported — it is a counter nobody can alert on`).toContain(`# TYPE ${series} `)
    }
  })

  it('exports process-level metrics, so `up == 1` is not the only signal the API is alive', async () => {
    const body = await metricsText()
    expect(body).toContain('process_resident_memory_bytes')
    expect(body).toContain('nodejs_eventloop_lag_seconds')
  })

  it('labels the lockout counter by gate — an account under attack must be distinguishable', async () => {
    // `email` rising is a customer being locked out of guessing attempts; `ip` rising is either
    // abuse or a shared egress whose ceiling is too low. One unlabelled number cannot tell them
    // apart, and the operator response is different.
    const prom = createApiProm()
    prom.authLockoutTripped.inc({ gate: 'email' })
    prom.authLockoutTripped.inc({ gate: 'ip' })
    const body = await metricsText(prom)
    expect(body).toContain('auth_lockout_tripped_total{gate="email"} 1')
    expect(body).toContain('auth_lockout_tripped_total{gate="ip"} 1')
  })
})
