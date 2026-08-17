/** Public-site API access. Same-origin by default — Caddy carves /v1 to the api
 * (matches PilotForm); VITE_API_URL overrides for local dev against a bare api. */
export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''

/** The real tenant dashboard (apps/web) — the marketing site NEVER authenticates
 * tenant users itself, it only links out. */
export const DASH_URL: string =
  (import.meta.env.VITE_DASH_URL as string | undefined) || 'https://dash.orbetra.com'

/**
 * A dashboard link that CARRIES THE READER'S LANGUAGE.
 *
 * The site and the dashboard are different origins, so nothing is shared between them: someone
 * reading orbetra.com in English pressed "Open the fleet dashboard" and landed on a Lithuanian
 * login page, because the dashboard's detector fell through localStorage (empty on that origin) to
 * the browser's own language. Choosing English on our marketing site and being answered in another
 * language is the first thing a prospect sees of the product.
 *
 * `lng` is what `i18next-browser-languagedetector` reads FIRST, ahead of the browser, and its
 * default cache writes it to the dashboard's localStorage — so the choice carries once and then
 * sticks, without the two apps having to share anything.
 *
 * The path defaults to `/login`, NOT the root. The root bounces an unauthenticated visitor to
 * `/login` and the redirect drops the query string with it — so the parameter arrived, was thrown
 * away before anything read it, and the page came up in the browser's language anyway. Landing
 * directly on the page that needs the language is the fix.
 */
export function dashUrl(lang: string, path = '/login'): string {
  const base = `${DASH_URL}${path}`
  return `${base}${base.includes('?') ? '&' : '?'}lng=${encodeURIComponent(lang)}`
}

/** Where "Live demo" points: the built-in read-only mock admin by default. */
export const DEMO_URL: string = (import.meta.env.VITE_DEMO_URL as string | undefined) || '/app'

/** Header/footer "Docs" target: the Scalar API reference served by the dashboard origin
 * (ADR-037) — founder decision 2026-08-17. The prose guide remains reachable at /docs. */
export const DOCS_URL = `${DASH_URL}/v1/docs`

/** Error carrying the HTTP status so callers can branch (409 vs 429 vs 401). */
export class ApiError extends Error {
  readonly status: number
  /**
   * The RFC 7807 `detail` slug, when the API sent one.
   *
   * Several 400s are DIFFERENT rules a user can fix — a free-mail domain is not the same mistake as
   * claiming your own — and a single "invalid request" turns each of them into a support ticket for
   * a rule we could simply have told them. The API already distinguishes them; this stops the
   * client from throwing that away.
   */
  readonly detail: string | null
  constructor(message: string, status: number, detail: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export async function apiPost<T = unknown>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

export async function apiGet<T = unknown>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return handle<T>(res)
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    // `title` FIRST: the API answers RFC 7807 problem+json, where the human-readable summary lives
    // in `title` and the specifics in `detail`. `message`/`error` stay as fallbacks for the handful
    // of public routes that predate the convention, so this keeps working during the changeover
    // rather than degrading every error to "Request failed (400)".
    const d = data as { title?: string; message?: string; error?: string; detail?: string } | null
    throw new ApiError(d?.title || d?.message || d?.error || `Request failed (${res.status})`, res.status, d?.detail ?? null)
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}
