import { KB, isVisible, type KbArticle, type KbLang, type KbViewer } from '@orbetra/kb'

import { isOverseer } from './accountContext'
import { getCurrentUser } from './auth'
import { PLATFORM_NAME, type Branding } from './branding'

export { KB }
export type { KbArticle, KbLang }

/**
 * The knowledge base as the DASHBOARD sees it.
 *
 * This module imports only the package ROOT — slugs, types and the gating predicate. The articles
 * themselves live behind `@orbetra/kb/content`, imported solely by the lazily-loaded help route, so
 * a fleet operator who never opens the help never downloads a word of it. Every contextual "learn
 * more" link in the product goes through here and costs nothing but a slug.
 */

/** Where an article lives inside the app. */
export const kbPath = (slug: string): string => `/app/learn/${slug}`

/**
 * Who is reading, for the audience gates.
 *
 * `whiteLabel` is the decisive one: on a reseller's own host the reader may be that reseller's
 * customer, and articles about the platform's own plans and invoices are withheld — naming a
 * commercial relationship they are not in is the same leak class as showing our logo (see
 * packages/kb's own brand test).
 *
 * `isAdmin` REQUIRES A TENANT-WIDE ADMIN, not merely the admin role, and that distinction is the
 * whole safety of the sentence above. `POST /v1/users` accepts `{role:'tsp_admin', accountId:<uuid>}`
 * — `canGrantRole('tsp_admin','tsp_admin')` is true — so a reseller can pin an admin to ONE of their
 * customers' accounts, and that person is the customer's admin, not ours. Reading the role alone let
 * them through the `platformOnly` gate on the reseller's own host, which is precisely the reader it
 * exists to stop. The API already defends four routes with the same rule (`tenantWide` in
 * apps/api/src/routes/crud.ts) and this app already spells the predicate out in `isOverseer`; this
 * reuses it rather than writing a third, subtly different copy.
 */
export function kbViewer(whiteLabel: boolean): KbViewer {
  const user = getCurrentUser()
  return {
    surface: 'app',
    whiteLabel,
    isAdmin: isOverseer(),
    ...(user !== null ? { entitlements: user.entitlements } : {}),
  }
}

/** Is this article reachable for the current reader? Used by HelpLink to decide whether to render
 *  a link at all — a help icon that leads to a page the reader may not open is worse than none. */
export function kbReachable(article: KbArticle, whiteLabel: boolean): boolean {
  return isVisible(article, kbViewer(whiteLabel))
}

/**
 * The name substituted into `{product}` in the prose.
 *
 * On a tenant host with no product name configured there is deliberately NO fallback to ours — the
 * neutral noun is used instead, exactly as the sidebar shows no mark rather than ours. The i18n key
 * is passed in by the caller so this module stays free of a translation dependency.
 */
export function kbProductName(branding: Branding | null | undefined, whiteLabel: boolean, neutral: string): string {
  const configured = branding?.productName?.trim()
  if (configured !== undefined && configured !== '') return configured
  return whiteLabel ? neutral : PLATFORM_NAME
}

/** The reader's language, mapped onto the languages the knowledge base is written in. */
export function kbLang(i18nLanguage: string | undefined): KbLang {
  const base = (i18nLanguage ?? 'en').slice(0, 2)
  return base === 'lt' || base === 'pl' || base === 'de' ? base : 'en'
}
