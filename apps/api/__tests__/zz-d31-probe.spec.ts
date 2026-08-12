import { describe, it } from 'vitest'
import { apiManifest } from '../src/app.js'
import { buildOpenApi } from '../src/openapi.js'

describe('d31 probe', () => {
  it('dumps', () => {
    const spec = buildOpenApi(apiManifest(), 'https://api.orbetra.test') as any
    const paths = Object.keys(spec.paths).sort()
    console.log('TOTAL_PATHS', paths.length, 'MANIFEST', apiManifest().length)
    console.log('AUTH_PATHS', JSON.stringify(paths.filter((p) => p.startsWith('/v1/auth'))))
    console.log('ALL', JSON.stringify(paths.map((p) => `${Object.keys(spec.paths[p]).join('|')} ${p}`), null, 1))
  })
})
