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

// ── self password change ─────────────────────────────────────────────────────
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(8).max(1024),
})
