/**
 * Uploaded white-label brand assets (logo / favicon) — format sniffing, SVG screening, and the
 * content-addressed path they are served from.
 *
 * Pure and dependency-free on purpose: the API validates an upload with it, the web app pre-checks a
 * file before spending a request on it, and both must agree on what "acceptable" means. A second
 * implementation on the client is how the two drift until the browser promises something the server
 * refuses.
 *
 * ── Why the served path is relative ──────────────────────────────────────────────────────────────
 * `assetPath` returns a PATH, never an origin. A reseller's customer must never see our domain, and
 * the only host that is always correct is the one the page is already on: the tenant's own domain, or
 * `<slug>.orbetra.com`, whichever they are using. Caddy already proxies `/v1/*` on both
 * (infra/caddy/Caddyfile:216), so the same stored string renders correctly everywhere without anyone
 * resolving a per-tenant origin. Email is the one exception — a mail client has no page to resolve
 * against — and it makes the URL absolute itself (packages/shared/src/email.ts).
 *
 * ── Why the path is a content hash ───────────────────────────────────────────────────────────────
 * The bytes are immutable and the name is their digest, so a replaced logo gets a NEW url. That is
 * what lets the response be cached for a year: there is no such thing as a stale copy, only an
 * unreferenced one. It also means the route needs no `Vary` — unlike /v1/branding and the manifest,
 * this response does not depend on the Host.
 */

/** 512 KB. A favicon is single-digit KB and a wordmark rarely 60; this is generous, not a target.
 *  Enforced on DECODED bytes — a base64 length cap alone bounds the transfer, not what we store. */
export const MAX_BRAND_ASSET_BYTES = 512 * 1024
/** Refuse absurd raster dimensions. A 20000×20000 PNG can be a few KB compressed and still cost the
 *  decoder gigabytes in every browser that opens it — the size cap does not bound the pixel count. */
export const MAX_BRAND_ASSET_PIXELS = 2048

export type BrandAssetMime = 'image/png' | 'image/svg+xml'
export type BrandAssetSlot = 'logo' | 'favicon'

/** The two slots, in the order the settings form shows them. */
export const BRAND_ASSET_SLOTS: readonly BrandAssetSlot[] = ['logo', 'favicon']

const EXT: Record<BrandAssetMime, 'png' | 'svg'> = { 'image/png': 'png', 'image/svg+xml': 'svg' }
const MIME_FOR_EXT: Record<string, BrandAssetMime> = { png: 'image/png', svg: 'image/svg+xml' }

/** Matches what `assetPath` produces — used by brandingSchema to accept a stored reference, and by
 *  the serving route to reject anything that is not one of ours before it reaches the database. */
export const BRAND_ASSET_PATH_RE = /^\/v1\/public\/brand\/([0-9a-f]{32})\.(png|svg)$/

/** Where a stored asset is served from. `sha256` is the full hex digest; the path carries the first
 *  32 chars (128 bits) — collision-proof for this purpose and a URL people can still read. */
export function assetPath(sha256: string, mime: BrandAssetMime): string {
  return `/v1/public/brand/${sha256.slice(0, 32)}.${EXT[mime]}`
}

/** Split a served path back into its parts, or null if it is not one of ours. */
export function parseAssetPath(path: string): { hash: string; mime: BrandAssetMime } | null {
  const m = BRAND_ASSET_PATH_RE.exec(path)
  if (m === null) return null
  const [, hash, ext] = m
  const mime = MIME_FOR_EXT[ext!]
  return hash === undefined || mime === undefined ? null : { hash, mime }
}

/** True for a branding value that points at an asset we store (rather than a tenant's own https URL). */
export const isBrandAssetPath = (v: string): boolean => BRAND_ASSET_PATH_RE.test(v)

/**
 * Make uploaded-asset references absolute, for the one consumer that cannot resolve a relative path:
 * email.
 *
 * A browser resolves `/v1/public/brand/…` against the page it is on, which is always the right host.
 * A mail client has no page — it fetches whatever the `src` literally says — so a relative value
 * renders as a broken image in every inbox. This is applied where branding is READ for a message,
 * with the recipient tenant's own origin, so the logo in the mail comes from the same domain as
 * everything else that tenant's customers see.
 *
 * Values that are already absolute are untouched. A null origin leaves the relative path in place,
 * where `safeHttpsUrl` will drop it and the header falls back to the product name as text — a
 * missing logo, never a broken one.
 */
/** Does this branding reference an uploaded file at all? Callers use it to skip resolving a tenant
 *  origin they would not use — most tenants have no upload, and the lookup is a database round-trip. */
export const hasBrandAsset = (b: { logoUrl?: string; faviconUrl?: string }): boolean =>
  (b.logoUrl !== undefined && isBrandAssetPath(b.logoUrl)) || (b.faviconUrl !== undefined && isBrandAssetPath(b.faviconUrl))

export function absolutizeBrandAssets<T extends { logoUrl?: string; faviconUrl?: string }>(branding: T, origin: string | null): T {
  if (origin === null) return branding
  const fix = (v: string | undefined): string | undefined => (v !== undefined && isBrandAssetPath(v) ? `${origin.replace(/\/+$/, '')}${v}` : v)
  const logoUrl = fix(branding.logoUrl)
  const faviconUrl = fix(branding.faviconUrl)
  if (logoUrl === branding.logoUrl && faviconUrl === branding.faviconUrl) return branding
  return {
    ...branding,
    ...(logoUrl !== undefined ? { logoUrl } : {}),
    ...(faviconUrl !== undefined ? { faviconUrl } : {}),
  }
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Read a PNG's real dimensions from its IHDR chunk, or null if the bytes are not a PNG.
 *
 * The declared mime is a claim by the uploader; these eight bytes are the file. `nosniff` is set on
 * every API response, so serving SVG markup under `Content-Type: image/png` would render nothing
 * rather than execute — but the check belongs here anyway, because the day a route forgets the header
 * is not the day to discover the type was never verified.
 *
 * Layout: 8-byte signature, then a chunk of [4 length][4 type][data…]; IHDR is always first and
 * begins with width and height as big-endian uint32.
 * https://www.w3.org/TR/png-3/#11IHDR
 */
export function sniffPng(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  for (let i = 0; i < PNG_MAGIC.length; i++) if (bytes[i] !== PNG_MAGIC[i]) return null
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== 'IHDR') return null
  const be32 = (o: number): number => ((bytes[o]! << 24) >>> 0) + (bytes[o + 1]! << 16) + (bytes[o + 2]! << 8) + bytes[o + 3]!
  const width = be32(16)
  const height = be32(20)
  return width > 0 && height > 0 ? { width, height } : null
}

/** Why an SVG was refused. A closed union so the web app's message table is exhaustive by type —
 *  a new reason added here fails the build until it has a translation. */
export type SvgRejection =
  | 'not_svg'
  | 'doctype_subset'
  | 'entity'
  | 'script'
  | 'foreign_object'
  | 'embedded_content'
  | 'event_handler'
  | 'javascript_url'
  | 'remote_reference'

/**
 * Screen an SVG for the constructs that make it active content rather than a picture.
 *
 * This is the SECOND layer and it is not the one to rely on. Markup screening by regex can be
 * defeated — with entity tricks, exotic encodings, or a construct nobody listed. The control that
 * actually holds is the response header: the serving route sends
 * `Content-Security-Policy: default-src 'none'; sandbox`, and a sandbox without `allow-scripts` means
 * no script runs even when someone navigates straight to the file. This function exists so that an
 * obviously hostile upload is refused at the door with a message, instead of being stored forever and
 * silently neutered — and so a future route that forgets the header is not a total loss.
 *
 * Returns a machine-readable reason, or null when nothing objectionable was found.
 */
export function validateSvg(text: string): SvgRejection | null {
  // `/` belongs in the class: `<svg/>` is a legal (if minimal) document, and without it a
  // self-closing root read as "not an SVG at all" and masked whatever the real reason was.
  if (!/<svg[\s/>]/i.test(text)) return 'not_svg'
  // An internal DTD subset is where entity-expansion lives. A plain `<!DOCTYPE svg …>` with no `[`
  // is what Illustrator and older Inkscape emit and is inert, so refusing every DOCTYPE would reject
  // a great many legitimate files to no benefit.
  if (/<!DOCTYPE[^>[]*\[/i.test(text)) return 'doctype_subset'
  if (/<!ENTITY/i.test(text)) return 'entity'
  if (/<script[\s>]/i.test(text)) return 'script'
  if (/<foreignObject[\s>]/i.test(text)) return 'foreign_object'
  if (/<(iframe|embed|object)[\s>]/i.test(text)) return 'embedded_content'
  // Event handlers: no SVG presentation attribute begins with "on", so any `on…=` is a handler.
  if (/\son[a-z]+\s*=/i.test(text)) return 'event_handler'
  if (/javascript\s*:/i.test(text)) return 'javascript_url'
  // Remote references pull a third party into every render — they leak the viewer's IP and let the
  // referenced content change after we approved this file.
  if (/<(use|image)\b[^>]*(xlink:)?href\s*=\s*["']?\s*(https?:)?\/\//i.test(text)) return 'remote_reference'
  return null
}

export interface BrandAssetInspection {
  mime: BrandAssetMime
  width: number | null
  height: number | null
}

/** Every way an upload can be refused. The API sends it as the 400's `detail`; the web app maps it
 *  to a translated message through an exhaustive table, so a reason added here fails that build. */
export type BrandAssetRejection = 'too_large' | 'empty' | 'mime_mismatch' | 'too_many_pixels' | SvgRejection

/**
 * The single accept/reject decision, shared by the API (authoritative) and the web app (fast
 * feedback). `declared` is the caller's claim; the bytes decide.
 */
export function inspectBrandAsset(
  bytes: Uint8Array,
  declared: BrandAssetMime,
  decodeUtf8: (b: Uint8Array) => string = (b) => new TextDecoder().decode(b),
): { ok: true; value: BrandAssetInspection } | { ok: false; reason: BrandAssetRejection } {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > MAX_BRAND_ASSET_BYTES) return { ok: false, reason: 'too_large' }
  if (declared === 'image/png') {
    const dim = sniffPng(bytes)
    if (dim === null) return { ok: false, reason: 'mime_mismatch' }
    if (dim.width > MAX_BRAND_ASSET_PIXELS || dim.height > MAX_BRAND_ASSET_PIXELS) return { ok: false, reason: 'too_many_pixels' }
    return { ok: true, value: { mime: declared, width: dim.width, height: dim.height } }
  }
  // SVG. A PNG relabelled as SVG fails `validateSvg`'s `<svg` check, so the mismatch is covered in
  // both directions without sniffing binary here.
  const reason = validateSvg(decodeUtf8(bytes))
  if (reason !== null) return { ok: false, reason }
  return { ok: true, value: { mime: declared, width: null, height: null } }
}
