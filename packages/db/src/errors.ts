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
/** Prisma unique-violation code (P2002), duck-typed — avoids importing @prisma/client at call
 *  sites and dedupes the copy that had been repeated verbatim in devices.ts + drivers.ts (review LOW). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'P2002'
}

/**
 * Map a foreseeable DB failure onto the answer it deserves. Anything not listed here is a genuine
 * bug and must keep 500ing — a catch-all would turn every unknown fault into a plausible-looking
 * 4xx and hide it (audit MED).
 *
 * `detail` is a short, TENANT-SAFE sentence: it names the class of problem, never a constraint
 * name, a table, or another tenant's data.
 */
export function dbErrorHttp(err: unknown): { status: 400 | 404 | 409; title: string; detail?: string } | null {
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined
  switch (code) {
    case 'P2025': // an operation required a record that was not found
    case 'P2023': // inconsistent column data — e.g. a malformed UUID where a uuid column is expected
      return { status: 404, title: 'Not Found' }
    case 'P2002': // unique constraint violation
      return { status: 409, title: 'Conflict' }
    // A FOREIGN KEY the caller could reasonably hit, in both directions:
    //  - P2003 on DELETE: "this account still has devices". Restricting the delete is correct; a
    //    500 for it is not, and it is exactly what an operator sees when they try to tidy up.
    //  - P2003 on CREATE/UPDATE: an unknown `profileId` or `accountId` in the body — caller input,
    //    so 400, not 500.
    // Prisma does not distinguish the direction in the code, and the message is not safe to echo,
    // so both become a 409 with a detail that fits either reading: the row references something
    // that does not exist, or is referenced by something that does.
    case 'P2003':
      return { status: 409, title: 'Conflict', detail: 'referenced record missing, or still in use by another record' }
    // value out of range for the column's type — an oversize numeric cursor or id from the caller
    case 'P2020':
      return { status: 400, title: 'Bad Request', detail: 'value out of range' }
    default:
      return null
  }
}
