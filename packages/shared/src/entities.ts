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
}
/** One fuel-level sample for the playback fuel graph (E08-3). pct comes from AVL 89 (or
 * OBD 48) in %, liters from AVL 84 (wiki ×0.1 already applied). Either may be null when
 * the device reports only one representation. */
export interface FuelSampleView {
  fixTime: string // ISO
  pct: number | null
  liters: number | null
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
export const geofenceKindSchema = z.enum(['polygon', 'circle'])
export const geofenceCreateSchema = z.object({
  name: z.string().min(1).max(120),
  color: hexColor.optional(),
  kind: geofenceKindSchema,
  /** null ⇒ tenant-shared (visible to all accounts); a tenant admin may set it. */
  accountId: z.string().uuid().nullable().optional(),
  geometry: geoJsonPolygonSchema,
})
export const geofenceUpdateSchema = z
  .object({
    name: z.string().min(1).max(120),
    color: hexColor,
    kind: geofenceKindSchema,
    geometry: geoJsonPolygonSchema,
  })
  .partial()

export interface GeofenceView {
  id: string
  tenantId: string
  accountId: string | null
  name: string
  color: string
  kind: 'polygon' | 'circle'
  geometry: unknown // GeoJSON Polygon
  createdAt: string
}
