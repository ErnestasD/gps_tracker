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

// ── rules ────────────────────────────────────────────────────────────────────
// MUST mirror the Prisma RuleKind enum (packages/db/prisma/schema.prisma)
export const ruleKindSchema = z.enum(['geofence', 'overspeed', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic', 'device_offline'])
export const ruleCreateSchema = z.object({
  accountId: z.string().uuid(),
  kind: ruleKindSchema,
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).optional(),
  scope: z.record(z.string(), z.unknown()).optional(),
  channels: z.array(z.unknown()).optional(),
  cooldownS: z.number().int().min(0).max(86_400).optional(),
  enabled: z.boolean().optional(),
})
export const ruleUpdateSchema = ruleCreateSchema.omit({ accountId: true, kind: true }).partial()

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
