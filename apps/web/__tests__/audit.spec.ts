import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import de from '../src/i18n/de.json'
import en from '../src/i18n/en.json'
import lt from '../src/i18n/lt.json'
import pl from '../src/i18n/pl.json'
import { AUDIT_ENTITIES, auditQuery } from '../src/lib/audit.js'
import {
  auditChanges, auditSubject, auditSubjectLabel, fieldLabel, flattenSnapshot, formatAuditValue,
  humanizeField, isColorValue, shortId, type FormatCtx,
} from '../src/lib/auditView.js'

/** Audit filter → query string (E03-6). Pure; empty values must never appear. */
describe('auditQuery', () => {
  it('omits empty/undefined filters entirely', () => {
    expect(auditQuery({})).toBe('')
    expect(auditQuery({ entity: '', action: '' })).toBe('')
  })

  it('serializes present filters', () => {
    expect(auditQuery({ entity: 'device', action: 'delete' })).toBe('?entity=device&action=delete')
    expect(auditQuery({ limit: 50, cursor: '123' })).toBe('?cursor=123&limit=50')
  })

  it('encodes ISO timestamps safely', () => {
    const q = auditQuery({ from: '2026-07-01T00:00:00.000Z' })
    expect(q).toContain('from=2026-07-01T00%3A00%3A00.000Z')
  })
})

/** The tenant record as `branding:update` used to snapshot it — the shape the page must survive. */
const TENANT_BEFORE = {
  id: '3de6ef93-807a-4fd8-b510-a6f3cea6eb3b',
  name: 'Since2',
  plan: 'tsp_grow',
  branding: { accent: '#46D993', logoUrl: 'https://dokigo.lt/logo.svg', primary: '#46D993', productName: 'Dokigo' },
  createdAt: '2026-09-03T12:27:48.935Z',
  stripeCustomerId: 'cus_123',
  referredByAffiliateId: 'aff-1',
}

describe('flattenSnapshot', () => {
  it('walks nested objects into dotted paths so one colour change is one change', () => {
    const flat = flattenSnapshot(TENANT_BEFORE)
    expect(flat['branding.accent']).toBe('#46D993')
    expect(flat['name']).toBe('Since2')
  })

  it('drops identifiers, timestamps and billing internals — including rows written before the repo fix', () => {
    const flat = flattenSnapshot(TENANT_BEFORE)
    expect(Object.keys(flat)).not.toContain('id')
    expect(Object.keys(flat)).not.toContain('createdAt')
    expect(Object.keys(flat)).not.toContain('stripeCustomerId')
    expect(Object.keys(flat)).not.toContain('referredByAffiliateId')
  })

  it('keeps arrays whole — a recipient list is one field to a human', () => {
    expect(flattenSnapshot({ recipients: ['a@x.lt', 'b@x.lt'] })['recipients']).toEqual(['a@x.lt', 'b@x.lt'])
  })

  it('keeps a path whose object flattened to nothing, so "cleared" stays visible', () => {
    expect(Object.keys(flattenSnapshot({ branding: {} }))).toEqual(['branding'])
  })
})

describe('auditChanges', () => {
  it('an update lists ONLY the fields that differ', () => {
    const after = { ...TENANT_BEFORE, branding: { ...TENANT_BEFORE.branding, logoUrl: '/v1/public/brand/abc.png' } }
    const changes = auditChanges({ action: 'update', before: TENANT_BEFORE, after })
    expect(changes.map((c) => c.path)).toEqual(['branding.logoUrl'])
    expect(changes[0]!.before).toBe('https://dokigo.lt/logo.svg')
    expect(changes[0]!.after).toBe('/v1/public/brand/abc.png')
  })

  it('key order is not a change', () => {
    const reordered = { plan: 'tsp_grow', name: 'Since2', branding: TENANT_BEFORE.branding, id: TENANT_BEFORE.id }
    expect(auditChanges({ action: 'update', before: TENANT_BEFORE, after: reordered })).toEqual([])
  })

  it('an empty object on one side does not add a "— → —" row beside the children that changed', () => {
    const changes = auditChanges({
      action: 'update',
      before: { name: 'Since2', branding: {} },
      after: { name: 'Since2', branding: { productName: 'Dokigo', accent: '#46D993' } },
    })
    expect(changes.map((c) => c.path)).toEqual(['branding.productName', 'branding.accent'])
  })

  it('an empty object is an empty value, not a labelled blank cell', () => {
    expect(auditChanges({ action: 'create', before: null, after: { name: 'R1', config: {}, scope: {} } }).map((c) => c.path)).toEqual(['name'])
  })

  it('a create lists the fields that carry a value, not the dozen optional nulls', () => {
    const changes = auditChanges({
      action: 'create',
      before: null,
      after: { id: 7, name: 'Truck 1', imei: '356307042440077', plate: null, vin: null, groupName: '' },
    })
    expect(changes.map((c) => c.path)).toEqual(['name', 'imei'])
  })

  it('a delete reads from the before snapshot', () => {
    const changes = auditChanges({ action: 'delete', before: { name: 'Old rule', enabled: true }, after: null })
    expect(changes.map((c) => c.path)).toEqual(['name', 'enabled'])
    expect(changes[1]!.before).toBe(true)
  })
})

describe('auditSubject', () => {
  it('prefers the white-label product name over the tenant name on a branding row', () => {
    expect(auditSubject({ entity: 'branding', before: TENANT_BEFORE, after: TENANT_BEFORE })).toBe('Dokigo')
  })

  it('names a user by e-mail and a device by name', () => {
    expect(auditSubject({ entity: 'user', before: null, after: { email: 'labas@dokigo.lt', role: 'viewer' } })).toBe('labas@dokigo.lt')
    expect(auditSubject({ entity: 'device', before: null, after: { name: 'Truck 1', imei: '35630' } })).toBe('Truck 1')
  })

  it('falls back to the IMEI when a device row has no name', () => {
    expect(auditSubject({ entity: 'device', before: null, after: { imei: '356307042440077' } })).toBe('356307042440077')
  })

  it('is null when the snapshot carries nothing a human would recognise', () => {
    expect(auditSubject({ entity: 'trip', before: { driverId: null }, after: { driverId: 'd-1' } })).toBeNull()
  })
})

/** Enough of the catalog to prove a key was looked up rather than guessed. */
const CATALOG_STUB: Record<string, string> = {
  'audit.yes': 'Yes', 'audit.no': 'No', 'roles.viewer': 'Viewer',
  'rules.kind.overspeed': 'Overspeed', 'audit.slot.logo': 'Logo',
  'geofences.circle': 'Circle', 'devices.cmd.st.acked': 'Acknowledged',
}

const ctx = (names: Record<string, string> = {}): FormatCtx => ({
  t: (key, fallback) => CATALOG_STUB[key] ?? fallback,
  dt: (iso) => `dt(${iso})`,
  resolveId: (id) => names[id] ?? null,
})

describe('auditSubjectLabel', () => {
  it('translates the brand-image slot, which is what its entityId is', () => {
    const label = auditSubjectLabel({ entity: 'branding_asset', entityId: 'logo', before: null, after: { slot: 'logo', mime: 'image/png' } }, ctx())
    expect(label).toBe('Logo')
  })

  it('resolves an unnamed subject through the id lookup, and shortens what it cannot resolve', () => {
    const row = { entity: 'trip', entityId: 'b7c2f1a4-1111-2222-3333-444455556666', before: {}, after: {} }
    expect(auditSubjectLabel(row, ctx({ 'b7c2f1a4-1111-2222-3333-444455556666': 'Trip 12' }))).toBe('Trip 12')
    expect(auditSubjectLabel(row, ctx())).toBe('b7c2f1a4…')
  })
})

describe('formatAuditValue', () => {
  const f = (value: unknown, path: string, entity = 'device', names: Record<string, string> = {}) =>
    formatAuditValue(value, path, entity, ctx(names))

  it('renders ids as the name they belong to — the whole point of the rewrite', () => {
    expect(f('acc-1', 'accountId', 'user', { 'acc-1': 'Vilnius fleet' })).toBe('Vilnius fleet')
    expect(f(42, 'deviceId', 'maintenance', { '42': 'Truck 1' })).toBe('Truck 1')
  })

  it('shortens an id it cannot resolve rather than printing a UUID at a human', () => {
    expect(f('b7c2f1a4-1111-2222-3333-444455556666', 'driverId', 'trip')).toBe('b7c2f1a4…')
  })

  it('reads a null accountId as the whole organisation, not as a missing value', () => {
    expect(f(null, 'accountId', 'user')).toBe('Whole organisation')
  })

  it('formats booleans, timestamps, empties and redacted secrets', () => {
    expect(f(true, 'enabled', 'rule')).toBe('Yes')
    expect(f('2026-09-06T19:41:00.000Z', 'expiresAt', 'shareLink')).toBe('dt(2026-09-06T19:41:00.000Z)')
    expect(f(null, 'plate')).toBe('—')
    expect(f([], 'recipients', 'scheduledReport')).toBe('—')
    expect(f('***', 'secret', 'webhook')).toBe('hidden')
  })

  it('translates enum columns through the dictionaries the rest of the app renders from', () => {
    expect(f('viewer', 'role', 'user')).toBe('Viewer')
    expect(f('overspeed', 'kind', 'rule')).toBe('Overspeed')
    expect(f('some_new_kind', 'kind', 'rule')).toBe('some_new_kind') // unknown enum degrades to the truth
    // `kind` and `status` mean different things per entity, so the dictionary is keyed by both
    expect(f('circle', 'kind', 'geofence')).toBe('Circle')
    expect(f('acked', 'status', 'command')).toBe('Acknowledged')
  })

  it('renders an array of objects inline, since there is no JSON pane to fall back to', () => {
    expect(f([{ type: 'email', to: 'dispatch@x.lt' }], 'channels', 'rule')).toBe('Type: email, To: dispatch@x.lt')
  })

  it('never renders a blank cell for an object it has nothing to show for', () => {
    expect(f({}, 'config', 'rule')).toBe('—')
    expect(f({ stripeCustomerId: 'cus_1' }, 'config', 'rule')).toBe('—') // every key hidden
  })

  it('renders a file size in KB and leaves other numbers alone', () => {
    expect(f(18_432, 'sizeBytes', 'branding_asset')).toBe('18 KB')
    expect(f(300, 'cooldownS', 'rule')).toBe('300')
  })
})

describe('labels', () => {
  it('humanizes a field the catalog does not know, rather than printing the raw key', () => {
    expect(humanizeField('branding.logoUrl')).toBe('Logo url')
    expect(humanizeField('unit_speed')).toBe('Unit speed')
  })

  it('prefers the catalog label over the humanized fallback', () => {
    expect(fieldLabel((key, fallback) => (key === 'audit.f.logoUrl' ? 'Logotipas' : fallback), 'branding.logoUrl')).toBe('Logotipas')
  })

  it('lets an entity override a shared label — a driver has a name, not a title', () => {
    const t = (key: string, fallback: string) =>
      key === 'audit.fe.driver.name' ? 'Vardas' : key === 'audit.f.name' ? 'Pavadinimas' : fallback
    expect(fieldLabel(t, 'name', 'driver')).toBe('Vardas')
    expect(fieldLabel(t, 'name', 'geofence')).toBe('Pavadinimas')
  })

  it('shortens only what is long enough to need it', () => {
    expect(shortId('logo')).toBe('logo')
    expect(shortId('3de6ef93-807a-4fd8-b510-a6f3cea6eb3b')).toBe('3de6ef93…')
  })

  it('spots a colour so the value can carry a swatch', () => {
    expect(isColorValue('#46D993')).toBe(true)
    expect(isColorValue('Dokigo')).toBe(false)
  })
})

/**
 * The guard that was missing.
 *
 * `branding_asset` shipped with no label in any language, so a tenant admin read the raw enum
 * `branding_asset` in their own audit log — i18next fell through to the default and nothing failed.
 * The set of entities is knowable: every `entity: '…'` literal in a db repo is one the server can
 * write (audit.record calls plus the generic-repo configs, and nothing else in those files uses the
 * key). A new entity now fails here until it has a label in all four languages and a decision about
 * the tenant filter.
 */
const REPOS = resolve(import.meta.dirname, '../../../packages/db/src/repos')
const CATALOGS = { en, lt, pl, de }
/** Recorded via `recordPlatform` with tenantId NULL — no tenant trail can contain them, so they are
 *  deliberately absent from the tenant page's filter, but the platform panel still labels them. */
const PLATFORM_ONLY = ['affiliate', 'commission', 'deal_registration']

describe('audit entity labels', () => {
  const recorded = new Set<string>()
  for (const file of readdirSync(REPOS).filter((f) => f.endsWith('.ts'))) {
    for (const m of readFileSync(join(REPOS, file), 'utf8').matchAll(/\bentity: '([a-z_A-Z]+)'/g)) recorded.add(m[1]!)
  }

  it('finds the entities (guards against the scan silently matching nothing)', () => {
    expect(recorded.size).toBeGreaterThan(15)
    expect(recorded.has('branding_asset')).toBe(true)
  })

  it('every entity the server can record has a label in all four languages', () => {
    for (const [lang, cat] of Object.entries(CATALOGS)) {
      const labels = (cat as { audit: { e: Record<string, string> } }).audit.e
      const missing = [...recorded].filter((e) => labels[e] === undefined)
      expect(missing, `${lang}.json: audit.e is missing ${missing.join(', ')}`).toEqual([])
    }
  })

  it('the tenant filter offers exactly the tenant-visible entities', () => {
    const expected = [...recorded].filter((e) => !PLATFORM_ONLY.includes(e)).sort()
    expect([...AUDIT_ENTITIES].sort()).toEqual(expected)
  })
})
