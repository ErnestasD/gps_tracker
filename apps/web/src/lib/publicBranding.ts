import { useEffect, useState } from 'react'

import { applyBranding, type Branding } from './branding'
import { fetchPublicBranding } from './share'

/**
 * Tenant branding BEFORE anyone logs in, resolved from the Host the browser used.
 *
 * `GET /v1/branding` has existed since E03-5 and the README, the epic plan and the endpoint's own
 * doc-comment all said it was what made "a custom-domain login page show the tenant's logo before
 * authentication" true. It was never wired up: its only caller was the public share page, and the
 * login screen hard-coded the Orbetra wordmark, the Orbetra gradient, `<title>Orbetra</title>` and
 * our favicon. A reseller's customer arriving at `fleet.reseller.lt/login` was met by OUR brand, on
 * the one screen every single one of their users sees, while the marketing site promised "Orbetra
 * never appears".
 *
 * `whiteLabel` is the answer to a second question the same fetch settles: whether this page may
 * mention us at all. On our own hosts it is false and the login card links back to orbetra.com; on a
 * tenant's host it is true and nothing — no logo, no link, no tab title — says Orbetra.
 *
 * FAIL SOFT in every direction. The endpoint is public, cached 60 s, and returns `{}` for a host it
 * does not know; a network failure resolves to null. Either way the page renders with the platform
 * brand, because a login form that cannot be reached is a worse outcome than an unbranded one.
 */
export interface PublicBrand {
  /** true ⇒ this host belongs to a tenant: show THEIR brand and never ours */
  whiteLabel: boolean
  /** the tenant's product name, when white-labelled */
  productName?: string | undefined
  branding: Branding
}

const PLATFORM: PublicBrand = { whiteLabel: false, branding: {} }

/**
 * `/v1/branding`'s answer → whose brand this page wears. PURE, and separated from the hook because
 * it is the whole decision: get it wrong in the permissive direction and a reseller's customers see
 * our logo; get it wrong the other way and our own login page goes blank.
 *
 * An unknown host answers `{}` — that is the PLATFORM, not a tenant with empty branding. A tenant
 * only owns the page once it has actually configured something, which is also why a bare
 * `productName` with no colours counts: it is a deliberate act by someone on the Branding screen.
 */
export function brandFromResponse(res: { whiteLabel?: unknown; branding?: unknown; productName?: string } | null): PublicBrand | null {
  // A FETCH FAILURE IS NOT THE PLATFORM. It used to be: a blocked request, a 502 mid-deploy or a
  // flaky network on a tenant's login page fell through to `PLATFORM` and rendered our wordmark and
  // a link to our marketing site on their domain. `null` means UNKNOWN, and every caller renders
  // nothing brand-specific for it (fail closed).
  if (res === null) return null
  const branding = (typeof res.branding === 'object' && res.branding !== null ? res.branding : {}) as Branding
  // THE SERVER decides, not the shape of what came back. Inferring white-label from "did any
  // branding field arrive" meant a reseller who verified their domain BEFORE filling in the branding
  // form got the full platform wordmark on the one screen every one of their customers passes
  // through. The host resolving to a tenant is the fact, and only the API knows it.
  if (res.whiteLabel !== true) return PLATFORM
  return { whiteLabel: true, productName: res.productName, branding }
}

/**
 * Resolve once per page load, apply the colours/title/favicon, and return the result.
 *
 * `null` means UNKNOWN — still in flight, or the request failed. Callers must render nothing
 * brand-specific for it; see brandFromResponse on why a failure must not resolve to the platform.
 *
 * Returns `null` while in flight so the caller can render nothing brand-specific yet: flashing the
 * Orbetra wordmark for 200 ms before swapping to the tenant's is exactly the leak this closes, and
 * it is the kind that survives a screenshot.
 */
export function usePublicBranding(): PublicBrand | null {
  const [brand, setBrand] = useState<PublicBrand | null>(null)
  useEffect(() => {
    let live = true
    void fetchPublicBranding().then((res) => {
      if (!live) return
      const brand = brandFromResponse(res)
      if (brand !== null) {
        applyBranding({ ...brand.branding, ...(brand.productName !== undefined ? { productName: brand.productName } : {}) }, brand.whiteLabel)
      }
      setBrand(brand)
    })
    return () => {
      live = false
    }
  }, [])
  return brand
}
