/**
 * Same-origin by default: dev uses the Vite /v1 proxy, prod serves web+api behind
 * one Caddy origin. VITE_API_URL overrides for split deployments — but note the
 * refresh cookie is SameSite=Strict, so split-origin is unsupported in v1 (README).
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export class ApiError extends Error {
  /**
   * The `detail` field of an RFC 7807 problem+json body, when the server sent one.
   *
   * The API has always explained itself — "that name is reserved", "3–40 characters", "domain limit
   * reached (max 25)" — and the client threw every one of those away, leaving screens to guess at a
   * generic message. Guessing is how "that slug is reserved" became "check the domain is valid",
   * which sends the operator to fix something that was never wrong.
   */
  constructor(readonly status: number, readonly detail?: string) {
    super(`API ${status}`)
  }
}
