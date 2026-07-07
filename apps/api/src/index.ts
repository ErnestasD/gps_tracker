// @orbetra/api — Hono REST + WS gateway (E02-4 ws-ticket/live stream; E03-1 auth).
export { createApp, createApiProm, type ApiDeps, type ApiProm } from './app.js'
export { attachWsGateway, issueTicket, type WsAuthContext, type WsDeps } from './ws.js'
export { authMiddleware, requireRole, problem, type AuthContext, type AuthEnv } from './auth/middleware.js'
export { mintAccessToken, verifyAccessToken, ISSUER, type AccessClaims } from './auth/jwt.js'
export { hashPassword, verifyPassword } from './auth/passwords.js'
export { createAuthRoutes, type AuthRouteDeps } from './auth/login.js'
