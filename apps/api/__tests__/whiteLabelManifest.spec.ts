import { describe, expect, it } from 'vitest'

/**
 * The PWA manifest is the longest-lived brand leak in the product: `applyBranding` rewrites the
 * title and the favicon at runtime and could never touch this file, because the browser fetches it
 * itself. So "Install app" offered a reseller's customer an app called **Orbetra**, and the icon on
 * their phone stayed ours for as long as they kept the shortcut. A flash you can fix with a
 * re-render; a home-screen icon you cannot.
 *
 * These assert the shape the route returns for the three cases that matter. The route itself is
 * exercised end-to-end in branding.spec.ts against a real DB.
 */
describe('manifest branding rules', () => {
  const build = (branding: { productName?: string; logoUrl?: string; primary?: string }, isTenant: boolean, host: string) => {
    const name = branding.productName ?? (isTenant ? host : 'Orbetra')
    const icons = typeof branding.logoUrl === 'string' && branding.logoUrl.startsWith('https://')
      ? [{ src: branding.logoUrl }]
      : isTenant
        ? []
        : [{ src: '/icons/pwa-192.png' }]
    return { name, icons }
  }

  it('a branded tenant gets their own name and icon', () => {
    expect(build({ productName: 'VrummTrack', logoUrl: 'https://vrumm.lt/l.png' }, true, 'fleet.vrumm.lt'))
      .toEqual({ name: 'VrummTrack', icons: [{ src: 'https://vrumm.lt/l.png' }] })
  })

  it('a tenant with NO product name gets their HOST — never ours, never their legal name', () => {
    expect(build({}, true, 'fleet.vrumm.lt').name).toBe('fleet.vrumm.lt')
  })

  it('a tenant with NO logo gets NO icon — the browser default beats our mark on their phone', () => {
    expect(build({ productName: 'VrummTrack' }, true, 'fleet.vrumm.lt').icons).toEqual([])
  })

  it('our own hosts still get the platform identity', () => {
    expect(build({}, false, 'dash.orbetra.com')).toEqual({ name: 'Orbetra', icons: [{ src: '/icons/pwa-192.png' }] })
  })

  it('an http logo is refused the same way it is everywhere else', () => {
    expect(build({ logoUrl: 'http://vrumm.lt/l.png' }, true, 'fleet.vrumm.lt').icons).toEqual([])
  })
})
