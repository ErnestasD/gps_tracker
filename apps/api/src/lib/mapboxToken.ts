/**
 * Short-lived Mapbox tokens, minted for whatever host the dashboard is being served from.
 *
 * The public `pk.` token is baked into the JS bundle, so it is readable by anyone who opens the
 * page — which is why it carries URL restrictions. Those restrictions list OUR domains, and a
 * white-label tenant's dashboard is served from THEIRS: `fleet.dokigo.lt` asked Mapbox for tiles
 * and got 403 on every one, leaving a black rectangle under a working interface. The style JSON
 * still returned 200, which is what made it look like a rendering fault rather than an
 * authorisation one.
 *
 * The alternatives were: drop the restrictions (a public token anyone can lift and bill to us), or
 * add every customer domain to the allow-list (Mapbox caps that list, and a domain would verify
 * with a broken map until the call succeeded). A token that expires in an hour needs no allow-list
 * at all — the exposure it leaves is an hour of tiles, not a standing invitation. It is Mapbox's
 * own recommendation for exactly this case.
 */

/** How long a minted token lives. Mapbox refuses temporary tokens beyond one hour. */
export const TOKEN_TTL_S = 3600

/**
 * Re-mint at 80 % of the lifetime rather than at expiry.
 *
 * A token that dies mid-pan turns the map black with no user action to explain it, and the
 * request that would replace it is the one that just failed. The margin is for clock skew between
 * us and Mapbox, and for a browser tab that has been asleep.
 */
export const REFRESH_AT = 0.8

/**
 * Scopes a MAP needs and nothing else.
 *
 * `styles:tiles` and `styles:read` fetch the style and its tiles; `fonts:read` the glyphs, without
 * which labels silently disappear. Deliberately absent: anything that can write. A token handed to
 * every browser session must not be able to change an account it belongs to, and the secret token
 * this is minted from can do plenty.
 */
export const TOKEN_SCOPES = ['styles:tiles', 'styles:read', 'fonts:read'] as const

export type MintedToken = { token: string; expiresAt: string }

export type MapboxConfig = { username: string; secretToken: string }

/** Reads the config from the environment; `null` when the deployment has not set it up. */
export function mapboxConfig(env: Record<string, string | undefined>): MapboxConfig | null {
  const username = env['MAPBOX_USERNAME']?.trim()
  const secretToken = env['MAPBOX_SECRET_TOKEN']?.trim()
  if (username === undefined || username === '' || secretToken === undefined || secretToken === '') return null
  return { username, secretToken }
}

/**
 * Ask Mapbox for a temporary token.
 *
 * `fetchImpl` is injected so tests never touch the network — the same shape as the DNS resolvers
 * in tenantSelf.
 */
export async function mintTemporaryToken(
  fetchImpl: typeof fetch,
  cfg: MapboxConfig,
  nowMs: number,
): Promise<MintedToken> {
  const expiresAt = new Date(nowMs + TOKEN_TTL_S * 1000).toISOString()
  const res = await fetchImpl(
    `https://api.mapbox.com/tokens/v2/${encodeURIComponent(cfg.username)}?access_token=${encodeURIComponent(cfg.secretToken)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires: expiresAt, scopes: [...TOKEN_SCOPES] }),
    },
  )
  if (!res.ok) throw new Error(`mapbox tokens api ${res.status}`)
  const body = (await res.json()) as { token?: unknown }
  if (typeof body.token !== 'string' || body.token === '') throw new Error('mapbox tokens api returned no token')
  return { token: body.token, expiresAt }
}

/**
 * When a cached token should be replaced.
 *
 * Exported because it is the part worth testing on its own: an off-by-one here means either a
 * token that expires under a user's cursor, or a fresh mint on every page load — and Mapbox rate
 * limits token creation, so the second failure mode takes the map out for everyone at once.
 */
export function needsRefresh(cached: MintedToken | null, nowMs: number): boolean {
  if (cached === null) return true
  const expiry = Date.parse(cached.expiresAt)
  if (!Number.isFinite(expiry)) return true
  const mintedAt = expiry - TOKEN_TTL_S * 1000
  return nowMs >= mintedAt + TOKEN_TTL_S * 1000 * REFRESH_AT
}
