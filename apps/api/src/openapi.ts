import type { ManifestEntry } from './routes/registry.js'

/**
 * OpenAPI 3.1 document for the public API (E06-5, §6.6). Generated from the route MANIFEST
 * (so new CRUD routes appear automatically and can't drift) plus the curated non-manifest
 * routes (auth, reports, api-keys, ws-ticket). Two security schemes: a Bearer JWT (web) and
 * X-Api-Key (integrations). Read (GET) operations accept either; writes require the JWT (an
 * API key is read-only → 403). Served at /v1/openapi.json; the docs page renders it.
 */
interface Operation {
  tags: string[]
  summary: string
  security: Record<string, string[]>[]
  parameters?: unknown[]
  responses: Record<string, { description: string }>
}

const PARAM = /:([a-zA-Z0-9_]+)/g
/** `/v1/devices/:id` → `/v1/devices/{id}` and collect the path params. */
function toPath(path: string): { path: string; params: string[] } {
  const params: string[] = []
  const out = path.replace(PARAM, (_m, name: string) => {
    params.push(name)
    return `{${name}}`
  })
  return { path: out, params }
}

function pathParams(names: string[]): unknown[] {
  return names.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }))
}

const RESPONSES = {
  read: { '200': { description: 'OK' }, '401': { description: 'Unauthenticated' }, '403': { description: 'Forbidden' }, '404': { description: 'Not found' } },
  write: { '200': { description: 'OK' }, '201': { description: 'Created' }, '400': { description: 'Bad request' }, '401': { description: 'Unauthenticated' }, '403': { description: 'Forbidden' } },
  publicPost: { '200': { description: 'OK' }, '400': { description: 'Bad request' }, '429': { description: 'Rate limited' } },
}
// GET accepts a JWT or an API key; writes require the JWT (API keys are read-only).
const READ_SEC: Record<string, string[]>[] = [{ bearerAuth: [] }, { apiKeyAuth: [] }]
const WRITE_SEC: Record<string, string[]>[] = [{ bearerAuth: [] }]

function op(entity: string, method: string, path: string, params: string[]): Operation {
  const read = method === 'get'
  return {
    tags: [entity],
    summary: `${method.toUpperCase()} ${path}`,
    security: read ? READ_SEC : WRITE_SEC,
    ...(params.length > 0 ? { parameters: pathParams(params) } : {}),
    responses: read ? RESPONSES.read : RESPONSES.write,
  }
}

export function buildOpenApi(manifest: ManifestEntry[], serverUrl = '/'): object {
  const paths: Record<string, Record<string, Operation>> = {}
  const add = (method: string, rawPath: string, operation: Operation): void => {
    const { path } = toPath(rawPath)
    ;(paths[path] ??= {})[method] = operation
  }

  for (const m of manifest) {
    const { params } = toPath(m.path)
    add(m.method, m.path, op(m.entity, m.method, m.path, params))
  }

  // curated non-manifest routes (registered outside the CRUD manifest)
  add('post', '/v1/auth/login', { tags: ['auth'], summary: 'Log in (email + password)', security: [], responses: RESPONSES.publicPost })
  add('post', '/v1/auth/refresh', { tags: ['auth'], summary: 'Rotate the refresh token', security: [], responses: RESPONSES.publicPost })
  add('post', '/v1/auth/logout', { tags: ['auth'], summary: 'Revoke the refresh family', security: WRITE_SEC, responses: RESPONSES.write })
  add('get', '/v1/auth/me', { tags: ['auth'], summary: 'Current user', security: WRITE_SEC, responses: RESPONSES.read })
  add('post', '/v1/auth/password', { tags: ['auth'], summary: 'Change own password', security: WRITE_SEC, responses: RESPONSES.write })
  add('get', '/v1/ws-ticket', { tags: ['live'], summary: 'Single-use WebSocket ticket', security: WRITE_SEC, responses: RESPONSES.read })
  add('get', '/v1/devices/last', { tags: ['device'], summary: 'Last-known position snapshot', security: READ_SEC, responses: RESPONSES.read })
  add('get', '/v1/profiles', { tags: ['device'], summary: 'Device profiles (global reference data)', security: READ_SEC, responses: RESPONSES.read })
  add('get', '/v1/branding', { tags: ['tenant'], summary: 'Public branding by Host', security: [], responses: RESPONSES.read })
  add('post', '/v1/public/pilot-request', { tags: ['public'], summary: 'Pilot request from the marketing site (rate-limited, honeypotted)', security: [], responses: RESPONSES.write })
  add('post', '/v1/reports/{type}', {
    tags: ['report'],
    summary: 'Run a report (trips/mileage/stops/overspeed/geofence/engine_hours)',
    security: READ_SEC,
    parameters: pathParams(['type']),
    responses: RESPONSES.read,
  })
  // api-key management is tenant-admin only (an API key can't reach it) → JWT security only
  add('get', '/v1/api-keys', { ...op('apiKey', 'get', '/v1/api-keys', []), security: WRITE_SEC })
  add('post', '/v1/api-keys', op('apiKey', 'post', '/v1/api-keys', []))
  add('delete', '/v1/api-keys/{id}', op('apiKey', 'delete', '/v1/api-keys/:id', ['id']))

  const tags = [...new Set(Object.values(paths).flatMap((ops) => Object.values(ops).flatMap((o) => o.tags)))].sort().map((name) => ({ name }))

  return {
    openapi: '3.1.0',
    info: {
      title: 'Orbetra API',
      version: '1.0.0',
      description: 'Multi-tenant GPS tracking API. Authenticate with a Bearer JWT (web) or X-Api-Key (integrations, read-only). Times are ISO-8601 UTC.',
    },
    servers: [{ url: serverUrl }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key', description: 'Read-only integration key (orb_live_…)' },
      },
    },
  }
}
