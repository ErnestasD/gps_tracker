import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { AppShell } from '@/components/AppShell'
import { getToken } from '@/lib/auth'
import { LoginPage } from '@/routes/login'
import { MapPage } from '@/routes/app/map'

// Code-based route tree (no codegen plugin — nothing generated for typed eslint
// to choke on). /app/* is guarded: no stub token ⇒ bounce to /login (E03-1 swaps
// the guard's token source, tree stays).
const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect idiom
    throw redirect({ to: getToken() !== null ? '/app/map' : '/login' })
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {},
  component: LoginPage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  beforeLoad: ({ location }) => {
    if (getToken() === null) {
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

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, appRoute.addChildren([mapRoute])])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
