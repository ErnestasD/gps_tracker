import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
} from "@tanstack/react-router";
import { NavBar } from "@/components/site/NavBar";
import { Footer } from "@/components/site/Footer";
import { ScrollTrajectory } from "@/components/site/ScrollTrajectory";
import { OrbitalFluidBg } from "@/components/site/OrbitalFluidBg";
import { RefConsent } from "@/components/site/RefConsent";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 pt-24">
      <div className="max-w-lg text-center">
        <svg viewBox="0 0 320 200" className="mx-auto mb-8 w-full max-w-sm">
          <ellipse cx="160" cy="100" rx="130" ry="55" fill="none" stroke="#D6DEEC" strokeWidth="1" strokeDasharray="3 4" />
          <ellipse cx="160" cy="100" rx="90" ry="38" fill="none" stroke="#D6DEEC" strokeWidth="1" />
          <ellipse cx="160" cy="100" rx="50" ry="20" fill="none" stroke="#D6DEEC" strokeWidth="1" />
          <path d="M 250 60 Q 285 30 305 15" fill="none" stroke="#2563EB" strokeWidth="1.5" strokeDasharray="4 3" />
          <circle cx="305" cy="15" r="5" fill="#B45309" />
          <circle cx="305" cy="15" r="10" fill="#B45309" fillOpacity="0.2" />
          <circle cx="90" cy="120" r="3" fill="#2563EB" />
          <circle cx="210" cy="80" r="3" fill="#3a3b8f" />
        </svg>
        <div className="section-label justify-center">— FIG.404 · OFF-ROUTE</div>
        <h1 className="display text-5xl font-bold mt-4">
          Route <span className="text-gradient">not found</span>
        </h1>
        <p className="mt-4 text-muted-foreground">
          This node has drifted off its orbit. Let's get you back to base.
        </p>
        <Link to="/" className="mt-8 pill-primary hover:pill-primary-hover">
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="display text-2xl font-bold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. Try again or head home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { void router.invalidate(); reset(); }}
            className="pill-primary hover:pill-primary-hover"
          >
            Try again
          </button>
          <a href="/" className="pill-ghost">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Orbetra — White-label GPS tracking, precisely engineered" },
      {
        name: "description",
        content:
          "Orbetra is a white-label, EU-hosted GPS tracking platform built for Teltonika fleets. Multi-tenant, per-device pricing, real REST API.",
      },
      { name: "author", content: "Orbetra" },
      { property: "og:title", content: "Orbetra — White-label GPS tracking, precisely engineered" },
      { property: "og:description", content: "White-label, EU-hosted GPS tracking for TSPs and fleet resellers. Multi-tenant, Teltonika-first." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#04070F" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      <OrbitalFluidBg />
      <NavBar />
      <ScrollTrajectory />
      <main className="pt-16">
        <Outlet />
      </main>
      <Footer />
      <RefConsent />
    </QueryClientProvider>
  );
}
