/** Public-site API access. Same-origin by default — Caddy carves /v1 to the api
 * (matches PilotForm); VITE_API_URL overrides for local dev against a bare api. */
export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''

/** The real tenant dashboard (apps/web) — the marketing site NEVER authenticates
 * tenant users itself, it only links out. */
export const DASH_URL: string =
  (import.meta.env.VITE_DASH_URL as string | undefined) || 'https://dash.orbetra.com'

/** Where "Live demo" points: the built-in read-only mock admin by default. */
export const DEMO_URL: string = (import.meta.env.VITE_DEMO_URL as string | undefined) || '/app'

export const DOCS_URL = '/docs'

/** Error carrying the HTTP status so callers can branch (409 vs 429 vs 401). */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
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
    const d = data as { message?: string; error?: string } | null
    throw new ApiError(d?.message || d?.error || `Request failed (${res.status})`, res.status)
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
