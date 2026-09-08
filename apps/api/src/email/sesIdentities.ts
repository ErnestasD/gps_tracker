import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2'

import { dkimStatusOf, type IdentityStatus } from '@orbetra/shared'

/**
 * Creating and reading SES sending identities (ADR-036, audit W-3).
 *
 * An INTERFACE with a factory, the same shape as the Stripe gateway, for the same two reasons: the
 * routes have to be testable without reaching AWS, and the whole feature has to be absent — not
 * broken — on a deployment that has no credentials for it.
 *
 * Scope is deliberately three calls on a settings screen. The SEND path does not come here: mail
 * still goes out over SMTP (ADR-023), because SES accepts any `From` on an identity it has verified.
 * That is what makes this one header rather than a second delivery path.
 */

export interface SesIdentity {
  /** the three DKIM selector tokens; each becomes a `<token>._domainkey.<domain>` CNAME */
  dkimTokens: string[]
  status: IdentityStatus
}

export interface SesIdentityGateway {
  /** Create (or re-read, if it already exists) the identity for a domain. */
  create(domain: string): Promise<SesIdentity>
  /** Current verification state. Null when SES has never heard of the identity. */
  get(domain: string): Promise<SesIdentity | null>
  remove(domain: string): Promise<void>
}

export interface SesIdentityConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Config from the environment, or null when this deployment cannot manage identities.
 *
 * Separate credentials from the SMTP ones already in use, and not an oversight: SES SMTP credentials
 * can SEND but cannot manage identities, so the same server holding `SMTP_USER`/`SMTP_PASS` still
 * cannot create one. An IAM user limited to the four `ses:*EmailIdentity*` actions is what this
 * reads, and until the founder provisions it the routes answer 503 and the settings screen says the
 * feature is unavailable — the SMS gateway's pattern (ADR-032), so a missing credential is never a
 * broken screen.
 */
export function sesIdentityConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SesIdentityConfig | null {
  const region = env['AWS_REGION']?.trim()
  const accessKeyId = env['SES_ADMIN_ACCESS_KEY_ID']?.trim()
  const secretAccessKey = env['SES_ADMIN_SECRET_ACCESS_KEY']?.trim()
  if (!region || !accessKeyId || !secretAccessKey) return null
  return { region, accessKeyId, secretAccessKey }
}

export function createSesIdentityGateway(cfg: SesIdentityConfig): SesIdentityGateway {
  const client = new SESv2Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  const read = async (domain: string): Promise<SesIdentity | null> => {
    try {
      const res = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
      return { dkimTokens: res.DkimAttributes?.Tokens ?? [], status: dkimStatusOf(res.DkimAttributes?.Status) }
    } catch (err) {
      // NotFoundException is an ANSWER, not a fault: it means "no identity here", which is exactly
      // what a caller checking a domain they have not registered needs to hear. Anything else is a
      // real failure and must surface, or a broken IAM policy would look like a missing identity
      // and the tenant would be told to publish records that were never created.
      if (err instanceof Error && err.name === 'NotFoundException') return null
      throw err
    }
  }
  return {
    create: async (domain) => {
      try {
        const res = await client.send(
          // EasyDKIM: SES generates the key pair and hands back the three selectors. The alternative
          // (BYODKIM) would mean holding a private key for someone else's domain.
          new CreateEmailIdentityCommand({ EmailIdentity: domain }),
        )
        return { dkimTokens: res.DkimAttributes?.Tokens ?? [], status: dkimStatusOf(res.DkimAttributes?.Status) }
      } catch (err) {
        // Already registered — by this tenant re-submitting the form, or by another one. Reading it
        // back is right for the first and harmless for the second: the DKIM tokens are public DNS
        // either way, and only whoever controls the zone can publish them. Ownership is proved by
        // the records resolving, not by who called this first.
        if (err instanceof Error && err.name === 'AlreadyExistsException') {
          const existing = await read(domain)
          if (existing !== null) return existing
        }
        throw err
      }
    },
    get: read,
    remove: async (domain) => {
      try {
        await client.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }))
      } catch (err) {
        // Deleting something that is not there is the outcome the caller wanted.
        if (err instanceof Error && err.name === 'NotFoundException') return
        throw err
      }
    },
  }
}
