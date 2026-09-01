import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Activity, AlertOctagon, TrendingUp } from "lucide-react";
import { Badge, PageHeader, StatCard } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { fmtDateTime } from "@/lib/admin-format";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
});

// Same table skin as the events page — the archive reads as the same surface
const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)" };

type Severity = "critical" | "warning" | "info";
type Kind = "geofence" | "overspeed" | "low_battery" | "device_offline";

const KIND_LABELS: Record<Kind, string> = {
  geofence: "Geozona",
  overspeed: "Greičio viršijimas",
  low_battery: "Žema baterija",
  device_offline: "Įrenginys neprisijungęs",
};
const KINDS = Object.keys(KIND_LABELS) as Kind[];

const SEV_LABELS: Record<Severity, string> = { critical: "Kritinis", warning: "Įspėjimas", info: "Info" };
const SEVERITIES: Severity[] = ["critical", "warning", "info"];

const severityOf = (kind: Kind): Severity =>
  kind === "overspeed" || kind === "low_battery" || kind === "device_offline" ? "warning" : "info";

const TONE: Record<Severity, "danger" | "warning" | "info"> = { critical: "danger", warning: "warning", info: "info" };
const SEV_ICON: Record<Severity, typeof Activity> = { critical: AlertOctagon, warning: TrendingUp, info: Activity };
const SEV_COLOR: Record<Severity, string> = {
  critical: "var(--admin-danger)",
  warning: "var(--admin-warning)",
  info: "var(--admin-info)",
};

type DemoNotification = { id: string; at: string; kind: Kind; device: string; message: string };

// Static archive — newest first; each row is a bell notification that has already been delivered
const DATA: DemoNotification[] = [
  { id: "nt_12", at: "2026-09-01T07:42:00Z", kind: "overspeed", device: "Van 03", message: "Viršytas greitis: 105 km/val > 90 km/val" },
  { id: "nt_11", at: "2026-09-01T07:15:00Z", kind: "geofence", device: "Van 03", message: "Išvažiavimas iš zonos „Testas“" },
  { id: "nt_10", at: "2026-09-01T06:58:00Z", kind: "geofence", device: "Sprinter 07", message: "Įvažiavimas į zoną „STL bazė“" },
  { id: "nt_09", at: "2026-09-01T06:31:00Z", kind: "overspeed", device: "Truck 12", message: "Viršytas greitis: 97 km/val > 90 km/val" },
  { id: "nt_08", at: "2026-09-01T05:54:00Z", kind: "geofence", device: "Sprinter 07", message: "Išvažiavimas iš zonos „STL bazė“" },
  { id: "nt_07", at: "2026-08-31T19:22:00Z", kind: "geofence", device: "Van 03", message: "Įvažiavimas į zoną „Testas“" },
  { id: "nt_06", at: "2026-08-31T18:47:00Z", kind: "overspeed", device: "Van 03", message: "Viršytas greitis: 112 km/val > 90 km/val" },
  { id: "nt_05", at: "2026-08-31T17:36:00Z", kind: "geofence", device: "Van 08", message: "Išvažiavimas iš zonos „Testas“" },
  { id: "nt_04", at: "2026-08-31T16:05:00Z", kind: "geofence", device: "Truck 12", message: "Įvažiavimas į zoną „STL bazė“" },
  { id: "nt_03", at: "2026-08-31T14:58:00Z", kind: "overspeed", device: "Sprinter 07", message: "Viršytas greitis: 94 km/val > 90 km/val" },
  { id: "nt_02", at: "2026-08-31T11:49:00Z", kind: "geofence", device: "Van 08", message: "Įvažiavimas į zoną „Testas“" },
  { id: "nt_01", at: "2026-08-31T09:34:00Z", kind: "overspeed", device: "Van 08", message: "Viršytas greitis: 101 km/val > 90 km/val" },
];

function NotificationsPage() {
  const [kind, setKind] = React.useState("");
  const [severity, setSeverity] = React.useState<"" | Severity>("");
  const [from, setFrom] = React.useState<Date | undefined>(undefined);
  const [to, setTo] = React.useState<Date | undefined>(undefined);

  const shown = DATA.filter((n) => {
    if (kind && n.kind !== kind) return false;
    if (severity && severityOf(n.kind) !== severity) return false;
    const day = n.at.slice(0, 10);
    if (from && day < isoDay(from)) return false;
    if (to && day > isoDay(to)) return false;
    return true;
  });

  const critical = DATA.filter((n) => severityOf(n.kind) === "critical").length;
  const warning = DATA.filter((n) => severityOf(n.kind) === "warning").length;
  const info = DATA.length - critical - warning;

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader title="Pranešimai" description="Pranešimų archyvas: viskas, kas buvo pristatyta per varpelį." className="mb-0">
        <FilterLabel label="Tipas">
          <div className="w-40">
            <Combobox value={kind} onChange={setKind}
              options={[{ value: "", label: "Visi tipai" }, ...KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label="Rimtumas">
          <div className="w-40">
            <Combobox value={severity} onChange={(v) => setSeverity(v as "" | Severity)}
              options={[{ value: "", label: "Visi lygiai" }, ...SEVERITIES.map((sv) => ({ value: sv, label: SEV_LABELS[sv] }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label="Nuo">
          <div className="w-36"><DatePicker value={from} onChange={setFrom} /></div>
        </FilterLabel>
        <FilterLabel label="Iki">
          <div className="w-36"><DatePicker value={to} onChange={setTo} /></div>
        </FilterLabel>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Kritiniai" value={<span className="inline-flex items-center gap-2"><AlertOctagon className="h-5 w-5" style={{ color: "var(--admin-danger)" }} />{critical}</span>} />
        <StatCard label="Įspėjimai" value={<span className="inline-flex items-center gap-2"><TrendingUp className="h-5 w-5" style={{ color: "var(--admin-warning)" }} />{warning}</span>} />
        <StatCard label="Informaciniai" value={<span className="inline-flex items-center gap-2"><Activity className="h-5 w-5" style={{ color: "var(--admin-info)" }} />{info}</span>} />
      </div>

      <div className="admin-card overflow-hidden">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            Pagal šiuos filtrus pranešimų nėra.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--admin-surface-sunken)" }}>
                  <th className={th} style={thStyle}>Kada</th>
                  <th className={th} style={thStyle}>Tipas</th>
                  <th className={th} style={thStyle}>Įrenginys</th>
                  <th className={th} style={thStyle}>Pranešimas</th>
                  <th className={`${th} hidden md:table-cell`} style={thStyle}>Rimtumas</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--admin-ink)" }}>
                {shown.map((n) => {
                  const sev = severityOf(n.kind);
                  const Icon = SEV_ICON[sev];
                  return (
                    <tr key={n.id} className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]">
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>{fmtDateTime(n.at)}</td>
                      <td className="px-4 py-2.5"><Badge tone={TONE[sev]}>{KIND_LABELS[n.kind]}</Badge></td>
                      <td className="px-4 py-2.5">{n.device}</td>
                      <td className="px-4 py-2.5" style={{ color: "var(--admin-ink-soft)" }}>{n.message}</td>
                      <td className="hidden px-4 py-2.5 md:table-cell" style={{ color: "var(--admin-ink-soft)" }}>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Icon className="h-3.5 w-3.5" style={{ color: SEV_COLOR[sev] }} aria-hidden />
                          {SEV_LABELS[sev]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
