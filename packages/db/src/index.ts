// @orbetra/db — the scoped-repository layer (E03-2) is the ONLY relational DB API.
// Prisma is confined here (CLAUDE.md rule 2; enforced by lint + the isolation suite).
export { createPool } from './pool.js'
export { createAuthDb, buildAuthMethods, UNSCOPED_AUTH_METHODS, type AuthDb, type AuthUserRow, type RefreshTokenRow } from './auth.js'
export { createDb, type Db } from './db.js'

export { type Scope, type Actor, scopedWhere, NotInScopeError } from './scope.js'
export { type AccountRepo, type AccountCreate, type AccountUpdate } from './repos/accounts.js'
export { type UserRepo, type UserView, type UserCreate, type UserUpdate } from './repos/users.js'
export { DuplicateImeiError, type DeviceRepo, type DeviceCreate, type DeviceUpdate } from './repos/devices.js'
export { DriverIbuttonConflictError, type DriverRepo, type DriverCreate, type DriverUpdate } from './repos/drivers.js'
export { type CommandRepo, type CommandView, type CommandCreate } from './repos/commands.js'
export { type ExportRepo, type ExportJobView } from './repos/exports.js'
export { type LeadRepo, type LeadView, type LeadCreate } from './repos/leads.js'
export { type ProfileRepo } from './repos/profiles.js'
export { type RuleRepo, type RuleCreate, type RuleUpdate } from './repos/rules.js'
export { hashShareToken, type ShareLinkRepo, type ShareLinkView, type ShareLinkCreate, type CreatedShareLink, type ShareLinkResolved } from './repos/shareLinks.js'
export { type WebhookRepo, type WebhookCreate, type WebhookUpdate } from './repos/webhooks.js'
export { type WebhookDeliveryRepo, type WebhookDeliveryView, type WebhookDeliveryListOpts } from './repos/webhookDeliveries.js'
export { type UsageRepo, type PlatformUsageRow, type TenantUsageRow, type UsageRangeOpts } from './repos/usage.js'
export { hashKey, type ApiKeyRepo, type ApiKeyView, type ApiKeyCreate, type CreatedApiKey, type ApiKeyResolved } from './repos/apiKeys.js'
export { type EventRepo, type EventListOpts } from './repos/events.js'
export { type TripReadRepo, type TripListOpts } from './repos/trips.js'
export { type GeofenceRepo, type GeofenceCreate, type GeofenceUpdate, GeofenceInvalidError, GeofenceTooLargeError } from './repos/geofences.js'
export { readPositions, readLatestValidPosition, type PositionsOpts } from './positions.js'
export { readFuelSeries, type FuelOpts } from './fuel.js'
export { readHealthSeries, type HealthOpts } from './health.js'
export { erasePositions } from './gdpr.js'
export {
  runReport,
  isReportType,
  REPORT_TYPES,
  type ReportType,
  type ReportScope,
  type ReportParams,
  type ReportResult,
  type ReportRow,
  type DailyMileageRow,
  type DailyStopsRow,
  type DailyEngineHoursRow,
  type DailyOverspeedRow,
  type DailyGeofenceRow,
  type TripRow,
} from './reports.js'
export type { Pool } from 'pg'
export { type TenantRepo, type TenantCreate, type TenantUpdate } from './repos/tenants.js'
export { type TenantDomainRepo, DomainConflictError, DomainLimitError, MAX_DOMAINS_PER_TENANT } from './repos/tenantDomains.js'
export { type AuditRepo } from './repos/audit.js'
