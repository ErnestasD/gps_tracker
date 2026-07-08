import { PrismaClient } from '@prisma/client'

import { buildAuthMethods, type AuthDb } from './auth.js'
import { createAccountRepo, type AccountRepo } from './repos/accounts.js'
import { createAuditRepo, type AuditRepo } from './repos/audit.js'
import { createDeviceRepo, type DeviceRepo } from './repos/devices.js'
import { createEventRepo, type EventRepo } from './repos/events.js'
import { createGeofenceRepo, type GeofenceRepo } from './repos/geofences.js'
import { createProfileRepo, type ProfileRepo } from './repos/profiles.js'
import { createRuleRepo, type RuleRepo } from './repos/rules.js'
import { createTenantDomainRepo, type TenantDomainRepo } from './repos/tenantDomains.js'
import { createTenantRepo, type TenantRepo } from './repos/tenants.js'
import { createTripRepo, type TripReadRepo } from './repos/trips.js'
import { createUserRepo, type UserRepo } from './repos/users.js'
import { createWebhookRepo, type WebhookRepo } from './repos/webhooks.js'

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
  profiles: ProfileRepo
  rules: RuleRepo
  webhooks: WebhookRepo
  events: EventRepo
  trips: TripReadRepo
  geofences: GeofenceRepo
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
    profiles: createProfileRepo(prisma),
    rules: createRuleRepo(prisma, audit),
    webhooks: createWebhookRepo(prisma, audit),
    events: createEventRepo(prisma),
    trips: createTripRepo(prisma),
    geofences: createGeofenceRepo(prisma, audit),
    audit,
    $disconnect: () => prisma.$disconnect(),
  }
}
