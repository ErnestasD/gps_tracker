import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { AppShell } from '@/components/AppShell'
import { getAccessToken, refreshSession } from '@/lib/auth'
import { LoginPage } from '@/routes/login'
import { MapPage } from '@/routes/app/map'
import { AuditPage } from '@/routes/app/audit'
import { BrandingPage } from '@/routes/app/branding'
import { DevicesPage } from '@/routes/app/devices/index'
import { SettingsPage } from '@/routes/app/settings'

/** Reload survival: the access token is memory-only, but the httpOnly refresh
 * cookie is not — try a refresh before deciding the user is logged out. */
const hasSession = async (): Promise<boolean> =>
  getAccessToken() !== null || (await refreshSession())

// Code-based route tree (no codegen plugin — nothing generated for typed eslint
// to choke on). /app/* is guarded: no stub token ⇒ bounce to /login (E03-1 swaps
// the guard's token source, tree stays).
const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
    throw redirect({ to: (await hasSession()) ? '/app/map' : '/login' })
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const r = search['redirect']
    // internal paths only (review LOW): TanStack navigate can't leave the origin
    // today, but E03-1's real auth must not inherit an unvalidated redirect
    return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? { redirect: r } : {}
  },
  component: LoginPage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  beforeLoad: async ({ location }) => {
    if (!(await hasSession())) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})

const mapRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/map',
  component: MapPage,
})

const devicesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/devices',
  component: DevicesPage,
})

const brandingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/branding',
  component: BrandingPage,
})

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  component: AuditPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  appRoute.addChildren([mapRoute, devicesRoute, brandingRoute, auditRoute, settingsRoute]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
