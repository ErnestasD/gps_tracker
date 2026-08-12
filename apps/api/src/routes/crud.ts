import { randomBytes } from 'node:crypto'

import type { Context } from 'hono'
import type { Redis } from 'ioredis'

import { AccountHasUsersError, AffiliateConflictError, DealDomainTakenError, TenantHasCommissionsError, DomainConflictError, DomainDuplicateError, DomainLimitError, DriverIbuttonConflictError, DriverNotInScopeError, DuplicateImeiError, GeofenceInvalidError, GeofenceTooLargeError, GeofenceTooComplexError, GeofenceLimitError, MAX_DOMAINS_PER_TENANT, readCanLatest, readFuelSeries, readHealthSeries, readOdometersKm, readPositions, toDeviceId, type Db, type Pool } from '@orbetra/db'
import {
  ROLES,
  accountCreateSchema,
  accountPreferencesSchema,
  accountUpdateSchema,
  affiliateCreateSchema,
  affiliateUpdateSchema,
  dealDecisionSchema,
  commissionStatusUpdateSchema,
  brandingSchema,
  canGrantRole,
  canManageUser,
  deviceCreateSchema,
  domainCreateSchema,
  deviceImportSchema,
  geofenceCreateSchema,
  isAllowedSmsCommand,
  geofenceUpdateSchema,
  deviceUpdateSchema,
  buildOnboarding,
  smsSendRequestSchema,
  commandCreateSchema,
  ruleCreateSchema,
  ruleUpdateSchema,
  driverCreateSchema,
  driverUpdateSchema,
  tripAssignDriverSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  markServicedSchema,
  maintenanceDue,
  type MaintenanceView,
  shareCreateSchema,
  tenantCreateSchema,
  tenantUpdateSchema,
  quarantineClaimSchema,
  userCreateSchema,
  userUpdateSchema,
  webhookCreateSchema,
  scheduledReportCreateSchema,
  scheduledReportUpdateSchema,
  webhookUpdateSchema,
  type Role,
} from '@orbetra/shared'

import { hashPassword } from '../auth/passwords.js'
import { problem, type AuthEnv } from '../auth/middleware.js'
import { activateDevice, deactivateDevice, syncDeviceConfig } from './deviceRegistry.js'
import { removeGeofence, syncGeofence } from './geofenceRegistry.js'
import { removeDriverIbutton, syncDriverIbutton } from './driverRegistry.js'
import { removeRule, syncRule } from './ruleRegistry.js'
import { applyImport, dryRun, parseCsv, rowsToImport, MAX_IMPORT_ROWS } from './deviceImport.js'
import { markSessionsRevoked } from '../ws.js'
import { issuePartnerSetPwToken } from './partner.js'
import { claimDevice, listQuarantine } from './quarantine.js'
import { scopeOf, type RouteDef } from './registry.js'
import { restoreTenantDevices } from '@orbetra/registry'

import { checkPlatformSubdomain, expectedTxt, isUnderPlatformDomain, newTxtToken, verifyDomainTxt, type TxtResolver } from './tenantSelf.js'

// Geofence Redis sync is BEST-EFFORT (E05-2 review MED-3): the DB row is the source of
// truth and is already committed, so a Redis blip must NOT 500 the request (a 500 → client
// retry → duplicate fence). A missed sync leaves the fence out of the worker cache until a
// re-save; a startup DB→Redis rehydrate is the durable backfill (follow-up).
const bestEffortSync = async (fn: () => Promise<void>, what = 'redis sync'): Promise<void> => {
  try {
    await fn()
  } catch (e) {
    console.error(`${what} failed (best-effort)`, e) // e.g. 'driver ibutton sync' — not always geofence
  }
}

/** Per-device / per-tenant / platform-wide SMS ceilings (audit high). Deliberately low: config
 *  SMS is an onboarding action, not a messaging product. Override per deployment. */
export const DEFAULT_SMS_QUOTA = { perDevicePerDay: 5, perTenantPerDay: 100, globalPerDay: 1_000 }

const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

/** As RL_SCRIPT, but the caller says how much to add — one CSV import is N devices, not one event. */
const RL_ADD_SCRIPT = `local n = redis.call('INCRBY', KEYS[1], ARGV[2])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

/**
 * Hand a reservation back. Deliberately NOT `RL_ADD_SCRIPT` with a negative amount.
 *
 * That is what it was, and it defeated the ceiling it exists to enforce. Redis materialises a
 * missing key at 0 before applying INCRBY, so refunding against a key that had expired — or that
 * on-call had just cleared with the `DEL devcreate:rl:<tenantId>` the runbook tells them to run,
 * which is by definition done mid-onboarding — left the counter at MINUS the refund, and the
 * `TTL < 0` branch then stamped a fresh FULL window on it. Measured against a real Redis: a
 * 1000-row import spanning the window boundary came back at `-1000` with `ttl=3600` — a tenant
 * handed 1000 free creates on top of the whole ceiling, for an hour. The window is set once at key
 * creation and never extended, and MAX_IMPORT_ROWS is the amplitude, so "spanning the boundary" is
 * an ordinary import rather than a stunt.
 *
 * So: never create the key, and never fall below zero. KEEPTTL because clamping must not restart
 * the window either.
 */
const RL_REFUND_SCRIPT = `if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if n < 0 then redis.call('SET', KEYS[1], 0, 'KEEPTTL') n = 0 end
return n`

/**
 * Devices a tenant may CREATE per hour.
 *
 * Be honest about what this is and is not. It is a RESOURCE guard: without it one trial tenant can
 * drive an unbounded number of rows into `devices` from a loop, and every one of them takes an IMEI
 * hold against the rest of the platform (audit 2026-08-11 #2). It is NOT an anti-squat measure —
 * targeted squatting needs a few hundred specific IMEIs, far under any ceiling a real fleet could
 * live with. The remedy for squatting is the platform quarantine claim, which can now override a
 * retired holder.
 *
 * Keyed per TENANT, not per account, and that is a deliberate mismatch with the boundary this
 * codebase uses everywhere else: a runaway integration in one account of a white-label TSP does
 * throttle its sibling end-customers. The ceiling guards `devices` ROWS, and rows are a tenant-level
 * resource; at 10 000/hour the sibling case is unreachable in practice, which is why it is
 * acceptable rather than why it is right.
 *
 * The ceiling is therefore set where no real customer can reach it. PROJECT_PLAN §5 ("Performance envelope") designs the
 * whole PLATFORM for 5000 devices and names 200 vehicles as a large single fleet, and
 * `DIRECT_DEVICE_LIMIT` tops out at 100 — so an hour's budget is twice everything we expect to run,
 * arriving at once. A cap tight enough to inconvenience an onboarding would be a regression dressed
 * as a control.
 */
export const DEFAULT_DEVICE_CREATE_LIMIT = { max: 10_000, windowS: 3600 }

export interface CrudDeps {
  db: Db
  /** SMS ceilings; defaults to DEFAULT_SMS_QUOTA. */
  smsQuota?: { perDevicePerDay: number; perTenantPerDay: number; globalPerDay: number }
  /** Fired when a send is refused by a quota — a rejection nobody can see is not a guard. */
  onSmsQuotaRejected?: (scope: 'device' | 'tenant' | 'global') => void
  /** Per-tenant device-creation ceiling; defaults to DEFAULT_DEVICE_CREATE_LIMIT. */
  deviceCreateLimit?: { max: number; windowS: number }
  /**
   * Fired when a tenant hits the device-creation ceiling (`limit`), when Redis could not be
   * consulted and the create was let through (`degraded`), or when a reservation could not be handed
   * back (`refund_failed`).
   *
   * The three are NOT interchangeable and the third was originally folded into the second, which
   * inverted its meaning: `degraded` says the guard was absent and traffic flowed, while a failed
   * hand-back says the guard OVER-charged — a tenant now carries a phantom charge (up to a whole
   * 1000-row import) for the rest of the window, and the remedy is `DEL devcreate:rl:<tenantId>`.
   * On-call reading "the create was let through" would do nothing, which is the wrong action.
   */
  onDeviceCreateThrottled?: (why: 'limit' | 'degraded' | 'refund_failed') => void
  /** Device CRUD syncs the ingest/worker Redis registries (E03-3). */
  redis: Redis
  /** DNS TXT resolver for domain verification (E03-5); injectable for tests. */
  resolveTxt: TxtResolver
  /**
   * Our own domain (`PLATFORM_DOMAIN`, e.g. `orbetra.com`). A tenant may claim `<slug>` under it and
   * be live in a minute with no DNS work at all — the zero-setup half of white-label. Unset ⇒ the
   * option is simply not offered and every domain goes through DNS TXT, which is the correct
   * behaviour anywhere the wildcard record does not exist (local, CI, a self-hosted deploy).
   */
  platformDomain?: string
  /**
   * Where a tenant should point their OWN domain (`EDGE_HOSTNAME`, e.g. `dash.orbetra.com`).
   *
   * A CNAME to a hostname, not an A record to an IP: the address is ours to change, and a customer
   * who hard-codes it goes dark the day we move. Handed back with the domain so the UI can state the
   * step — its absence was why a tenant could publish the TXT record, see the badge flip to
   * "verified", and still have a domain that resolved nowhere, with nothing anywhere telling them
   * the one step that was missing.
   */
  edgeHostname?: string
  /** raw-SQL pool for positions history reads (E04-3); positions are not in Prisma.
   * Optional so manifest-only construction (apiManifest) needs no DB; the positions
   * route 503s if it is somehow reached without one. */
  pool?: Pool
  /** public ingest endpoint for the SMS onboarding sheet (V1-nice). NO default host: an unset
   *  INGEST_PUBLIC_HOST must render as a visible gap, never as the platform's own domain in a
   *  reseller's installation instructions. */
  onboarding?: { host: string; port: number }
  /** GDPR job enqueuers (E08-4) — BullMQ producers wired in the server entry (ADR-020
   * addendum); optional so manifest-only construction needs no Redis, routes 503 without. */
  gdpr?: {
    enqueueErase(data: { deviceId: string; tenantId: string; imei: string; accountId: string }): Promise<void>
    enqueueExport(data: { exportId: string }): Promise<void>
    /** erase is refused until the device has been retired this long (review HIGH-1: a live
     * TCP session survives retire until idle-timeout, and stream backlog drains async — an
     * instant erase could be "resurrected" by in-flight positions). Default 60 min. */
    eraseMinRetiredMs?: number
  }
  /** SMS gateway job enqueuer (SMS gateway feature) — a BullMQ producer wired in main.ts, present
   * ONLY when Twilio is configured. Mirrors `gdpr`: absent ⇒ POST /v1/devices/:id/sms 503s and the
   * onboarding sheet reports smsEnabled:false. */
  sms?: {
    enqueue(job: { smsDeliveryId: string; deviceId: string; tenantId: string; to: string; body: string; provider: string }): Promise<unknown>
  }
}

// Per-resource authorization (review HIGH). Reads are broad; writes are restricted;
// platform routes are platform_admin-only (assigned by scopeClass below).
const TENANT_ADMINS: Role[] = ['platform_admin', 'tsp_admin']
const ACCOUNT_WRITERS: Role[] = ['platform_admin', 'tsp_admin', 'account_manager']
const READ_POLICY: Record<string, Role[]> = {
  account: [...ROLES],
  user: TENANT_ADMINS.concat('account_manager'),
  device: [...ROLES],
  rule: [...ROLES],
  webhook: ACCOUNT_WRITERS,
  event: [...ROLES],
  branding: [...ROLES], // viewers see the theme
  domain: TENANT_ADMINS, // domains are admin config
  audit: TENANT_ADMINS, // audit trail is tenant-wide + sensitive → admins only
  geofence: [...ROLES],
  driver: [...ROLES], // the driver roster is broadly readable
  maintenance: [...ROLES], // maintenance schedule is broadly readable
  command: [...ROLES], // reading command status is broad; SENDING is a write (below)
  webhookDelivery: ACCOUNT_WRITERS, // webhook delivery log — same readers as webhooks
  usage: TENANT_ADMINS, // billing data — a tenant admin can see their own bill
  export: TENANT_ADMINS, // GDPR exports contain the account's full data — admins only
  share: [...ROLES], // viewing which public share links exist is broad
  scheduledReport: ACCOUNT_WRITERS, // report config incl. recipient emails — managers+admins
}
const WRITE_POLICY: Record<string, Role[]> = {
  account: TENANT_ADMINS,
  // language + units for this fleet's outbound mail — the operator who READS the alerts picks the
  // units they arrive in. Deliberately wider than `account` (rename / reporting time zone), which
  // stays with tenant admins; see the route note.
  accountPrefs: ACCOUNT_WRITERS,
  user: TENANT_ADMINS,
  device: ACCOUNT_WRITERS,
  rule: ACCOUNT_WRITERS,
  webhook: TENANT_ADMINS,
  geofence: ACCOUNT_WRITERS,
  driver: ACCOUNT_WRITERS,
  maintenance: ACCOUNT_WRITERS,
  trip: ACCOUNT_WRITERS, // assigning a driver to a trip is an operator action
  command: ACCOUNT_WRITERS, // sending a Codec-12 command controls hardware → writers only
  export: TENANT_ADMINS, // requesting a GDPR export
  gdpr: TENANT_ADMINS, // device erase — irreversible data destruction
  share: ACCOUNT_WRITERS, // minting/revoking a public link exposes device location → writers only
  scheduledReport: ACCOUNT_WRITERS,
  sms: ACCOUNT_WRITERS, // sending a config SMS controls hardware onboarding → writers only (GET uses entity 'device')
}
function rolesFor(entity: string, method: string, scopeClass: string): Role[] {
  if (scopeClass === 'platform') return ['platform_admin']
  if (method === 'get') return READ_POLICY[entity] ?? [...ROLES]
  return WRITE_POLICY[entity] ?? TENANT_ADMINS
}

/** :id is always present on an item route; narrow the noUncheckedIndexedAccess string|undefined. */
const id = (c: Context): string => c.req.param('id') ?? ''

/**
 * True when the caller's scope really is tenant-WIDE (no accountId pin).
 *
 * `READ_POLICY.audit = TENANT_ADMINS` assumes every tenant admin is tenant-wide — an assumption
 * written into scope.ts ("undefined ⇒ tenant-wide") but never enforced: `POST /v1/users` accepts
 * `{role:'tsp_admin', accountId:<uuid>}`, `canGrantRole('tsp_admin','tsp_admin')` is true, and
 * `scopeOf` then pins that admin to the account. Every other repo honours the pin via
 * `scopedWhere` — but `audit_log` has NO accountId column, so `audit.list` filters on tenantId
 * alone and such an admin read the whole tenant's trail, including sibling accounts' device
 * names, user emails and geofence changes. A white-label TSP running unrelated customers as
 * accounts is exactly the shape this breaks. Audit MED.
 *
 * FOUR surfaces need this, not one. Fixing `audit` and leaving the others was half a fix, and the
 * half that was left out was the expensive one: `/v1/billing/*` handed a pinned admin a Stripe
 * Customer Portal session for the RESELLER's customer, and `/v1/tenant/domains` let them delete the
 * tenant's verified white-label host — a whole-tenant outage triggered by one end-customer's admin.
 * The rule for anything added later: if the repo behind a route has no accountId column to be scoped
 * by, the route needs this test. `tests/isolation/suite.spec.ts` (TENANT_WIDE_ONLY) sweeps a pinned
 * admin over every route listed there — which is a list a human maintains, not a derived set, so
 * adding the guard here without adding the route there leaves it locked by nothing. Review found
 * `POST /v1/accounts` that way: the fifth surface of this shape, missed by the first four fixes.
 *
 * NOT applied to `GET /v1/tenant/branding`: `READ_POLICY.branding` is every role on purpose
 * ("viewers see the theme"), and the response carries no per-account data — gating it would blank
 * the UI theme for every account-scoped user to defend nothing.
 */
const tenantWide = (c: Context<AuthEnv>): boolean => c.get('auth').accountId === undefined

/**
 * Serialize a device-cap check-then-create for one tenant.
 *
 * `POST /v1/devices` took this lock precisely because a plain count-then-insert races — and then
 * the two OTHER paths that create devices under the same cap did not take it at all: the CSV import
 * and the quarantine claim. So the lock only ever serialized single-create against single-create.
 * Two concurrent 5-row imports on a 10-device plan with 5 active devices each evaluated `5 + 5 > 10`
 * as false and both proceeded — 15 devices on a 10-device plan, permanently, because nothing
 * re-checks the cap after creation. Audit MED.
 *
 * `cap === null` (every TSP plan) needs no lock at all: there is nothing to overshoot.
 */
export async function withDeviceCapLock<T>(
  redis: Redis,
  tenantId: string,
  cap: number | null,
  run: () => Promise<T>,
  onBusy: () => T,
): Promise<T> {
  if (cap === null) return run()
  const key = `device:create:${tenantId}`
  if ((await redis.set(key, '1', 'EX', 10, 'NX')) === null) return onBusy()
  try {
    return await run()
  } finally {
    await redis.del(key).catch(() => undefined)
  }
}

// A readable, URL-safe affiliate referral code (default when the admin doesn't pick one). Ambiguous
// glyphs (0/O, 1/I/L) dropped so a partner can dictate it over the phone; CSPRNG so it's unguessable.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const genAffiliateCode = (): string => {
  const bytes = randomBytes(8)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

const body = async <T>(c: Context, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): Promise<T | null> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

/**
 * Serialize repo rows to JSON-safe values. BigInt ids (events) → string; Date →
 * ISO. Kept in one place so every handler's response shape is consistent.
 */
function toJson(value: unknown): object {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as object
}
const json = (c: Context, data: unknown, status: 200 | 201 | 202 = 200): Response => {
  c.header('Cache-Control', 'no-store')
  return c.json(toJson(data), status)
}

/** Serialize a maintenance row + attach the device's current odometer + the computed due (V2). */
function toMaintView(
  item: { id: string; deviceId: bigint; title: string; intervalKm: number | null; intervalDays: number | null; lastServiceOdoKm: number | null; lastServiceAt: Date | null; active: boolean; createdAt: Date },
  odo: Map<string, number>,
): MaintenanceView {
  const deviceId = item.deviceId.toString()
  const currentOdoKm = odo.get(deviceId) ?? null
  const lastServiceAt = item.lastServiceAt?.toISOString() ?? null
  return {
    id: item.id, deviceId, title: item.title,
    intervalKm: item.intervalKm, intervalDays: item.intervalDays,
    lastServiceOdoKm: item.lastServiceOdoKm, lastServiceAt,
    active: item.active, createdAt: item.createdAt.toISOString(),
    currentOdoKm,
    due: maintenanceDue({ intervalKm: item.intervalKm, intervalDays: item.intervalDays, lastServiceOdoKm: item.lastServiceOdoKm, lastServiceAt }, currentOdoKm, Date.now()),
  }
}

/**
 * The route manifest (E03-2): every scoped CRUD endpoint, self-describing for the
 * isolation suite. Registration is driven from this array — the meta-test fails if
 * a live /v1 route is missing here.
 */
/**
 * The sanitized ceiling, and an honest note about what it does and does not catch.
 *
 * `Number('abc')` and `Number('10_000')` are NaN and would refuse every caller on the platform;
 * those this rejects. `Number('')` is 0, and 0 is NOT rejected — it is an intentional freeze, which
 * is a thing an operator legitimately wants and the only value with a real use at that end of the
 * range. So an EMPTY `DEVICE_CREATE_MAX_PER_WINDOW` still freezes device creation everywhere, and
 * the only thing standing in front of that is the real default in `docker-compose.apps.yml`
 * (`${DEVICE_CREATE_MAX_PER_WINDOW:-10000}`) — `main.ts` uses `??`, which does not treat the empty
 * string as absent. Run the api outside compose with that variable set and empty and nobody can add
 * a device. Stated rather than papered over, because a freeze that looks like a typo and a typo
 * that looks like a freeze are the same string.
 */
function deviceLimits(deps: CrudDeps): { max: number; windowS: number } {
  const rl = deps.deviceCreateLimit ?? DEFAULT_DEVICE_CREATE_LIMIT
  return {
    // `max: 0` is honoured — an explicit platform-wide freeze, the one legitimate reason to set it
    // to a number no fleet could live with. `windowS` must be a WHOLE number of seconds: EXPIRE
    // rejects a fractional argument, the script would throw on every call, and this limiter treats a
    // throw as `degraded` and lets the create through — the ceiling silently absent platform-wide.
    max: Number.isInteger(rl.max) && rl.max >= 0 ? rl.max : DEFAULT_DEVICE_CREATE_LIMIT.max,
    windowS: Number.isInteger(rl.windowS) && rl.windowS > 0 ? rl.windowS : DEFAULT_DEVICE_CREATE_LIMIT.windowS,
  }
}

/** A reservation that was taken (`reserved` devices), or the basis for a 429. */
type DeviceBudget = { reserved: number } | { retryAfterS: number }

/**
 * Reserve `cost` devices up front, ATOMICALLY, and hand back whatever is not used.
 *
 * Two earlier shapes were both wrong and the second was worse. Charging on the way in billed work
 * that never happened — a re-uploaded CSV creates nothing (`applyImport` only writes its create
 * rows) yet cost 1000, and a request that itself 429'd deepened the hole it had just reported:
 * review measured 9500 spent plus two rejected 1000-row imports leaving the counter at 11500, with
 * the tenant then unable to add one device by hand for the rest of the hour. Replacing that with
 * GET-then-work-then-INCRBY fixed the billing and threw away atomicity: review measured five
 * concurrent 100-row imports against a ceiling of 2 creating 500 devices, because every one of them
 * read the counter before any of them wrote it. Overshoot is `in-flight requests × MAX_IMPORT_ROWS`,
 * and a runaway loop — the exact thing this bounds — is by definition a client that does not wait
 * for responses, so the guard was weakest against its own stated threat. Nothing serializes these
 * either: `withDeviceCapLock` returns immediately when the plan is uncapped, which TSP plans are.
 *
 * So: reserve atomically, refuse if the reservation crosses the ceiling and give it straight back,
 * then refund the difference once the work reports what it actually created. (The SMS quota below
 * is NOT this pattern and is no precedent for it: it charges on the way in and refunds only when
 * the enqueue fails, so a send refused by the tenant ceiling keeps the device unit it already
 * spent. An earlier version of this comment claimed otherwise.)
 *
 * One accepted rough edge: a large reservation that trips the ceiling briefly makes a small
 * concurrent request 429 as well, until the hand-back lands a round trip later. Bounded by an RTT
 * and self-healing, unlike every failure above.
 *
 * FAIL-OPEN on a Redis fault (`reserved: 0`), in line with every other limiter here: this ceiling
 * exists to stop a runaway loop, and refusing a customer's onboarding because Redis blipped is the
 * worse failure. The degraded path fires the hook so the absence is visible rather than silent.
 */
export async function reserveDeviceBudget(deps: CrudDeps, tenantId: string, cost: number): Promise<DeviceBudget> {
  const { max, windowS } = deviceLimits(deps)
  const key = `devcreate:rl:${tenantId}`
  let used: number
  try {
    used = (await deps.redis.eval(RL_ADD_SCRIPT, 1, key, String(windowS), String(cost))) as number
  } catch {
    deps.onDeviceCreateThrottled?.('degraded')
    return { reserved: 0 }
  }
  if (used <= max) return { reserved: cost }
  // Refused: hand the reservation back through the SAME function the success path settles with, so
  // one tested code path owns both. They used to be two copies of the same eval, and review showed
  // the copy here was undefended — reverting just this line to the pre-fix negative-INCRBY shape
  // left the whole spec green, which is exactly how a regression rounds 2-4 kept re-introducing
  // would have walked back in.
  await settleDeviceBudget(deps, tenantId, cost, 0)
  deps.onDeviceCreateThrottled?.('limit')
  // the remaining TTL, not the full window: a tenant that trips at minute 59 must not be told to
  // wait an hour when the counter expires in sixty seconds
  const ttl = await deps.redis.ttl(key).catch(() => -1)
  return { retryAfterS: ttl > 0 ? ttl : windowS }
}

/** Give back the reserved devices that were never created. Never throws. */
export async function settleDeviceBudget(deps: CrudDeps, tenantId: string, reserved: number, created: number): Promise<void> {
  const unused = reserved - created
  if (unused <= 0) return
  await deps.redis
    .eval(RL_REFUND_SCRIPT, 1, `devcreate:rl:${tenantId}`, String(-unused))
    .catch(() => deps.onDeviceCreateThrottled?.('refund_failed'))
}

export function buildRoutes(deps: CrudDeps): RouteDef[] {
  const { db } = deps
  const auth = (c: Context<AuthEnv>) => c.get('auth')
  // odometer(s) for maintenance due — empty map (km-due null) when the positions pool is absent
  const odoMap = (ids: bigint[]) => (deps.pool !== undefined ? readOdometersKm(deps.pool, ids) : Promise.resolve(new Map<string, number>()))

  const raw: Omit<RouteDef, 'roles'>[] = [
    // ── accounts (tenant) ────────────────────────────────────────────────────
    { method: 'get', path: '/v1/accounts', scopeClass: 'tenant', entity: 'account', shape: 'collection',
      handler: async (c) => json(c, await db.accounts.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/accounts/:id', scopeClass: 'tenant', entity: 'account', shape: 'item',
      handler: async (c) => {
        const row = await db.accounts.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/accounts', scopeClass: 'tenant', entity: 'account', shape: 'collection', entitlement: 'subAccounts',
      handler: async (c) => {
        // `accounts.create` is the ONE account method that does not honour the pin: list/get/update/
        // remove all go through listWhere/findScoped, while create writes `tenantId` from the scope
        // and ignores `scope.accountId` entirely. A pinned admin therefore added siblings to the
        // reseller's tenant — unbounded (there is no per-tenant account cap the way domains have
        // MAX_DOMAINS_PER_TENANT) and burning the reseller's `subAccounts` entitlement. Not privesc:
        // they can neither see nor manage what they created. Still theirs to answer for.
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'accounts are tenant-wide')
        const data = await body(c, accountCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        return json(c, await db.accounts.create(scopeOf(auth(c)), { userId: auth(c).userId }, data), 201)
      } },
    { method: 'patch', path: '/v1/accounts/:id', scopeClass: 'tenant', entity: 'account', shape: 'item',
      handler: async (c) => {
        const data = await body(c, accountUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.accounts.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    /**
     * The account's LANGUAGE and UNITS — what alert e-mails, Telegram messages and scheduled report
     * tables are rendered in — the five `TODO(account-settings)` markers this closes.
     *
     * A separate route from `PATCH /v1/accounts/:id` because it answers to a different role. Renaming
     * an account or moving its reporting time zone re-cuts every report's day boundary and stays with
     * tenant admins; picking miles is the choice of the operator who reads the alerts, so `entity:
     * 'accountPrefs'` opens it to ACCOUNT_WRITERS. The repo method is narrow to match — the handler
     * cannot write `name` or `timezone` because `updatePreferences` takes no such argument, so the
     * separation survives an edit to this schema.
     */
    { method: 'patch', path: '/v1/accounts/:id/preferences', scopeClass: 'tenant', entity: 'accountPrefs', shape: 'item',
      handler: async (c) => {
        const data = await body(c, accountPreferencesSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.accounts.updatePreferences(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/accounts/:id', scopeClass: 'tenant', entity: 'account', shape: 'item',
      handler: async (c) => {
        try {
          const ok = await db.accounts.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
          return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
        } catch (err) {
          // deleting an account with users would SetNull their accountId → tenant-wide privesc (E1)
          if (err instanceof AccountHasUsersError) return problem(c, 409, 'Conflict', 'account_has_users')
          throw err
        }
      } },

    // ── users (tenant + account) ─────────────────────────────────────────────
    { method: 'get', path: '/v1/users', scopeClass: 'tenant', entity: 'user', shape: 'collection',
      handler: async (c) => json(c, await db.users.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/users/:id', scopeClass: 'tenant', entity: 'user', shape: 'item',
      handler: async (c) => {
        const row = await db.users.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/users', scopeClass: 'tenant', entity: 'user', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, userCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        // role grant authorization (review HIGH): a caller cannot mint a role above
        // its own tier, and only a platform_admin can mint a platform_admin
        if (!canGrantRole(a.role, data.role)) return problem(c, 403, 'Forbidden', 'cannot grant that role')
        // account-scoped creators can only create in their own account
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if (accountId !== null && (await db.accounts.get(scopeOf(a), accountId)) === null) {
          return problem(c, 400, 'Bad Request', 'accountId not in scope')
        }
        const created = await db.users.create(scopeOf(a), { userId: a.userId }, {
          email: data.email,
          passwordHash: await hashPassword(data.password),
          role: data.role,
          accountId,
        })
        return json(c, created, 201)
      } },
    { method: 'patch', path: '/v1/users/:id', scopeClass: 'tenant', entity: 'user', shape: 'item',
      handler: async (c) => {
        const data = await body(c, userUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        // TIER GUARD (audit HIGH): load the TARGET's CURRENT role and refuse a caller acting on a
        // peer-or-higher-tier user (except on THEMSELVES). Without this, a tsp_admin could reset a
        // co-tenant platform_admin's password (no `role` in the body ⇒ the grant check below is
        // skipped) → log in as them → cross-tenant god access. Self-edits (locale/password) are ok.
        const target = await db.users.get(scopeOf(a), id(c))
        if (target === null) return problem(c, 404, 'Not Found')
        if (target.id !== a.userId && !canManageUser(a.role, target.role)) {
          return problem(c, 403, 'Forbidden', 'cannot modify a user of equal or higher privilege')
        }
        // role grant authorization on update too (review HIGH: self-promotion vector)
        if (data.role !== undefined && !canGrantRole(a.role, data.role)) {
          return problem(c, 403, 'Forbidden', 'cannot grant that role')
        }
        // accountId change must stay in scope (review MED: PATCH skipped this);
        // account-scoped callers cannot move users out of their account at all
        if (data.accountId !== undefined) {
          if (a.accountId !== undefined && data.accountId !== a.accountId) {
            return problem(c, 403, 'Forbidden', 'cannot move users across accounts')
          }
          if (data.accountId !== null && (await db.accounts.get(scopeOf(a), data.accountId)) === null) {
            return problem(c, 400, 'Bad Request', 'accountId not in scope')
          }
        }
        // snapshot the PRE-update scope so the change check is correct even if the repo returns the
        // same row reference it then mutates (a role/account move must be measured against the OLD value)
        const prevRole = target.role
        const prevAccountId = target.accountId
        const { password, ...rest } = data
        const row = await db.users.update(scopeOf(a), { userId: a.userId }, id(c), {
          ...rest,
          ...(password !== undefined ? { passwordHash: await hashPassword(password) } : {}),
        })
        if (row === null) return problem(c, 404, 'Not Found')
        // Revoke the target's live sessions on a password reset OR a SCOPE change (role demotion /
        // account move). Without the scope-change case, an open WebSocket kept the OLD, broader
        // scope indefinitely — a tsp_admin narrowed to one account still streamed the whole tenant
        // (audit B2). Compare against the target's PRE-update values so a no-op PATCH doesn't churn.
        const scopeChanged =
          (data.role !== undefined && data.role !== prevRole) ||
          (data.accountId !== undefined && data.accountId !== prevAccountId)
        if (password !== undefined || scopeChanged) {
          // every session of the TARGET user dies here: the row sweep plus the epoch stamp, in one
          // transaction, so a rotation already in flight cannot outrun it. Logged rather than
          // thrown: the role/password change is ALREADY COMMITTED, so a 500 here tells the admin
          // their edit failed when it did not, and they retry into a no-op. The WS teardown below
          // still runs, and the epoch is re-stamped by the next successful eviction.
          try {
            await db.auth.refreshTokens.revokeAllForUser(id(c), new Date())
          } catch (err) {
            console.error('user update: session revoke failed for', id(c), err instanceof Error ? err.message : String(err))
          }
          // …and tear down the target's LIVE WebSocket streams: revoking refresh families kills
          // HTTP access but a socket opened before the change keeps streaming otherwise (audit MED/B2).
          // Best-effort marker; the WS gateway re-validates on an interval AND ws-ticket issuance
          // now refuses a token minted before this marker (B1).
          await markSessionsRevoked(deps.redis, id(c))
        }
        return json(c, row)
      } },
    { method: 'delete', path: '/v1/users/:id', scopeClass: 'tenant', entity: 'user', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        // TIER GUARD (audit HIGH): a caller may not delete a peer-or-higher-tier user (DELETE had
        // NO tier check at all — a tsp_admin could delete a co-tenant platform_admin).
        const target = await db.users.get(scope, id(c))
        if (target === null) return problem(c, 404, 'Not Found')
        if (target.id !== a.userId && !canManageUser(a.role, target.role)) {
          return problem(c, 403, 'Forbidden', 'cannot delete a user of equal or higher privilege')
        }
        const ok = await db.users.remove(scope, { userId: a.userId }, id(c))
        // a deleted user's live WS stream must not keep flowing — mark the session revoked so the
        // gateway drops any socket they still hold (audit R2-5; parity with the password-change path)
        if (ok) await markSessionsRevoked(deps.redis, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },

    // ── devices (account) — syncs the ingest/worker Redis registries ─────────
    { method: 'get', path: '/v1/devices', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => json(c, await db.devices.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/devices/:id', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const row = await db.devices.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/devices', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, deviceCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if ((await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        const budget = await reserveDeviceBudget(deps, a.tenantId, 1)
        if ('retryAfterS' in budget) {
          c.header('Retry-After', String(budget.retryAfterS))
          return problem(c, 429, 'Too Many Requests', 'device creation rate exceeded for this tenant')
        }
        // tenant-plan device cap (WP2): Direct plans cap non-retired devices; TSP plans are uncapped
        // (deviceLimit null). Counted at TENANT scope. The count-then-create is serialized per tenant
        // by a short Redis lock so concurrent creates can't each pass at limit-1 and overshoot the
        // hard cap (review MED). A concurrent create loses the lock → 409, retry (rare admin path).
        // one device is reserved; `created` decides how much of it is kept. Every path out of here
        // that does NOT create a device — plan cap, bad profile, duplicate IMEI, a lost lock whose
        // own answer is "retry", and any THROW — must give the reservation back, or a customer pays
        // for rejections they were told to retry. The entitlement read lives inside the try for
        // exactly that reason: a pool blip there used to leak the reservation, and ten of them lock
        // a tenant out for the rest of the window.
        let created = 0
        try {
        const cap = (await db.tenants.getEntitlements(a.tenantId)).deviceLimit
        return await withDeviceCapLock(deps.redis, a.tenantId, cap, async () => {
          if (cap !== null && (await db.devices.countActive({ tenantId: a.tenantId })) + 1 > cap) {
            return problem(c, 403, 'Forbidden', 'device_limit_reached')
          }
          // validate the (global) profile — a bad uuid would else be a P2003 500 (review MED)
          const profile = await db.profiles.get(data.profileId)
          if (profile === null) return problem(c, 400, 'Bad Request', 'unknown profileId')
          // An IMEI is claimed by an ACTIVE device here, or by ANY device in another tenant —
          // the repo throws DuplicateImeiError for both and never says which
          // (including another tenant's), translated to 409 here so a cross-tenant clash
          // is not a 500 and does not reveal the other tenant's row (review HIGH)
          let device
          try {
            device = await db.devices.create(scopeOf(a), { userId: a.userId }, { ...data, accountId })
          } catch (err) {
            if (err instanceof DuplicateImeiError) return problem(c, 409, 'Conflict', 'IMEI already registered')
            throw err
          }
          await activateDevice(deps.redis, {
            id: device.id, imei: device.imei, tenantId: a.tenantId, accountId,
            config: { presenceRules: profile.presenceRules, odometerSource: device.odometerSource, avlTable: profile.avlTable }, // E04-5
          })
          created = 1 // the row exists; the reservation is now a real charge
          return json(c, device, 201)
        }, () => problem(c, 409, 'Conflict', 'device_create_in_progress'))
        } finally {
          await settleDeviceBudget(deps, a.tenantId, budget.reserved, created)
        }
      } },
    { method: 'patch', path: '/v1/devices/:id', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const data = await body(c, deviceUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.devices.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        if (row === null) return problem(c, 404, 'Not Found')
        // E04-5: odometerSource / profile may have changed → re-sync the worker's trip config
        // (skip a retired device — it's out of the registry; syncing would leave an orphan key)
        if (row.retiredAt === null && (data.odometerSource !== undefined || data.profileId !== undefined)) {
          const profile = await db.profiles.get(row.profileId)
          await syncDeviceConfig(deps.redis, row.id, profile?.presenceRules, row.odometerSource, profile?.avlTable)
        }
        return json(c, row)
      } },
    { method: 'delete', path: '/v1/devices/:id', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        // retire = registry teardown THEN DB soft-delete. Registry FIRST so a Redis
        // failure leaves the device consistently active-in-both (fail-safe: better a
        // reconcile-retry than a "retired" device that ingest still accepts — review MED)
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        await deactivateDevice(deps.redis, { id: device.id, imei: device.imei, tenantId: device.tenantId }) // ingest rejects next connect (AC[2])
        const row = await db.devices.retire(scope, { userId: auth(c).userId }, id(c))
        return json(c, row ?? device)
      } },
    // ── device history (E04-3, §6.6) — device-scope gated, then raw-SQL positions ──
    { method: 'get', path: '/v1/devices/:id/positions', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        // scope gate FIRST: prove the device is in the caller's tenant/account (404 else),
        // and only then read positions by the validated numeric id — never the raw :id
        const device = await db.devices.get(scopeOf(auth(c)), id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        if (deps.pool === undefined) return problem(c, 503, 'Unavailable', 'positions store not configured')
        const q = c.req.query.bind(c.req)
        return json(c, await readPositions(deps.pool, device.id, {
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('cursor') !== undefined ? { cursor: q('cursor')! } : {}),
          ...(q('limit') !== undefined ? { limit: Number(q('limit')) } : {}),
        }))
      } },
    // fuel series for the playback fuel graph (E08-3) — same gate + raw-SQL shape as positions
    { method: 'get', path: '/v1/devices/:id/fuel', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const device = await db.devices.get(scopeOf(auth(c)), id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        if (deps.pool === undefined) return problem(c, 503, 'Unavailable', 'positions store not configured')
        const q = c.req.query.bind(c.req)
        return json(c, await readFuelSeries(deps.pool, device.id, {
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('limit') !== undefined ? { limit: Number(q('limit')) } : {}),
        }))
      } },
    // device-health series + summary (V1-nice) — GSM/voltage trend, last-seen, firmware
    { method: 'get', path: '/v1/devices/:id/health', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        if (deps.pool === undefined) return problem(c, 503, 'Unavailable', 'positions store not configured')
        const q = c.req.query.bind(c.req)
        // the profile's table decides AVL 66's scale — FMB930 reports external voltage on a
        // different factor and the wiki instructs the backend to correct it (see health.ts)
        const healthProfile = await db.profiles.get(device.profileId)
        const series = await readHealthSeries(deps.pool, device.id, {
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('limit') !== undefined ? { limit: Number(q('limit')) } : {}),
          ...(healthProfile !== null ? { avlTable: healthProfile.avlTable } : {}),
        })
        // firmware = newest acked getver response (E08-2 commands)
        const cmds = await db.commands.listForDevice(scope, device.id)
        const firmware = cmds.find((cmd) => cmd.text.trim().toLowerCase() === 'getver' && cmd.status === 'acked' && cmd.response !== null)?.response ?? null
        const latest = series.length > 0 ? series[series.length - 1] : null
        return json(c, { series, latest, firmware, lastSeen: latest?.fixTime ?? null })
      } },
    // latest CAN/OBD engine snapshot (V2) — null when the vehicle has no CAN adapter
    { method: 'get', path: '/v1/devices/:id/can', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        if (deps.pool === undefined) return problem(c, 503, 'Unavailable', 'positions store not configured')
        return json(c, await readCanLatest(deps.pool, device.id))
      } },
    { method: 'get', path: '/v1/devices/:id/trips', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        const q = c.req.query.bind(c.req)
        return json(c, await db.trips.list(scope, {
          deviceId: device.id.toString(),
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('limit') !== undefined ? { take: Number(q('limit')) } : {}),
        }))
      } },

    // ── Codec-12 commands (E08-2, §3.5) — device-scope gated ──────────────────
    { method: 'get', path: '/v1/devices/:id/commands', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        return json(c, await db.commands.listForDevice(scope, device.id))
      } },
    { method: 'post', path: '/v1/devices/:id/commands', scopeClass: 'account', entity: 'command', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const device = await db.devices.get(scope, id(c)) // scope gate FIRST (404 else)
        if (device === null) return problem(c, 404, 'Not Found')
        if (device.retiredAt !== null) return problem(c, 400, 'Bad Request', 'device is retired')
        const data = await body(c, commandCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const cmd = await db.commands.create(scope, { userId: a.userId }, { deviceId: device.id, accountId: device.accountId, text: data.text })
        // transport seam (E08-2): queue for ingest to send + wake the dispatcher. Carry
        // expiresAtMs so a command still queued at 24 h is purged (never drained+executed on a
        // late reconnect — critical for destructive presets like deleterecords/cpureset).
        await bestEffortSync(async () => {
          const pendKey = `cmd:pending:${device.id.toString()}`
          await deps.redis.rpush(pendKey, JSON.stringify({ id: cmd.id, text: cmd.text, attempt: 0, expiresAtMs: Date.parse(cmd.expiresAt) }))
          await deps.redis.expire(pendKey, 24 * 3_600) // bound the list if the device never connects
          await deps.redis.sadd('cmd:active', device.id.toString())
        })
        return json(c, cmd, 201)
      } },
    { method: 'get', path: '/v1/commands/:id', scopeClass: 'account', entity: 'command', shape: 'item',
      handler: async (c) => {
        const row = await db.commands.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },

    // ── temporary public share links (V1-nice) ─────────────────────────────────
    // create a share for a device — scope gate FIRST (404 before body validation, so a
    // cross-tenant device is indistinguishable from a bad body); accountId pinned from the device.
    { method: 'post', path: '/v1/devices/:id/shares', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        // Retiring revokes a device's live links; minting a NEW one afterwards would re-open the
        // unauthenticated endpoint for a vehicle the operator has already said is no longer theirs
        // (audit review MED). Retire is a soft delete, so `get` still returns the row.
        if (device.retiredAt !== null) return problem(c, 409, 'Conflict', 'device is retired')
        const data = await body(c, shareCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const created = await db.shareLinks.create(scope, { userId: a.userId }, {
          deviceId: device.id, accountId: device.accountId, ttlHours: data.ttlHours,
          ...(data.label !== undefined ? { label: data.label } : {}),
        })
        // return the plaintext token ONCE + a relative path; the web app prepends its own origin
        return json(c, { token: created.token, path: `/s/${created.token}`, view: created.view }, 201)
      } },
    { method: 'get', path: '/v1/devices/:id/shares', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        return json(c, await db.shareLinks.list(scope, device.id))
      } },
    { method: 'get', path: '/v1/shares', scopeClass: 'account', entity: 'share', shape: 'collection',
      handler: async (c) => json(c, await db.shareLinks.list(scopeOf(auth(c)))) },
    { method: 'delete', path: '/v1/shares/:id', scopeClass: 'account', entity: 'share', shape: 'item',
      handler: async (c) => {
        const ok = await db.shareLinks.revoke(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },
    // SMS onboarding sheet (V1-nice) — point a device at us without Teltonika software
    { method: 'get', path: '/v1/devices/:id/onboarding', scopeClass: 'account', entity: 'device', shape: 'item',
      handler: async (c) => {
        const device = await db.devices.get(scopeOf(auth(c)), id(c))
        if (device === null) return problem(c, 404, 'Not Found')
        const profile = await db.profiles.get(device.profileId)
        const target = deps.onboarding ?? { host: '', port: 5027 }
        const apnRaw = c.req.query('apn')
        // smsEnabled: whether the platform can actually SEND this config SMS (Twilio configured) — the
        // web hides the "Send config SMS" button when false and falls back to manual copy-paste.
        return json(c, {
          ...buildOnboarding({
            imei: device.imei,
            host: target.host,
            port: target.port,
            ...(apnRaw !== undefined ? { apn: apnRaw } : {}),
            ...(profile !== null ? { family: profile.key } : {}),
          }),
          smsEnabled: deps.sms !== undefined,
        })
      } },

    // ── SMS gateway (SMS gateway feature) — send Teltonika config SMS to a device's SIM ──
    // POST enqueues a send (config SMS from buildOnboarding, or an explicit body); GET polls status.
    // TSP-only (smsGateway entitlement). ACCOUNT_WRITERS on POST; GET reuses the device read policy.
    { method: 'post', path: '/v1/devices/:id/sms', scopeClass: 'account', entity: 'sms', shape: 'item', entitlement: 'smsGateway',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const device = await db.devices.get(scope, id(c)) // scope gate FIRST (404 else)
        if (device === null) return problem(c, 404, 'Not Found')
        if (device.retiredAt !== null) return problem(c, 400, 'Bad Request', 'device is retired')
        // platform SMS not configured (no Twilio creds) → 503 BEFORE the msisdn check, so an
        // unconfigured platform never masquerades as a per-device data problem (mirrors gdpr's 503)
        if (deps.sms === undefined) return problem(c, 503, 'Unavailable', 'sms not configured')
        if (!device.simMsisdn) return problem(c, 400, 'Bad Request', 'device has no SIM phone number')
        const data = await body(c, smsSendRequestSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        // `body` overrides the generated text. Bound it to the ALLOW-LIST of Teltonika command
        // templates until an arbitrary-command feature is actually designed: free-form text to an
        // arbitrary MSISDN from the platform's sender is a smishing relay, not a device command.
        // Checked BEFORE the quota — it is a pure function of the parsed body, so a rejected
        // request must not spend a budget that then locks the device out of onboarding for a day.
        if (data.body !== undefined && !isAllowedSmsCommand(data.body)) {
          return problem(c, 400, 'Bad Request', 'body must be a supported device command')
        }
        // QUOTAS (audit high). Every send is a real, billable message from the PLATFORM's Twilio
        // sender to a caller-chosen E.164 number — the destination comes from `simMsisdn`, which
        // the same role sets with only a syntactic regex, so any number worldwide (premium ranges
        // included) is reachable. Nothing here was metered or re-billed, so the cost was 100%
        // unrecoverable platform spend plus smishing risk against a shared sender id. Three
        // bounds: per device (stop a loop), per tenant (stop an account), and a platform-wide
        // breaker (stop everyone at once). Fail CLOSED — a Redis blip must not open the tap.
        const smsQuota = deps.smsQuota ?? DEFAULT_SMS_QUOTA
        try {
          const over = async (key: string, max: number, windowS: number): Promise<boolean> =>
            ((await deps.redis.eval(RL_SCRIPT, 1, key, String(windowS))) as number) > max
          if (await over(`sms:q:dev:${device.id}`, smsQuota.perDevicePerDay, 86_400)) {
            deps.onSmsQuotaRejected?.('device')
            return problem(c, 429, 'Too Many Requests', 'sms quota exceeded for this device')
          }
          if (await over(`sms:q:ten:${a.tenantId}`, smsQuota.perTenantPerDay, 86_400)) {
            deps.onSmsQuotaRejected?.('tenant')
            return problem(c, 429, 'Too Many Requests', 'sms quota exceeded for this account')
          }
          if (await over('sms:q:global', smsQuota.globalPerDay, 86_400)) {
            // the platform-wide breaker refuses SMS for EVERY tenant until the window rolls, so it
            // has to be visible: the counter is alerted on (SmsQuotaTripped) and the manual reset
            // is `DEL sms:q:global` — see docs/runbooks/w7-alerting.md
            deps.onSmsQuotaRejected?.('global')
            console.error('sms platform-wide quota tripped — refusing all sends')
            return problem(c, 503, 'Unavailable', 'sms temporarily unavailable')
          }
        } catch (err) {
          console.error('sms quota check unavailable', err)
          return problem(c, 503, 'Unavailable', 'sms temporarily unavailable')
        }
        // build the config SMS via buildOnboarding (the SAME generator as the onboarding sheet); a
        // caller may override the generated text with an explicit body (future arbitrary command).
        const profile = await db.profiles.get(device.profileId)
        const target = deps.onboarding ?? { host: '', port: 5027 }
        const sheet = buildOnboarding({
          imei: device.imei,
          host: target.host,
          port: target.port,
          ...(data.apn !== undefined ? { apn: data.apn } : {}),
          ...(profile !== null ? { family: profile.key } : {}),
        })
        // smsAuto = APN (when supplied) + server params in ONE setparam, so a device with no
        // auto-APN gets data AND the server address from a single SMS (server-only when no APN)
        // An unconfigured ingest host yields no command at all. REFUSE rather than invent one: the
        // alternative was a default that pointed a reseller's customer's hardware at our domain,
        // permanently, from inside the device.
        const bodyText = data.body ?? sheet.smsAuto
        if (bodyText === null) return problem(c, 503, 'Service Unavailable', 'ingest host is not configured (INGEST_PUBLIC_HOST)')
        // persist a 'queued' delivery FIRST (the id is the BullMQ jobId), then enqueue.
        const delivery = await db.smsDeliveries.create(scope, { deviceId: device.id, accountId: device.accountId, to: device.simMsisdn, body: bodyText, provider: 'twilio' })
        try {
          await deps.sms.enqueue({ smsDeliveryId: delivery.id, deviceId: device.id.toString(), tenantId: a.tenantId, to: device.simMsisdn, body: bodyText, provider: 'twilio' })
        } catch (err) {
          // enqueue failed (e.g. Redis down) — mark the freshly-created row failed so it is not a
          // stuck 'queued' ghost the worker never drains, and 503 so the caller can retry (review)
          console.error('sms enqueue failed', err) // no secrets (to/body may carry a phone number → not logged)
          // best-effort breadcrumb: if markFailed itself throws (DB blip) the caller still gets the
          // intended 503 (never a 500), and the row stays 'queued' — honest, since nothing was sent
          await db.smsDeliveries.markFailed(delivery.id, 'enqueue failed').catch((e) => console.error('sms markFailed failed', e))
          // nothing left the building, so give the budget back — otherwise a Redis outage burns the
          // device's whole daily allowance on retries that never sent an SMS
          await Promise.all([
            deps.redis.decr(`sms:q:dev:${device.id}`),
            deps.redis.decr(`sms:q:ten:${a.tenantId}`),
            deps.redis.decr('sms:q:global'),
          ]).catch(() => undefined)
          return problem(c, 503, 'Unavailable', 'sms enqueue failed')
        }
        return json(c, delivery, 201)
      } },
    { method: 'get', path: '/v1/devices/:id/sms', scopeClass: 'account', entity: 'device', shape: 'item', entitlement: 'smsGateway',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const device = await db.devices.get(scope, id(c)) // scope gate FIRST (404 else)
        if (device === null) return problem(c, 404, 'Not Found')
        return json(c, await db.smsDeliveries.listForDevice(scope, device.id))
      } },

    // ── GDPR (E08-4): device-erase cascade + account data export ────────────────
    { method: 'post', path: '/v1/devices/:id/erase', scopeClass: 'account', entity: 'gdpr', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const device = await db.devices.get(scope, id(c)) // scope gate FIRST (404 else)
        if (device === null) return problem(c, 404, 'Not Found')
        // retire tears down the ingest registry — erasing a LIVE device would race new data
        if (device.retiredAt === null) return problem(c, 400, 'Bad Request', 'retire the device first')
        if (deps.gdpr === undefined) return problem(c, 503, 'Unavailable', 'gdpr queue not configured')
        // a live session survives retire until its idle timeout and the stream backlog drains
        // async — an instant erase would race in-flight positions that then resurrect after
        // the delete with NO remaining erase path (device row gone → 404 forever). Wait out
        // the window (review HIGH-1); the worker also runs a post-delete final sweep.
        const minRetiredMs = deps.gdpr.eraseMinRetiredMs ?? 60 * 60_000
        if (Date.now() - new Date(device.retiredAt).getTime() < minRetiredMs) {
          return problem(c, 409, 'Conflict', `retired too recently — erase is allowed ${Math.ceil(minRetiredMs / 60_000)} min after retire`)
        }
        await db.audit.record(scope, { userId: a.userId }, { action: 'delete', entity: 'device', entityId: device.id.toString(), before: { imei: device.imei, name: device.name, gdprErase: true } })
        // imei + accountId travel with the job: `raw_rejects` keys on the IMEI and the export sweep
        // on the account, and the devices row that holds both is deleted mid-erase
        await deps.gdpr.enqueueErase({ deviceId: device.id.toString(), tenantId: scope.tenantId, imei: device.imei, accountId: device.accountId })
        return json(c, { queued: true, deviceId: device.id.toString() }, 202)
      } },
    { method: 'post', path: '/v1/accounts/:id/export', scopeClass: 'account', entity: 'export', shape: 'item',
      handler: async (c) => {
        const a = auth(c)
        const scope = scopeOf(a)
        const account = await db.accounts.get(scope, id(c)) // scope gate FIRST (404 else)
        if (account === null) return problem(c, 404, 'Not Found')
        if (deps.gdpr === undefined) return problem(c, 503, 'Unavailable', 'gdpr queue not configured')
        // coalesce: a pending export already covers this request — do not pile up
        // full-history files on disk (review MED-3 flood guard)
        const pending = await db.exports.findPending(scope, account.id)
        if (pending !== null) {
          // SELF-HEAL (review): if the BullMQ job was lost (Redis restart), a zombie pending
          // row would coalesce every future POST forever. Re-enqueue: BullMQ dedupes by jobId
          // if the job still exists; if it vanished, this actually runs it (idempotent).
          await deps.gdpr.enqueueExport({ exportId: pending.id })
          return json(c, pending, 200)
        }
        const job = await db.exports.create(scope, { userId: a.userId }, account.id)
        await deps.gdpr.enqueueExport({ exportId: job.id })
        return json(c, job, 201)
      } },
    // pilot leads from the public site (W9-S1) — platform sales inbox
    { method: 'get', path: '/v1/platform/leads', scopeClass: 'platform', entity: 'lead', shape: 'collection',
      handler: async (c) => json(c, await db.leads.list()) },
    { method: 'get', path: '/v1/exports', scopeClass: 'account', entity: 'export', shape: 'collection',
      handler: async (c) => json(c, await db.exports.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/exports/:id', scopeClass: 'account', entity: 'export', shape: 'item',
      handler: async (c) => {
        const row = await db.exports.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'get', path: '/v1/exports/:id/download', scopeClass: 'account', entity: 'export', shape: 'item',
      handler: async (c) => {
        const info = await db.exports.pathOf(scopeOf(auth(c)), id(c))
        if (info === null) return problem(c, 404, 'Not Found')
        if (info.status === 'expired') return problem(c, 410, 'Gone', 'export expired')
        if (info.status !== 'done' || info.path === null) return problem(c, 404, 'Not Found')
        const { createReadStream } = await import('node:fs')
        const { stat, unlink } = await import('node:fs/promises')
        if (info.expiresAt.getTime() < Date.now()) {
          // lazy expiry cleanup (review MED-3): the worker sweep is the durable one; this
          // best-effort unlink stops an expired personal-data dump lingering after a hit
          await unlink(info.path).catch(() => undefined)
          return problem(c, 410, 'Gone', 'export expired')
        }
        const st = await stat(info.path).catch(() => null)
        if (st === null) return problem(c, 410, 'Gone', 'export file removed')
        // GDPR personal-data dump: never cacheable (parity with json(); this handler streams via
        // c.body and so bypasses the json() helper that stamps no-store on every other read)
        c.header('Cache-Control', 'no-store')
        c.header('content-type', 'application/gzip')
        // brand-neutral: this file is handed to the data subject, who on a white-label tenant has
        // never heard of us and should not learn our name from a filename
        c.header('content-disposition', `attachment; filename="fleet-data-export-${id(c)}.ndjson.gz"`)
        c.header('content-length', String(st.size))
        const nodeStream = createReadStream(info.path)
        const { Readable } = await import('node:stream')
        return c.body(Readable.toWeb(nodeStream) as ReadableStream)
      } },

    { method: 'post', path: '/v1/devices/import/preview', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => {
        const parsed = await body(c, deviceImportSchema)
        if (parsed === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const profileKeys = new Set((await db.profiles.map()).keys())
        const rows = rowsToImport(parseCsv(parsed.csv))
        if (rows.length > MAX_IMPORT_ROWS) return problem(c, 400, 'Bad Request', `too many rows (max ${MAX_IMPORT_ROWS})`)
        const result = await dryRun(db, scopeOf(a), rows, profileKeys, a.accountId)
        // tenant-plan device cap (WP2): preview surfaces an over-cap batch as a BLOCKING error
        // row (not a 403) so the UI can show the diff and the reason together. Uses the SAME
        // conservative denominator as the apply path (raw rows.length) so a preview that passes
        // can never be followed by an apply that 403s (review LOW: preview/apply mismatch).
        const cap = (await db.tenants.getEntitlements(a.tenantId)).deviceLimit
        if (cap !== null) {
          const active = await db.devices.countActive({ tenantId: a.tenantId })
          if (active + rows.length > cap) {
            result.errors.push({ row: 0, imei: '', reason: `device_limit_reached (plan allows ${cap}; ${active} active + ${rows.length} rows)` })
          }
        }
        return json(c, result)
      } },
    { method: 'post', path: '/v1/devices/import', scopeClass: 'account', entity: 'device', shape: 'collection',
      handler: async (c) => {
        const parsed = await body(c, deviceImportSchema)
        if (parsed === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const profiles = await db.profiles.map()
        const rows = rowsToImport(parseCsv(parsed.csv))
        if (rows.length > MAX_IMPORT_ROWS) return problem(c, 400, 'Bad Request', `too many rows (max ${MAX_IMPORT_ROWS})`)
        // Checked on the APPLY path only — the preview reads nothing it could not read anyway and
        // creates nothing, so metering it would make a two-step UI cost twice its own budget. The
        // CHARGE happens after the apply, for the rows that actually became devices.
        const importBudget = await reserveDeviceBudget(deps, a.tenantId, rows.length)
        if ('retryAfterS' in importBudget) {
          c.header('Retry-After', String(importBudget.retryAfterS))
          return problem(c, 429, 'Too Many Requests', 'device creation rate exceeded for this tenant')
        }
        // tenant-plan device cap (WP2): reject the whole batch if it could push the fleet over the
        // cap. Conservative bound (rows.length, before dedup/updates) — Direct plans are small and
        // this admin path is low-frequency, so refusing a would-be-over batch is the safe default.
        // the whole batch is reserved; only the rows that became devices are kept. `applyImport`
        // writes its create-rows and reports the rest, so a re-uploaded CSV, a file of duplicates
        // and a batch of bad IMEIs all settle back to zero — as do the plan-cap 403, the lost-lock
        // 409 whose own answer is "retry", and any throw. The entitlement read is inside the try so
        // a pool blip cannot leak a 1000-device reservation.
        let imported = 0
        try {
        const cap = (await db.tenants.getEntitlements(a.tenantId)).deviceLimit
        // SAME lock as the single create (audit MED): two concurrent 5-row imports on a 10-device
        // plan with 5 active devices both saw `5 + 5 > 10` as false and both proceeded.
        return await withDeviceCapLock(deps.redis, a.tenantId, cap, async () => {
          if (cap !== null && (await db.devices.countActive({ tenantId: a.tenantId })) + rows.length > cap) {
            return problem(c, 403, 'Forbidden', 'device_limit_reached')
          }
          const result = await applyImport(db, deps.redis, scopeOf(a), { userId: a.userId }, rows, profiles, a.accountId)
          imported = result.created
          return json(c, result, 201)
        }, () => problem(c, 409, 'Conflict', 'device_create_in_progress'))
        } finally {
          await settleDeviceBudget(deps, a.tenantId, importBudget.reserved, imported)
        }
      } },

    // ── rules (account) ──────────────────────────────────────────────────────
    { method: 'get', path: '/v1/rules', scopeClass: 'account', entity: 'rule', shape: 'collection',
      handler: async (c) => json(c, await db.rules.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const row = await db.rules.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/rules', scopeClass: 'account', entity: 'rule', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, ruleCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if ((await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        const rule = await db.rules.create(scopeOf(a), { userId: a.userId }, { ...data, accountId })
        await bestEffortSync(() => syncRule(deps.redis, rule)) // publish to the worker's rule cache (E05-4)
        return json(c, rule, 201)
      } },
    { method: 'patch', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const data = await body(c, ruleUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.rules.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        if (row === null) return problem(c, 404, 'Not Found')
        await bestEffortSync(() => syncRule(deps.redis, row)) // re-publish the updated rule (E05-4)
        return json(c, row)
      } },
    { method: 'delete', path: '/v1/rules/:id', scopeClass: 'account', entity: 'rule', shape: 'item',
      handler: async (c) => {
        const ok = await db.rules.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        if (!ok) return problem(c, 404, 'Not Found')
        await bestEffortSync(() => removeRule(deps.redis, auth(c).tenantId, id(c))) // drop from the worker's rule cache
        return json(c, { ok: true })
      } },

    // ── drivers (account, V2 registry) ─────────────────────────────────────────
    { method: 'get', path: '/v1/drivers', scopeClass: 'account', entity: 'driver', shape: 'collection',
      handler: async (c) => json(c, await db.drivers.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/drivers/:id', scopeClass: 'account', entity: 'driver', shape: 'item',
      handler: async (c) => {
        const row = await db.drivers.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/drivers', scopeClass: 'account', entity: 'driver', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, driverCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if (accountId === undefined || (await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        try {
          const created = await db.drivers.create(scopeOf(a), { userId: a.userId }, { ...data, accountId })
          // publish the iButton→driver mapping to the worker's resolution map (V2 Part B, best-effort)
          await bestEffortSync(() => syncDriverIbutton(deps.redis, created.tenantId, created.accountId, created.id, created.ibutton, null), 'driver ibutton sync')
          return json(c, created, 201)
        } catch (err) {
          // tenant-local iButton clash → 409 (never a 500, never reveal the holder — review pattern)
          if (err instanceof DriverIbuttonConflictError) return problem(c, 409, 'Conflict', 'iButton already assigned')
          throw err
        }
      } },
    { method: 'patch', path: '/v1/drivers/:id', scopeClass: 'account', entity: 'driver', shape: 'item',
      handler: async (c) => {
        const data = await body(c, driverUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const scope = scopeOf(auth(c))
        const before = await db.drivers.get(scope, id(c)) // old iButton, to drop the stale mapping
        try {
          const row = await db.drivers.update(scope, { userId: auth(c).userId }, id(c), data)
          if (row === null) return problem(c, 404, 'Not Found')
          await bestEffortSync(() => syncDriverIbutton(deps.redis, row.tenantId, row.accountId, row.id, row.ibutton, before?.ibutton ?? null), 'driver ibutton sync')
          return json(c, row)
        } catch (err) {
          if (err instanceof DriverIbuttonConflictError) return problem(c, 409, 'Conflict', 'iButton already assigned')
          throw err
        }
      } },
    { method: 'delete', path: '/v1/drivers/:id', scopeClass: 'account', entity: 'driver', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        const before = await db.drivers.get(scope, id(c)) // capture the iButton to drop its mapping
        const ok = await db.drivers.remove(scope, { userId: auth(c).userId }, id(c))
        if (!ok) return problem(c, 404, 'Not Found')
        if (before !== null) await bestEffortSync(() => removeDriverIbutton(deps.redis, before.tenantId, before.accountId, before.ibutton), 'driver ibutton sync')
        return json(c, { ok: true })
      } },

    // ── scheduled emailed reports (account, V1-nice) ───────────────────────────
    { method: 'get', path: '/v1/scheduled-reports', scopeClass: 'account', entity: 'scheduledReport', shape: 'collection',
      handler: async (c) => json(c, await db.scheduledReports.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/scheduled-reports/:id', scopeClass: 'account', entity: 'scheduledReport', shape: 'item',
      handler: async (c) => {
        const row = await db.scheduledReports.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/scheduled-reports', scopeClass: 'account', entity: 'scheduledReport', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, scheduledReportCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if (accountId === undefined) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        const account = await db.accounts.get(scopeOf(a), accountId)
        if (account === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        // default to the ACCOUNT's timezone (§7.7 account-local day boundaries) — the DB column
        // defaults to 'UTC', which would make emailed reports bucket days differently from the
        // interactive report (POST /v1/reports/:type uses account.timezone). The form omits it.
        return json(c, await db.scheduledReports.create(scopeOf(a), { userId: a.userId }, { ...data, accountId, timezone: data.timezone ?? account.timezone }), 201)
      } },
    { method: 'patch', path: '/v1/scheduled-reports/:id', scopeClass: 'account', entity: 'scheduledReport', shape: 'item',
      handler: async (c) => {
        const data = await body(c, scheduledReportUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const scope = scopeOf(auth(c))
        const before = await db.scheduledReports.get(scope, id(c))
        if (before === null) return problem(c, 404, 'Not Found')
        // cross-field guard on the MERGED row: a weekly schedule must keep a weekday, else the cron
        // silently never fires (the partial update schema can't see the existing row on its own)
        const cadence = data.cadence ?? before.cadence
        const weekday = data.weekday !== undefined ? data.weekday : before.weekday
        if (cadence === 'weekly' && (weekday === null || weekday === undefined)) return problem(c, 400, 'Bad Request', 'weekly cadence requires a weekday')
        const row = await db.scheduledReports.update(scope, { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/scheduled-reports/:id', scopeClass: 'account', entity: 'scheduledReport', shape: 'item',
      handler: async (c) => {
        const ok = await db.scheduledReports.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },

    // ── maintenance reminders (account, V2) — due computed at read from current odometer + now ──
    { method: 'get', path: '/v1/maintenance', scopeClass: 'account', entity: 'maintenance', shape: 'collection',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        // optional device filter — toDeviceId range-guards int8 (a huge-but-numeric id must not 500)
        const bid = toDeviceId(c.req.query('deviceId') ?? '')
        const items = await db.maintenance.list(scope, ...(bid !== null ? ([bid] as const) : ([] as const)))
        const odo = await odoMap([...new Set(items.map((i) => i.deviceId))]) // one batched read
        return json(c, items.map((i) => toMaintView(i, odo)))
      } },
    { method: 'get', path: '/v1/maintenance/:id', scopeClass: 'account', entity: 'maintenance', shape: 'item',
      handler: async (c) => {
        const item = await db.maintenance.get(scopeOf(auth(c)), id(c))
        if (item === null) return problem(c, 404, 'Not Found')
        return json(c, toMaintView(item, await odoMap([item.deviceId])))
      } },
    { method: 'post', path: '/v1/maintenance', scopeClass: 'account', entity: 'maintenance', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, maintenanceCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const scope = scopeOf(a)
        // the target device must be in the caller's scope (never schedule against another's device)
        const device = await db.devices.get(scope, data.deviceId)
        if (device === null) return problem(c, 400, 'Bad Request', 'deviceId not in scope')
        const odo = await odoMap([device.id])
        // a km reminder with no explicit baseline starts from the device's CURRENT odometer, so it
        // begins with a full interval remaining — NOT baselined at 0 (which would read overdue at
        // once on a used vehicle). Falls back to null (status 'unknown') if no odometer is known.
        const kmBaseline = data.intervalKm != null && data.lastServiceOdoKm == null
          ? (odo.get(device.id.toString()) != null ? Math.round(odo.get(device.id.toString())!) : null)
          : (data.lastServiceOdoKm ?? null)
        const created = await db.maintenance.create(scope, { userId: a.userId }, {
          accountId: device.accountId, deviceId: device.id, title: data.title,
          intervalKm: data.intervalKm ?? null, intervalDays: data.intervalDays ?? null,
          lastServiceOdoKm: kmBaseline,
          lastServiceAt: data.lastServiceAt != null ? new Date(data.lastServiceAt) : (data.intervalDays != null ? new Date() : null),
          ...(data.active !== undefined ? { active: data.active } : {}),
        })
        return json(c, toMaintView(created, odo), 201)
      } },
    { method: 'patch', path: '/v1/maintenance/:id', scopeClass: 'account', entity: 'maintenance', shape: 'item',
      handler: async (c) => {
        const data = await body(c, maintenanceUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.maintenance.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), {
          ...('title' in data ? { title: data.title } : {}),
          ...('intervalKm' in data ? { intervalKm: data.intervalKm ?? null } : {}),
          ...('intervalDays' in data ? { intervalDays: data.intervalDays ?? null } : {}),
          ...('lastServiceOdoKm' in data ? { lastServiceOdoKm: data.lastServiceOdoKm ?? null } : {}),
          ...('lastServiceAt' in data ? { lastServiceAt: data.lastServiceAt != null ? new Date(data.lastServiceAt) : null } : {}),
          ...('active' in data ? { active: data.active } : {}),
        })
        return row === null ? problem(c, 404, 'Not Found') : json(c, toMaintView(row, await odoMap([row.deviceId])))
      } },
    { method: 'delete', path: '/v1/maintenance/:id', scopeClass: 'account', entity: 'maintenance', shape: 'item',
      handler: async (c) => {
        const ok = await db.maintenance.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },
    // record a completed service — resets the baseline (odo + timestamp) for the next due
    { method: 'post', path: '/v1/maintenance/:id/serviced', scopeClass: 'account', entity: 'maintenance', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        if (await db.maintenance.get(scope, id(c)) === null) return problem(c, 404, 'Not Found')
        const data = await body(c, markServicedSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const at = data.at != null ? new Date(data.at) : new Date()
        const row = await db.maintenance.markServiced(scope, { userId: auth(c).userId }, id(c), at, data.odoKm ?? null)
        return row === null ? problem(c, 404, 'Not Found') : json(c, toMaintView(row, await odoMap([row.deviceId])))
      } },

    // ── geofences (account-scoped, nullable account = tenant-shared, E05-1) ────
    { method: 'get', path: '/v1/geofences', scopeClass: 'account', entity: 'geofence', shape: 'collection',
      handler: async (c) => json(c, await db.geofences.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/geofences/:id', scopeClass: 'account', entity: 'geofence', shape: 'item',
      handler: async (c) => {
        const row = await db.geofences.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/geofences', scopeClass: 'account', entity: 'geofence', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, geofenceCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        // account users are pinned to their account; a tenant admin may target an account or
        // null (tenant-shared). A named account must be in scope.
        const accountId = a.accountId !== undefined ? a.accountId : (data.accountId ?? null)
        if (accountId !== null && (await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        try {
          const gf = await db.geofences.create(scopeOf(a), { userId: a.userId }, { ...data, accountId })
          await bestEffortSync(() => syncGeofence(deps.redis, gf)) // publish to the worker's geom cache (E05-2)
          return json(c, gf, 201)
        } catch (err) {
          if (err instanceof GeofenceTooLargeError || err instanceof GeofenceInvalidError || err instanceof GeofenceTooComplexError) return problem(c, 400, 'Bad Request', err.message)
          if (err instanceof GeofenceLimitError) return problem(c, 409, 'Conflict', err.message)
          throw err
        }
      } },
    { method: 'patch', path: '/v1/geofences/:id', scopeClass: 'account', entity: 'geofence', shape: 'item',
      handler: async (c) => {
        const data = await body(c, geofenceUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        try {
          const row = await db.geofences.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
          if (row === null) return problem(c, 404, 'Not Found')
          await bestEffortSync(() => syncGeofence(deps.redis, row)) // re-publish the updated geometry (E05-2)
          return json(c, row)
        } catch (err) {
          if (err instanceof GeofenceTooLargeError || err instanceof GeofenceInvalidError || err instanceof GeofenceTooComplexError) return problem(c, 400, 'Bad Request', err.message)
          if (err instanceof GeofenceLimitError) return problem(c, 409, 'Conflict', err.message)
          throw err
        }
      } },
    { method: 'delete', path: '/v1/geofences/:id', scopeClass: 'account', entity: 'geofence', shape: 'item',
      handler: async (c) => {
        const ok = await db.geofences.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        if (!ok) return problem(c, 404, 'Not Found')
        await bestEffortSync(() => removeGeofence(deps.redis, auth(c).tenantId, id(c))) // drop from the worker's geom cache
        return json(c, { ok: true })
      } },

    // ── webhooks (tenant, nullable account) ──────────────────────────────────
    { method: 'get', path: '/v1/webhooks', scopeClass: 'tenant', entity: 'webhook', shape: 'collection', entitlement: 'webhooks',
      handler: async (c) => json(c, await db.webhooks.list(scopeOf(auth(c)))) },
    { method: 'get', path: '/v1/webhooks/:id', scopeClass: 'tenant', entity: 'webhook', shape: 'item', entitlement: 'webhooks',
      handler: async (c) => {
        const row = await db.webhooks.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/webhooks', scopeClass: 'tenant', entity: 'webhook', shape: 'collection', entitlement: 'webhooks',
      handler: async (c) => {
        const data = await body(c, webhookCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const accountId = a.accountId !== undefined ? a.accountId : data.accountId
        if (accountId !== null && (await db.accounts.get(scopeOf(a), accountId)) === null) return problem(c, 400, 'Bad Request', 'accountId not in scope')
        return json(c, await db.webhooks.create(scopeOf(a), { userId: a.userId }, { ...data, accountId }), 201)
      } },
    { method: 'patch', path: '/v1/webhooks/:id', scopeClass: 'tenant', entity: 'webhook', shape: 'item', entitlement: 'webhooks',
      handler: async (c) => {
        const data = await body(c, webhookUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.webhooks.update(scopeOf(auth(c)), { userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'delete', path: '/v1/webhooks/:id', scopeClass: 'tenant', entity: 'webhook', shape: 'item', entitlement: 'webhooks',
      handler: async (c) => {
        const ok = await db.webhooks.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },

    // ── platform audit trail (affiliates/commissions — no subject tenant) ─────
    { method: 'get', path: '/v1/platform/audit', scopeClass: 'platform', entity: 'audit', shape: 'collection',
      // The money trail for the partner programme. Filed with tenantId NULL and readable ONLY here:
      // filing it under the acting admin's own tenant would split it across whichever tenants the
      // platform admins belong to AND expose every partner's commercial terms to that tenant's own
      // tsp_admins (READ_POLICY.audit = TENANT_ADMINS). Review MED.
      handler: async (c) => json(c, await db.audit.listPlatform({
        take: Number(c.req.query('limit') ?? 50),
        ...(c.req.query('cursor') !== undefined ? { cursor: c.req.query('cursor')! } : {}),
        ...(c.req.query('entity') !== undefined ? { entity: c.req.query('entity')! } : {}),
        ...(c.req.query('action') !== undefined ? { action: c.req.query('action')! } : {}),
        ...(c.req.query('from') !== undefined ? { from: c.req.query('from')! } : {}),
        ...(c.req.query('to') !== undefined ? { to: c.req.query('to')! } : {}),
      })) },

    // ── usage metering (E07-4): platform panel + a tenant's own bill ──────────
    { method: 'get', path: '/v1/platform/usage', scopeClass: 'platform', entity: 'usage', shape: 'collection',
      // platformSummary is UNSCOPED by design — reachable ONLY here (platform_admin via scopeClass)
      handler: async (c) => json(c, await db.usage.platformSummary({
        ...(c.req.query('from') !== undefined ? { from: c.req.query('from')! } : {}),
        ...(c.req.query('to') !== undefined ? { to: c.req.query('to')! } : {}),
      })) },
    { method: 'get', path: '/v1/usage', scopeClass: 'tenant', entity: 'usage', shape: 'collection',
      handler: async (c) => {
        // same shape as /v1/audit: `usage.tenantSummary` filters on tenantId alone, so an
        // account-PINNED tsp_admin (which POST /v1/users can create) read the whole tenant's
        // device-day totals — every sibling account's fleet size and activity. Fixing audit and
        // leaving this was half a fix (review MED).
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'usage is tenant-wide')
        return json(c, await db.usage.tenantSummary(scopeOf(auth(c)), {
          ...(c.req.query('from') !== undefined ? { from: c.req.query('from')! } : {}),
          ...(c.req.query('to') !== undefined ? { to: c.req.query('to')! } : {}),
        }))
      } },

    // ── webhook deliveries (tenant, read-only log — E06-4b) ───────────────────
    { method: 'get', path: '/v1/webhook-deliveries', scopeClass: 'tenant', entity: 'webhookDelivery', shape: 'collection', entitlement: 'webhooks',
      handler: async (c) => json(c, await db.webhookDeliveries.list(scopeOf(auth(c)), {
        take: Number(c.req.query('limit') ?? 100),
        ...(c.req.query('cursor') !== undefined ? { cursor: c.req.query('cursor')! } : {}),
        ...(c.req.query('webhookId') !== undefined ? { webhookId: c.req.query('webhookId')! } : {}),
      })) },

    // ── events (account, read-only) ──────────────────────────────────────────
    { method: 'get', path: '/v1/events', scopeClass: 'account', entity: 'event', shape: 'collection',
      handler: async (c) => {
        const q = (k: string): string | undefined => c.req.query(k) ?? undefined
        // all filters are sanitized in the repo (garbage never 500s) — E05-6 timeline UI
        return json(c, await db.events.list(scopeOf(auth(c)), {
          take: Number(c.req.query('limit') ?? 100),
          ...(q('cursor') !== undefined ? { cursor: q('cursor') } : {}),
          ...(q('kind') !== undefined ? { kind: q('kind') } : {}),
          ...(q('deviceId') !== undefined ? { deviceId: q('deviceId') } : {}),
          ...(q('from') !== undefined ? { from: q('from') } : {}),
          ...(q('to') !== undefined ? { to: q('to') } : {}),
        }))
      } },
    { method: 'get', path: '/v1/events/:id', scopeClass: 'account', entity: 'event', shape: 'item',
      handler: async (c) => {
        const row = await db.events.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },

    // ── trips (account, read-only, E04-3) ────────────────────────────────────
    { method: 'get', path: '/v1/trips', scopeClass: 'account', entity: 'trip', shape: 'collection',
      handler: async (c) => {
        const q = c.req.query.bind(c.req)
        return json(c, await db.trips.list(scopeOf(auth(c)), {
          ...(q('deviceId') !== undefined ? { deviceId: q('deviceId')! } : {}),
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
          ...(q('limit') !== undefined ? { take: Number(q('limit')) } : {}),
        }))
      } },
    { method: 'get', path: '/v1/trips/:id', scopeClass: 'account', entity: 'trip', shape: 'item',
      handler: async (c) => {
        const row = await db.trips.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    // assign/clear a trip's driver (V2) — scope gate the TRIP first (404), then validate body; a
    // cross-tenant/-account driver is refused (DriverNotInScopeError → 400, never assigns it)
    { method: 'patch', path: '/v1/trips/:id/driver', scopeClass: 'account', entity: 'trip', shape: 'item',
      handler: async (c) => {
        const scope = scopeOf(auth(c))
        if (await db.trips.get(scope, id(c)) === null) return problem(c, 404, 'Not Found')
        const data = await body(c, tripAssignDriverSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        try {
          const row = await db.trips.assignDriver(scope, { userId: auth(c).userId }, id(c), data.driverId)
          return row === null ? problem(c, 404, 'Not Found') : json(c, row)
        } catch (err) {
          if (err instanceof DriverNotInScopeError) return problem(c, 400, 'Bad Request', 'driverId not in scope')
          throw err
        }
      } },

    // ── audit log (E03-6, tenant, read-only + admin-gated, append-only) ─────────
    { method: 'get', path: '/v1/audit', scopeClass: 'tenant', entity: 'audit', shape: 'collection',
      handler: async (c) => {
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'audit is tenant-wide')
        const q = c.req.query.bind(c.req)
        return json(c, await db.audit.list(scopeOf(auth(c)), {
          take: Number(q('limit') ?? 50),
          ...(q('cursor') !== undefined ? { cursor: q('cursor')! } : {}),
          ...(q('entity') !== undefined ? { entity: q('entity')! } : {}),
          ...(q('action') !== undefined ? { action: q('action')! } : {}),
          ...(q('from') !== undefined ? { from: q('from')! } : {}),
          ...(q('to') !== undefined ? { to: q('to')! } : {}),
        }))
      } },
    { method: 'get', path: '/v1/audit/:id', scopeClass: 'tenant', entity: 'audit', shape: 'item',
      handler: async (c) => {
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'audit is tenant-wide')
        if (!/^\d+$/.test(id(c))) return problem(c, 404, 'Not Found') // BigInt() would throw on non-numeric
        const row = await db.audit.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },

    // ── tenant-self branding + domains (E03-5) — tenant from auth, never a param ─
    { method: 'get', path: '/v1/tenant/branding', scopeClass: 'tenant', entity: 'branding', shape: 'collection',
      handler: async (c) => {
        const tenant = await db.tenants.get(auth(c).tenantId)
        // `dnsTarget` and `platformDomain` are deployment config, not tenant data, and they ride
        // here because the Branding page loads this alongside the domain list and has to state both
        // remaining setup steps: where to point a CNAME, and whether the zero-setup
        // `<slug>.orbetra.com` option exists at all (it needs a wildcard record to).
        return json(c, {
          branding: tenant?.branding ?? {},
          name: tenant?.name,
          dnsTarget: deps.edgeHostname ?? null,
          platformDomain: deps.platformDomain ?? null,
        })
      } },
    { method: 'patch', path: '/v1/tenant/branding', scopeClass: 'tenant', entity: 'branding', shape: 'collection', entitlement: 'whiteLabel',
      handler: async (c) => {
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'branding is tenant-wide')
        const data = await body(c, brandingSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const tenant = await db.tenants.updateBranding({ userId: a.userId }, a.tenantId, data)
        return json(c, { branding: tenant.branding, name: tenant.name })
      } },
    // NOTE: stays a bare ARRAY. The UI also needs `dnsTarget` + `platformDomain`, and wrapping them
    // in here would have been the obvious place — but the isolation suite's collection sweep reads
    // `Array.isArray(body) ? body : []`, so an object body turns its cross-tenant leak check into a
    // vacuous pass. The config rides on GET /v1/tenant/branding instead, which the same page loads.
    { method: 'get', path: '/v1/tenant/domains', scopeClass: 'tenant', entity: 'domain', shape: 'collection', entitlement: 'customDomains',
      handler: async (c) => tenantWide(c) ? json(c, await db.tenantDomains.list(scopeOf(auth(c)))) : problem(c, 403, 'Forbidden', 'domains are tenant-wide') },
    { method: 'get', path: '/v1/tenant/domains/:id', scopeClass: 'tenant', entity: 'domain', shape: 'item', entitlement: 'customDomains',
      handler: async (c) => {
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'domains are tenant-wide')
        const row = await db.tenantDomains.get(scopeOf(auth(c)), id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/tenant/domains', scopeClass: 'tenant', entity: 'domain', shape: 'collection', entitlement: 'customDomains',
      handler: async (c) => {
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'domains are tenant-wide')
        const data = await body(c, domainCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const a = auth(c)
        const domain = data.domain.toLowerCase()
        // A subdomain of OUR zone takes a different path, and must be routed to it even when the
        // slug turns out to be unclaimable: sending `secure.orbetra.com` down the DNS-TXT branch
        // would tell a tenant to publish a record in a zone they cannot edit, and then fail forever
        // with "TXT record not found" — a dead end with no hint of the real reason.
        const ownZone = isUnderPlatformDomain(domain, deps.platformDomain)
        if (ownZone) {
          const chk = checkPlatformSubdomain(domain, deps.platformDomain)
          if (!chk.ok) return problem(c, 400, 'Bad Request', chk.reason)
        }
        try {
          // verified on creation for our own zone: there is no ownership for the tenant to prove —
          // we hold the DNS. The slug check above plus the global partial-unique index below ARE the
          // ownership model, which is why neither may be skipped.
          const row = await db.tenantDomains.create(scopeOf(a), { userId: a.userId }, domain, newTxtToken(), ownZone ? { verified: true } : {})
          return json(c, { ...row, txtRecord: ownZone ? null : expectedTxt(row.txtToken), dnsTarget: ownZone ? null : deps.edgeHostname ?? null }, 201)
        } catch (err) {
          if (err instanceof DomainLimitError) return problem(c, 409, 'Conflict', `domain limit reached (max ${MAX_DOMAINS_PER_TENANT})`)
          if (err instanceof DomainConflictError) return problem(c, 409, 'Conflict', 'that name is already taken')
          // Anything ELSE — a dead pool, a Prisma fault — propagates as the 500 it is rather than
          // being dressed up as a conflict: the detail is now shown to the operator verbatim, and
          // "domain already added" sends someone off to check DNS while the database is down.
          if (!(err instanceof DomainDuplicateError)) throw err
          return problem(c, 409, 'Conflict', 'domain already added')
        }
      } },
    { method: 'delete', path: '/v1/tenant/domains/:id', scopeClass: 'tenant', entity: 'domain', shape: 'item', entitlement: 'customDomains',
      handler: async (c) => {
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'domains are tenant-wide')
        const ok = await db.tenantDomains.remove(scopeOf(auth(c)), { userId: auth(c).userId }, id(c))
        return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
      } },
    { method: 'post', path: '/v1/tenant/domains/:id/verify', scopeClass: 'tenant', entity: 'domain', shape: 'item', entitlement: 'customDomains',
      handler: async (c) => {
        if (!tenantWide(c)) return problem(c, 403, 'Forbidden', 'domains are tenant-wide')
        const a = auth(c)
        const row = await db.tenantDomains.get(scopeOf(a), id(c))
        if (row === null) return problem(c, 404, 'Not Found')
        if (!(await verifyDomainTxt(deps.resolveTxt, row.domain, row.txtToken))) {
          return problem(c, 400, 'Not Verified', 'TXT record not found — check DNS and try again')
        }
        try {
          return json(c, await db.tenantDomains.setVerified(scopeOf(a), { userId: a.userId }, id(c)))
        } catch (err) {
          // another tenant proved ownership of this domain first (partial-unique guard)
          if (err instanceof DomainConflictError) return problem(c, 409, 'Conflict', 'domain already verified by another tenant')
          throw err
        }
      } },

    // ── tenants (PLATFORM) ───────────────────────────────────────────────────
    { method: 'get', path: '/v1/tenants', scopeClass: 'platform', entity: 'tenant', shape: 'collection',
      handler: async (c) => json(c, await db.tenants.list()) },
    { method: 'get', path: '/v1/tenants/:id', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        const row = await db.tenants.get(id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/tenants', scopeClass: 'platform', entity: 'tenant', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, tenantCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const { ref, ...rest } = data
        // resolve a referral code → an ACTIVE affiliate; an unknown/inactive code attributes to no one
        // (never a 400 — a bad ref must not block tenant provisioning, incl. the future public signup)
        const referredByAffiliateId = ref !== undefined ? (await db.affiliates.getActiveByCode(ref))?.id ?? null : null
        return json(c, await db.tenants.create({ userId: auth(c).userId }, { ...rest, referredByAffiliateId }), 201)
      } },
    { method: 'patch', path: '/v1/tenants/:id', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        const data = await body(c, tenantUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.tenants.update({ userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    /**
     * Put a SUSPENDED tenant back on the air, by hand.
     *
     * The lapse ladder can disconnect a customer's whole fleet, and until now the only way back was
     * a Stripe payment landing on the webhook — so a customer who paid by bank transfer, or one cut
     * off by our own mistake, was restored with a psql UPDATE and a Redis rebuild typed from memory,
     * while they waited on the phone.
     *
     * THE ORDER IS THE WHOLE THING, and it is the same order the sweep and the webhook use: rebuild
     * the registry FIRST, clear the flag SECOND. Clearing first and then failing the Redis write
     * leaves a tenant marked not-suspended with a dark fleet — invisible to `listSuspended` (not
     * suspended) and to `listLapsedTenants` (they paid), so nothing ever looks at them again. This
     * way a failure leaves them marked suspended with a working feed, which the next sweep finishes.
     *
     * It does NOT touch billing. A tenant restored here while still unpaid is picked up by the next
     * sweep and suspended again — deliberately: this is an override for a human who knows why, not a
     * way to make the ledger say something it does not.
     */
    { method: 'post', path: '/v1/tenants/:id/restore', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        const tenant = await db.tenants.get(id(c))
        if (tenant === null) return problem(c, 404, 'Not Found')
        if (!(await db.tenants.isSuspended(id(c)))) return json(c, { ok: true, restored: 0, alreadyActive: true })
        const devices = await db.tenants.registryDevicesFor(id(c))
        const restored = await restoreTenantDevices(deps.redis, devices)
        // keepLadder: the notice stage SURVIVES an override. Clearing it would mean the next sweep
        // cannot suspend (it needs stage >= 3), so every click would buy ~2 more days of free
        // service and mail the customer a fresh "your fleet stops tomorrow" — the opposite of what
        // the button says (review HIGH).
        const cleared = await db.tenants.unsuspend(id(c), { keepLadder: true })
        if (!cleared) return json(c, { ok: true, restored, alreadyActive: true }) // lost the race; nothing to file
        // filed under the PLATFORM trail: who re-enabled a fleet, and when, is exactly the kind of
        // override that must be answerable later. It is written AFTER the state change and cannot be
        // in the same transaction as it (different store for the registry half), so a failure here is
        // logged rather than thrown: reporting a completed restore as an error would have the
        // operator click again, see `alreadyActive`, and believe the second click did it — leaving a
        // restored fleet with no trail at all.
        try {
          await db.audit.recordPlatform({ userId: auth(c).userId }, { action: 'update', entity: 'tenant', entityId: id(c), before: { suspended: true }, after: { suspended: false, devices: restored } })
        } catch (err) {
          console.error('platform: restore succeeded but the audit write failed', id(c), err instanceof Error ? err.message : String(err))
        }
        console.warn('platform: tenant restored by hand', JSON.stringify({ tenantId: id(c), devices: restored }))
        return json(c, { ok: true, restored })
      } },
    /** A tenant's white-label hosts, for the platform view — the tenant-self route is scoped to the
     *  caller's own tenant, and a support question about someone else's login URL cannot use it. */
    { method: 'get', path: '/v1/tenants/:id/domains', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        const rows = await db.tenantDomains.list({ tenantId: id(c) })
        // PROJECTED, not passed through: the wire shape and the TS interface on the web side must be
        // the same object, or the next person to dump a row on a support screen ships whatever
        // column was added since.
        return json(c, rows.map((d) => ({ id: d.id, domain: d.domain, verified: d.verified, createdAt: d.createdAt })))
      } },
    { method: 'delete', path: '/v1/tenants/:id', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => {
        try {
          const ok = await db.tenants.remove({ userId: auth(c).userId }, id(c))
          return ok ? json(c, { ok: true }) : problem(c, 404, 'Not Found')
        } catch (err) {
          // the commission ledger is a financial record — deleting a tenant that carries one would
          // destroy paid/owed history (audit HIGH). Void the commissions deliberately first.
          if (err instanceof TenantHasCommissionsError) return problem(c, 409, 'Conflict', 'tenant_has_commissions')
          throw err
        }
      } },
    // accounts of a SPECIFIC tenant (platform) — the claim dialog needs the target
    // tenant's accounts, which /v1/accounts (caller-scoped) can't give
    { method: 'get', path: '/v1/tenants/:id/accounts', scopeClass: 'platform', entity: 'tenant', shape: 'item',
      handler: async (c) => json(c, await db.accounts.list({ tenantId: id(c) })) },

    // ── quarantine (PLATFORM) — unknown-IMEI review + claim (E03-4) ───────────
    { method: 'get', path: '/v1/quarantine', scopeClass: 'platform', entity: 'quarantine', shape: 'collection',
      handler: async (c) => json(c, await listQuarantine(deps.redis)) },
    { method: 'post', path: '/v1/quarantine/:imei/claim', scopeClass: 'platform', entity: 'quarantine', shape: 'item',
      handler: async (c) => {
        const data = await body(c, quarantineClaimSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const imei = c.req.param('imei') ?? ''
        if (!/^\d{15}$/.test(imei)) return problem(c, 400, 'Bad Request', 'invalid IMEI')
        const result = await claimDevice(db, deps.redis, { userId: auth(c).userId }, { ...data, imei })
        if (!result.ok) {
          const title = result.status === 409 ? 'Conflict' : result.status === 403 ? 'Forbidden' : 'Bad Request'
          return problem(c, result.status, title, result.reason)
        }
        return json(c, result, 201)
      } },

    // ── affiliates / partner program (PLATFORM, item 5 / W9) ──────────────────
    // Invite-only management: platform_admin creates a partner (code auto-generated when omitted),
    // then flips status → active so its referral code starts attributing new tenants (F4).
    // WITH stats: the registry is a management screen, and a name + a percentage answers nothing an
    // admin came here to ask. Three grouped queries for the whole table (see listWithStats).
    { method: 'get', path: '/v1/affiliates', scopeClass: 'platform', entity: 'affiliate', shape: 'collection',
      handler: async (c) => json(c, await db.affiliates.listWithStats()) },
    { method: 'get', path: '/v1/affiliates/:id', scopeClass: 'platform', entity: 'affiliate', shape: 'item',
      handler: async (c) => {
        const row = await db.affiliates.get(id(c))
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    { method: 'post', path: '/v1/affiliates', scopeClass: 'platform', entity: 'affiliate', shape: 'collection',
      handler: async (c) => {
        const data = await body(c, affiliateCreateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const autoCode = data.code === undefined // an auto-generated code collision is retryable
        for (let attempt = 0; ; attempt++) {
          try {
            const created = await db.affiliates.create({ userId: auth(c).userId }, { ...data, code: data.code ?? genAffiliateCode() })
            return json(c, created, 201)
          } catch (err) {
            // ONLY a real unique clash → 409; any other error propagates to the 500 net (review MED:
            // a bare catch masked DB outages as "already exists"). An email clash is never retryable;
            // an auto-generated-code clash is (regenerate a few times before giving up — review LOW).
            if (err instanceof AffiliateConflictError) {
              if (err.field === 'code' && autoCode && attempt < 4) continue
              return problem(c, 409, 'Conflict', err.field === 'email' ? 'email_in_use' : 'code_in_use')
            }
            throw err
          }
        }
      } },
    { method: 'patch', path: '/v1/affiliates/:id', scopeClass: 'platform', entity: 'affiliate', shape: 'item',
      handler: async (c) => {
        const data = await body(c, affiliateUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.affiliates.update({ userId: auth(c).userId }, id(c), data)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
    // issue a one-time set/reset-password link for the partner's self-service login (F5). The plaintext
    // token is returned ONCE for the admin to convey to the partner (email wiring is a follow-up).
    { method: 'post', path: '/v1/affiliates/:id/set-password-token', scopeClass: 'platform', entity: 'affiliate', shape: 'item',
      handler: async (c) => {
        const affiliate = await db.affiliates.get(id(c))
        if (affiliate === null) return problem(c, 404, 'Not Found')
        const token = await issuePartnerSetPwToken(db, affiliate.id)
        return json(c, { token }, 201)
      } },
    // DEAL REGISTRATION queue (§6.9). Approval is the anti-land-grab control — without a human in
    // this loop a partner registers every large company in the country on their first afternoon.
    { method: 'get', path: '/v1/deals', scopeClass: 'platform', entity: 'deal_registration', shape: 'collection',
      handler: async (c) => json(c, await db.affiliates.listDeals()) },
    { method: 'patch', path: '/v1/deals/:id', scopeClass: 'platform', entity: 'deal_registration', shape: 'item',
      handler: async (c) => {
        const data = await body(c, dealDecisionSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        try {
          const row = await db.affiliates.decideDeal({ userId: auth(c).userId }, id(c), data.status, data.reason, new Date())
          // null covers both "no such claim" and "already decided" — re-approving a converted claim
          // would move its expiry and silently re-open a window that has already paid out
          return row === null ? problem(c, 404, 'Not Found') : json(c, row)
        } catch (err) {
          // two partners both told "this prospect is protected for you" is worse than one being told
          // no: the duplicate is discovered only when the money is already owed twice
          if (err instanceof DealDomainTakenError) return problem(c, 409, 'Conflict', 'domain_claimed')
          throw err
        }
      } },
    // commissions accrued for ONE affiliate (payout review); PATCH marks one paid/void
    { method: 'get', path: '/v1/affiliates/:id/commissions', scopeClass: 'platform', entity: 'affiliate', shape: 'item',
      handler: async (c) => json(c, await db.affiliates.listCommissions(id(c))) },
    { method: 'patch', path: '/v1/commissions/:id', scopeClass: 'platform', entity: 'commission', shape: 'item',
      handler: async (c) => {
        const data = await body(c, commissionStatusUpdateSchema)
        if (data === null) return problem(c, 400, 'Bad Request')
        const row = await db.affiliates.setCommissionStatus({ userId: auth(c).userId }, id(c), data.status)
        return row === null ? problem(c, 404, 'Not Found') : json(c, row)
      } },
  ]
  // attach the allowed-roles policy uniformly (review HIGH)
  return raw.map((r) => ({ ...r, roles: rolesFor(r.entity, r.method, r.scopeClass) }))
}
