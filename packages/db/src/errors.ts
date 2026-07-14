/**
 * Map a Prisma known-request error to an HTTP status, or null for anything else. Duck-typed by
 * `.code` (not `instanceof PrismaClientKnownRequestError`) so callers that can't import
 * @prisma/client — every package outside packages/db (rule 2) — still classify DB errors correctly.
 *
 * This is the API's `app.onError` safety net: repos that own a constraint already translate it to a
 * domain error + explicit status in their route (e.g. DuplicateImeiError → 409), so those never reach
 * here; this only catches the UNHANDLED ones — chiefly a non-UUID `:id` hitting a uuid column (P2023),
 * which otherwise surfaces as a raw 500 across every item route.
 */
export function dbErrorHttp(err: unknown): { status: 404 | 409; title: string } | null {
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined
  switch (code) {
    case 'P2025': // an operation required a record that was not found
    case 'P2023': // inconsistent column data — e.g. a malformed UUID where a uuid column is expected
      return { status: 404, title: 'Not Found' }
    case 'P2002': // unique constraint violation
      return { status: 409, title: 'Conflict' }
    default:
      return null
  }
}
