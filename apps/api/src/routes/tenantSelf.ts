import { randomBytes } from 'node:crypto'
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises'

/** DNS TXT resolver — injectable so tests don't hit real DNS. */
export type TxtResolver = (hostname: string) => Promise<string[][]>

export const defaultTxtResolver: TxtResolver = dnsResolveTxt

export const TXT_PREFIX = 'orbetra-verify='

/** New CSPRNG verification token (hex). */
export function newTxtToken(): string {
  return randomBytes(16).toString('hex')
}

/** The exact TXT record value the tenant must publish. */
export function expectedTxt(txtToken: string): string {
  return `${TXT_PREFIX}${txtToken}`
}

/**
 * Verify a domain owns its txtToken via a DNS TXT lookup. resolveTxt returns
 * chunked records (string[][]) — each record's chunks are joined. Any lookup
 * error (NXDOMAIN, no TXT) → false, never throws.
 */
export async function verifyDomainTxt(resolver: TxtResolver, domain: string, txtToken: string): Promise<boolean> {
  let records: string[][]
  try {
    records = await resolver(domain)
  } catch {
    return false
  }
  const want = expectedTxt(txtToken)
  return records.some((chunks) => chunks.join('') === want)
}
