import { Check, Copy, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * The two pieces every DNS setup table on this page is built from.
 *
 * They lived inside the Branding route, private to the custom-domain panel, and the sending-domain
 * panel (ADR-036) then grew a second, plainer version of the same table — a click-the-text copy with
 * no status column and no explanations. Two tables asking a reseller to transcribe DNS records, in
 * one screen, behaving differently, is the kind of difference a reader reads as meaning something.
 * One implementation, used twice.
 */

/**
 * An ⓘ that opens its explanation.
 *
 * A Popover rather than a tooltip: this text is the difference between a working setup and a broken
 * one, and hover is not a gesture a phone has.
 */
export function Hint({ label, body, testId }: { label: string; body: string; testId: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--admin-hairline)]"
          style={{ color: 'var(--admin-ink-soft)' }}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs">
        <div className="mb-1 font-semibold" style={{ color: 'var(--admin-ink)' }}>{label}</div>
        {/* the copy carries its own paragraph breaks — rendering them keeps the popover readable */}
        {body.split('\n\n').map((para) => (
          <p key={para.slice(0, 24)} className="mt-1 first:mt-0" style={{ color: 'var(--admin-ink-soft)' }}>{para}</p>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** One monospaced value with a copy button — the only interaction these tables need. */
export function Field({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  const { t } = useTranslation()
  return (
    <span className="flex items-start gap-1">
      <code className="mono break-all" style={{ color: 'var(--admin-ink)' }}>{text}</code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`${t('branding.copy')}: ${text}`}
        title={copied ? t('branding.copied') : t('branding.copy')}
        className="shrink-0 rounded p-0.5 transition-colors"
        style={{ color: copied ? 'var(--admin-success)' : 'var(--admin-ink-soft)' }}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  )
}

/**
 * How often a panel looks at DNS while records are still pending. A provider takes minutes.
 *
 * Shared so the two tables cannot drift into different ideas of "watching" — one polling every
 * twenty seconds and the other every minute would make the same wait feel like two different
 * products.
 */
export const DNS_POLL_MS = 20_000
