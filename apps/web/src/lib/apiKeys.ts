import { getJson, mutate } from './client'

/**
 * API-keys management client (E06-3 UI). Tenant-admin only on the server. The plaintext
 * `key` is returned ONCE on create and never retrievable again — the UI must surface it
 * immediately for the operator to copy.
 */
export interface ApiKeyView {
  id: string
  accountId: string | null
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}
export interface CreatedApiKey extends ApiKeyView {
  /** shown once; store it now */
  key: string
}
export interface ApiKeyCreateInput {
  name: string
  accountId?: string | null
}

export const listApiKeys = () => getJson<ApiKeyView[]>('/v1/api-keys')
export const createApiKey = (data: ApiKeyCreateInput) => mutate<CreatedApiKey>('POST', '/v1/api-keys', data)
export const revokeApiKey = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/api-keys/${encodeURIComponent(id)}`)
