import type { EmailSuppression, PrismaClient } from '@prisma/client'

/**
 * Addresses we must stop mailing.
 *
 * PLATFORM-LEVEL and unscoped by design, like the affiliate repo: an address is not a tenant's
 * property, the same mailbox can belong to a user of one tenant and a partner of none, and a mailbox
 * that no longer exists does not exist for anybody. Scoping this per tenant would let a bounce
 * learned on one host go on bouncing on another.
 */
export interface SuppressionRepo {
  /**
   * Record an address as undeliverable. Idempotent — SNS delivers at least once, and a redelivered
   * bounce must not look like a second one.
   *
   * A COMPLAINT OVERWRITES A BOUNCE, never the reverse. They are not the same fact: a bounce says
   * the address is wrong, a complaint says a real person marked us as spam, and AWS treats the
   * second an order of magnitude more harshly (0.1% versus 5%). Downgrading a complaint to a bounce
   * because a later message also bounced would lose the more serious of the two.
   */
  suppress(address: string, reason: 'bounce' | 'complaint', detail: string | null, messageId: string | null): Promise<void>
  /** Is this address suppressed? Called on the send path, so it is a single indexed primary-key read. */
  isSuppressed(address: string): Promise<boolean>
  /** The suppression, for support answering "why did they never get the mail?". Null when clear. */
  get(address: string): Promise<EmailSuppression | null>
  /**
   * Let an address through again.
   *
   * Support needs this: a customer who fixed their mailbox, or a complaint filed by mistake, must
   * not be locked out of every future message forever. It is deliberately a deletion rather than a
   * flag — a suppression that can be "inactive" invites a send path that forgets to check the flag.
   */
  release(address: string): Promise<boolean>
  /** Everything suppressed, newest first — the admin list. Bounded like every other admin read. */
  list(limit?: number): Promise<EmailSuppression[]>
}

const LIST_LIMIT = 500

export function createSuppressionRepo(prisma: PrismaClient): SuppressionRepo {
  const key = (address: string) => address.trim().toLowerCase()
  return {
    suppress: async (address, reason, detail, messageId) => {
      const a = key(address)
      if (a === '') return
      await prisma.emailSuppression.upsert({
        where: { address: a },
        create: { address: a, reason, detail, messageId },
        // a bounce arriving after a complaint leaves the complaint standing; see the interface note
        update: reason === 'complaint' ? { reason, detail, messageId } : {},
      })
    },
    isSuppressed: async (address) => {
      const a = key(address)
      if (a === '') return false
      return (await prisma.emailSuppression.findUnique({ where: { address: a }, select: { address: true } })) !== null
    },
    get: (address) => prisma.emailSuppression.findUnique({ where: { address: key(address) } }),
    release: async (address) => {
      const { count } = await prisma.emailSuppression.deleteMany({ where: { address: key(address) } })
      return count > 0
    },
    list: (limit = LIST_LIMIT) => prisma.emailSuppression.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
  }
}
