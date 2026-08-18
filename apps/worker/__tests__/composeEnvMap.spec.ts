import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every env var the code reads must be mapped in the compose file that runs it.
 *
 * Nothing in `docker-compose.apps.yml` is inherited by luck — each variable is enumerated. So an
 * env var added to the code and forgotten there is read as `undefined` in production while every
 * test passes, and the feature it gates simply switches off in silence. This has now bitten twice:
 *
 *   INGEST_PUBLIC_HOST      absent ⇒ the API served its hard-coded default (our own domain) into
 *                           resellers' customers' hardware
 *   TWILIO_API_KEY_SID/…    absent ⇒ moving to Twilio's revocable API-key credential, the one they
 *                           recommend over the Auth Token, would have killed the SMS gateway with
 *                           no message anywhere
 *
 * A unit test cannot catch that; only reading the two files together can. Scoped to the prefixes
 * whose absence is silent rather than loud — a missing DATABASE_URL crashes on boot and needs no
 * test to find it.
 */
const REPO = resolve(import.meta.dirname, '../../..')
const COMPOSE = readFileSync(resolve(REPO, 'infra/compose/docker-compose.apps.yml'), 'utf8')

/** Sources whose env reads gate a feature silently. */
const SOURCES = [
  'packages/shared/src/sms.ts',
  'apps/worker/src/sms/drivers.ts',
] as const

/** Prefixes of the integrations that fail QUIETLY when unset. */
const SILENT_PREFIXES = /^(TWILIO|TELEGRAM|SES|SMTP|VAPID|GEOCODER|OSRM)_/

describe('compose env map covers every silently-gating env var the code reads', () => {
  it('maps them all', () => {
    const read = new Set<string>()
    for (const rel of SOURCES) {
      const src = readFileSync(resolve(REPO, rel), 'utf8')
      for (const m of src.matchAll(/env\['([A-Z][A-Z0-9_]+)'\]/g)) {
        const name = m[1]!
        if (SILENT_PREFIXES.test(name)) read.add(name)
      }
    }
    expect(read.size, 'the scan found no env vars at all — the regex or the paths drifted').toBeGreaterThan(3)

    const missing = [...read].filter((name) => !new RegExp(`^\\s+${name}:`, 'm').test(COMPOSE))
    expect(missing, `read by the code but never passed to the container: ${missing.join(', ')}`).toEqual([])
  })
})
