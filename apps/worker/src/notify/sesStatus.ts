import { GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2'

import { dkimStatusOf, type IdentityStatus } from '@orbetra/shared'

/**
 * Read one SES identity's DKIM state (ADR-036).
 *
 * ── Why the worker holds the SDK too ─────────────────────────────────────────────────────────────
 * ADR-036 scoped `@aws-sdk/client-sesv2` to apps/api, where the settings routes create and read
 * identities. That was right for what the ADR described and short by one caller: the panel only
 * advances while somebody has it open, so a reseller who publishes their records and closes the tab
 * had nothing finishing the job — SES flipped their identity to verified and the row sat `pending`,
 * with their mail still leaving as the platform. The sweep that fixes that lives in the worker,
 * because the worker is where scheduled work lives.
 *
 * The ADR's actual constraint is unchanged and worth restating: this is identity MANAGEMENT, never
 * the send path. Mail still goes out over SMTP (ADR-023), and nothing here runs per message — one
 * call per unverified domain, every ten minutes.
 *
 * ONE command, not three: the worker only ever asks. Creating and deleting identities stay in the
 * API, where a human is on the other end of the request.
 */
export function sesStatusReader(cfg: { region: string; accessKeyId: string; secretAccessKey: string }) {
  const client = new SESv2Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  return async (domain: string): Promise<IdentityStatus | null> => {
    try {
      const res = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
      return dkimStatusOf(res.DkimAttributes?.Status)
    } catch (err) {
      // NotFound is an ANSWER — the identity is gone, so there is nothing to finish and nothing to
      // report as broken. Anything else is a real fault and must surface as `unreachable` rather
      // than be mistaken for "still pending", which would leave the row moving nowhere in silence.
      if (err instanceof Error && err.name === 'NotFoundException') return null
      throw err
    }
  }
}
