import { PrismaClient } from '@prisma/client'

import { buildAuthMethods, type AuthDb } from './auth.js'
import { createAccountRepo, type AccountRepo } from './repos/accounts.js'
import { createApiKeyRepo, type ApiKeyRepo } from './repos/apiKeys.js'
import { createAuditRepo, type AuditRepo } from './repos/audit.js'
import { createCommandRepo, type CommandRepo } from './repos/commands.js'
import { createExportRepo, type ExportRepo } from './repos/exports.js'
import { createLeadRepo, type LeadRepo } from './repos/leads.js'
import { createDeviceRepo, type DeviceRepo } from './repos/devices.js'
import { createDriverRepo, type DriverRepo } from './repos/drivers.js'
import { createMaintenanceRepo, type MaintenanceRepo } from './repos/maintenance.js'
import { createEventRepo, type EventRepo } from './repos/events.js'
import { createGeofenceRepo, type GeofenceRepo } from './repos/geofences.js'
import { createProfileRepo, type ProfileRepo } from './repos/profiles.js'
import { createRuleRepo, type RuleRepo } from './repos/rules.js'
import { createShareLinkRepo, type ShareLinkRepo } from './repos/shareLinks.js'
import { createSmsDeliveryRepo, type SmsDeliveryRepo } from './repos/smsDeliveries.js'
import { createTenantDomainRepo, type TenantDomainRepo } from './repos/tenantDomains.js'
import { createTenantRepo, type TenantRepo } from './repos/tenants.js'
import { createTripRepo, type TripReadRepo } from './repos/trips.js'
import { createUsageRepo, type UsageRepo } from './repos/usage.js'
import { createUserRepo, type UserRepo } from './repos/users.js'
import { createWebhookRepo, type WebhookRepo } from './repos/webhooks.js'
import { createScheduledReportRepo, type ScheduledReportRepo } from './repos/scheduledReports.js'
import { createPushSubscriptionRepo, type PushSubscriptionRepo } from './repos/pushSubscriptions.js'
import { createWebhookDeliveryRepo, type WebhookDeliveryRepo } from './repos/webhookDeliveries.js'

/**
 * The scoped-repository layer (E03-2) — the ONLY DB API for relational data.
 * ONE PrismaClient, all repos share it. `auth` is the E03-1 surface (unscoped by
 * design, see UNSCOPED_AUTH_METHODS). Import repos from here; never `@prisma/client`
 * outside packages/db (lint-banned, proven by the isolation suite's lint-proof test).
 */
export interface Db {
  auth: Omit<AuthDb, '$disconnect'>
  tenants: TenantRepo
  tenantDomains: TenantDomainRepo
  accounts: AccountRepo
  users: UserRepo
  devices: DeviceRepo
  drivers: DriverRepo
  maintenance: MaintenanceRepo
  commands: CommandRepo
  smsDeliveries: SmsDeliveryRepo
  profiles: ProfileRepo
  rules: RuleRepo
  shareLinks: ShareLinkRepo
  webhooks: WebhookRepo
  scheduledReports: ScheduledReportRepo
  pushSubscriptions: PushSubscriptionRepo
  webhookDeliveries: WebhookDeliveryRepo
  usage: UsageRepo
  apiKeys: ApiKeyRepo
  events: EventRepo
  trips: TripReadRepo
  geofences: GeofenceRepo
  exports: ExportRepo
  leads: LeadRepo
  audit: AuditRepo
  $disconnect(): Promise<void>
}

export function createDb(databaseUrl: string): Db {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  const audit = createAuditRepo(prisma)
  return {
    auth: buildAuthMethods(prisma),
    tenants: createTenantRepo(prisma, audit),
    tenantDomains: createTenantDomainRepo(prisma, audit),
    accounts: createAccountRepo(prisma, audit),
    users: createUserRepo(prisma, audit),
    devices: createDeviceRepo(prisma, audit),
    drivers: createDriverRepo(prisma, audit),
    maintenance: createMaintenanceRepo(prisma, audit),
    commands: createCommandRepo(prisma, audit),
    smsDeliveries: createSmsDeliveryRepo(prisma),
    profiles: createProfileRepo(prisma),
    rules: createRuleRepo(prisma, audit),
    shareLinks: createShareLinkRepo(prisma, audit),
    webhooks: createWebhookRepo(prisma, audit),
    scheduledReports: createScheduledReportRepo(prisma, audit),
    pushSubscriptions: createPushSubscriptionRepo(prisma),
    webhookDeliveries: createWebhookDeliveryRepo(prisma),
    usage: createUsageRepo(prisma),
    apiKeys: createApiKeyRepo(prisma, audit),
    events: createEventRepo(prisma),
    trips: createTripRepo(prisma, audit),
    geofences: createGeofenceRepo(prisma, audit),
    exports: createExportRepo(prisma, audit),
    leads: createLeadRepo(prisma),
    audit,
    $disconnect: () => prisma.$disconnect(),
  }
}
