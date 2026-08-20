import { z } from 'zod'

import { tenantPlanSchema } from './plans.js'
import { roleSchema } from './roles.js'
import { distanceUnitSchema, speedUnitSchema, volumeUnitSchema } from './units.js'

/**
 * IANA time-zone id (e.g. `Europe/Vilnius`). Validated against the runtime's own tz database rather
 * than a regex — a name that `Intl` cannot resolve would make every report throw at render.
 */
export const ianaTimezoneSchema = z.string().min(1).max(64).refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      return true
    } catch {
      return false
    }
  },
  { message: 'not a valid IANA time zone' },
)

/** CRUD request contracts (E03-2). The single type source for api ↔ web. */

// ── accounts ─────────────────────────────────────────────────────────────────
export const accountCreateSchema = z.object({
  name: z.string().min(1).max(120),
  /** Reporting time zone — the server buckets report days by THIS, not by the viewer's browser. */
  timezone: ianaTimezoneSchema.optional(),
})
export const accountUpdateSchema = accountCreateSchema.partial()

// ── users ────────────────────────────────────────────────────────────────────
export const userCreateSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(1024),
  role: roleSchema,
  accountId: z.string().uuid().nullable(),
})
/** The UI languages Orbetra ships (web i18n + server-side email/report localization). Single source
 * for the web switcher, the ADMIN user update, and the self-service `PATCH /v1/auth/me`. */
export const SUPPORTED_LOCALES = ['en', 'lt', 'pl', 'de'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const localeSchema = z.enum(SUPPORTED_LOCALES)
export const localeUpdateSchema = z.object({ locale: localeSchema })

/**
 * The ACCOUNT's display preferences — language + units for everything the SERVER renders (alert
 * e-mails, Telegram messages, scheduled report tables).
 *
 * Its own schema and its own route (`PATCH /v1/accounts/:id/preferences`) rather than four more
 * optional fields on `accountUpdateSchema`, because the two are not the same decision. Renaming an
 * account and changing its reporting time zone are tenant-admin acts — a time-zone change silently
 * re-cuts every report's day boundary. Choosing miles is an operator's act: the account_manager who
 * reads the alerts is exactly who should pick the units they arrive in, and making them file a
 * ticket with their TSP for it is how a setting ends up permanently wrong.
 *
 * Partial: the settings page sends one field at a time as the operator flips each control.
 *
 * STRICT, unlike the other CRUD schemas, and deliberately: the point of this route is that it can do
 * LESS than `PATCH /v1/accounts/:id`, so a body carrying `name` or `timezone` must be refused rather
 * than silently stripped. Non-strict, an account_manager posting `{unitSpeed, name}` would get a 200
 * and no rename — a caller cannot tell that from a rename that worked, and the next reader of this
 * schema would have to prove the repo method is narrow to know which it was. Two independent floors
 * (rejected here, unrepresentable in `updatePreferences`) is what makes that unambiguous.
 */
export const accountPreferencesSchema = z
  .object({
    locale: localeSchema,
    unitSpeed: speedUnitSchema,
    unitDistance: distanceUnitSchema,
    unitVolume: volumeUnitSchema,
  })
  .partial()
  .strict()
export type AccountPreferences = z.infer<typeof accountPreferencesSchema>

export const userUpdateSchema = z
  .object({
    role: roleSchema,
    accountId: z.string().uuid().nullable(),
    // the SAME enum the self-service route uses. It accepted any 2–10 character string, which is
    // then looked up in an object literal with no fallback when an e-mail is rendered — so an admin
    // typing 'gb' or 'en-US' permanently broke that user's password-reset mail, on a route whose
    // author had already written the enum three lines away (audit MED).
    locale: localeSchema,
    password: z.string().min(8).max(1024),
  })
  .partial()


// ── devices ──────────────────────────────────────────────────────────────────
export const odometerSourceSchema = z.enum(['auto', 'device', 'gps'])

// vehicle profile (FLEET-1 F1) — identity of the VEHICLE the tracker sits in. All optional:
// a bare tracker registration stays as cheap as before; the card fills in over time.
export const fuelTypeSchema = z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'cng', 'other'])
export const vehicleStatusSchema = z.enum(['active', 'in_service', 'reserve'])
const VEHICLE_PROFILE_FIELDS = {
  make: z.string().max(64).nullable().optional(),
  vehicleModel: z.string().max(64).nullable().optional(),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  // VIN is 17 chars without I/O/Q, but older/import vehicles deviate — validate charset, not length
  vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{5,17}$/i).nullable().optional(),
  fuelType: fuelTypeSchema.nullable().optional(),
  vehicleStatus: vehicleStatusSchema.optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchasePriceCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  /** assigned driver from the tenant's registry; the route scope-gates the id */
  driverId: z.string().uuid().nullable().optional(),
} as const

export const deviceCreateSchema = z.object({
  accountId: z.string().uuid(),
  profileId: z.string().uuid(),
  imei: z.string().regex(/^\d{15}$/, 'IMEI must be 15 digits'),
  name: z.string().min(1).max(120),
  plate: z.string().max(32).nullable().optional(),
  groupName: z.string().max(64).nullable().optional(),
  // SIM identity (SMS gateway): msisdn is E.164 (the number config SMS are sent TO); iccid is the
  // 18–22-digit SIM serial. Both operator-entered + optional; the regexes keep them injection-inert.
  simMsisdn: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable().optional(),
  simIccid: z.string().regex(/^\d{18,22}$/).nullable().optional(),
  odometerSource: odometerSourceSchema.optional(),
  ...VEHICLE_PROFILE_FIELDS,
})
export const deviceUpdateSchema = z
  .object({
    name: z.string().min(1).max(120),
    plate: z.string().max(32).nullable(),
    groupName: z.string().max(64).nullable(),
    simMsisdn: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable().optional(),
    simIccid: z.string().regex(/^\d{18,22}$/).nullable().optional(),
    profileId: z.string().uuid(),
    odometerSource: odometerSourceSchema,
    ...VEHICLE_PROFILE_FIELDS,
  })
  .partial()
  /**
   * STRICT, so a field this route cannot change is a 400 rather than a silent 200.
   *
   * Non-strict, zod stripped unknown keys and the handler then issued an empty update that returned
   * the unchanged row with status 200. The two an operator actually tries are the expensive ones:
   * `PATCH {imei}` — an IMEI is typed by hand at creation and no route can correct it, and a
   * mistyped one is held platform-wide against every other tenant while the real tracker is
   * rejected into quarantine — and `PATCH {accountId}`, because the create form pre-selects the
   * first account and nothing can move the device afterwards. Both answered "success" and changed
   * nothing. Saying no is honest; saying yes and doing nothing is not.
   */
  .strict()
/** CSV import body: raw text + whether to apply (else dry-run preview). */
export const deviceImportSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  apply: z.boolean().optional(),
})

// ── history / playback (E04-3) — JSON-serialized shapes the web consumes ────────
// (BigInt ids → string, timestamps → ISO, per the API's toJson convention)
/** One historical position for playback (fix_valid=false ⇒ render as a trail gap, I5). */
export interface PositionView {
  fixTime: string // ISO
  lat: number
  lon: number
  speed: number | null
  course: number | null
  ignition: boolean | null
  /** AVL 240 as the device reported it — the tracker's OWN statement about whether it is moving,
   *  independent of the GNSS speed. `null` on a model that does not report it. */
  movement: boolean | null
  fixValid: boolean
  odometerM: string | null // bigint as string
  recHash: string // bigint as string — the second half of the keyset cursor
}
/** A trip as returned by the read API (mirrors the Prisma Trip model, serialized). */
export interface TripView {
  id: string
  deviceId: string
  status: 'open' | 'closed'
  startTime: string // ISO
  endTime: string | null
  startLat: number | null
  startLon: number | null
  endLat: number | null
  endLon: number | null
  distanceM: number
  distanceSource: 'gps' | 'odometer'
  maxSpeed: number
  idleS: number
  /** assigned driver (V2) — null when unassigned; driverName is the joined display label. */
  driverId: string | null
  driverName: string | null
}
/** Assign or clear a trip's driver (V2). null clears the assignment. */
export const tripAssignDriverSchema = z.object({
  driverId: z.string().uuid().nullable(),
})
/** One fuel-level sample for the playback fuel graph (E08-3). pct comes from AVL 89 (or
 * OBD 48) in %, liters from AVL 84 (wiki ×0.1 already applied). Either may be null when
 * the device reports only one representation. */
export interface FuelSampleView {
  fixTime: string // ISO
  pct: number | null
  liters: number | null
}

/** One device-health sample (V1-nice): GSM signal 0–5, external + battery voltage (V). */
export interface HealthSampleView {
  fixTime: string // ISO
  gsm: number | null
  extV: number | null
  battV: number | null
}

/** Latest CAN/OBD engine snapshot (V2). null fields = the vehicle/adapter doesn't report that param. */
export interface CanView {
  fixTime: string // ISO
  rpm: number | null
  coolantC: number | null
  engineLoadPct: number | null
  throttlePct: number | null
  speedKmh: number | null
  totalMileageKm: number | null
}

/** An event as returned by the read API (E05-2/4 pipeline output, serialized). */
export interface EventView {
  id: string // bigint as string — also the pagination cursor
  deviceId: string
  ruleId: string | null
  kind: string
  at: string // ISO
  lat: number | null
  lon: number | null
  payload: Record<string, unknown>
  acknowledgedAt: string | null
  createdAt: string
}

// ── rules ────────────────────────────────────────────────────────────────────
// MUST mirror the Prisma RuleKind enum (packages/db/prisma/schema.prisma)
export const ruleKindSchema = z.enum(['geofence', 'overspeed', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic', 'device_offline', 'fuel_theft'])

// A rule's notification channels (E05-5). email = SES recipient; telegram = a chat_id bound
// via the pairing deep-link. Webhook delivery is a separate channel type in E06-4.
export const notificationChannelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), to: z.string().email() }),
  z.object({ type: z.literal('telegram'), chatId: z.string().min(1).max(64) }),
  // webpush has NO target in the channel — it fans out to the account's stored browser subscriptions (ADR-026)
  z.object({ type: z.literal('webpush') }),
])
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

/** POST /v1/push/subscribe body — a browser's PushSubscription (endpoint + keys). */
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
})

/**
 * A rule's scope. `deviceIds` is an ALLOW-LIST — absent or empty means the whole account.
 *
 * Bounded and typed because it is caller input that lands on the hot path: the worker consults it
 * for every device in every batch, so an unvalidated array was work a tenant admin could ask the
 * pipeline to do on their behalf, forever, with one PATCH (audit MED). 5000 is the largest fleet
 * any plan sells; a rule that needs more is an account-wide rule.
 */
export const MAX_RULE_SCOPE_IDS = 5_000
export const ruleScopeSchema = z
  .object({
    // number OR string: `scope` used to be a free `z.record(…, unknown)`, so a client that stored
    // `deviceIds: [42]` — device ids are bigints, and JSON has no bigint — was accepted. Rejecting
    // that shape now would 400 a rule the API itself created, including on a read-modify-write PATCH.
    // A device id is a bigint rendered by `deviceId.toString()`, so the accepted form is exactly
    // what that produces: no leading zero, no sign, no exponent, ≤19 digits (the int8 ceiling).
    // Anything else — "042", " 42", "4.2e1" — validated fine and then matched nothing, leaving a
    // rule that silently covers no devices at all.
    deviceIds: z
      .array(z.union([z.string().regex(/^[1-9]\d{0,18}$/), z.number().int().positive()]).transform(String))
      .max(MAX_RULE_SCOPE_IDS)
      .optional(),
  })
  // passthrough, NOT strict: unknown keys are kept rather than rejected OR silently stripped. A
  // strict schema breaks a client that stored an extra key under the old free-form contract, and
  // zod's default (strip) would quietly delete it on the next PATCH — losing data on a write.
  .passthrough()

export const ruleCreateSchema = z.object({
  accountId: z.string().uuid(),
  kind: ruleKindSchema,
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).optional(),
  scope: ruleScopeSchema.optional(),
  channels: z.array(notificationChannelSchema).max(20).optional(),
  cooldownS: z.number().int().min(0).max(86_400).optional(),
  enabled: z.boolean().optional(),
})
export const ruleUpdateSchema = ruleCreateSchema.omit({ accountId: true, kind: true }).partial()

// ── api keys (E06-3) ─────────────────────────────────────────────────────────
// Integration keys. `accountId` (nullable) scopes the key to one account; a tenant admin
// may leave it null for tenant-wide read. scopes default ['read'] (write is not v1).
export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  accountId: z.string().uuid().nullable().optional(),
  scopes: z.array(z.enum(['read'])).optional(),
})
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>

// ── commands (E08-2, Codec 12) ───────────────────────────────────────────────
// A Codec-12 GPRS command sent to a device over its live socket (§3.5). `text` is the raw
// command; a preset just fills it in for the operator. deleterecords is warning-gated in UI.
export const commandCreateSchema = z.object({
  // printable ASCII only — encodeCodec12 sends raw ASCII bytes; unicode would be mangled
  text: z.string().min(1).max(512).regex(/^[\x20-\x7e]+$/, 'command must be printable ASCII'),
})

/**
 * Tracking-settings write (device settings). A map of named settings to whole numbers; the bounds
 * are per MODEL and enforced by `isSettingInRange` in the handler, not here, because zod cannot see
 * which device this is for. Keys are validated there too — an unknown one is a 400, never ignored.
 */
export const deviceSettingsWriteSchema = z.object({
  changes: z.record(z.string(), z.number().int()).refine((r) => Object.keys(r).length > 0, 'no changes'),
})
export type DeviceSettingsWriteInput = z.infer<typeof deviceSettingsWriteSchema>

/** Non-idempotent commands that must NOT be auto-retried on timeout (a cpureset causes the
 * >30 s silence that looks like a timeout — retrying resets the just-rebooted device). */
export function isRetryableCommand(text: string): boolean {
  const verb = text.trim().toLowerCase().split(/\s+/)[0] ?? ''
  return verb !== 'cpureset' && verb !== 'deleterecords'
}
export type CommandCreateInput = z.infer<typeof commandCreateSchema>

/** The 10 V1 presets (§8 W8 S2). `text` is the exact Codec-12 payload (FMB Commands wiki). */
export const COMMAND_PRESETS = [
  { key: 'getinfo', text: 'getinfo' },
  { key: 'getver', text: 'getver' },
  { key: 'getgps', text: 'getgps' },
  { key: 'getio', text: 'getio' },
  { key: 'cpureset', text: 'cpureset' },
  { key: 'dout_on', text: 'setdigout 1' },
  { key: 'dout_off', text: 'setdigout 0' },
  { key: 'reporting_interval', text: 'setparam 10050:30' }, // data acquisition period (s) — operator edits value
  { key: 'server_address', text: 'setparam 2004:0.0.0.0,2005:5027' }, // domain:port — operator edits
  { key: 'deleterecords', text: 'deleterecords' }, // DESTRUCTIVE — UI warning-gates it
] as const
export type CommandPresetKey = (typeof COMMAND_PRESETS)[number]['key']

// ── public pilot request (W9-S1, §6.9) ───────────────────────────────────────
// The ONLY unauthenticated write. `hp_field` is a honeypot (hidden field — humans leave
// it empty, bots/autofill fill it; NOT named 'website'/'url' so browser autofill skips it);
// `ref` is the affiliate code from the tc_ref cookie.
export const pilotRequestSchema = z.object({
  name: z.string().min(1).max(120),
  company: z.string().min(1).max(160),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional().or(z.literal('')),
  deviceCount: z.string().max(40).optional().or(z.literal('')),
  message: z.string().max(2000).optional().or(z.literal('')),
  hp_field: z.string().max(200).optional().or(z.literal('')),
  ref: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/).optional(), // no `_`: LIKE wildcard, see affiliateCodeSchema
})
export type PilotRequestInput = z.infer<typeof pilotRequestSchema>

// ── affiliates / partner program (W9, item 5) ────────────────────────────────
// Platform-level (platform_admin) partner management. Invite-only: an admin creates the affiliate
// (a `code` is auto-generated when omitted) then flips status → active to make it attribute.
// Same charset as pilotRequest `ref` so a referral code is a legal ?ref value end-to-end.
// No `_`: it is a SQL LIKE single-character wildcard, and referral codes are matched against the
// database. The lookup uses exact `lower(code) =` equality (not ILIKE) so this is belt-and-braces,
// but a code that can never be a wildcard is one less way to misroute commission money. `-` is kept
// (not a LIKE metacharacter) and the auto-generated alphabet is alphanumeric anyway.
export const affiliateCodeSchema = z.string().regex(/^[a-zA-Z0-9-]{3,64}$/)
export const affiliateStatusSchema = z.enum(['pending', 'active', 'suspended'])
export const commissionStatusSchema = z.enum(['pending', 'paid', 'void'])

const commissionPctSchema = z.number().min(0).max(100)
const commissionMonthsSchema = z.number().int().min(1).max(120)

/**
 * Consumer mailbox providers.
 *
 * Lived in apps/api/src/routes/signup.ts, where the self-referral guard needs it. Deal registration
 * needs the SAME list for a harder reason: a claim is keyed on an email domain, so one approved
 * registration on `gmail.com` would quietly claim every self-serve signup on the platform. Two
 * copies of this list drifting apart is how that ships, so there is one.
 *
 * Not exhaustive by design: it only has to cover what a small reseller in this market plausibly
 * uses as a contact address.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'freenet.de',
  'inbox.lt', 'gmail.lt', 'takas.lt', 'one.lt', 'zebra.lt', 'centras.lt', 'delfi.lt',
  'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl', 'gazeta.pl', 'op.pl', 'poczta.onet.pl',
  'yandex.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'ukr.net',
  'seznam.cz', 'zoho.com', 'fastmail.com', 'hushmail.com', 'tutanota.com', 'tuta.io',
  'mail.com', 'email.com', 'live.co.uk', 'live.de', 'hotmail.de', 'hotmail.fr', 'outlook.de', 'outlook.fr',
  'yahoo.de', 'yahoo.fr', 'yahoo.pl', 'gmx.at', 'gmx.ch', 'poczta.fm', 'vp.pl', 'azet.sk', 'centrum.sk',
  // disposable providers: a claim on one of these is a claim on everybody who ever used it
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'yopmail.com', 'temp-mail.org', 'sharklasers.com',
])

/** The domain part of an address, lowercased. '' for anything that is not an address. */
export function emailDomain(address: string): string {
  const at = address.lastIndexOf('@')
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase()
}

/**
 * A partner registering a prospect BEFORE that prospect signs up (§6.9 deal registration).
 *
 * The domain is the matching key and it is a COMPANY domain by rule — see FREE_MAIL_DOMAINS. The
 * shape is deliberately small: this is a claim, not a CRM record, and every field a partner types
 * here is one an admin has to read before approving.
 */
export const dealRegistrationCreateSchema = z.object({
  company: z.string().trim().min(1).max(160),
  /** the prospect's company email domain, with or without a leading @ or scheme — normalised here */
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(253)
    .transform((d) => d.replace(/^https?:\/\//, '').replace(/^@/, '').replace(/^www\./, '').replace(/\/.*$/, ''))
    .refine((d) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d), 'not a domain'),
  contactName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().toLowerCase().email().max(320).optional(),
  note: z.string().trim().max(2000).optional(),
})

/** An admin's decision on a pending claim. A rejection carries a reason the partner will read. */
export const dealDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(500).optional(),
})

export type DealRegistrationCreateInput = z.infer<typeof dealRegistrationCreateSchema>
export type DealDecisionInput = z.infer<typeof dealDecisionSchema>

/** The partner's own language for the mail we send them — not their customers' language. */
export const affiliateLocaleSchema = z.enum(['en', 'lt', 'de', 'pl'])

export const affiliateCreateSchema = z.object({
  // TRIMMED: a stored name with a stray leading/trailing space makes the admin edit panel's diff
  // report a change on every open, so every save carried a name mutation nobody made
  name: z.string().trim().min(1).max(160),
  email: z.string().email().max(320),
  code: affiliateCodeSchema.optional(),
  commissionPct: commissionPctSchema.optional(),
  commissionMonths: commissionMonthsSchema.optional(),
  locale: affiliateLocaleSchema.optional(),
  tierPct: commissionPctSchema.nullable().optional(),
  tierMinCustomers: z.number().int().min(1).max(10_000).nullable().optional(),
})
export const affiliateUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    status: affiliateStatusSchema,
    commissionPct: commissionPctSchema,
    commissionMonths: commissionMonthsSchema,
    locale: affiliateLocaleSchema,
    // NULLABLE, not merely optional: clearing a tier back to a flat rate has to be expressible,
    // and `undefined` means "leave it alone" in a partial patch
    tierPct: commissionPctSchema.nullable(),
    tierMinCustomers: z.number().int().min(1).max(10_000).nullable(),
  })
  .partial()
export const commissionStatusUpdateSchema = z.object({ status: commissionStatusSchema })

export type AffiliateCreateInput = z.infer<typeof affiliateCreateSchema>
export type AffiliateUpdateInput = z.infer<typeof affiliateUpdateSchema>

// Direct self-service signup (F2): a small-fleet customer creates their own tenant + admin user on a
// trial. `ref` carries the affiliate attribution (?ref cookie); `hp_field` is an anti-bot honeypot.
export const signupSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email().max(320),
  password: z.string().min(8).max(1024),
  company: z.string().min(1).max(160).optional().or(z.literal('')),
  ref: affiliateCodeSchema.optional(),
  /**
   * The account's REPORTING time zone — the one the server buckets report days by (hard rule 7),
   * NOT the browser display preference. Hard-coded to UTC before, with no UI anywhere to change it,
   * so a Lithuanian fleet's "yesterday" ran 00:00-24:00 UTC — three hours out in summer, and trips
   * straddling 03:00 local landed in the wrong day. The signup form sends the browser's zone.
   */
  timezone: ianaTimezoneSchema.optional(),
  hp_field: z.string().max(200).optional().or(z.literal('')),
})
export type SignupInput = z.infer<typeof signupSchema>

// Partner self-service auth (F5): a partner is NOT a tenant user — a separate login against the
// Affiliate row. Set-password consumes a one-time admin-issued token (email wiring is a follow-up).
export const partnerLoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
})
export const partnerSetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8).max(1024),
})

// ── reports (E06-1) ──────────────────────────────────────────────────────────
// POST /v1/reports/:type body. `accountId` is required only for a tenant-wide caller
// (an account-scoped user's account is fixed by their token). from/to are ISO; the engine
// buckets by the account's IANA zone (§7.7).
export const reportRequestSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  deviceId: z.string().regex(/^\d+$/).optional(),
  accountId: z.string().uuid().optional(),
})
export type ReportRequest = z.infer<typeof reportRequestSchema>

// ── scheduled emailed reports (V1-nice) ─────────────────────────────────────────
export const reportTypeSchema = z.enum(['trips', 'mileage', 'stops', 'overspeed', 'geofence', 'engine_hours'])
export const scheduledReportCreateSchema = z
  .object({
    /** null/omitted ⇒ the caller's account (account users are pinned); a tenant admin may target one. */
    accountId: z.string().uuid().optional(),
    reportType: reportTypeSchema,
    cadence: z.enum(['daily', 'weekly']),
    hourUtc: z.number().int().min(0).max(23),
    weekday: z.number().int().min(0).max(6).optional(), // 0=Sun … 6=Sat (weekly only)
    recipients: z.array(z.string().email()).min(1).max(20),
    // the SAME validator the account preferences use: an unresolvable zone makes the reporter fall
    // back to UTC, so accepting one means silently emailing every report in the wrong timezone
    timezone: ianaTimezoneSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((d) => d.cadence !== 'weekly' || d.weekday !== undefined, { message: 'weekly cadence requires a weekday' })
export const scheduledReportUpdateSchema = z
  .object({
    reportType: reportTypeSchema,
    cadence: z.enum(['daily', 'weekly']),
    hourUtc: z.number().int().min(0).max(23),
    weekday: z.number().int().min(0).max(6).nullable(),
    recipients: z.array(z.string().email()).min(1).max(20),
    timezone: ianaTimezoneSchema,
    enabled: z.boolean(),
  })
  .partial()

export interface ScheduledReportView {
  id: string
  tenantId: string
  accountId: string
  reportType: string
  cadence: string
  hourUtc: number
  weekday: number | null
  recipients: string[]
  timezone: string
  enabled: boolean
  lastRunAt: string | null
  createdAt: string
}

// ── webhooks ─────────────────────────────────────────────────────────────────
/**
 * The event kinds a webhook can actually receive: every rule kind the engine emits, plus the
 * geofence transition the worker emits directly (it carries no ruleId). `events: []` / omitted means
 * "all of them" — that is the documented default and stays untouched.
 *
 * Validated as an ENUM rather than free strings: an unknown kind used to be accepted with 201 and
 * then never fire, leaving the customer with a subscription that looks configured and delivers
 * nothing, and no delivery-log row to explain why.
 */
export const webhookEventKindSchema = ruleKindSchema
export const WEBHOOK_EVENT_KINDS = ruleKindSchema.options

export const webhookCreateSchema = z.object({
  accountId: z.string().uuid().nullable(),
  url: z.string().url().max(2048),
  secret: z.string().min(16).max(256),
  events: z.array(webhookEventKindSchema).optional(),
  enabled: z.boolean().optional(),
})
export const webhookUpdateSchema = z
  .object({ url: z.string().url().max(2048), events: z.array(webhookEventKindSchema), enabled: z.boolean() })
  .partial()

// ── tenants (platform) ───────────────────────────────────────────────────────
export const tenantCreateSchema = z.object({
  name: z.string().min(1).max(120),
  branding: z.record(z.string(), z.unknown()).optional(),
  // platform_admin may set the entitlement tier at creation (e.g. a sales-provisioned TSP plan);
  // the manifest handler spreads this into db.tenants.create, which is plan-aware (WP1).
  plan: tenantPlanSchema.optional(),
  // affiliate attribution (item 5): a referral code the tenant signed up under. The handler resolves
  // it to an ACTIVE affiliate → referredByAffiliateId; an unknown/inactive code attributes to no one
  // (never an error — a bad ref must not block provisioning, esp. on the future public signup path).
  ref: affiliateCodeSchema.optional(),
})
// .partial() propagates `plan` as optional here too (PATCH /v1/tenants — platform_admin only).
export const tenantUpdateSchema = tenantCreateSchema.partial()

// ── white-label branding (E03-5) ─────────────────────────────────────────────
/** Hex color — STRICT so a value can't break out of `setProperty('--accent', v)`
 * into arbitrary CSS (XSS/style injection). */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex color')
export const brandingSchema = z
  .object({
    // https-only URL, rendered as an <img src> (never innerHTML)
    logoUrl: z.string().url().startsWith('https://').max(2048),
    primary: hexColor,
    accent: hexColor,
    productName: z.string().min(1).max(60),
    supportEmail: z.string().email().max(320),
  })
  .partial()
export type Branding = z.infer<typeof brandingSchema>

/**
 * The same shape, read TOLERANTLY — for the render paths, never for a write.
 *
 * `brandingSchema.safeParse` is all-or-nothing, so ONE bad field made the whole object fail and the
 * caller fell back to `{}` — which every renderer reads as "not white-label", so a tenant with a
 * 61-character product name, or a logo URL a migration wrote as `null`, had OUR logo and OUR name
 * put on every email they sent. A single stale field must cost that field, not the brand.
 *
 * Writes keep using `brandingSchema`: an operator typing a bad colour deserves a 400, not a value
 * that vanishes silently.
 */
export const brandingReadSchema = z
  .object({
    logoUrl: z.string().url().startsWith('https://').max(2048).optional().catch(undefined),
    primary: hexColor.optional().catch(undefined),
    accent: hexColor.optional().catch(undefined),
    productName: z.string().min(1).max(60).optional().catch(undefined),
    supportEmail: z.string().email().max(320).optional().catch(undefined),
  })
  // drop the keys that failed, so `Object.keys(branding).length` stays an honest "what is set"
  .transform((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as Branding)

export const domainCreateSchema = z.object({
  // hostname: labels of a-z0-9-, dots; no scheme/path
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, 'must be a bare hostname'),
})

// ── quarantine claim (platform) ──────────────────────────────────────────────
export const quarantineClaimSchema = z.object({
  tenantId: z.string().uuid(),
  accountId: z.string().uuid(),
  profileId: z.string().uuid(),
  name: z.string().min(1).max(120),
})

// ── self password change ─────────────────────────────────────────────────────
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(8).max(1024),
})

// ── forgot password (ADR-031) ────────────────────────────────────────────────
/** Step 1: request a reset link. The response is identical whether or not the email exists
 *  (no enumeration), so only the shape is validated here. */
export const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
})
/** Step 2: redeem the emailed token and set a new password. `token` is the raw 32B CSPRNG
 *  hex (64 chars); newPassword mirrors the create/change min length. */
export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(1024),
})

// ── geofences (E05-1) ──────────────────────────────────────────────────────────
const lngLat = z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)])
/**
 * TOTAL vertex budget for one geofence (audit high). The old per-ring cap of 10 000 was not a
 * bound in any sense that mattered: the worker ray-casts every fence against every record on the
 * ONE process that hosts all 16 shard consumers plus every BullMQ job, with no bounding-box
 * prefilter — 200 records × 100 fences × 10k vertices measured at 459 ms of SYNCHRONOUS blocking
 * per batch, from a body a free trial can POST. A 10k-vertex polygon is also only ~0.2 % of the
 * 10 000 km² area cap, so neither existing guard came close to catching it. 2 000 positions is far
 * more than any hand-drawn or municipal boundary needs after simplification.
 */
export const MAX_GEOFENCE_VERTICES = 2_000
const totalVertices = (rings: unknown[][]): number => rings.reduce((n, r) => n + r.length, 0)

/** A GeoJSON Polygon: ≥1 linear ring, each ≥4 positions and closed (first === last).
 * The server also enforces ST_IsValid + an area cap; this is the shape gate. */
export const geoJsonPolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(z.array(lngLat).min(4).max(MAX_GEOFENCE_VERTICES))
      .min(1)
      .max(50),
  })
  .refine(
    (g) => g.coordinates.every((ring) => {
      const a = ring[0]
      const b = ring[ring.length - 1]
      return a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1]
    }),
    { message: 'each ring must be closed (first position === last)' },
  )
  .refine((g) => totalVertices(g.coordinates) <= MAX_GEOFENCE_VERTICES, {
    message: `polygon exceeds ${MAX_GEOFENCE_VERTICES} total vertices — simplify it`,
  })
/** A GeoJSON LineString: ≥2 positions — the centre-line of a corridor geofence (V2). */
export const geoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(lngLat).min(2).max(MAX_GEOFENCE_VERTICES),
})
export const geofenceKindSchema = z.enum(['polygon', 'circle', 'corridor'])
/** Corridor half-width in metres (the buffer around the route line). 10 m … 5 km. */
const corridorBufferSchema = z.number().int().min(10).max(5_000)

export const geofenceCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    color: hexColor.optional(),
    kind: geofenceKindSchema,
    /** null ⇒ tenant-shared (visible to all accounts); a tenant admin may set it. */
    accountId: z.string().uuid().nullable().optional(),
    /** polygon/circle: the closed polygon. Absent for a corridor. */
    geometry: geoJsonPolygonSchema.optional(),
    /** corridor: the route centre-line + buffer half-width (server buffers it to a polygon). */
    line: geoJsonLineStringSchema.optional(),
    bufferM: corridorBufferSchema.optional(),
  })
  // exactly the fields for the kind: a corridor needs line+bufferM (no geometry); others need geometry
  .refine((d) => (d.kind === 'corridor' ? d.line !== undefined && d.bufferM !== undefined && d.geometry === undefined : d.geometry !== undefined && d.line === undefined),
    { message: 'corridor requires { line, bufferM }; polygon/circle require { geometry }' })
export const geofenceUpdateSchema = z
  .object({
    // kind is immutable post-create (a corridor is physically stored as a buffered polygon)
    name: z.string().min(1).max(120),
    color: hexColor,
    geometry: geoJsonPolygonSchema,
  })
  .partial()

export interface GeofenceView {
  id: string
  tenantId: string
  accountId: string | null
  name: string
  color: string
  kind: 'polygon' | 'circle' | 'corridor'
  geometry: unknown // GeoJSON Polygon (a corridor is stored as its buffered polygon)
  createdAt: string
}

// ── driver safety scoring (V2) ─────────────────────────────────────────────────────────────
export interface DriverScoreView {
  driverId: string
  driverName: string
  trips: number
  distanceKm: number
  maxSpeed: number
  idleH: number
  overspeedEvents: number
  /** 0–100 safety score; null when the driver has no trips in the window (nothing to score). */
  score: number | null
}

/** Pure safety score (0–100) from a driver's window aggregates — the single source for API + web.
 *  100 = clean; deductions for overspeed frequency, excessive top speed, and idling. Null when the
 *  driver drove no trips in the window (no signal). Deterministic + clamped; unit-tested. */
export function driverScore(agg: { trips: number; distanceM: number; maxSpeed: number; idleS: number; driveS: number; overspeedEvents: number }): number | null {
  if (agg.trips <= 0) return null
  const km = agg.distanceM / 1000
  // overspeed events per 100 km (guard tiny distance so one event on 0.1 km isn't ×1000)
  const perHundredKm = km >= 1 ? (agg.overspeedEvents / km) * 100 : agg.overspeedEvents
  const overspeedPenalty = Math.min(perHundredKm * 8, 45)
  // top speed above 100 km/h
  const speedPenalty = agg.maxSpeed > 100 ? Math.min((agg.maxSpeed - 100) * 0.5, 20) : 0
  // idle share of drive time
  const idlePenalty = agg.driveS > 0 ? Math.min((agg.idleS / agg.driveS) * 30, 20) : 0
  return Math.max(0, Math.min(100, Math.round(100 - overspeedPenalty - speedPenalty - idlePenalty)))
}

// ── maintenance reminders (V2, engine hours + plans in FLEET-1) ────────────────────────────
export const maintenanceCreateSchema = z.object({
  deviceId: z.string().min(1), // stringified BigInt; the route validates the device is in scope
  // accountId is intentionally NOT accepted — it's derived from the device's account (a body value
  // could otherwise imply a caller can steer the account; the route ignores it either way).
  title: z.string().min(1).max(120),
  intervalKm: z.number().int().min(1).max(10_000_000).nullish(),
  intervalDays: z.number().int().min(1).max(3650).nullish(),
  intervalEngineH: z.number().int().min(1).max(1_000_000).nullish(),
  lastServiceOdoKm: z.number().int().min(0).max(10_000_000).nullish(),
  lastServiceAt: z.string().datetime().nullish(),
  lastServiceEngineH: z.number().int().min(0).max(1_000_000).nullish(),
  active: z.boolean().optional(),
})
export const maintenanceUpdateSchema = maintenanceCreateSchema.omit({ deviceId: true }).partial()

/** Plan template item (FLEET-1 F2): the intervals only — baselines are set at APPLY time from
 *  the device's current odometer/now, exactly like a hand-created item. */
export const maintenancePlanItemSchema = z
  .object({
    title: z.string().min(1).max(120),
    intervalKm: z.number().int().min(1).max(10_000_000).nullish(),
    intervalDays: z.number().int().min(1).max(3650).nullish(),
    intervalEngineH: z.number().int().min(1).max(1_000_000).nullish(),
  })
  .refine((i) => i.intervalKm != null || i.intervalDays != null || i.intervalEngineH != null, {
    message: 'an item needs at least one interval (km, days or engine hours)',
  })
export const maintenancePlanCreateSchema = z.object({
  name: z.string().min(1).max(120),
  items: z.array(maintenancePlanItemSchema).min(1).max(50),
})
export const maintenancePlanUpdateSchema = maintenancePlanCreateSchema.partial()
/** Apply a plan: create its items for each device. Idempotent per (device, title) — an item
 *  with the same title already on the device is skipped, not duplicated. */
export const maintenancePlanApplySchema = z.object({
  deviceIds: z.array(z.string().min(1)).min(1).max(500),
})
export type MaintenancePlanItem = z.infer<typeof maintenancePlanItemSchema>

/** Ad-hoc service-log entry (FLEET-1 F2) — work done outside any schedule. */
export const serviceLogCreateSchema = z.object({
  title: z.string().min(1).max(160),
  at: z.string().datetime().optional(), // defaults to now server-side
  odoKm: z.number().int().min(0).max(10_000_000).nullish(),
  engineH: z.number().int().min(0).max(1_000_000).nullish(),
  costCents: z.number().int().min(0).max(2_000_000_000).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  vendor: z.string().max(160).nullish(),
  notes: z.string().max(2000).nullish(),
})
export interface ServiceLogView {
  id: string
  deviceId: string
  maintenanceItemId: string | null
  title: string
  at: string
  odoKm: number | null
  engineH: number | null
  costCents: number | null
  currency: string
  vendor: string | null
  notes: string | null
  createdAt: string
}

// ── vehicle documents (FLEET-1 F3) ─────────────────────────────────────────────────────────
export const vehicleDocumentKindSchema = z.enum(['insurance', 'inspection', 'tachograph', 'permit', 'leasing', 'other'])
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export const vehicleDocumentCreateSchema = z.object({
  kind: vehicleDocumentKindSchema,
  title: z.string().min(1).max(160),
  number: z.string().max(64).nullish(),
  validFrom: z.string().regex(DATE_ONLY).nullish(),
  validTo: z.string().regex(DATE_ONLY),
  note: z.string().max(2000).nullish(),
})
export const vehicleDocumentUpdateSchema = vehicleDocumentCreateSchema.partial()
export type DocumentDueStatus = 'ok' | 'due_soon' | 'overdue'
/** "Expiring" window for documents — insurance/TA renewals need lead time to act on. */
export const DOC_DUE_SOON_DAYS = 30
/** Pure due state for a document expiry (date-only, UTC midnight semantics — one source for
 *  API and web, like maintenanceDue below). */
export function documentDue(validTo: string, nowMs: number): { daysRemaining: number; status: DocumentDueStatus } {
  const due = Date.parse(`${validTo}T23:59:59.999Z`) // valid THROUGH the stated day
  const daysRemaining = Math.floor((due - nowMs) / 86_400_000)
  return { daysRemaining, status: daysRemaining < 0 ? 'overdue' : daysRemaining <= DOC_DUE_SOON_DAYS ? 'due_soon' : 'ok' }
}
export interface VehicleDocumentView {
  id: string
  deviceId: string
  kind: z.infer<typeof vehicleDocumentKindSchema>
  title: string
  number: string | null
  validFrom: string | null
  validTo: string
  note: string | null
  createdAt: string
  due: { daysRemaining: number; status: DocumentDueStatus }
}
/**
 * Platform console: the only user field a platform admin flips from outside the tenant.
 *
 * Deliberately NOT role or account — those belong to the tenant's own admin, who knows why someone
 * is a manager. Reaching across a tenant boundary to re-grant privileges inside it is a different
 * and much larger decision than switching an account off.
 */
export const platformUserUpdateSchema = z.object({
  disabled: z.boolean(),
})

export const markServicedSchema = z.object({
  at: z.string().datetime().optional(), // defaults to now server-side
  odoKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
  engineH: z.number().int().min(0).max(1_000_000).nullable().optional(),
  // FLEET-1 F2: marking serviced writes a service-log row — these enrich it (optional)
  costCents: z.number().int().min(0).max(2_000_000_000).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  vendor: z.string().max(160).nullish(),
  notes: z.string().max(2000).nullish(),
})

/** Computed maintenance due state (V2) — never stored; derived from the device's current odometer
 *  + now. `status='unknown'` means no computable interval (missing interval or baseline). */
export type MaintenanceStatus = 'ok' | 'due_soon' | 'overdue' | 'unknown'
export interface MaintenanceDue {
  kmRemaining: number | null
  daysRemaining: number | null
  /** engine hours remaining (FLEET-1 F2) — null when no engine-hour interval/baseline */
  engineHRemaining: number | null
  status: MaintenanceStatus
}
export interface MaintenanceView {
  id: string
  deviceId: string
  title: string
  intervalKm: number | null
  intervalDays: number | null
  intervalEngineH: number | null
  lastServiceOdoKm: number | null
  lastServiceAt: string | null
  lastServiceEngineH: number | null
  active: boolean
  createdAt: string
  /** the device's current odometer (km) at read time — null if the device reports none. */
  currentOdoKm: number | null
  /** derived engine hours at read time (baseline + driven hours since) — null if not computable */
  currentEngineH: number | null
  due: MaintenanceDue
  /** forecast (FLEET-1 F2): the km-due date predicted from the device's avg daily km over the
   *  last 30 days; ISO date or null when not computable. Day-due dates are exact, not forecast. */
  predictedDueAt: string | null
}

/** "Due soon" thresholds (V2). Overdue = past the interval; due_soon = within this window. */
export const MAINT_DUE_SOON_KM = 500
export const MAINT_DUE_SOON_DAYS = 14
const DAY_MS = 86_400_000

/** Pure due computation — the single source of truth for both API and web. Given the item, the
 *  device's current odometer (km, or null), and now (ms): compute km/day remaining + a status. */
/** "Due soon" window for engine-hour intervals (FLEET-1 F2). */
export const MAINT_DUE_SOON_ENGINE_H = 50

export function maintenanceDue(
  item: {
    intervalKm: number | null
    intervalDays: number | null
    intervalEngineH?: number | null
    lastServiceOdoKm: number | null
    lastServiceAt: string | null
    lastServiceEngineH?: number | null
  },
  currentOdoKm: number | null,
  nowMs: number,
  currentEngineH: number | null = null,
): MaintenanceDue {
  const kmRemaining =
    item.intervalKm != null && item.lastServiceOdoKm != null && currentOdoKm != null
      ? item.lastServiceOdoKm + item.intervalKm - currentOdoKm
      : null
  let daysRemaining: number | null = null
  if (item.intervalDays != null && item.lastServiceAt != null) {
    const dueAt = Date.parse(item.lastServiceAt) + item.intervalDays * DAY_MS
    if (Number.isFinite(dueAt)) daysRemaining = Math.floor((dueAt - nowMs) / DAY_MS)
  }
  const engineHRemaining =
    item.intervalEngineH != null && item.lastServiceEngineH != null && currentEngineH != null
      ? item.lastServiceEngineH + item.intervalEngineH - currentEngineH
      : null
  let status: MaintenanceStatus = 'unknown'
  if (kmRemaining !== null || daysRemaining !== null || engineHRemaining !== null) {
    const overdue =
      (kmRemaining !== null && kmRemaining < 0) ||
      (daysRemaining !== null && daysRemaining < 0) ||
      (engineHRemaining !== null && engineHRemaining < 0)
    const soon =
      (kmRemaining !== null && kmRemaining <= MAINT_DUE_SOON_KM) ||
      (daysRemaining !== null && daysRemaining <= MAINT_DUE_SOON_DAYS) ||
      (engineHRemaining !== null && engineHRemaining <= MAINT_DUE_SOON_ENGINE_H)
    status = overdue ? 'overdue' : soon ? 'due_soon' : 'ok'
  }
  return { kmRemaining, daysRemaining, engineHRemaining, status }
}

/** Forecast the km-due date from average daily km (FLEET-1 F2). Pure; null when the average is
 *  unusable (≤0), the item already lacks a km due, or the item is overdue (the date is "now"). */
export function predictKmDueDate(kmRemaining: number | null, avgKmPerDay: number | null, nowMs: number): string | null {
  if (kmRemaining === null || avgKmPerDay === null || avgKmPerDay <= 0) return null
  if (kmRemaining < 0) return null
  const days = kmRemaining / avgKmPerDay
  if (!Number.isFinite(days) || days > 3650) return null
  return new Date(nowMs + days * DAY_MS).toISOString().slice(0, 10)
}

// ── iButton driver resolution (V2, Part B) ─────────────────────────────────────────────────
// The physical Dallas key has ONE 64-bit id, but it reaches us two ways: the driver registry
// stores it as HEX (what the operator reads off the key), while the pipeline's AVL 78 "iButton"
// arrives DECIMAL (the codec decodes the 8-byte big-endian value as an integer — Codec 8/8E fixed
// IO, https://wiki.teltonika-gps.com/view/Codec, AVL id 78 "iButton", 8 B Unsigned). To match, both
// sides reduce to the same canonical DECIMAL string via BigInt — leading-zero / case differences
// vanish. ASSUMPTION (byte order): the operator enters the hex in the SAME big-endian order the
// device reports AVL 78; a golden fixture with a real non-zero iButton to pin this is a follow-up
// (existing codec8 fixture carries iButton=0). If a device family printed the id byte-reversed,
// resolution would silently miss (no wrong assignment, just no auto-driver) — safe-fail.
/** Canonical key from the registry's hex iButton (e.g. "00A1B2C3D4" → "692635348"). null if invalid. */
export function ibuttonKeyFromHex(hex: string): string | null {
  if (!/^[0-9a-fA-F]{1,32}$/.test(hex)) return null
  try { return BigInt('0x' + hex).toString() } catch { return null }
}
/** Canonical key from the AVL 78 value (a decimal Number/string/bigint). null when 0/absent/invalid
 *  (iButton value 0 = no key attached). */
export function ibuttonKeyFromAvl(value: unknown): string | null {
  // AVL 78 arrives as a decimal number/bigint/string; anything else isn't an iButton value
  if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') return null
  const s = String(value).trim()
  if (s === '' || !/^\d+$/.test(s)) return null
  try { const n = BigInt(s); return n === 0n ? null : n.toString() } catch { return null }
}

// ── driver registry (V2) ──────────────────────────────────────────────────────────────────
// iButton/RFID key ids are hex (Dallas 1-Wire 64-bit → up to 16 hex; be generous to 32). The
// hex charset also keeps the value injection-inert for the follow-up that puts it in Redis / SMS.
const ibuttonSchema = z.string().regex(/^[0-9a-fA-F]{8,32}$/, 'iButton id must be 8–32 hex chars')
export const driverCreateSchema = z.object({
  accountId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  licenseNo: z.string().max(60).nullish(),
  ibutton: ibuttonSchema.nullish(),
  phone: z.string().max(40).nullish(),
  notes: z.string().max(500).nullish(),
  active: z.boolean().optional(),
})
export const driverUpdateSchema = driverCreateSchema.partial().omit({ accountId: true })
export interface DriverView {
  id: string
  tenantId: string
  accountId: string
  name: string
  licenseNo: string | null
  ibutton: string | null
  phone: string | null
  notes: string | null
  active: boolean
  createdAt: string
}

// ── temporary public share links (V1-nice) ────────────────────────────────────────────────
/** Create a share link for a device. ttl capped at 30 days so a "temporary" link can't be forever. */
export const shareCreateSchema = z.object({
  ttlHours: z.number().int().min(1).max(720),
  label: z.string().max(80).optional(),
})
export interface ShareLinkView {
  id: string
  tenantId: string
  deviceId: string
  prefix: string
  label: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}
/**
 * What the PUBLIC (no-auth) share endpoint returns — deliberately minimal. `label` is the
 * OPERATOR-CHOSEN public label for the link (null if unset); the device's internal name is NEVER
 * exposed (it commonly carries PII/plates the minting user didn't mean to publish — review MED).
 */
export interface PublicShareView {
  label: string | null
  expiresAt: string
  position: {
    lat: number
    lon: number
    fixTime: string
    speedKph: number | null
    course: number | null
  } | null
}

// ── billing (Stripe, ADR-024) ──────────────────────────────────────────────────────────────
/** GET /v1/billing — the tenant's subscription state. `configured` is false when the server
 *  has no Stripe keys (staging/CI): the UI then shows billing as unavailable rather than erroring. */
export interface BillingView {
  /** true when STRIPE_SECRET_KEY + price are set server-side; false ⇒ billing disabled */
  configured: boolean
  /** true once a Stripe customer exists for the tenant */
  hasCustomer: boolean
  /** mirrors Stripe subscription.status; null = never subscribed */
  status: string | null
  /** convenience: status ∈ {active, trialing} */
  active: boolean
  /** ISO end of the current paid period, or null */
  currentPeriodEnd: string | null
  /** ISO instant the fleet was cut off for non-payment; null = serving (audit MED #22). The UI needs
   *  this to explain an empty live map — "no devices are reporting" and "we stopped accepting their
   *  data" look identical on screen and could not be more different to the person looking at it. */
  suspendedAt: string | null
  /** true when the tenant may start Stripe Checkout — computed SERVER-SIDE with the same predicate
   *  the checkout route enforces, so the UI can never offer (or hide) a plan picker that disagrees
   *  with the API. True for: never subscribed, a terminally-ended subscription, and an F2 self-serve
   *  LOCAL trial (trialing with no Stripe subscription — the trial must be able to convert to paid). */
  canSubscribe: boolean
  /** true while an F2 self-serve trial is running (local trial, not a Stripe-side trial). */
  localTrial: boolean
}
/** POST /v1/billing/checkout and /portal both return a Stripe-hosted URL to redirect to. */
export interface BillingRedirectView {
  url: string
}
/** GET /v1/billing/plans — a subscribable plan for the picker (resolved from Stripe prices). */
export interface BillingPlanView {
  priceId: string
  productName: string
  /** amount in minor units (cents), or null for a metered price */
  amount: number | null
  currency: string
  interval: string | null
}
