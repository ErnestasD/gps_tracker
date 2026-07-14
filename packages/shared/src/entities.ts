import { z } from 'zod'

import { roleSchema } from './roles.js'

/** CRUD request contracts (E03-2). The single type source for api ↔ web. */

// ── accounts ─────────────────────────────────────────────────────────────────
export const accountCreateSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).optional(),
})
export const accountUpdateSchema = accountCreateSchema.partial()

// ── users ────────────────────────────────────────────────────────────────────
export const userCreateSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(1024),
  role: roleSchema,
  accountId: z.string().uuid().nullable(),
})
export const userUpdateSchema = z
  .object({
    role: roleSchema,
    accountId: z.string().uuid().nullable(),
    locale: z.string().min(2).max(10),
    password: z.string().min(8).max(1024),
  })
  .partial()

// ── devices ──────────────────────────────────────────────────────────────────
export const odometerSourceSchema = z.enum(['auto', 'device', 'gps'])
export const deviceCreateSchema = z.object({
  accountId: z.string().uuid(),
  profileId: z.string().uuid(),
  imei: z.string().regex(/^\d{15}$/, 'IMEI must be 15 digits'),
  name: z.string().min(1).max(120),
  plate: z.string().max(32).nullable().optional(),
  groupName: z.string().max(64).nullable().optional(),
  odometerSource: odometerSourceSchema.optional(),
})
export const deviceUpdateSchema = z
  .object({
    name: z.string().min(1).max(120),
    plate: z.string().max(32).nullable(),
    groupName: z.string().max(64).nullable(),
    profileId: z.string().uuid(),
    odometerSource: odometerSourceSchema,
  })
  .partial()
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
export const ruleKindSchema = z.enum(['geofence', 'overspeed', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic', 'device_offline'])

// A rule's notification channels (E05-5). email = SES recipient; telegram = a chat_id bound
// via the pairing deep-link. Webhook delivery is a separate channel type in E06-4.
export const notificationChannelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), to: z.string().email() }),
  z.object({ type: z.literal('telegram'), chatId: z.string().min(1).max(64) }),
])
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

export const ruleCreateSchema = z.object({
  accountId: z.string().uuid(),
  kind: ruleKindSchema,
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).optional(),
  scope: z.record(z.string(), z.unknown()).optional(),
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
  ref: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
})
export type PilotRequestInput = z.infer<typeof pilotRequestSchema>

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

// ── webhooks ─────────────────────────────────────────────────────────────────
export const webhookCreateSchema = z.object({
  accountId: z.string().uuid().nullable(),
  url: z.string().url().max(2048),
  secret: z.string().min(16).max(256),
  events: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
})
export const webhookUpdateSchema = z
  .object({ url: z.string().url().max(2048), events: z.array(z.string()), enabled: z.boolean() })
  .partial()

// ── tenants (platform) ───────────────────────────────────────────────────────
export const tenantCreateSchema = z.object({
  name: z.string().min(1).max(120),
  branding: z.record(z.string(), z.unknown()).optional(),
})
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

// ── geofences (E05-1) ──────────────────────────────────────────────────────────
const lngLat = z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)])
/** A GeoJSON Polygon: ≥1 linear ring, each ≥4 positions and closed (first === last).
 * The server also enforces ST_IsValid + an area cap; this is the shape gate. */
export const geoJsonPolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(z.array(lngLat).min(4).max(10_000))
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
/** A GeoJSON LineString: ≥2 positions — the centre-line of a corridor geofence (V2). */
export const geoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(lngLat).min(2).max(10_000),
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

// ── maintenance reminders (V2) ─────────────────────────────────────────────────────────────
export const maintenanceCreateSchema = z.object({
  deviceId: z.string().min(1), // stringified BigInt; the route validates the device is in scope
  // accountId is intentionally NOT accepted — it's derived from the device's account (a body value
  // could otherwise imply a caller can steer the account; the route ignores it either way).
  title: z.string().min(1).max(120),
  intervalKm: z.number().int().min(1).max(10_000_000).nullish(),
  intervalDays: z.number().int().min(1).max(3650).nullish(),
  lastServiceOdoKm: z.number().int().min(0).max(10_000_000).nullish(),
  lastServiceAt: z.string().datetime().nullish(),
  active: z.boolean().optional(),
})
export const maintenanceUpdateSchema = maintenanceCreateSchema.omit({ deviceId: true }).partial()
export const markServicedSchema = z.object({
  at: z.string().datetime().optional(), // defaults to now server-side
  odoKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
})

/** Computed maintenance due state (V2) — never stored; derived from the device's current odometer
 *  + now. `status='unknown'` means no computable interval (missing interval or baseline). */
export type MaintenanceStatus = 'ok' | 'due_soon' | 'overdue' | 'unknown'
export interface MaintenanceDue {
  kmRemaining: number | null
  daysRemaining: number | null
  status: MaintenanceStatus
}
export interface MaintenanceView {
  id: string
  deviceId: string
  title: string
  intervalKm: number | null
  intervalDays: number | null
  lastServiceOdoKm: number | null
  lastServiceAt: string | null
  active: boolean
  createdAt: string
  /** the device's current odometer (km) at read time — null if the device reports none. */
  currentOdoKm: number | null
  due: MaintenanceDue
}

/** "Due soon" thresholds (V2). Overdue = past the interval; due_soon = within this window. */
export const MAINT_DUE_SOON_KM = 500
export const MAINT_DUE_SOON_DAYS = 14
const DAY_MS = 86_400_000

/** Pure due computation — the single source of truth for both API and web. Given the item, the
 *  device's current odometer (km, or null), and now (ms): compute km/day remaining + a status. */
export function maintenanceDue(
  item: { intervalKm: number | null; intervalDays: number | null; lastServiceOdoKm: number | null; lastServiceAt: string | null },
  currentOdoKm: number | null,
  nowMs: number,
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
  let status: MaintenanceStatus = 'unknown'
  if (kmRemaining !== null || daysRemaining !== null) {
    const overdue = (kmRemaining !== null && kmRemaining < 0) || (daysRemaining !== null && daysRemaining < 0)
    const soon = (kmRemaining !== null && kmRemaining <= MAINT_DUE_SOON_KM) || (daysRemaining !== null && daysRemaining <= MAINT_DUE_SOON_DAYS)
    status = overdue ? 'overdue' : soon ? 'due_soon' : 'ok'
  }
  return { kmRemaining, daysRemaining, status }
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
