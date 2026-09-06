/**
 * Turning an audit row into something a fleet operator can read.
 *
 * The page used to print `JSON.stringify(before)` next to `JSON.stringify(after)`. For a branding
 * change that meant ~30 lines of tenant record — Stripe ids, billing cursors, the referring
 * affiliate — of which ONE line had actually changed, and the reader had to diff two blobs by eye
 * to find it. Everything here exists to answer the two questions an audit trail is for: WHAT
 * changed, and WHO is the thing it changed on.
 *
 * All of it is pure and unit-tested (`apps/web/__tests__/audit.spec.ts`). The i18n and date
 * formatting arrive as callbacks so the diff logic never needs a React or i18next runtime.
 */

/** One field that differs between the two snapshots. `path` is dotted: `branding.logoUrl`. */
export interface AuditChange {
  path: string
  before: unknown
  after: unknown
}

export interface AuditSnapshotRow {
  action: string
  entity: string
  entityId: string
  /** optional because the platform trail's client type declares them optional; absent = no snapshot */
  before?: unknown
  after?: unknown
}

/**
 * Keys dropped before anything is compared.
 *
 * The raw-JSON pane is gone, so this list is the ONE place information can disappear — it holds
 * identifiers and bookkeeping ONLY, never anything an operator chose. Two groups:
 *
 *  1. structural — the row's own id, the tenant it belongs to, timestamps the trail already
 *     carries in its `at` column, and content hashes/blobs that are not human-readable;
 *  2. billing and partner internals — Stripe ids, the applied-event cursor and the referring
 *     affiliate. `packages/db` no longer writes them into a tenant snapshot, but rows recorded
 *     before that fix are still in the table and must not resurface here.
 *
 * Secrets are redacted server-side (`redact()` in packages/db) and arrive as `***`; they are NOT
 * hidden here — "the signing secret was rotated" is exactly the kind of change this page is for.
 */
const HIDDEN_FIELDS = new Set([
  'id', 'tenantId', 'createdAt', 'updatedAt', 'sha256', 'hash', 'bytes', 'tokenHash', 'txtToken', 'passwordHash', 'geom',
  'stripeCustomerId', 'stripeSubscriptionId', 'subscriptionPriceId', 'lastBillingEventAt', 'lastBillingEventId',
  'lastBillingEventRank', 'referredByAffiliateId', 'commissionAnchorAt', 'commissionMonthsAtAnchor',
])

/** Nested JSON (rule `config`, tenant `branding`) is walked; deeper than this it is rendered inline. */
const MAX_DEPTH = 4

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Snapshot → flat map of dotted path to leaf value.
 *
 * Objects are walked so `{branding: {accent: '#46D993'}}` compares as `branding.accent` and one
 * colour change does not read as "the whole branding object changed". Arrays are NOT walked:
 * `recipients: ['a@x', 'b@x']` is one field to a human, and index-keyed paths (`recipients.0`)
 * would turn a reorder into two changes.
 */
export function flattenSnapshot(value: unknown, prefix = '', depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isPlainObject(value)) {
    if (prefix !== '') out[prefix] = value
    return out
  }
  for (const [key, v] of Object.entries(value)) {
    if (HIDDEN_FIELDS.has(key)) continue
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isPlainObject(v) && depth < MAX_DEPTH) {
      const nested = flattenSnapshot(v, path, depth + 1)
      // `{}` and `{stripeCustomerId: …}` both flatten to nothing; keep the path so "branding was
      // cleared" is still visible rather than silently absent.
      if (Object.keys(nested).length === 0) out[path] = v
      else Object.assign(out, nested)
    } else {
      out[path] = v
    }
  }
  return out
}

/** Key order is not meaningful in JSON, so compare on a sorted rendering. */
function stable(value: unknown): string {
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((k) => `${k}:${stable(value[k])}`).join(',')}}`
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return JSON.stringify(value ?? null) ?? 'null'
}

/** `{}` counts too: a create row listing "Branding: " with nothing after it is worse than omitting it. */
const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0)

/**
 * What this row actually changed.
 *
 * update (both snapshots present) → only the fields that differ. create/delete (one snapshot) →
 * the fields that carry a value; a device row has a dozen optional columns sitting at null, and
 * listing them as "—" would bury the three the operator filled in.
 *
 * `after` order first so the natural field order of the record survives into the table.
 */
export function auditChanges(row: Pick<AuditSnapshotRow, 'action' | 'before' | 'after'>): AuditChange[] {
  const before = flattenSnapshot(row.before)
  const after = flattenSnapshot(row.after)
  const both = isPlainObject(row.before) && isPlainObject(row.after)
  const paths = [...new Set([...Object.keys(after), ...Object.keys(before)])]
  // A branding save on a tenant whose branding was `{}` yields a bare `branding` path from the empty
  // side and `branding.accent` / `branding.productName` from the full one. The children say what
  // happened; the bare parent would sit beside them rendering "— → —".
  const hasChildren = (p: string): boolean => paths.some((other) => other.startsWith(`${p}.`))
  return paths
    .filter((p) => !hasChildren(p))
    .filter((p) => (both ? stable(before[p]) !== stable(after[p]) : !isEmptyValue(after[p] ?? before[p])))
    .map((p) => ({ path: p, before: before[p], after: after[p] }))
}

/**
 * The name of the thing the row is about, taken from the snapshot itself.
 *
 * Per-entity first, because the generic answer is sometimes the wrong one: a `branding` snapshot
 * carries both the tenant's legal name and the white-label product name, and the product name is
 * what the operator recognises on the Branding page they just left.
 */
const SUBJECT_FIELDS: Record<string, string[]> = {
  branding: ['branding.productName', 'productName', 'name'],
  branding_asset: [], // entityId IS the subject ('logo' / 'favicon') — see auditSubjectLabel()
  user: ['email'],
  device: ['name', 'imei'],
  domain: ['domain'],
  webhook: ['url'],
  document: ['title'],
  serviceLog: ['title'],
  maintenance: ['title'],
  shareLink: ['label'],
  command: ['text'],
  scheduledReport: ['reportType'],
}
const SUBJECT_FALLBACK = ['name', 'title', 'email', 'domain', 'label', 'productName', 'imei', 'url']

export function auditSubject(row: Pick<AuditSnapshotRow, 'entity' | 'before' | 'after'>): string | null {
  const snap = { ...flattenSnapshot(row.before), ...flattenSnapshot(row.after) }
  for (const field of SUBJECT_FIELDS[row.entity] ?? SUBJECT_FALLBACK) {
    const v = snap[field]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

/** `3de6ef93-807a-4fd8-…` — never the whole UUID; it is a breadcrumb, not an identifier to read. */
export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

/** `logoUrl` → `Logo url`, `unit_speed` → `Unit speed`. Last resort when a field has no label. */
export function humanizeField(path: string): string {
  const leaf = path.split('.').pop() ?? path
  const words = leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Translate = i18next's `t` narrowed to what this module needs: a key and a fallback. */
export type Translate = (key: string, fallback: string) => string

export interface FormatCtx {
  t: Translate
  /** ISO timestamp → the viewer's locale/zone (useFmt().dt). */
  dt: (iso: string) => string
  /** uuid/bigint → the name it belongs to (device, driver, account, user), or null if unknown. */
  resolveId: (id: string) => string | null
}

/** Values that look like a timestamp the server wrote (`2026-09-06T19:41:00.000Z`). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Enum columns with a dictionary the rest of the app already renders from — keyed by
 * `<entity>.<leaf>` where a bare leaf would be ambiguous (`kind` is a rule kind here, a document
 * kind there, a geofence shape somewhere else). Reused, not re-translated: the audit trail must
 * call a thing what the page the operator edited it on calls it.
 */
const ENUM_DICT: Record<string, string> = {
  role: 'roles', plan: 'plan',
  'rule.kind': 'rules.kind', 'document.kind': 'fleet.docKind', 'geofence.kind': 'geofences',
  'command.status': 'devices.cmd.st', 'export.status': 'settings.export.st',
  vehicleStatus: 'fleet.vstatus', fuelType: 'fleet.fuelType',
}

/** A colour field gets a swatch next to its value; the component asks with this. */
export const isColorValue = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)

/** `{type: email, to: x@y.lt}` — an array of objects, readable, without a JSON pane. */
function compact(value: unknown, ctx: FormatCtx, entity: string, depth = 0): string {
  if (Array.isArray(value)) return value.map((v) => compact(v, ctx, entity, depth + 1)).join(', ')
  if (isPlainObject(value)) {
    if (depth > 2) return '…'
    return Object.entries(value)
      .filter(([k]) => !HIDDEN_FIELDS.has(k))
      .map(([k, v]) => `${fieldLabel(ctx.t, k, entity)}: ${formatAuditValue(v, k, entity, ctx)}`)
      .join(', ')
  }
  return String(value)
}

/**
 * The label for a field: `audit.fe.<entity>.<leaf>` where the shared label would be wrong for this
 * entity (a driver's `name` is a person's name, not a "title"), else `audit.f.<leaf>`, else the
 * humanized key. Unknown fields are LABELLED, never dropped — there is no JSON pane behind this.
 */
export function fieldLabel(t: Translate, path: string, entity = ''): string {
  const leaf = path.split('.').pop() ?? path
  const generic = t(`audit.f.${leaf}`, humanizeField(leaf))
  return entity === '' ? generic : t(`audit.fe.${entity}.${leaf}`, generic)
}

/**
 * One snapshot value, rendered for a person.
 *
 * The rules are boring on purpose: nothing here may invent a value it cannot support. An id it
 * cannot resolve degrades to a short id, not to a guess; an unknown enum degrades to the raw
 * string, which is still the truth.
 */
export function formatAuditValue(value: unknown, path: string, entity: string, ctx: FormatCtx): string {
  const leaf = path.split('.').pop() ?? path
  // A null accountId is not a missing value: it is the record saying "the whole organisation"
  // (a tenant-wide admin, a tenant-wide API key, a webhook on every account).
  if (leaf === 'accountId' && (value === null || value === undefined)) return ctx.t('audit.tenantWide', 'Whole organisation')
  if (isEmptyValue(value)) return '—'
  if (typeof value === 'boolean') return value ? ctx.t('audit.yes', 'Yes') : ctx.t('audit.no', 'No')
  if (value === '***') return ctx.t('audit.redacted', 'hidden')
  // …Id columns are the reason this page was unreadable. Resolve, or shorten — never print raw.
  // BigInt ids (device, ShareLink.deviceId) arrive as numbers or as strings depending on the
  // serializer, so both shapes go through the same lookup.
  if (/Id$/.test(leaf) && (typeof value === 'string' || typeof value === 'number')) {
    return ctx.resolveId(String(value)) ?? shortId(String(value))
  }
  if (typeof value === 'string') {
    const dict = ENUM_DICT[`${entity}.${leaf}`] ?? ENUM_DICT[leaf]
    if (dict !== undefined) return ctx.t(`${dict}.${value}`, value)
    if (ISO_DATE.test(value)) return ctx.dt(value)
    return value
  }
  if (typeof value === 'number') {
    if (leaf === 'sizeBytes') return `${Math.max(1, Math.round(value / 1024))} KB`
    return String(value)
  }
  const rendered = compact(value, ctx, entity)
  return rendered === '' ? '—' : rendered
}

/**
 * Who the row is about when the snapshot has no name of its own.
 *
 * `branding_asset` files them under the slot ('logo'/'favicon'); everything else gets whatever the
 * device/driver/account/user lookups know about the entity id, and a short id if they know nothing.
 */
export function auditSubjectLabel(row: Pick<AuditSnapshotRow, 'entity' | 'entityId' | 'before' | 'after'>, ctx: FormatCtx): string {
  const named = auditSubject(row)
  if (named !== null) return named
  if (row.entity === 'branding_asset') return ctx.t(`audit.slot.${row.entityId}`, row.entityId)
  return ctx.resolveId(row.entityId) ?? shortId(row.entityId)
}
