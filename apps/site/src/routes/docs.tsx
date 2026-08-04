import { createFileRoute, Link } from "@tanstack/react-router";
import { API_URL } from "@/lib/api";

// Display-only base for code samples: the site itself calls the api same-origin
// (API_URL may be ""), but docs should always show the canonical public host.
const DOCS_API_BASE = API_URL || "https://api.orbetra.com";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Docs & API Reference — Orbetra" },
      {
        name: "description",
        content:
          "Orbetra developer docs: authentication, devices, positions, trips and webhooks. REST endpoints, examples and hardware onboarding for supported trackers.",
      },
      { property: "og:title", content: "Docs & API Reference — Orbetra" },
      {
        property: "og:description",
        content: "REST API reference, authentication, webhooks and device onboarding for Orbetra.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocsPage,
});

const SECTIONS = [
  { id: "start", label: "Getting started" },
  { id: "auth", label: "Authentication" },
  { id: "endpoints", label: "REST endpoints" },
  { id: "webhooks", label: "Webhooks" },
  { id: "devices", label: "Device onboarding" },
];

const ENDPOINTS = [
  { method: "GET", path: "/v1/devices", desc: "List devices in your account." },
  { method: "GET", path: "/v1/devices/{id}", desc: "Single device with last known position." },
  { method: "GET", path: "/v1/devices/{id}/positions", desc: "Positions for a device and time range." },
  { method: "GET", path: "/v1/trips", desc: "Trips grouped by device and day." },
  { method: "POST", path: "/v1/geofences", desc: "Create a polygon, circle or corridor geofence." },
  { method: "GET", path: "/v1/events", desc: "Alerts: ignition, overspeed, geofence, power cut." },
  { method: "POST", path: "/v1/webhooks", desc: "Register an HTTPS endpoint for push events." },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--hairline)] bg-ink/[0.03] p-4 mono text-[12px] leading-relaxed text-ink/85">
      {children}
    </pre>
  );
}

function DocsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-20 md:pt-28 pb-24">
      <div className="section-label">
        <span className="h-[1px] w-6 bg-[var(--brand-blue)]" />
        — DEVELOPERS
      </div>
      <h1 className="display text-4xl md:text-5xl font-bold mt-4 text-ink">Docs & API reference</h1>
      <p className="mt-4 max-w-2xl text-ink/75">
        Everything in Orbetra is available over a REST API — the same one our own dashboard uses.
        Base URL: <span className="mono text-[13px] text-ink">{DOCS_API_BASE}</span>
      </p>

      <div className="mt-12 grid gap-10 md:grid-cols-[200px_1fr]">
        <nav className="md:sticky md:top-24 h-max">
          <ul className="space-y-2 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted-foreground hover:text-ink">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-14">
          <section id="start">
            <h2 className="display text-2xl font-semibold text-ink">Getting started</h2>
            <p className="mt-3 text-ink/75">
              Create an account, add your first tracker, then generate an API key in the app under
              Settings → API keys. Keys are scoped per account and can be revoked at any time.
            </p>
            <Code>{`curl ${DOCS_API_BASE}/v1/devices \\
  -H "Authorization: Bearer <your-api-key>"`}</Code>
            <p className="mt-4 text-sm text-muted-foreground">
              No account yet? <Link to="/signup" className="text-[var(--brand-blue)] hover:underline">Create one free</Link> or{" "}
              <Link to="/demo" className="text-[var(--brand-blue)] hover:underline">open the live demo</Link>.
            </p>
          </section>

          <section id="auth">
            <h2 className="display text-2xl font-semibold text-ink">Authentication</h2>
            <p className="mt-3 text-ink/75">
              All requests use a bearer token over HTTPS. Requests without a valid key return
              <span className="mono text-[13px]"> 401</span>. Endpoints are rate-limited per key;
              exceeding a limit returns <span className="mono text-[13px]">429</span> with a
              <span className="mono text-[13px]"> Retry-After</span> header.
            </p>
            <Code>{`Authorization: Bearer <your-api-key>
Content-Type: application/json`}</Code>
          </section>

          <section id="endpoints">
            <h2 className="display text-2xl font-semibold text-ink">REST endpoints</h2>
            <div className="mt-5 surface-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <th className="text-left px-4 py-3">Method</th>
                    <th className="text-left px-4 py-3">Path</th>
                    <th className="text-left px-4 py-3">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((e) => (
                    <tr key={e.method + e.path} className="border-t border-[var(--hairline)]">
                      <td className="px-4 py-3 mono text-[12px] text-[var(--brand-blue)]">{e.method}</td>
                      <td className="px-4 py-3 mono text-[12px] text-ink whitespace-nowrap">{e.path}</td>
                      <td className="px-4 py-3 text-ink/75">{e.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="webhooks">
            <h2 className="display text-2xl font-semibold text-ink">Webhooks</h2>
            <p className="mt-3 text-ink/75">
              Register an HTTPS endpoint and Orbetra pushes events as they happen. Every delivery is
              signed with HMAC-SHA256 in the <span className="mono text-[13px]">X-Signature</span> header
              (<span className="mono text-[13px]">sha256=&lt;hex&gt;</span> over the exact body bytes) and
              carries an <span className="mono text-[13px]">X-Webhook-Id</span> for idempotency — verify the
              signature before trusting the payload. Failed deliveries are retried with exponential backoff.
            </p>
            <Code>{`{
  "kind": "geofence",
  "deviceId": "<device-id>",
  "at": "2026-08-03T09:41:12Z",
  "payload": { "geofence": "Depot", "direction": "exit" }
}`}</Code>
            <p className="mt-4 text-sm text-muted-foreground">
              Event kinds: <span className="mono text-[12px]">geofence</span>,{" "}
              <span className="mono text-[12px]">overspeed</span>,{" "}
              <span className="mono text-[12px]">ignition</span>,{" "}
              <span className="mono text-[12px]">din_change</span>,{" "}
              <span className="mono text-[12px]">power_cut</span>,{" "}
              <span className="mono text-[12px]">low_battery</span>,{" "}
              <span className="mono text-[12px]">panic</span>,{" "}
              <span className="mono text-[12px]">device_offline</span>,{" "}
              <span className="mono text-[12px]">fuel_theft</span>. Subscribe to none and you get them all.
            </p>
          </section>

          <section id="devices">
            <h2 className="display text-2xl font-semibold text-ink">Device onboarding</h2>
            <p className="mt-3 text-ink/75">
              Teltonika trackers are supported today — Orbetra speaks their protocol natively. Point
              the tracker at the ingest host with your account port, power it up, and it appears in
              the app within a minute.
            </p>
            <Code>{`# Teltonika configurator
Server:   ingest.orbetra.com
Protocol: TCP
Port:     <provided in app → Devices → Add device>`}</Code>
            <p className="mt-4 text-sm text-muted-foreground">
              Running a model we haven't listed?{" "}
              <Link to="/pilot" className="text-[var(--brand-blue)] hover:underline">Send us the list</Link> and
              we'll confirm which IO values we decode by name.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
