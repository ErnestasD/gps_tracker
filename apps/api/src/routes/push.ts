import type { Hono } from 'hono'

import { PushEndpointClaimedError, type Db } from '@orbetra/db'
import { pushSubscribeSchema } from '@orbetra/shared'

import { problem, requireRole, type AuthEnv } from '../auth/middleware.js'

/**
 * Web Push subscription API (ADR-026). A browser subscribes its PushSubscription here; a `webpush`
 * rule channel later fans out to the account's stored subscriptions. Tenant/account/user come from
 * the JWT — never a param — so these are manifest-exempt (no cross-tenant :id surface). The VAPID
 * PUBLIC key is served so the client can subscribe; absent config ⇒ push is unavailable (empty key).
 *
 * subscribe/unsubscribe MUTATE (create/delete subscription rows), so they carry the same writer
 * guard as WRITE_POLICY entities — a read-only X-Api-Key (role `viewer`) is rejected 403 (review
 * MED: an integration key could otherwise create/delete push subscriptions).
 */
const WRITERS = ['platform_admin', 'tsp_admin', 'account_manager'] as const

export interface PushDeps {
  db: Db
  vapidPublicKey?: string | undefined
}

export function mountPush(app: Hono<AuthEnv>, deps: PushDeps): void {
  // the public application-server key the browser needs for PushManager.subscribe (safe to expose)
  app.get('/v1/push/vapid-key', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ key: deps.vapidPublicKey ?? null })
  })

  app.post('/v1/push/subscribe', requireRole(...WRITERS), async (c) => {
    const auth = c.get('auth')
    // no accountId ⇒ a TENANT-LEVEL subscription (tenant-wide admin): stored with NULL account,
    // included in every account's fan-out for this tenant (audit fix — the old 400 here locked
    // out exactly the people who run the fleet)
    const data = pushSubscribeSchema.safeParse(await c.req.json().catch(() => null))
    if (!data.success) return problem(c, 400, 'Bad Request')
    try {
      await deps.db.pushSubscriptions.subscribe(
        { tenantId: auth.tenantId, accountId: auth.accountId },
        auth.userId,
        { endpoint: data.data.endpoint, p256dh: data.data.keys.p256dh, auth: data.data.keys.auth },
      )
    } catch (err) {
      // the endpoint belongs to another tenant — refuse rather than silently re-home it (which
      // would stop the real owner's alerts and start delivering them to this caller)
      if (err instanceof PushEndpointClaimedError) return problem(c, 409, 'Conflict', 'endpoint_claimed')
      throw err
    }
    return c.json({ ok: true }, 201)
  })

  app.post('/v1/push/unsubscribe', requireRole(...WRITERS), async (c) => {
    const auth = c.get('auth')
    const body = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown }
    if (typeof body.endpoint !== 'string' || body.endpoint === '') return problem(c, 400, 'Bad Request')
    await deps.db.pushSubscriptions.unsubscribe({ tenantId: auth.tenantId, accountId: auth.accountId }, body.endpoint)
    return c.json({ ok: true })
  })
}
