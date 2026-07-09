import type { Pool } from 'pg'

/**
 * Webhook delivery log writer (E06-4b). One row per POST ATTEMPT (success or failure) for
 * observability. Raw parameterized batch INSERT over the worker pool. Never stores the
 * payload or the secret — only the endpoint's id, the event id/kind, the HTTP status, and a
 * short error reason.
 */
export interface DeliveryRow {
  tenantId: string
  accountId: string | null
  webhookId: string
  eventId: string
  kind: string
  statusCode: number | null
  success: boolean
  error: string | null
}

export async function writeDeliveries(pool: Pool, rows: DeliveryRow[]): Promise<void> {
  if (rows.length === 0) return
  const params: unknown[] = []
  const tuples = rows.map((r, i) => {
    params.push(r.tenantId, r.accountId, r.webhookId, r.eventId, r.kind, r.statusCode, r.success, r.error)
    const b = i * 8
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`
  })
  await pool.query(
    `INSERT INTO webhook_deliveries ("tenantId","accountId","webhookId","eventId","kind","statusCode","success","error") VALUES ${tuples.join(',')}`,
    params,
  )
}
