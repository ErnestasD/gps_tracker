import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader, AdminButton, Badge } from "@/components/admin/AdminKit";
import { GripVertical, Plus, RotateCcw } from "lucide-react";
import { DemoMap, type DemoPin } from "@/components/admin/DemoMap";
import { cityFor, type LngLat } from "@/lib/demo-geo";
import { contentFor } from "@/lib/demo-content";
import { LANGUAGES, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/app/routing")({
  component: RoutingPage,
});

/**
 * Mirrors the real route planner (apps/web app/routing): stop list left, route map right.
 *
 * The plan used to be the Vilnius–Kaunas A1 with stops called "Sandėlis · Kirtimai" and
 * "Klientas · Vievis" — shown to a German reader as their fleet's next delivery run. The stops now
 * sit on the city's own routed loop, so the plan is drivable where the vans actually are, and the
 * distance is MEASURED off that geometry rather than asserted: the old page claimed a fixed 128 km
 * beside whatever line it happened to draw.
 */
const STOP_FRACTIONS = [0.05, 0.32, 0.58, 0.86];

function planFor(lang: string) {
  const loop = cityFor(lang).loops[0];
  const c = contentFor(lang);
  const l = L[normalizeLang(lang)];
  const idx = STOP_FRACTIONS.map((f) => Math.floor(loop.length * f));
  const names = [c.zones.depot, `${l.customer} · ${c.towns[1]}`, `${l.customer} · ${c.towns[2]}`, c.terminal];
  const stops = idx.map((i, n) => ({
    n: n + 1,
    name: names[n],
    coord: `${loop[i][1].toFixed(4)}, ${loop[i][0].toFixed(4)}`,
  }));
  const route = loop.slice(idx[0], idx[idx.length - 1] + 1);
  const pins: DemoPin[] = idx.map((i, n) => ({ id: `stop-${n + 1}`, at: loop[i], label: String(n + 1), color: "#7C7DF5" }));
  return { stops, route, pins, km: Math.round(lengthKm(route)) };
}

/** Length of a polyline in km — the planner states a distance, so it should be the drawn one. */
function lengthKm(pts: LngLat[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    m += 6_371_000 * Math.hypot(dLat, dLng * Math.cos(lat));
  }
  return m / 1000;
}

// Demo-only strings not present in the real dashboard's translation files —
// translated here, keyed by the site language.
const L: Record<
  Lang,
  { stops: string; reset: string; addStop: string; distance: string; duration: string; minutes: string; customer: string; badge: string }
> = {
  lt: {
    stops: "Sustojimai",
    reset: "Atstatyti",
    addStop: "Pridėti sustojimą",
    distance: "Atstumas",
    duration: "Trukmė",
    minutes: "min.",
    customer: "Klientas",
    badge: "OSRM · realūs keliai",
  },
  en: {
    stops: "Stops",
    reset: "Reset",
    addStop: "Add stop",
    distance: "Distance",
    duration: "Duration",
    minutes: "min",
    customer: "Customer",
    badge: "OSRM · real roads",
  },
  pl: {
    stops: "Przystanki",
    reset: "Od nowa",
    addStop: "Dodaj przystanek",
    distance: "Dystans",
    duration: "Czas",
    minutes: "min",
    customer: "Klient",
    badge: "OSRM · prawdziwe drogi",
  },
  de: {
    stops: "Stopps",
    reset: "Zurücksetzen",
    addStop: "Stopp hinzufügen",
    distance: "Distanz",
    duration: "Dauer",
    minutes: "Min.",
    customer: "Kunde",
    badge: "OSRM · echte Straßen",
  },
};

function normalizeLang(lang: string): Lang {
  const two = lang.slice(0, 2) as Lang;
  return LANGUAGES.includes(two) ? two : "lt";
}

function RoutingPage() {
  const { t, i18n } = useTranslation("admin");
  const lang = normalizeLang(i18n.resolvedLanguage ?? i18n.language);
  const l = L[lang];
  const plan = planFor(lang);
  // a city delivery run averages ~24 km/h with the stops — stated from the drawn distance rather
  // than the fixed "1 h 52 min" the page used to print beside any geometry at all
  const minutes = Math.max(15, Math.round((plan.km / 24) * 60));
  return (
    <div className="p-4 md:p-8">
      <PageHeader title={t("routing.title")} description={t("routing.desc")} />
      <div className="mt-6 grid gap-4 lg:grid-cols-[24rem_1fr]">
        <div className="admin-card flex flex-col">
          <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{l.stops}</span>
            <div className="flex gap-2">
              <AdminButton variant="secondary" size="sm"><RotateCcw className="h-3.5 w-3.5" /> {l.reset}</AdminButton>
              <AdminButton size="sm">{t("routing.optimize")}</AdminButton>
            </div>
          </div>
          <ul>
            {plan.stops.map((s) => (
              <li key={s.n} className="admin-hairline-b flex items-center gap-3 px-4 py-3">
                <GripVertical className="h-4 w-4 opacity-40" style={{ color: "var(--admin-ink-soft)" }} />
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
                  style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
                >
                  {s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--admin-ink)" }}>{s.name}</div>
                  <div className="mono text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>{s.coord}</div>
                </div>
              </li>
            ))}
            <li className="px-4 py-3">
              <button className="inline-flex cursor-pointer items-center gap-1.5 text-sm" style={{ color: "var(--admin-brand)" }}>
                <Plus className="h-3.5 w-3.5" /> {l.addStop}
              </button>
            </li>
          </ul>
          <div className="admin-hairline-t mt-auto grid grid-cols-3 gap-2 p-4 text-center">
            {[[l.distance, t("units.km", { n: plan.km })], [l.duration, `${Math.floor(minutes / 60)} h ${minutes % 60} ${l.minutes}`], [l.stops, String(plan.stops.length)]].map(([k, v]) => (
              <div key={k} className="rounded-md py-2" style={{ background: "var(--admin-surface-sunken)" }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{k}</div>
                <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="admin-card relative min-h-[480px] overflow-hidden">
          <DemoMap
            className="h-full w-full min-h-[480px]"
            fit={plan.route}
            routes={[{ id: "plan", coords: plan.route, color: "#7C7DF5", widthPx: 3.5 }]}
            pins={plan.pins}
          />
          <Badge tone="brand" className="absolute right-4 top-4 z-10">{l.badge}</Badge>
        </div>
      </div>
    </div>
  );
}
