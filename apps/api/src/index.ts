// @orbetra/api — Hono REST + WS gateway (E02-4 ws-ticket/live stream; E03-1 auth;
// E03-2 scoped CRUD + isolation manifest).
export { createApp, createApiProm, apiManifest, type ApiDeps, type ApiProm } from './app.js'
export { type ManifestEntry, type ScopeClass } from './routes/registry.js'
export { attachWsGateway, issueTicket, type WsAuthContext, type WsDeps } from './ws.js'
export { authMiddleware, requireRole, problem, type AuthContext, type AuthEnv } from './auth/middleware.js'
export { mintAccessToken, verifyAccessToken, ISSUER, type AccessClaims } from './auth/jwt.js'
export { hashPassword, verifyPassword } from './auth/passwords.js'
export { createAuthRoutes, type AuthRouteDeps } from './auth/login.js'
// registry sync — the ONE implementation of device/rule/geofence↔worker wiring;
// tools/seed-demo reuses these instead of duplicating Redis key formats
export { activateDevice, type RegistryDevice } from './routes/deviceRegistry.js'
export { syncRule } from './routes/ruleRegistry.js'
export { syncGeofence } from './routes/geofenceRegistry.js'
