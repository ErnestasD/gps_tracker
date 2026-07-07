// @orbetra/db — the scoped-repository layer (E03-2) is the ONLY relational DB API.
// Prisma is confined here (CLAUDE.md rule 2; enforced by lint + the isolation suite).
export { createPool } from './pool.js'
export { createAuthDb, buildAuthMethods, UNSCOPED_AUTH_METHODS, type AuthDb, type AuthUserRow, type RefreshTokenRow } from './auth.js'
export { createDb, type Db } from './db.js'

export { type Scope, type Actor, scopedWhere, NotInScopeError } from './scope.js'
export { type AccountRepo, type AccountCreate, type AccountUpdate } from './repos/accounts.js'
export { type UserRepo, type UserView, type UserCreate, type UserUpdate } from './repos/users.js'
export { type RuleRepo, type RuleCreate, type RuleUpdate } from './repos/rules.js'
export { type WebhookRepo, type WebhookCreate, type WebhookUpdate } from './repos/webhooks.js'
export { type EventRepo, type EventListOpts } from './repos/events.js'
export { type TenantRepo, type TenantCreate, type TenantUpdate } from './repos/tenants.js'
export { type AuditRepo } from './repos/audit.js'
