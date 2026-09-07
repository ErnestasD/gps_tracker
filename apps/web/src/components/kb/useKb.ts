import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type KbViewer } from '@orbetra/kb'

import { cachedBranding } from '@/lib/branding'
import { kbLang, kbProductName, kbViewer, type KbLang } from '@/lib/kb'
import { usePublicBranding } from '@/lib/publicBranding'

export interface KbGate {
  lang: KbLang
  viewer: KbViewer
  /** true on a tenant's own host; null until `/v1/branding` answers */
  whiteLabel: boolean | null
}

/**
 * Who is reading, and under whose brand — everything a contextual help link needs.
 *
 * `whiteLabel` starts as null (the host has not answered yet), and the viewer resolves that to the
 * STRICTEST case: an article that would be withheld on a reseller's host is never flashed for
 * 200 ms while the answer is in flight. Being briefly too cautious costs a paragraph; being briefly
 * too permissive is the leak.
 *
 * Deliberately does NOT read the stored branding: a page can carry half a dozen help links, and
 * each of them re-parsing localStorage on every render is a real cost for a value only the article
 * reader needs. `useKb` below adds it.
 */
export function useKbGate(): KbGate {
  const { i18n } = useTranslation()
  const host = usePublicBranding()
  const whiteLabel = host === null ? null : host.whiteLabel
  const strict = whiteLabel !== false
  const lang = kbLang(i18n.resolvedLanguage ?? i18n.language)
  const viewer = useMemo(() => kbViewer(strict), [strict])
  return { lang, viewer, whiteLabel }
}

export interface KbContext extends KbGate {
  /** the name substituted into `{product}` — the tenant's, ours, or a neutral noun */
  product: string
}

/** The gate plus the product name, for the pages that actually render article prose. */
export function useKb(): KbContext {
  const { t } = useTranslation()
  const gate = useKbGate()
  const host = usePublicBranding()
  const strict = gate.whiteLabel !== false
  const neutral = t('learn.neutralProduct')
  const product = useMemo(() => {
    const branding = { ...(cachedBranding() ?? {}), ...(host?.productName !== undefined ? { productName: host.productName } : {}) }
    return kbProductName(branding, strict, neutral)
  }, [host?.productName, strict, neutral])
  return { ...gate, product }
}
