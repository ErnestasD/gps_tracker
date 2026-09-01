import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Activity, AlertOctagon, TrendingUp } from "lucide-react";
import { AdminButton, Badge, PageHeader, StatCard } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { fmtDateTime } from "@/lib/admin-format";

export const Route = createFileRoute("/app/events")({
  component: EventsPage,
});

const PAGE = 10;

// Mirrors the product's events table skin (shared DataTable cannot page a cursor there either)
const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)" };

type Severity = "critical" | "warning" | "info";
type Kind =
  | "geofence"
  | "overspeed"
  | "ignition"
  | "din_change"
  | "power_cut"
  | "low_battery"
  | "panic"
  | "device_offline"
  | "fuel_theft";

const KIND_LABELS: Record<Kind, string> = {
  geofence: "Geozona",
  overspeed: "Greičio viršijimas",
  ignition: "Uždegimas",
  din_change: "Įvesties pokytis",
  power_cut: "Maitinimo nutrūkimas",
  low_battery: "Žema baterija",
  panic: "Pavojaus mygtukas",
  device_offline: "Įrenginys neprisijungęs",
  fuel_theft: "Kuro vagystė",
};
const EVENT_KINDS = Object.keys(KIND_LABELS) as Kind[];

const SEV_LABELS: Record<Severity, string> = { critical: "Kritinis", warning: "Įspėjimas", info: "Info" };
const SEVERITIES: Severity[] = ["critical", "warning", "info"];

const severityOf = (kind: Kind): Severity =>
  kind === "panic" || kind === "power_cut"
    ? "critical"
    : kind === "overspeed" || kind === "low_battery" || kind === "device_offline"
      ? "warning"
      : "info";

const TONE: Record<Severity, "danger" | "warning" | "info"> = { critical: "danger", warning: "warning", info: "info" };
const SEV_ICON: Record<Severity, typeof Activity> = { critical: AlertOctagon, warning: TrendingUp, info: Activity };
const SEV_COLOR: Record<Severity, string> = {
  critical: "var(--admin-danger)",
  warning: "var(--admin-warning)",
  info: "var(--admin-info)",
};

type DemoEvent = {
  id: string;
  at: string;
  kind: Kind;
  deviceId: string;
  detail: string;
  payload: Record<string, unknown>;
};

const DEVICES = [
  { id: "dev_1", name: "Van 03" },
  { id: "dev_2", name: "Sprinter 07" },
  { id: "dev_3", name: "Van 08" },
  { id: "dev_4", name: "Truck 12" },
];

const geo = (name: string, transition: "enter" | "exit", lat: number, lon: number) => ({
  geofenceId: name === "Testas" ? "gf_01" : "gf_02",
  name,
  transition,
  lat,
  lon,
});
const speed = (speedKmh: number, limitKmh: number, lat: number, lon: number) => ({ speedKmh, limitKmh, lat, lon });

// Static demo feed — newest first, like the product's cursor query
const DATA: DemoEvent[] = [
  { id: "ev_14", at: "2026-09-01T07:42:00Z", kind: "overspeed", deviceId: "dev_1", detail: "105 km/val > 90 km/val", payload: speed(105, 90, 54.7126, 25.2621) },
  { id: "ev_13", at: "2026-09-01T07:15:00Z", kind: "geofence", deviceId: "dev_1", detail: "Testas · išvažiavimas", payload: geo("Testas", "exit", 54.6721, 25.2797) },
  { id: "ev_12", at: "2026-09-01T06:58:00Z", kind: "geofence", deviceId: "dev_2", detail: "STL bazė · įvažiavimas", payload: geo("STL bazė", "enter", 54.6384, 25.1912) },
  { id: "ev_11", at: "2026-09-01T06:31:00Z", kind: "overspeed", deviceId: "dev_4", detail: "97 km/val > 90 km/val", payload: speed(97, 90, 54.8942, 23.9036) },
  { id: "ev_10", at: "2026-09-01T05:54:00Z", kind: "geofence", deviceId: "dev_2", detail: "STL bazė · išvažiavimas", payload: geo("STL bazė", "exit", 54.6381, 25.1908) },
  { id: "ev_09", at: "2026-08-31T19:22:00Z", kind: "geofence", deviceId: "dev_1", detail: "Testas · įvažiavimas", payload: geo("Testas", "enter", 54.6725, 25.2801) },
  { id: "ev_08", at: "2026-08-31T18:47:00Z", kind: "overspeed", deviceId: "dev_1", detail: "112 km/val > 90 km/val", payload: speed(112, 90, 55.0034, 24.9871) },
  { id: "ev_07", at: "2026-08-31T17:36:00Z", kind: "geofence", deviceId: "dev_3", detail: "Testas · išvažiavimas", payload: geo("Testas", "exit", 54.6718, 25.2793) },
  { id: "ev_06", at: "2026-08-31T16:05:00Z", kind: "geofence", deviceId: "dev_4", detail: "STL bazė · įvažiavimas", payload: geo("STL bazė", "enter", 54.6386, 25.1915) },
  { id: "ev_05", at: "2026-08-31T14:58:00Z", kind: "overspeed", deviceId: "dev_2", detail: "94 km/val > 90 km/val", payload: speed(94, 90, 54.9214, 23.9402) },
  { id: "ev_04", at: "2026-08-31T13:21:00Z", kind: "geofence", deviceId: "dev_4", detail: "STL bazė · išvažiavimas", payload: geo("STL bazė", "exit", 54.6379, 25.1904) },
  { id: "ev_03", at: "2026-08-31T11:49:00Z", kind: "geofence", deviceId: "dev_3", detail: "Testas · įvažiavimas", payload: geo("Testas", "enter", 54.6723, 25.2799) },
  { id: "ev_02", at: "2026-08-31T09:34:00Z", kind: "overspeed", deviceId: "dev_3", detail: "101 km/val > 90 km/val", payload: speed(101, 90, 54.7311, 25.3527) },
  { id: "ev_01", at: "2026-08-31T08:02:00Z", kind: "geofence", deviceId: "dev_1", detail: "Testas · įvažiavimas", payload: geo("Testas", "enter", 54.6726, 25.2802) },
];

function EventsPage() {
  const [kind, setKind] = React.useState("");
  const [severity, setSeverity] = React.useState<"" | Severity>("");
  const [deviceId, setDeviceId] = React.useState("");
  const [from, setFrom] = React.useState<Date | undefined>(undefined);
  const [to, setTo] = React.useState<Date | undefined>(undefined);
  const [open, setOpen] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(PAGE);

  // filter changes restart the "cursor" — mirrors the product resetting the query
  const resetPage = () => setVisible(PAGE);

  const filtered = DATA.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (deviceId && e.deviceId !== deviceId) return false;
    const day = e.at.slice(0, 10);
    if (from && day < isoDay(from)) return false;
    if (to && day > isoDay(to)) return false;
    return true;
  });

  const rows = filtered.slice(0, visible);
  const hasMore = filtered.length > rows.length;
  // severity is a client-side lens over the loaded rows only — same as the product
  const shown = severity === "" ? rows : rows.filter((r) => severityOf(r.kind) === severity);
  const deviceName = (id: string): string => DEVICES.find((d) => d.id === id)?.name ?? id;

  const critical = rows.filter((r) => severityOf(r.kind) === "critical").length;
  const warning = rows.filter((r) => severityOf(r.kind) === "warning").length;
  const info = rows.length - critical - warning;

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader title="Įvykiai" description="Signalų srautas: geozonos, greičio viršijimai, pavojaus mygtukas, ryšio dingimas." className="mb-0">
        <FilterLabel label="Tipas">
          <div className="w-40">
            <Combobox value={kind} onChange={(v) => { setKind(v); resetPage(); }}
              options={[{ value: "", label: "Visi tipai" }, ...EVENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label="Rimtumas">
          <div className="w-40">
            <Combobox value={severity} onChange={(v) => setSeverity(v as "" | Severity)}
              options={[{ value: "", label: "Visi lygiai" }, ...SEVERITIES.map((sv) => ({ value: sv, label: SEV_LABELS[sv] }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label="Įrenginys">
          <div className="w-40">
            <Combobox value={deviceId} onChange={(v) => { setDeviceId(v); resetPage(); }}
              options={[{ value: "", label: "Visi įrenginiai" }, ...DEVICES.map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label="Nuo">
          <div className="w-36"><DatePicker value={from} onChange={(d) => { setFrom(d); resetPage(); }} /></div>
        </FilterLabel>
        <FilterLabel label="Iki">
          <div className="w-36"><DatePicker value={to} onChange={(d) => { setTo(d); resetPage(); }} /></div>
        </FilterLabel>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Kritiniai" value={<span className="inline-flex items-center gap-2"><AlertOctagon className="h-5 w-5" style={{ color: "var(--admin-danger)" }} />{critical}</span>} />
        <StatCard label="Įspėjimai" value={<span className="inline-flex items-center gap-2"><TrendingUp className="h-5 w-5" style={{ color: "var(--admin-warning)" }} />{warning}</span>} />
        <StatCard label="Informaciniai" value={<span className="inline-flex items-center gap-2"><Activity className="h-5 w-5" style={{ color: "var(--admin-info)" }} />{info}</span>} />
      </div>
      {hasMore && (
        <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Skaičiai atspindi {rows.length} įkeltų įvykių.</p>
      )}

      <div className="admin-card overflow-hidden">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {rows.length > 0
              ? "Įkeltame lange atitinkančių įvykių nėra — įkelkite daugiau, kad ieškotumėte toliau."
              : "Pagal šiuos filtrus įvykių nėra."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--admin-surface-sunken)" }}>
                  <th className={th} style={thStyle}>Kada</th>
                  <th className={th} style={thStyle}>Tipas</th>
                  <th className={th} style={thStyle}>Įrenginys</th>
                  <th className={th} style={thStyle}>Detalė</th>
                  <th className={`${th} hidden md:table-cell`} style={thStyle}>Rimtumas</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Detalės</span></th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--admin-ink)" }}>
                {shown.map((r) => {
                  const sev = severityOf(r.kind);
                  const Icon = SEV_ICON[sev];
                  return (
                    <React.Fragment key={r.id}>
                      <tr className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]">
                        <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>{fmtDateTime(r.at)}</td>
                        <td className="px-4 py-2.5"><Badge tone={TONE[sev]}>{KIND_LABELS[r.kind]}</Badge></td>
                        <td className="px-4 py-2.5">{deviceName(r.deviceId)}</td>
                        <td className="px-4 py-2.5" style={{ color: "var(--admin-ink-soft)" }}>{r.detail}</td>
                        <td className="hidden px-4 py-2.5 md:table-cell" style={{ color: "var(--admin-ink-soft)" }}>
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <Icon className="h-3.5 w-3.5" style={{ color: SEV_COLOR[sev] }} aria-hidden />
                            {SEV_LABELS[sev]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <AdminButton variant="ghost" size="sm" aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                            {open === r.id ? "Slėpti" : "Detalės"}
                          </AdminButton>
                        </td>
                      </tr>
                      {open === r.id && (
                        <tr>
                          <td colSpan={6} className="p-3" style={{ background: "var(--admin-surface-sunken)" }}>
                            <pre className="max-h-64 overflow-auto rounded-md border p-2 text-xs" style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}>{JSON.stringify(r.payload, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="admin-hairline-t p-3 text-center">
            <AdminButton variant="secondary" size="sm" onClick={() => setVisible((v) => v + PAGE)}>
              Rodyti daugiau
            </AdminButton>
          </div>
        )}
      </div>
    </div>
  );
}

function isoDay(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function FilterLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
      {label}
      {children}
    </label>
  );
}
