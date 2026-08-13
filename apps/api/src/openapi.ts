import type { ManifestEntry } from './routes/registry.js'

/**
 * OpenAPI 3.1 document for the public API (E06-5, §6.6).
 *
 * SCOPE, precisely — the document is a route + auth INVENTORY, not a full schema contract. Request
 * and response BODIES are deliberately not modelled; the prose docs describe payload shapes.
 *
 * Two sources, with different drift guarantees:
 *  - the route MANIFEST (all CRUD routes): generated, so a new route appears automatically and the
 *    openapi spec test keeps it honest.
 *  - a HAND-CURATED list below (auth, reports, api-keys, ws-ticket, billing, web push, public
 *    share). This half CAN drift: it is a selection, not a mirror. It does not claim to enumerate
 *    every route in those groups — e.g. the /v1/auth block lists the operations an integrator needs,
 *    while the browser-only ones (PATCH /me, forgot/reset-password) are described in the prose docs.
 *
 * Two security schemes: a Bearer JWT (web) and X-Api-Key (integrations). An API key resolves to role
 * `viewer`, so it is offered only on operations whose policy actually admits that role — writes, and
 * reads restricted to higher roles, are JWT-only. Served at /v1/openapi.json; the docs page renders it.
 */
interface Operation {
  tags: string[]
  summary: string
  security: Record<string, string[]>[]
  parameters?: unknown[]
  responses: Record<string, { description: string }>
}

const PARAM = /:([a-zA-Z0-9_]+)/g
/** `/v1/devices/:id` → `/v1/devices/{id}` and collect the path params. */
function toPath(path: string): { path: string; params: string[] } {
  const params: string[] = []
  const out = path.replace(PARAM, (_m, name: string) => {
    params.push(name)
    return `{${name}}`
  })
  return { path: out, params }
}

function pathParams(names: string[]): unknown[] {
  return names.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }))
}

/**
 * Response sets, PER METHOD SHAPE rather than one template for every write.
 *
 * The single `write` template advertised `201 Created` on DELETE and PATCH — statuses those
 * handlers never return — and omitted `404` on every item route, which they all can. A generated
 * client branching on the document was therefore branching on statuses that do not exist and
 * missing the one it will actually meet.
 */
const R = {
  ok: { '200': { description: 'OK' } },
  created: { '201': { description: 'Created' } },
  badRequest: { '400': { description: 'Bad request — payload failed validation' } },
  unauth: { '401': { description: 'Unauthenticated' } },
  forbidden: { '403': { description: 'Forbidden — role or plan entitlement' } },
  notFound: { '404': { description: 'Not found, or outside the caller\'s scope' } },
} as const
const RESPONSES = {
  readCollection: { ...R.ok, ...R.unauth, ...R.forbidden },
  readItem: { ...R.ok, ...R.unauth, ...R.forbidden, ...R.notFound },
  /** POST on a collection path — the create routes answer 201 with the row. */
  create: { ...R.created, ...R.badRequest, ...R.unauth, ...R.forbidden },
  /** POST on an item path (…/{id}/serviced, …/verify) — an action, answered 200. */
  action: { ...R.ok, ...R.badRequest, ...R.unauth, ...R.forbidden, ...R.notFound },
  update: { ...R.ok, ...R.badRequest, ...R.unauth, ...R.forbidden, ...R.notFound },
  remove: { ...R.ok, ...R.unauth, ...R.forbidden, ...R.notFound },
  publicPost: { ...R.ok, ...R.badRequest, '429': { description: 'Rate limited' } },
}

/**
 * Where the method-shape heuristic guesses wrong, the truth is listed instead of inferred.
 *
 * The heuristic — collection POST creates (201), item POST acts (200) — is right for most routes and
 * wrong for these. Guessing is exactly what produced "DELETE returns 201"; an explicit table is the
 * only thing that keeps the document honest for the exceptions.
 */
const POST_CREATES_ON_ITEM_PATH = new Set([
  '/v1/devices/{id}/commands',
  '/v1/devices/{id}/shares',
  '/v1/devices/{id}/sms',
  '/v1/accounts/{id}/export',
  '/v1/quarantine/{imei}/claim',
  '/v1/affiliates/{id}/set-password-token',
])
/** Collection-path POSTs that are NOT creates — they answer 200 with a computed result. */
const POST_RETURNS_OK = new Set(['/v1/devices/import/preview'])
/** Statuses a specific operation can return beyond its shape's set (throttles, conflicts, outages). */
const EXTRA: Record<string, Record<string, { description: string }>> = {
  '/v1/devices': {
    '409': { description: 'IMEI already registered, or a create for it is already in flight' },
    '429': { description: 'Rate limited — per-tenant device creation ceiling; honour Retry-After' },
  },
  '/v1/devices/import': {
    '409': { description: 'IMEI already registered, or a create for it is already in flight' },
    '429': { description: 'Rate limited — per-tenant device creation ceiling; honour Retry-After' },
  },
  '/v1/devices/{id}/sms': {
    '429': { description: 'Rate limited — per-device / per-tenant / platform SMS quota' },
    '503': { description: 'SMS gateway not configured' },
  },
  '/v1/devices/{id}/erase': {
    '409': { description: 'Device retired too recently to erase' },
    '503': { description: 'GDPR job queue not configured' },
  },
  '/v1/accounts/{id}': { '409': { description: 'Account still has users' } },
}
// GET accepts a JWT or an API key; writes require the JWT (API keys are read-only).
const READ_SEC: Record<string, string[]>[] = [{ bearerAuth: [] }, { apiKeyAuth: [] }]
const WRITE_SEC: Record<string, string[]>[] = [{ bearerAuth: [] }]

/** The role every API key resolves to (auth/apiKey.ts). A route whose policy excludes it is
 *  JWT-only however read-only it looks, so the document must not offer apiKeyAuth on it. */
const API_KEY_ROLE = 'viewer'

function op(
  entity: string,
  method: string,
  rawPath: string,
  params: string[],
  opts: { roles?: readonly string[] } = {},
): Operation {
  const read = method === 'get'
  // C21: the summary is part of the published document — it must speak OpenAPI's `{id}`, not
  // Hono's `:id`. Both forms used to render side by side on the docs page.
  const { path } = toPath(rawPath)
  // C11: security followed the HTTP verb alone, so ~27 GETs advertised apiKeyAuth while their
  // READ_POLICY excludes `viewer` — every one of them 403s a key. Offer it only where a key can
  // actually be used.
  const keyMayRead = read && (opts.roles === undefined || opts.roles.includes(API_KEY_ROLE))
  const isCreate = method === 'post' && (params.length > 0 ? POST_CREATES_ON_ITEM_PATH.has(path) : !POST_RETURNS_OK.has(path))
  const base = read
    ? params.length > 0
      ? RESPONSES.readItem
      : RESPONSES.readCollection
    : method === 'delete'
      ? RESPONSES.remove
      : method === 'patch' || method === 'put'
        ? RESPONSES.update
        : isCreate
          // an item-path create can still 404 on the parent it hangs off
          ? { ...RESPONSES.create, ...(params.length > 0 ? R.notFound : {}) }
          : params.length > 0
            ? RESPONSES.action
            // a collection-path POST that computes rather than creates (import/preview): 200, no 404
            : { ...R.ok, ...R.badRequest, ...R.unauth, ...R.forbidden }
  return {
    tags: [entity],
    summary: `${method.toUpperCase()} ${path}`,
    security: keyMayRead ? READ_SEC : WRITE_SEC,
    ...(params.length > 0 ? { parameters: pathParams(params) } : {}),
    // EXTRA is per operation and WRITES ONLY: keyed on the path alone it leaked a device-creation
    // 409/429 onto GET /v1/devices — a read that can return neither, i.e. the very defect this
    // response work exists to remove, reintroduced on a different verb.
    responses: !read && EXTRA[path] !== undefined ? { ...base, ...EXTRA[path] } : base,
  }
}

export function buildOpenApi(manifest: ManifestEntry[], serverUrl = '/'): object {
  const paths: Record<string, Record<string, Operation>> = {}
  const add = (method: string, rawPath: string, operation: Operation): void => {
    const { path } = toPath(rawPath)
    ;(paths[path] ??= {})[method] = operation
  }

  for (const m of manifest) {
    const { params } = toPath(m.path)
    add(m.method, m.path, op(m.entity, m.method, m.path, params, { roles: m.roles }))
  }

  // curated non-manifest routes (registered outside the CRUD manifest)
  add('post', '/v1/auth/login', { tags: ['auth'], summary: 'Log in (email + password)', security: [], responses: RESPONSES.publicPost })
  add('post', '/v1/auth/refresh', { tags: ['auth'], summary: 'Rotate the refresh token', security: [], responses: RESPONSES.publicPost })
  // logout is PUBLIC (no auth middleware): it clears the refresh cookie and best-effort revokes
  // its family, returning 200 to any caller — so it advertises no security requirement.
  add('post', '/v1/auth/logout', { tags: ['auth'], summary: 'Revoke the refresh family', security: [], responses: { '200': { description: 'OK' } } })
  add('get', '/v1/auth/me', { tags: ['auth'], summary: 'Current user', security: WRITE_SEC, responses: RESPONSES.readCollection })
  add('post', '/v1/auth/password', { tags: ['auth'], summary: 'Change own password', security: WRITE_SEC, responses: { ...R.ok, ...R.badRequest, ...R.unauth, '429': { description: 'Rate limited — per-user password-change ceiling' } } })
  // ws-ticket is mounted under /v1/* which accepts EITHER a JWT or an X-Api-Key → READ_SEC (both)
  add('get', '/v1/ws-ticket', { tags: ['live'], summary: 'Single-use WebSocket ticket', security: READ_SEC, responses: RESPONSES.readCollection })
  add('get', '/v1/devices/last', { tags: ['device'], summary: 'Last-known position snapshot', security: READ_SEC, responses: RESPONSES.readCollection })
  add('get', '/v1/profiles', { tags: ['device'], summary: 'Device profiles (global reference data)', security: READ_SEC, responses: RESPONSES.readCollection })
  add('get', '/v1/branding', { tags: ['tenant'], summary: 'Public branding by Host', security: [], responses: RESPONSES.readCollection })
  add('post', '/v1/public/pilot-request', { tags: ['public'], summary: 'Pilot request from the marketing site (rate-limited, honeypotted)', security: [], responses: { ...RESPONSES.publicPost, '201': { description: 'Created' } } })
  // The three self-serve signup endpoints. Their RESPONSE CODES are part of the security contract,
  // not an implementation detail: signup answers 201 whether or not the address is already
  // registered, and resend answers 200 whether or not it exists — documenting anything else here
  // would invite a client to branch on a distinction the server refuses to make (audit MED #67).
  add('post', '/v1/public/signup', {
    tags: ['public'],
    summary: 'Self-serve signup (rate-limited, honeypotted). ALWAYS 201 — an already-registered address is answered identically and its owner is notified by email',
    security: [],
    responses: { ...RESPONSES.publicPost, '201': { description: 'Accepted. The account, if newly created, cannot sign in until the emailed activation link is used' } },
  })
  add('post', '/v1/public/verify-email', {
    tags: ['public'],
    summary: 'Activate a self-serve signup with the emailed token (single-use, 48 h). Mints no session',
    security: [],
    responses: { ...RESPONSES.publicPost, '200': { description: 'Verified' }, '400': { description: 'Token unknown, already used, or expired' } },
  })
  add('post', '/v1/public/verify-email/resend', {
    tags: ['public'],
    summary: 'Request a fresh activation link. ALWAYS 200 — an unknown or already-verified address is answered identically',
    security: [],
    responses: { ...RESPONSES.publicPost, '200': { description: 'Accepted' } },
  })
  add('post', '/v1/reports/{type}', {
    tags: ['report'],
    summary: 'Run a report (trips/mileage/stops/overspeed/geofence/engine_hours)',
    security: READ_SEC,
    parameters: pathParams(['type']),
    // the real outcomes, checked against routes/reports.ts: an unknown {type} is the FIRST branch and
    // answers 404; an impossible range or an out-of-scope account is 400; an X-Api-Key whose tenant
    // lacks apiAccess is 403 from the /v1/* middleware; the per-user limiter answers 429; and a
    // deployment without the raw-SQL pool answers 503.
    responses: {
      ...R.ok, ...R.badRequest, ...R.unauth,
      '403': { description: 'API key whose tenant lacks the apiAccess entitlement' },
      '404': { description: 'Unknown report type' },
      '429': { description: 'Rate limited — per-user report ceiling' },
      '503': { description: 'Reporting unavailable (no database pool)' },
    },
  })
  add('get', '/v1/driver-scores', { tags: ['driver'], summary: 'Driver safety scores over a window (V2)', security: READ_SEC, responses: RESPONSES.readCollection })
  add('post', '/v1/routing/optimize', {
    tags: ['routing'],
    summary: 'Optimize a multi-stop route (self-hosted OSRM trip, ADR-029)',
    security: READ_SEC,
    responses: {
      '200': { description: 'OK' },
      '400': { description: 'Bad request' },
      '401': { description: 'Unauthenticated' },
      '422': { description: 'Unroutable stops (outside the covered region)' },
      '429': { description: 'Rate limited' },
      '502': { description: 'Routing engine unreachable' },
      '503': { description: 'Routing not configured' },
    },
  })
  // api-key management is tenant-admin only (an API key can't reach it) → JWT security only
  add('get', '/v1/api-keys', { ...op('apiKey', 'get', '/v1/api-keys', []), security: WRITE_SEC })
  add('post', '/v1/api-keys', op('apiKey', 'post', '/v1/api-keys', []))
  add('delete', '/v1/api-keys/{id}', op('apiKey', 'delete', '/v1/api-keys/:id', ['id']))

  // billing (Stripe, ADR-024) — tenant-admin only, so JWT-only (an API key is 403). The webhook
  // is public (Stripe carries no JWT; it is signature-verified instead).
  add('get', '/v1/billing', { tags: ['billing'], summary: 'Billing/subscription status', security: WRITE_SEC, responses: RESPONSES.readCollection })
  add('get', '/v1/billing/plans', { tags: ['billing'], summary: 'Available subscription plans', security: WRITE_SEC, responses: RESPONSES.readCollection })
  add('post', '/v1/billing/checkout', { tags: ['billing'], summary: 'Start a Stripe Checkout session', security: WRITE_SEC, responses: { ...R.ok, ...R.badRequest, ...R.unauth, ...R.forbidden, '409': { description: 'Already subscribed' }, '503': { description: 'Billing not configured' } } })
  add('post', '/v1/billing/portal', { tags: ['billing'], summary: 'Open the Stripe billing portal', security: WRITE_SEC, responses: { ...R.ok, ...R.badRequest, ...R.unauth, ...R.forbidden, '409': { description: 'No customer' }, '503': { description: 'Billing not configured' } } })
  add('post', '/v1/webhooks/stripe', { tags: ['billing'], summary: 'Stripe webhook (signature-verified, no auth header)', security: [], responses: { '200': { description: 'OK' }, '400': { description: 'Invalid signature' }, '503': { description: 'Billing not configured' } } })

  // web push (ADR-026) — subscribe/unsubscribe MUTATE → JWT writers only; vapid-key is a safe read.
  add('get', '/v1/push/vapid-key', { tags: ['push'], summary: 'VAPID public key for PushManager.subscribe', security: READ_SEC, responses: RESPONSES.readCollection })
  add('post', '/v1/push/subscribe', { tags: ['push'], summary: 'Register a browser push subscription', security: WRITE_SEC, responses: { ...R.ok, ...R.badRequest, ...R.unauth, ...R.forbidden } })
  add('post', '/v1/push/unsubscribe', { tags: ['push'], summary: 'Remove a browser push subscription', security: WRITE_SEC, responses: { ...R.ok, ...R.badRequest, ...R.unauth, ...R.forbidden } })

  // PUBLIC temporary share-link resolver (E03-5) — the token IS the capability; no auth.
  add('get', '/v1/public/share/{token}', {
    tags: ['public'],
    summary: 'Resolve a public share token → one device latest position',
    security: [],
    parameters: pathParams(['token']),
    responses: { '200': { description: 'OK' }, '404': { description: 'Not found' }, '429': { description: 'Rate limited' }, '503': { description: 'Unavailable' } },
  })

  const tags = [...new Set(Object.values(paths).flatMap((ops) => Object.values(ops).flatMap((o) => o.tags)))].sort().map((name) => ({ name }))

  return {
    openapi: '3.1.0',
    info: {
      title: 'Orbetra API',
      version: '1.0.0',
      description: 'Multi-tenant GPS tracking API. Authenticate with a Bearer JWT (web) or X-Api-Key (integrations, read-only). Times are ISO-8601 UTC.',
    },
    servers: [{ url: serverUrl }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key', description: 'Read-only integration key (orb_live_…)' },
      },
    },
  }
}
