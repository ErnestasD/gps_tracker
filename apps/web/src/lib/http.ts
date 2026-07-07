/**
 * Same-origin by default: dev uses the Vite /v1 proxy, prod serves web+api behind
 * one Caddy origin. VITE_API_URL overrides for split deployments — but note the
 * refresh cookie is SameSite=Strict, so split-origin is unsupported in v1 (README).
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API ${status}`)
  }
}
