import { createFileRoute } from "@tanstack/react-router";
import { DEVICES, demoDetail, deviceName, localizeEvents, type DemoEvent, type Kind } from "@/lib/demo-events";
import * as React from "react";
import { useTranslation } from "react-i18next";
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

// kind → admin-locale key suffix (labels come from events.k.* in the product's translations)
const EVENT_KINDS: Kind[] = [
  "geofence",
  "overspeed",
  "ignition",
  "din_change",
  "power_cut",
  "low_battery",
  "panic",
  "device_offline",
  "fuel_theft",
];

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




// Static demo feed — newest first, like the product's cursor query.
// The detail column is derived from the payload at render, so it follows the UI language.

function EventsPage() {
  const { t, i18n } = useTranslation("admin");
  const events = React.useMemo(() => localizeEvents(i18n.language), [i18n.language]);
  const [kind, setKind] = React.useState("");
  const [severity, setSeverity] = React.useState<"" | Severity>("");
  const [deviceId, setDeviceId] = React.useState("");
  const [from, setFrom] = React.useState<Date | undefined>(undefined);
  const [to, setTo] = React.useState<Date | undefined>(undefined);
  const [open, setOpen] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(PAGE);

  const kindLabel = (k: Kind): string => t(`events.k.${k}`);
  const sevLabel = (sv: Severity): string => t(`events.sev.${sv}`);


  // filter changes restart the "cursor" — mirrors the product resetting the query
  const resetPage = () => setVisible(PAGE);

  const filtered = events.filter((e) => {
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

  const critical = rows.filter((r) => severityOf(r.kind) === "critical").length;
  const warning = rows.filter((r) => severityOf(r.kind) === "warning").length;
  const info = rows.length - critical - warning;

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader title={t("events.title")} description={t("events.desc")} className="mb-0">
        <FilterLabel label={t("events.kind")}>
          <div className="w-40">
            <Combobox value={kind} onChange={(v) => { setKind(v); resetPage(); }}
              options={[{ value: "", label: t("events.allKinds") }, ...EVENT_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t("events.severity")}>
          <div className="w-40">
            <Combobox value={severity} onChange={(v) => setSeverity(v as "" | Severity)}
              options={[{ value: "", label: t("events.allSeverities") }, ...SEVERITIES.map((sv) => ({ value: sv, label: sevLabel(sv) }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t("events.device")}>
          <div className="w-40">
            <Combobox value={deviceId} onChange={(v) => { setDeviceId(v); resetPage(); }}
              options={[{ value: "", label: t("events.allDevices") }, ...DEVICES.map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t("events.from")}>
          <div className="w-36"><DatePicker value={from} onChange={(d) => { setFrom(d); resetPage(); }} /></div>
        </FilterLabel>
        <FilterLabel label={t("events.to")}>
          <div className="w-36"><DatePicker value={to} onChange={(d) => { setTo(d); resetPage(); }} /></div>
        </FilterLabel>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t("events.stat.critical")} value={<span className="inline-flex items-center gap-2"><AlertOctagon className="h-5 w-5" style={{ color: "var(--admin-danger)" }} />{critical}</span>} />
        <StatCard label={t("events.stat.warning")} value={<span className="inline-flex items-center gap-2"><TrendingUp className="h-5 w-5" style={{ color: "var(--admin-warning)" }} />{warning}</span>} />
        <StatCard label={t("events.stat.info")} value={<span className="inline-flex items-center gap-2"><Activity className="h-5 w-5" style={{ color: "var(--admin-info)" }} />{info}</span>} />
      </div>
      {hasMore && (
        <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{t("events.statScope", { n: rows.length })}</p>
      )}

      <div className="admin-card overflow-hidden">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {rows.length > 0 ? t("events.filteredEmpty") : t("events.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--admin-surface-sunken)" }}>
                  <th className={th} style={thStyle}>{t("events.when")}</th>
                  <th className={th} style={thStyle}>{t("events.kind")}</th>
                  <th className={th} style={thStyle}>{t("events.device")}</th>
                  <th className={th} style={thStyle}>{t("events.detail")}</th>
                  <th className={`${th} hidden md:table-cell`} style={thStyle}>{t("events.severity")}</th>
                  <th className="px-4 py-2.5"><span className="sr-only">{t("events.details")}</span></th>
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
                        <td className="px-4 py-2.5"><Badge tone={TONE[sev]}>{kindLabel(r.kind)}</Badge></td>
                        <td className="px-4 py-2.5">{deviceName(r.deviceId)}</td>
                        <td className="px-4 py-2.5" style={{ color: "var(--admin-ink-soft)" }}>{demoDetail(t, r)}</td>
                        <td className="hidden px-4 py-2.5 md:table-cell" style={{ color: "var(--admin-ink-soft)" }}>
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <Icon className="h-3.5 w-3.5" style={{ color: SEV_COLOR[sev] }} aria-hidden />
                            {sevLabel(sev)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <AdminButton variant="ghost" size="sm" aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                            {open === r.id ? t("events.hide") : t("events.details")}
                          </AdminButton>
                        </td>
                      </tr>
                      {open === r.id && (
                        <tr>
                          <td colSpan={6} className="p-3" style={{ background: "var(--admin-surface-sunken)" }}>
                            <DemoEventDetails row={r} />
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
              {t("events.loadMore")}
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

/**
 * The demo's detail panel — the same labelled facts the product shows, not `JSON.stringify`.
 *
 * A prospect opening "details" here was shown our field names and our braces. The demo exists to
 * show the product; the product no longer looks like that, and a demo that lags the product is an
 * advertisement for the wrong thing.
 */
function DemoEventDetails({ row }: { row: DemoEvent }) {
  const { t, i18n } = useTranslation("admin");
  const p = row.payload as { name?: string; transition?: "enter" | "exit"; speedKmh?: number; maxSpeedKmh?: number; limitKmh?: number; lat?: number; lon?: number };
  const facts: { label: string; value: string }[] = [
    { label: t("events.f.when"), value: new Date(row.at).toLocaleString(i18n.language) },
    { label: t("events.f.device"), value: deviceName(row.deviceId) },
  ];
  if (p.lat !== undefined && p.lon !== undefined) {
    facts.push({ label: t("events.f.where"), value: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` });
  }
  if (p.name !== undefined) facts.push({ label: t("events.f.zone"), value: p.name });
  if (p.transition !== undefined) {
    facts.push({ label: t("events.f.direction"), value: t(`events.f.transition_${p.transition}`) });
  }
  if (p.speedKmh !== undefined) facts.push({ label: t("events.f.speed"), value: `${p.speedKmh} ${t("units.kmh")}` });
  // the worst moment of the breach, when the interval recorded one
  const peakKmh = p.maxSpeedKmh !== undefined && p.maxSpeedKmh > (p.speedKmh ?? 0) ? p.maxSpeedKmh : undefined;
  if (peakKmh !== undefined) facts.push({ label: t("events.f.peak"), value: `${peakKmh} ${t("units.kmh")}` });
  if (p.limitKmh !== undefined) facts.push({ label: t("events.f.limit"), value: `${p.limitKmh} ${t("units.kmh")}` });
  if (p.speedKmh !== undefined && p.limitKmh !== undefined) {
    // Measured from the WORST moment, not from the speed that tripped the rule — otherwise the
    // panel contradicts itself ("peak 97, limit 90, over by 3"). Same rule as the dashboard's
    // eventFacts; the two must agree, because the demo is a claim about the product.
    facts.push({ label: t("events.f.over"), value: `${(peakKmh ?? p.speedKmh) - p.limitKmh} ${t("units.kmh")}` });
  }

  return (
    <div className="admin-card p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>
        {t("events.f.title")}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-dashed py-1" style={{ borderColor: "var(--admin-hairline)" }}>
            <dt className="shrink-0 text-[11px] uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{f.label}</dt>
            <dd className="min-w-0 truncate text-right text-sm" style={{ color: "var(--admin-ink)" }}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
