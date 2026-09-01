import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { DemoMap } from "@/components/admin/DemoMap";
import { fmtDateTime } from "@/lib/admin-format";
import { KAUNAS_LOOP, routeSlice, VILNIUS_LOOP, type LngLat } from "@/lib/demo-geo";

export const Route = createFileRoute("/app/trips")({
  component: TripsPage,
});

// ---------------------------------------------------------------------------
// Static demo data — mirrors the real "Kelionės" page (trips list + detail map)
// ---------------------------------------------------------------------------

type DemoDevice = { id: string; name: string; plate: string };
type DemoDriver = { id: string; name: string };

const DEVICES: DemoDevice[] = [
  { id: "dev_0001", name: "Van 01", plate: "KLM 421" },
  { id: "dev_0002", name: "Van 02", plate: "JRE 208" },
  { id: "dev_0003", name: "Sprinter 03", plate: "BKT 617" },
  { id: "dev_0004", name: "Transit 04", plate: "FGD 934" },
  { id: "dev_0005", name: "Truck 05", plate: "HSN 152" },
];

const DRIVERS: DemoDriver[] = [
  { id: "drv_0001", name: "Jonas Kazlauskas" },
  { id: "drv_0002", name: "Mantas Petrauskas" },
  { id: "drv_0003", name: "Rokas Stankevičius" },
  { id: "drv_0004", name: "Tomas Urbonas" },
  { id: "drv_0005", name: "Lukas Balčiūnas" },
  { id: "drv_0006", name: "Andrius Žukauskas" },
];

type DemoTrip = {
  id: string;
  deviceId: string;
  driverId: string | null;
  start: string; // ISO
  distanceKm: number;
  source: "gps" | "odo";
  avgKmh: number;
  maxKmh: number;
  durationS: number;
  idleS: number;
  ongoing?: boolean;
};

const TRIPS: DemoTrip[] = [
  { id: "trp_009", deviceId: "dev_0002", driverId: "drv_0003", start: "2026-09-01T09:12:00Z", distanceKm: 5.8, source: "gps", avgKmh: 41, maxKmh: 63, durationS: 1240, idleS: 180, ongoing: true },
  { id: "trp_008", deviceId: "dev_0001", driverId: "drv_0001", start: "2026-09-01T08:05:00Z", distanceKm: 17.6, source: "gps", avgKmh: 58, maxKmh: 89, durationS: 1180, idleS: 90 },
  { id: "trp_007", deviceId: "dev_0004", driverId: "drv_0005", start: "2026-09-01T07:31:00Z", distanceKm: 3.2, source: "odo", avgKmh: 38, maxKmh: 52, durationS: 430, idleS: 120 },
  { id: "trp_006", deviceId: "dev_0003", driverId: null, start: "2026-09-01T06:58:00Z", distanceKm: 9.7, source: "gps", avgKmh: 47, maxKmh: 71, durationS: 800, idleS: 55 },
  { id: "trp_005", deviceId: "dev_0002", driverId: "drv_0003", start: "2026-08-31T17:24:00Z", distanceKm: 19.4, source: "gps", avgKmh: 64, maxKmh: 96, durationS: 1145, idleS: 45 },
  { id: "trp_004", deviceId: "dev_0005", driverId: "drv_0006", start: "2026-08-31T15:47:00Z", distanceKm: 7.9, source: "odo", avgKmh: 44, maxKmh: 66, durationS: 760, idleS: 110 },
  { id: "trp_003", deviceId: "dev_0001", driverId: "drv_0002", start: "2026-08-31T12:15:00Z", distanceKm: 14.8, source: "gps", avgKmh: 55, maxKmh: 82, durationS: 1050, idleS: 70 },
  { id: "trp_002", deviceId: "dev_0003", driverId: "drv_0004", start: "2026-08-31T09:03:00Z", distanceKm: 1.6, source: "gps", avgKmh: 39, maxKmh: 49, durationS: 250, idleS: 100 },
  { id: "trp_001", deviceId: "dev_0004", driverId: "drv_0005", start: "2026-08-31T06:40:00Z", distanceKm: 11.2, source: "gps", avgKmh: 51, maxKmh: 74, durationS: 890, idleS: 95 },
];

// ---------------------------------------------------------------------------
// Formatting — mirrors the real app's metric formatters (km, km/val, 1h 5m)
// ---------------------------------------------------------------------------

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const deviceLabel = (id: string) => DEVICES.find((d) => d.id === id)?.name ?? id;
const driverName = (id: string | null) => (id === null ? null : DRIVERS.find((d) => d.id === id)?.name ?? null);

// ---------------------------------------------------------------------------
// Trip route — a deterministic slice of REAL street geometry per trip, so the
// detail map always shows a path along actual roads (never through fields).
// ---------------------------------------------------------------------------

function tripPath(trip: DemoTrip): LngLat[] {
  const seed = parseInt(trip.id.slice(-3), 10);
  const loop = seed % 2 === 0 ? VILNIUS_LOOP : KAUNAS_LOOP;
  return routeSlice(loop, (seed * 37) % loop.length, 45);
}

function TripMap({ trip }: { trip: DemoTrip }) {
  const coords = React.useMemo(() => tripPath(trip), [trip]);
  const start = coords[0];
  const end = coords[coords.length - 1];
  return (
    <DemoMap
      className="h-[420px] w-full"
      interactive={false}
      fit={coords}
      routes={[{ id: trip.id, coords, color: "#7C7DF5", widthPx: 3.5 }]}
      pins={[
        { id: "start", at: start, label: "A", color: "#22C55E" },
        { id: "end", at: end, label: "B", color: "#EF4444" },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)", background: "var(--admin-surface-sunken)" };

type SortKey = "start" | "device" | "distance" | "avg" | "max";

function TripsPage() {
  const { t } = useTranslation("admin");
  const fmtKm = (km: number) => t("units.km", { n: Math.round(km * 10) / 10 });
  const fmtSpeed = (kmh: number) => `${Math.round(kmh)} ${t("units.kmh")}`;
  const [deviceId, setDeviceId] = React.useState("");
  const [driverQ, setDriverQ] = React.useState("");
  const [from, setFrom] = React.useState<Date | undefined>(new Date(2026, 7, 31));
  const [to, setTo] = React.useState<Date | undefined>(new Date(2026, 8, 1));
  const [selected, setSelected] = React.useState<DemoTrip | null>(TRIPS[4]); // the 19.4 km run
  const [driverOverride, setDriverOverride] = React.useState<Record<string, string | null>>({});
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "start", dir: "desc" });

  const tripDriverId = React.useCallback(
    (t: DemoTrip): string | null => (t.id in driverOverride ? driverOverride[t.id] : t.driverId),
    [driverOverride],
  );

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const rows = React.useMemo(() => {
    const ql = driverQ.trim().toLowerCase();
    const dayKey = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
    const list = TRIPS.filter((t) => {
      if (deviceId !== "" && t.deviceId !== deviceId) return false;
      if (ql !== "" && !(driverName(tripDriverId(t)) ?? "").toLowerCase().includes(ql)) return false;
      const day = dayKey(new Date(t.start));
      if (from && day < dayKey(from)) return false;
      if (to && day > dayKey(to)) return false;
      return true;
    });
    const val = (t: DemoTrip): number | string => {
      switch (sort.key) {
        case "start": return Date.parse(t.start);
        case "device": return deviceLabel(t.deviceId).toLowerCase();
        case "distance": return t.distanceKm;
        case "avg": return t.avgKmh;
        case "max": return t.maxKmh;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [deviceId, driverQ, from, to, sort, tripDriverId]);

  const sortTh = (key: SortKey, label: string, opts: { align?: "right"; hide?: boolean } = {}) => (
    <th
      className={`${th} ${opts.hide === true ? "hidden md:table-cell" : ""} ${opts.align === "right" ? "text-right" : ""}`}
      style={thStyle}
      aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-wider hover:text-[var(--admin-ink)]"
      >
        {label}
        {sort.key === key ? (
          sort.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );

  return (
    <div className="flex w-full flex-col gap-4 p-4 md:p-8">
      <PageHeader className="mb-0" title={t("trips.title")} description={t("trips.desc")}>
        <FilterLabel label={t("trips.device")}>
          <div className="w-44">
            <Combobox
              value={deviceId}
              onChange={setDeviceId}
              options={[
                { value: "", label: t("trips.allDevices") },
                ...DEVICES.map((d) => ({ value: d.id, label: d.name, hint: d.plate })),
              ]}
            />
          </div>
        </FilterLabel>
        <FilterLabel label={t("trips.driver")}>
          <div className="flex h-9 w-44 items-center gap-2 rounded-md border px-3 text-sm" style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)" }}>
            <Search className="h-3.5 w-3.5 opacity-60" aria-hidden />
            <input
              value={driverQ}
              onChange={(e) => setDriverQ(e.target.value)}
              placeholder={t("trips.searchDriver")}
              aria-label={t("trips.driver")}
              className="w-full bg-transparent outline-none placeholder:opacity-60"
              style={{ color: "var(--admin-ink)" }}
            />
          </div>
        </FilterLabel>
        <FilterLabel label={t("trips.from")}>
          <div className="w-40"><DatePicker value={from} onChange={setFrom} /></div>
        </FilterLabel>
        <FilterLabel label={t("trips.to")}>
          <div className="w-40"><DatePicker value={to} onChange={setTo} /></div>
        </FilterLabel>
      </PageHeader>

      {/* two-panel proportions: list carries the wide columns, detail map keeps 2/5 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* list */}
        <div className="admin-card overflow-hidden lg:col-span-3">
          <div className="max-h-[600px] overflow-auto">
            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
                {t("trips.empty")}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr>
                    {sortTh("start", t("trips.start"))}
                    {sortTh("device", t("trips.device"), { hide: true })}
                    <th className={th} style={thStyle}>{t("trips.driver")}</th>
                    {sortTh("distance", t("trips.distance"), { align: "right" })}
                    {sortTh("avg", t("trips.avgSpeed"), { align: "right", hide: true })}
                    {sortTh("max", t("trips.maxSpeed"), { align: "right", hide: true })}
                    <th className={`${th} hidden text-right md:table-cell`} style={thStyle}>{t("trips.duration")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((trip) => (
                    <tr
                      key={trip.id}
                      onClick={() => setSelected(trip)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(trip);
                        }
                      }}
                      aria-selected={selected?.id === trip.id}
                      className="admin-hairline-b cursor-pointer transition-colors hover:bg-[var(--admin-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]"
                      style={selected?.id === trip.id ? { background: "var(--admin-surface-sunken)" } : undefined}
                    >
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: "var(--admin-ink)" }}>
                        {fmtDateTime(trip.start)}
                        {trip.ongoing === true && <Badge tone="warning" className="ml-2">{t("trips.ongoing")}</Badge>}
                      </td>
                      <td className="hidden px-3 py-2.5 font-medium md:table-cell" style={{ color: "var(--admin-ink)" }}>{deviceLabel(trip.deviceId)}</td>
                      <td className="px-3 py-2.5" style={{ color: "var(--admin-ink-soft)" }}>{driverName(tripDriverId(trip)) ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: "var(--admin-ink)" }}>
                        {fmtKm(trip.distanceKm)}
                        <span className="ml-1 text-[10px] uppercase" style={{ color: "var(--admin-ink-soft)" }}>{trip.source === "odo" ? t("trips.odo") : t("trips.gps")}</span>
                      </td>
                      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell" style={{ color: "var(--admin-ink-soft)" }}>{fmtSpeed(trip.avgKmh)}</td>
                      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell" style={{ color: "var(--admin-ink-soft)" }}>{fmtSpeed(trip.maxKmh)}</td>
                      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell" style={{ color: "var(--admin-ink-soft)" }}>{fmtDuration(trip.durationS * 1000)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* detail */}
        <div className="admin-card overflow-hidden lg:col-span-2">
          <div className="flex h-full min-h-[420px] flex-col gap-2 p-2">
            {selected === null ? (
              <p className="m-auto text-sm" style={{ color: "var(--admin-ink-soft)" }}>{t("trips.pick")}</p>
            ) : (
              <>
                <div className="overflow-hidden rounded-md border" style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)" }}>
                  <TripMap trip={selected} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <Stat label={t("trips.duration")} value={fmtDuration(selected.durationS * 1000)} />
                  <Stat label={t("trips.distance")} value={fmtKm(selected.distanceKm)} />
                  <Stat label={t("trips.maxSpeed")} value={fmtSpeed(selected.maxKmh)} />
                  <Stat label={t("trips.idle")} value={fmtDuration(selected.idleS * 1000)} />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
                  {t("trips.driver")}:
                  <div className="flex-1">
                    <Combobox
                      value={tripDriverId(selected) ?? ""}
                      onChange={(v) => setDriverOverride((o) => ({ ...o, [selected.id]: v === "" ? null : v }))}
                      options={[{ value: "", label: t("trips.noDriver") }, ...DRIVERS.map((d) => ({ value: d.id, label: d.name }))]}
                    />
                  </div>
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
      {label}
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2" style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface-sunken)" }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{label}</div>
      <div className="tabular-nums font-medium" style={{ color: "var(--admin-ink)" }}>{value}</div>
    </div>
  );
}
