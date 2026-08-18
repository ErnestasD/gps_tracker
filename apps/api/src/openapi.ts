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
  responses: Record<string, { description: string; headers?: Record<string, unknown> }>
}

/**
 * Human wording for the generated half of the document (founder feedback 2026-08-17: the
 * Scalar page rendered "GET /v1/devices" as its own summary — a reference with no prose).
 * Three layers, all data: nouns turn plain CRUD into "List devices" / "Create a device";
 * SUMMARY_OVERRIDES names every sub-resource action the noun rule cannot express; TAG_META
 * gives each sidebar group a display name and an intro paragraph. None of it is load-bearing
 * for clients (summaries are prose), so drift here mis-labels, never mis-types.
 */
const NOUNS: Record<string, { one: string; many: string }> = {
  account: { one: 'an account', many: 'accounts' },
  affiliate: { one: 'a partner', many: 'partners' },
  apiKey: { one: 'an API key', many: 'API keys' },
  audit: { one: 'an audit entry', many: 'audit log entries' },
  deal_registration: { one: 'a deal registration', many: 'deal registrations' },
  device: { one: 'a device', many: 'devices' },
  document: { one: 'a vehicle document', many: 'vehicle documents' },
  domain: { one: 'a custom domain', many: 'custom domains' },
  driver: { one: 'a driver', many: 'drivers' },
  event: { one: 'an event', many: 'events' },
  export: { one: 'an export job', many: 'export jobs' },
  geofence: { one: 'a geofence', many: 'geofences' },
  maintenance: { one: 'a maintenance task', many: 'maintenance tasks' },
  maintenancePlan: { one: 'a maintenance plan', many: 'maintenance plans' },
  rule: { one: 'an alert rule', many: 'alert rules' },
  scheduledReport: { one: 'a scheduled report', many: 'scheduled reports' },
  share: { one: 'a share link', many: 'share links' },
  tenant: { one: 'a tenant', many: 'tenants' },
  trip: { one: 'a trip', many: 'trips' },
  user: { one: 'a user', many: 'users' },
  webhook: { one: 'a webhook', many: 'webhooks' },
  webhookDelivery: { one: 'a webhook delivery', many: 'webhook delivery attempts' },
}

const SUMMARY_OVERRIDES: Record<string, string> = {
  'POST /v1/accounts/{id}/export': 'Request a GDPR data export of an account',
  'PATCH /v1/accounts/{id}/preferences': 'Update account preferences (time zone, units, report day)',
  'GET /v1/affiliates/{id}/commissions': "List a partner's commissions",
  'POST /v1/affiliates/{id}/set-password-token': 'Issue a one-time partner sign-in link',
  'GET /v1/commands/{id}': 'Get a command and its device reply',
  'PATCH /v1/commissions/{id}': 'Update a commission (approve / void / mark paid)',
  'PATCH /v1/deals/{id}': 'Approve or reject a deal registration',
  'POST /v1/devices/import': 'Bulk-import devices from CSV',
  'POST /v1/devices/import/preview': 'Validate a CSV import without applying it',
  'GET /v1/devices/{id}/can': 'Read CAN-bus data for a device',
  'GET /v1/devices/{id}/commands': 'List commands sent to a device',
  'POST /v1/devices/{id}/commands': 'Send a GPRS command to a device',
  'POST /v1/devices/{id}/erase': 'Queue GDPR erasure of a device',
  'GET /v1/devices/{id}/fuel': 'Fuel-level history for a device',
  'GET /v1/devices/{id}/health': 'Device health: battery, signal, last contact',
  'GET /v1/devices/{id}/onboarding': 'Onboarding sheet — the exact config SMS for this device',
  'GET /v1/devices/{id}/positions': 'Position history for a device',
  'GET /v1/devices/{id}/shares': 'List public share links for a device',
  'POST /v1/devices/{id}/shares': 'Create a temporary public share link',
  'GET /v1/devices/{id}/sms': 'List SMS messages sent to a device',
  'POST /v1/devices/{id}/sms': "Send an SMS to the device's SIM",
  'GET /v1/devices/{id}/trips': 'List trips driven by a device',
  'GET /v1/exports/{id}/download': 'Download a finished export archive',
  'POST /v1/maintenance/{id}/serviced': 'Mark a maintenance task as serviced',
  'GET /v1/platform/alerts': 'Platform alerts needing attention (superadmin)',
  'GET /v1/platform/audit': 'Cross-tenant audit log (superadmin)',
  'GET /v1/platform/billing': 'Billing state of every tenant (superadmin)',
  'GET /v1/platform/errors': 'Recent device/integration errors (superadmin)',
  'GET /v1/platform/lapses': 'Tenants in the payment-lapse ladder (superadmin)',
  'GET /v1/platform/leads': 'Pilot requests and signups (superadmin)',
  'GET /v1/platform/overview': 'Business overview KPIs (superadmin)',
  'GET /v1/platform/usage': 'Usage across all tenants (superadmin)',
  'GET /v1/platform/users': 'List users across all tenants (superadmin)',
  'PATCH /v1/platform/users/{id}': 'Enable or disable any user (superadmin)',
  'GET /v1/quarantine': 'List unclaimed IMEIs in quarantine',
  'POST /v1/quarantine/{imei}/claim': 'Claim a quarantined IMEI into the fleet',
  'GET /v1/tenant/branding': "Get this tenant's white-label branding",
  'PATCH /v1/tenant/branding': "Update this tenant's white-label branding",
  'POST /v1/tenant/domains': 'Add a custom domain',
  'POST /v1/tenant/domains/{id}/verify': 'Trigger DNS verification for a domain',
  'GET /v1/tenants/{id}/accounts': 'List accounts inside a tenant',
  'GET /v1/tenants/{id}/domains': "List a tenant's custom domains",
  'POST /v1/tenants/{id}/restore': 'Restore a suspended tenant',
  'PATCH /v1/trips/{id}/driver': 'Assign a driver to a trip',
  'GET /v1/usage': 'Usage for the current tenant (devices, SMS, geofences)',
  'GET /v1/devices/{id}/service-log': "List a vehicle's service history",
  'POST /v1/devices/{id}/service-log': 'Record an ad-hoc service entry',
  'DELETE /v1/service-log/{id}': 'Delete a service-log entry',
  'GET /v1/devices/{id}/documents': "List a vehicle's documents",
  'POST /v1/devices/{id}/documents': 'Add a document to a vehicle',
  'GET /v1/documents': 'List documents fleet-wide, soonest expiry first',
  'POST /v1/maintenance-plans/{id}/apply': 'Apply a plan to devices (idempotent per title)',
}

/** Sidebar display names + section intros; tag NAMES stay stable (they are anchor URLs). */
const TAG_META: Record<string, { title: string; description: string }> = {
  account: { title: 'Accounts', description: 'Sub-accounts inside a tenant — each is an isolated fleet with its own users, devices and preferences.' },
  accountPrefs: { title: 'Account preferences', description: 'Per-account rendering rules: time zone, units and where the report day starts.' },
  affiliate: { title: 'Partners', description: 'The referral partner registry: commission terms, sign-in links and each partner\'s ledger. Partner-facing counterparts live under /v1/partner/* (portal auth).' },
  apiKey: { title: 'API keys', description: 'Read-only integration keys (`orb_live_…`). Tenant-admin managed; the raw key is shown once at creation.' },
  audit: { title: 'Audit log', description: 'Who changed what, when — every write lands here with actor, entity and before/after.' },
  auth: { title: 'Authentication', description: 'Email + password login mints a short-lived JWT; the httpOnly refresh cookie rotates it. See the intro for the API-key alternative.' },
  billing: { title: 'Billing', description: 'Stripe subscription lifecycle: plans, checkout, the billing portal and the signature-verified webhook.' },
  branding: { title: 'Branding', description: 'White-label identity — name, logo, colors — served publicly by Host so login pages brand before authentication.' },
  command: { title: 'Commands', description: 'GPRS (Codec-12) commands to the device over its open TCP session: free, instant, with the reply captured.' },
  commission: { title: 'Commissions', description: 'Individual commission ledger entries — accrued from referred customers\' payments, then approved, paid or voided.' },
  deal_registration: { title: 'Deal registrations', description: 'A partner\'s claim on a fleet they introduced personally — 90-day protection once approved, even for a link-less signup.' },
  device: { title: 'Devices', description: 'The tracker registry. A device must exist (IMEI + model profile) before ingest accepts its first frame; the profile selects which AVL dictionary decodes it.' },
  domain: { title: 'Custom domains', description: 'Tenant-owned dashboard domains with DNS verification and automatic TLS.' },
  driver: { title: 'Drivers', description: 'Driver registry with iButton/DL numbers, trip assignment and safety scores.' },
  event: { title: 'Events', description: 'Everything the rules engine emitted: geofence crossings, overspeed, ignition, power cuts, panic — with position and payload.' },
  export: { title: 'Data exports', description: 'Full-history GDPR exports of an account, generated async and downloaded as an archive.' },
  gdpr: { title: 'GDPR', description: 'Irreversible erasure of a retired device\'s history — queued, audited, and refused while the resurrection window is open.' },
  geofence: { title: 'Geofences', description: 'Polygons and circles evaluated in the pipeline; crossings become events and can alarm.' },
  lead: { title: 'Leads', description: 'Inbound pilot requests and self-serve signups, as the platform team sees them.' },
  live: { title: 'Live', description: 'Realtime positions: a single-use ticket authenticates the WebSocket that pushes every fix for the fleet as it arrives.' },
  maintenance: { title: 'Maintenance', description: 'Service reminders per vehicle by odometer km, calendar days or engine hours; due state and a km-forecast date are computed at read time.' },
  maintenancePlan: { title: 'Maintenance plans', description: 'Named interval templates defined once and applied to many vehicles in one action; applying creates ordinary maintenance items and is idempotent per title.' },
  serviceLog: { title: 'Service log', description: 'Completed-service history per vehicle — when, at what odometer/engine hours, what it cost and who did it. Marking a reminder serviced writes one automatically.' },
  document: { title: 'Vehicle documents', description: 'Insurance, roadworthiness (TA), tachograph calibration, permits and leasing with validity dates; due state (ok / due_soon ≤30 d / overdue) is computed at read time.' },
  public: { title: 'Public', description: 'Unauthenticated surface: signup, email verification, pilot requests and share-token resolution. Uniform answers by design — nothing here confirms whether an address exists.' },
  push: { title: 'Web push', description: 'Browser push notifications (VAPID) for alerts when the dashboard tab is closed.' },
  quarantine: { title: 'Quarantine', description: 'Where frames from unknown IMEIs wait. Claiming one creates the device and releases its buffered history.' },
  report: { title: 'Reports', description: 'On-demand fleet reports — trips, mileage, stops, overspeed, geofence time, engine hours — over any window, in the account\'s time zone.' },
  routing: { title: 'Routing', description: 'Multi-stop route optimization.' },
  rule: { title: 'Alert rules', description: 'The automation layer: geofence / overspeed / ignition / power-cut / panic conditions fanned out to email, push, webhooks or SMS.' },
  scheduledReport: { title: 'Scheduled reports', description: 'The same reports, emailed on a schedule instead of requested by hand.' },
  share: { title: 'Share links', description: 'Temporary public links to one vehicle\'s live position — the token is the whole capability.' },
  sms: { title: 'SMS', description: 'SMS to the device SIM for configuration when no GPRS session exists (Twilio-backed, quota-metered, at-most-once).' },
  tenant: { title: 'Tenants', description: 'Platform-level tenant administration: plans, suspension, restoration (superadmin).' },
  trip: { title: 'Trips', description: 'Ignition-to-ignition journeys computed in the pipeline: distance, duration, path and the driver behind the wheel.' },
  usage: { title: 'Usage & platform', description: 'Metered consumption against plan ceilings, and the superadmin views across every tenant.' },
  user: { title: 'Users', description: 'Dashboard users and their roles, from viewer to tenant admin.' },
  webhook: { title: 'Webhooks', description: 'HTTP fan-out of events to your systems — signed, retried, with per-delivery status.' },
  webhookDelivery: { title: 'Webhook deliveries', description: 'The delivery log per webhook: attempts, response codes and retry state.' },
}

/** Sidebar sections (x-tagGroups). Every tag must appear in exactly one group — Scalar hides
 *  ungrouped tags once groups exist, so buildOpenApi() appends any stragglers to "Other". */
const TAG_GROUPS: { name: string; tags: string[] }[] = [
  { name: 'Authentication', tags: ['auth', 'apiKey'] },
  { name: 'Fleet', tags: ['device', 'command', 'sms', 'quarantine', 'driver', 'maintenance', 'maintenancePlan', 'serviceLog', 'document', 'share'] },
  { name: 'Positions & trips', tags: ['live', 'trip', 'routing'] },
  { name: 'Automation', tags: ['geofence', 'rule', 'event', 'webhook', 'webhookDelivery', 'push'] },
  { name: 'Reports', tags: ['report', 'scheduledReport'] },
  { name: 'Organization', tags: ['account', 'accountPrefs', 'user', 'audit', 'usage', 'export', 'gdpr'] },
  { name: 'White-label', tags: ['tenant', 'branding', 'domain'] },
  { name: 'Billing & partners', tags: ['billing', 'affiliate', 'commission', 'deal_registration', 'lead'] },
  { name: 'Public', tags: ['public'] },
]

const INFO_DESCRIPTION = `The REST API behind the Orbetra platform. Everything the dashboard does — the live map, trips, geofences, alerts, reports, billing — goes through these endpoints, so anything you can see in the UI you can automate.

## Authentication

| Scheme | Header | Use |
|---|---|---|
| **Bearer JWT** | \`Authorization: Bearer <jwt>\` | Full read/write. Obtain via \`POST /v1/auth/login\`; the access token is short-lived and rotated through the httpOnly refresh cookie. |
| **API key** | \`X-Api-Key: orb_live_…\` | Server-to-server, **read-only** (resolves to the viewer role). Created under *Settings → API keys*; requires the \`apiAccess\` plan entitlement. |

Operations below advertise exactly the schemes they accept — a write never accepts an API key.

## Conventions

- **IDs** are ULIDs — sortable, URL-safe strings.
- **Times** are ISO-8601 in **UTC**. Rendering in the account's time zone is the client's job; reports do it server-side using the account preference.
- **Errors** are RFC 7807 \`application/problem+json\`: \`{ "title", "status", "detail" }\`.
- **Pagination**: larger collections take \`cursor\` + \`limit\` and return the next cursor. The trip lists instead cap the page and set \`X-Result-Truncated: true\` when the range needs narrowing.
- **Rate limits** answer \`429\` with \`Retry-After\` — honour it.
- **Tenancy**: every request is scoped to the authenticated tenant. A resource outside your scope answers \`404\`, never \`403\` — existence itself is tenant-scoped information.

## Live positions

For a cheap snapshot, poll \`GET /v1/devices/last\`. For realtime, fetch \`GET /v1/ws-ticket\` and connect to the WebSocket with the single-use ticket — every fix for the fleet is pushed the moment it arrives.

## Scope of this document

Routes, auth and status codes are generated from the live route registry and cannot drift. Request/response **bodies are not yet modelled** — field shapes are described in the [developer guide](https://orbetra.com/docs).`

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
/**
 * POSTs that HAND OFF rather than complete: the response says the work is queued, not done.
 * 202 is the whole contract here — a client that reads 200 concludes the device is already erased
 * and stops polling. The heuristic cannot see this (the path shape is an ordinary item action), so
 * the status is listed, and the shape's 200 is dropped rather than sitting alongside it.
 */
const POST_ACCEPTED: Record<string, { description: string }> = {
  '/v1/devices/{id}/erase': { description: 'Accepted — erase queued; the device is not yet erased' },
}
/**
 * Response headers worth documenting. The trips lists have no cursor: they cap (500 default, 5000
 * max) and signal a possibly-incomplete page in a header, which is invisible to anyone reading only
 * the document — so it is declared here rather than left as folklore.
 */
const TRUNCATION_HEADER = {
  'X-Result-Truncated': {
    description: 'Present and "true" when the page hit the row cap, so the range may be incomplete. Narrow from/to to see the rest — this list has no cursor.',
    schema: { type: 'string', enum: ['true'] },
  },
}
const RESPONSE_HEADERS: Record<string, Record<string, unknown>> = {
  '/v1/trips': TRUNCATION_HEADER,
  '/v1/devices/{id}/trips': TRUNCATION_HEADER,
}

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
  // 200 AND 201: an export request that finds one already pending returns THAT row, unchanged, with
  // 200 — a double-click must not pile up full-history files on disk. Declaring only the 201 is the
  // exact defect this response work exists to remove, on the branch a real client meets most often.
  '/v1/accounts/{id}/export': { '200': { description: 'An export was already pending — that job is returned unchanged' } },
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
  // Prose summary: explicit override → CRUD noun phrase → the method+path fallback (which is
  // also the safety net for a new sub-resource route until someone words it here).
  const noun = NOUNS[entity]
  const summary =
    SUMMARY_OVERRIDES[`${method.toUpperCase()} ${path}`] ??
    (noun !== undefined
      ? params.length === 0
        ? method === 'get' ? `List ${noun.many}` : method === 'post' ? `Create ${noun.one}` : undefined
        : path.endsWith('}')
          ? method === 'get' ? `Get ${noun.one}` : method === 'patch' || method === 'put' ? `Update ${noun.one}` : method === 'delete' ? `Delete ${noun.one}` : undefined
          : undefined
      : undefined) ??
    `${method.toUpperCase()} ${path}`
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
    summary,
    security: keyMayRead ? READ_SEC : WRITE_SEC,
    ...(params.length > 0 ? { parameters: pathParams(params) } : {}),
    // EXTRA is per operation and WRITES ONLY: keyed on the path alone it leaked a device-creation
    // 409/429 onto GET /v1/devices — a read that can return neither, i.e. the very defect this
    // response work exists to remove, reintroduced on a different verb.
    responses: (() => {
      const out: Record<string, { description: string; headers?: Record<string, unknown> }> =
        !read && EXTRA[path] !== undefined ? { ...base, ...EXTRA[path] } : { ...base }
      const accepted = method === 'post' ? POST_ACCEPTED[path] : undefined
      if (accepted !== undefined) {
        delete out['200']
        out['202'] = accepted
      }
      const hdrs = read ? RESPONSE_HEADERS[path] : undefined
      const ok = out['200']
      if (hdrs !== undefined && ok !== undefined) out['200'] = { ...ok, headers: hdrs }
      return out
    })(),
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

  const tagNames = [...new Set(Object.values(paths).flatMap((ops) => Object.values(ops).flatMap((o) => o.tags)))].sort()
  const tags = tagNames.map((name) => {
    const meta = TAG_META[name]
    return meta !== undefined ? { name, description: meta.description, 'x-displayName': meta.title } : { name }
  })
  // x-tagGroups hide any tag they don't mention, so a tag missing from the static groups is
  // appended to "Other" rather than silently vanishing from the sidebar.
  const grouped = new Set(TAG_GROUPS.flatMap((g) => g.tags))
  const stragglers = tagNames.filter((name) => !grouped.has(name))
  const tagGroups = [
    ...TAG_GROUPS.map((g) => ({ name: g.name, tags: g.tags.filter((name) => tagNames.includes(name)) })),
    ...(stragglers.length > 0 ? [{ name: 'Other', tags: stragglers }] : []),
  ]

  return {
    openapi: '3.1.0',
    info: {
      title: 'Orbetra API',
      version: '1.0.0',
      description: INFO_DESCRIPTION,
    },
    servers: [{ url: serverUrl }],
    tags,
    'x-tagGroups': tagGroups,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key', description: 'Read-only integration key (orb_live_…)' },
      },
    },
  }
}
