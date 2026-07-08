/** Signed 64-bit (Postgres bigint / int8) bounds. */
export const INT8_MIN = -(2n ** 63n)
export const INT8_MAX = 2n ** 63n - 1n

/**
 * Parse a route/query id string to a bigint that FITS in Postgres int8, else null.
 * `BigInt('999…')` never throws — it happily makes a value larger than int8, which
 * then explodes as "bigint out of range" when bound as a query param (a 500). Every
 * `:id`/deviceId coercion must go through this so an oversize id becomes a clean 404,
 * not a 500 (E04-3 review MED). `signed` allows a leading '-' (e.g. rec_hash cursors).
 */
export function toInt8OrNull(s: string, signed = false): bigint | null {
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(s)) return null
  const v = BigInt(s)
  return v >= INT8_MIN && v <= INT8_MAX ? v : null
}
