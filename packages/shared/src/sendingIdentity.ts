/**
 * A white-label tenant's own sending identity (ADR-036, audit W-3).
 *
 * Everything a reseller's customer sees is theirs — the login page, the colours, the logo, the links
 * in the mail. Except the one line no branding can cover:
 *
 *     From: Orbetra <hello@orbetra.com>
 *
 * `MAIL_FROM` is a single process-wide value (ADR-023), so this was never a display bug: the
 * platform had exactly one sending identity and every tenant borrowed it. ADR-036's answer is to
 * verify the tenant's domain as a DKIM identity in OUR SES account and then set `From` to their
 * address — one header on an unchanged delivery path, not a second delivery path.
 *
 * This module is the pure half: what the address is, what the tenant must publish, and whether the
 * deployment can manage identities at all. The SES calls live in the API.
 */

/** `<mailbox>@<domain>`, the address a recipient reads. Derived, never stored twice. */
export function sendingAddress(domain: string, mailbox: string): string {
  return `${mailbox.trim().toLowerCase()}@${domain.trim().toLowerCase()}`
}

/** One DNS record the tenant publishes. */
export interface DkimRecord {
  name: string
  value: string
}

/**
 * The three CNAMEs SES asks for, built from the selector tokens it returns.
 *
 * Easy DNS ceremony to get subtly wrong, so it is one function rather than a template in the UI:
 * the record NAME is `<token>._domainkey.<domain>` and the TARGET is `<token>.dkim.amazonses.com`.
 * The same token appears on both sides, which is exactly why a hand-written version tends to put the
 * domain on the wrong one and produce records that validate as DNS and never verify as DKIM.
 */
export function dkimRecords(domain: string, tokens: readonly string[]): DkimRecord[] {
  const d = domain.trim().toLowerCase()
  return tokens.map((t) => ({ name: `${t}._domainkey.${d}`, value: `${t}.dkim.amazonses.com` }))
}

/** How SES describes an identity, reduced to the three states we model. */
export type IdentityStatus = 'pending' | 'verified' | 'failed'

/**
 * Map SES's DKIM status onto ours.
 *
 * `TEMPORARY_FAILURE` is deliberately NOT `failed`: SES uses it while it is still retrying the DNS
 * lookup, and telling a tenant "failed" about records they published correctly two minutes ago sends
 * them to delete and re-add them, which restarts the clock. It reads as still pending, which is what
 * it is.
 *
 * Shared because two callers ask SES the same question — the settings routes and the sweep that
 * finishes the job when nobody has the panel open — and a second copy of this switch is a second
 * chance to disagree about what `TEMPORARY_FAILURE` means.
 */
export function dkimStatusOf(sesDkimStatus: string | undefined): IdentityStatus {
  switch (sesDkimStatus) {
    case 'SUCCESS':
      return 'verified'
    case 'FAILED':
      return 'failed'
    default:
      return 'pending'
  }
}
