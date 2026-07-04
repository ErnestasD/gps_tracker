// @orbetra/api — Hono REST + WS gateway (E02-4: ws-ticket + live stream).
export { createApp, createApiProm, type ApiProm, type AuthStub } from './app.js'
export { attachWsGateway, issueTicket, type WsAuthContext, type WsDeps } from './ws.js'
