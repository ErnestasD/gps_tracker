import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { type EntitlementKey } from '@orbetra/shared'

import { AppShell } from '@/components/AppShell'
import { getAccessToken, getCurrentUser, refreshSession } from '@/lib/auth'
import { LoginPage } from '@/routes/login'
import { ForgotPasswordPage } from '@/routes/forgotPassword'
import { ResetPasswordPage } from '@/routes/resetPassword'
import { MapPage } from '@/routes/app/map'
import { DashboardPage } from './routes/app/dashboard'
import { AuditPage } from '@/routes/app/audit'
import { BillingPage } from '@/routes/app/billing'
import { BrandingPage } from '@/routes/app/branding'
import { PlaybackPage } from '@/routes/app/playback'
import { TripsPage } from '@/routes/app/trips'
import { GeofencesPage } from '@/routes/app/geofences'
import { RoutePlannerPage } from '@/routes/app/routing'
import { ApiKeysPage } from '@/routes/app/apiKeys'
import { PlatformPage } from '@/routes/app/platform'
import { EventsPage } from '@/routes/app/events'
import { ReportsPage } from '@/routes/app/reports'
import { RulesPage } from '@/routes/app/rules'
import { WebhooksPage } from '@/routes/app/webhooks'
import { DevicesPage } from '@/routes/app/devices/index'
import { DriversPage } from '@/routes/app/drivers'
import { MaintenancePage } from '@/routes/app/maintenance'
import { SettingsPage } from '@/routes/app/settings'
import { SharePage } from '@/routes/share/index'

/** Reload survival: the access token is memory-only, but the httpOnly refresh
 * cookie is not — try a refresh before deciding the user is logged out. */
const hasSession = async (): Promise<boolean> =>
  getAccessToken() !== null || (await refreshSession())

/**
 * Tenant-plan route guard (WP3, defense-in-depth): a deep link / typed URL to a plan-gated page
 * (branding, api-keys, webhooks) must not reach the page for a tenant whose plan lacks the
 * entitlement — the parent /app beforeLoad already established the session, so getCurrentUser() is
 * populated here. Absent entitlement ⇒ bounce to /app (the nav item is hidden for the same reason).
 */
const requireEntitlement = (key: EntitlementKey) => (): void => {
  const user = getCurrentUser()
  if (user === null || user.entitlements[key] !== true) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
    throw redirect({ to: '/app' })
  }
}

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

// PUBLIC password-reset flow (ADR-031) — no auth, no app shell. Step 1 emails a link; step 2
// redeems the ?token= and sets a new password.
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
})

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const tk = search['token']
    return typeof tk === 'string' && tk !== '' ? { token: tk } : {}
  },
  component: ResetPasswordPage,
})

// PUBLIC temporary share page (V1-nice) — no auth, no app shell; the token is the capability.
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$token',
  component: function ShareRoute() {
    const { token } = shareRoute.useParams()
    return <SharePage token={token} />
  },
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

const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: DashboardPage,
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

const driversRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/drivers',
  component: DriversPage,
})

const maintenanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/maintenance',
  component: MaintenancePage,
})

const brandingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/branding',
  beforeLoad: requireEntitlement('whiteLabel'),
  component: BrandingPage,
})

const billingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/billing',
  component: BillingPage,
})

const playbackRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/playback',
  component: PlaybackPage,
})

const tripsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/trips',
  component: TripsPage,
})

const routingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/routing',
  component: RoutePlannerPage,
})

const geofencesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/geofences',
  component: GeofencesPage,
})

const rulesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/rules',
  component: RulesPage,
})

const eventsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/events',
  component: EventsPage,
})

const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reports',
  component: ReportsPage,
})

const apiKeysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/api-keys',
  beforeLoad: requireEntitlement('apiAccess'),
  component: ApiKeysPage,
})

const webhooksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/webhooks',
  beforeLoad: requireEntitlement('webhooks'),
  component: WebhooksPage,
})

const platformRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/platform',
  component: PlatformPage,
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
  forgotPasswordRoute,
  resetPasswordRoute,
  shareRoute,
  appRoute.addChildren([appIndexRoute, mapRoute, devicesRoute, driversRoute, maintenanceRoute, tripsRoute, routingRoute, playbackRoute, geofencesRoute, rulesRoute, eventsRoute, reportsRoute, apiKeysRoute, webhooksRoute, platformRoute, brandingRoute, billingRoute, auditRoute, settingsRoute]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
