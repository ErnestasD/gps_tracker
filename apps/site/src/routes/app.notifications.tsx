import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Activity, AlertOctagon, TrendingUp } from "lucide-react";
import { Badge, PageHeader, StatCard } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { fmtDateTime } from "@/lib/admin-format";
import { LANGUAGES, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
});

// Same table skin as the events page — the archive reads as the same surface
const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)" };

type Severity = "critical" | "warning" | "info";
type Kind = "geofence" | "overspeed" | "low_battery" | "device_offline";

// kind labels come from the product's events.k.* translation keys
const KINDS: Kind[] = ["geofence", "overspeed", "low_battery", "device_offline"];

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

// Demo-only strings that have no counterpart in the product's admin locale JSONs
const L: Record<Lang, {
  desc: string;
  message: string;
  empty: string;
  overspeed: (speedKmh: number, limitKmh: number, kmh: string) => string;
  zoneEnter: (zone: string) => string;
  zoneExit: (zone: string) => string;
}> = {
  lt: {
    desc: "Pranešimų archyvas: visi pranešimai, rodyti varpelio lange.",
    message: "Pranešimas",
    empty: "Pagal šiuos filtrus pranešimų nėra.",
    overspeed: (s, l, kmh) => `Greičio viršijimas: ${s} ${kmh} > ${l} ${kmh}`,
    zoneEnter: (z) => `Įvažiavo į geozoną „${z}“`,
    zoneExit: (z) => `Išvažiavo iš geozonos „${z}“`,
  },
  en: {
    desc: "Notification archive: everything delivered through the bell.",
    message: "Message",
    empty: "No notifications match these filters.",
    overspeed: (s, l, kmh) => `Overspeed: ${s} ${kmh} > ${l} ${kmh}`,
    zoneEnter: (z) => `Entered zone “${z}”`,
    zoneExit: (z) => `Exited zone “${z}”`,
  },
  pl: {
    desc: "Archiwum powiadomień: wszystko, co dostarczono przez dzwonek.",
    message: "Powiadomienie",
    empty: "Brak powiadomień dla tych filtrów.",
    overspeed: (s, l, kmh) => `Przekroczenie prędkości: ${s} ${kmh} > ${l} ${kmh}`,
    zoneEnter: (z) => `Wjazd do strefy „${z}”`,
    zoneExit: (z) => `Wyjazd ze strefy „${z}”`,
  },
  de: {
    desc: "Benachrichtigungsarchiv: alles, was über die Glocke zugestellt wurde.",
    message: "Meldung",
    empty: "Keine Benachrichtigungen für diese Filter.",
    overspeed: (s, l, kmh) => `Geschwindigkeit überschritten: ${s} ${kmh} > ${l} ${kmh}`,
    zoneEnter: (z) => `Einfahrt in Zone „${z}“`,
    zoneExit: (z) => `Ausfahrt aus Zone „${z}“`,
  },
};

type Msg =
  | { type: "overspeed"; speedKmh: number; limitKmh: number }
  | { type: "zone"; transition: "enter" | "exit"; zone: string };

type DemoNotification = { id: string; at: string; kind: Kind; device: string; msg: Msg };

const over = (speedKmh: number, limitKmh: number): Msg => ({ type: "overspeed", speedKmh, limitKmh });
const zone = (transition: "enter" | "exit", z: string): Msg => ({ type: "zone", transition, zone: z });

// Static archive — newest first; each row is a bell notification that has already been delivered.
// Message text is derived at render so it follows the UI language (zone names stay data).
const DATA: DemoNotification[] = [
  { id: "nt_12", at: "2026-09-01T07:42:00Z", kind: "overspeed", device: "Van 03", msg: over(105, 90) },
  { id: "nt_11", at: "2026-09-01T07:15:00Z", kind: "geofence", device: "Van 03", msg: zone("exit", "Testas") },
  { id: "nt_10", at: "2026-09-01T06:58:00Z", kind: "geofence", device: "Sprinter 07", msg: zone("enter", "STL bazė") },
  { id: "nt_09", at: "2026-09-01T06:31:00Z", kind: "overspeed", device: "Truck 12", msg: over(97, 90) },
  { id: "nt_08", at: "2026-09-01T05:54:00Z", kind: "geofence", device: "Sprinter 07", msg: zone("exit", "STL bazė") },
  { id: "nt_07", at: "2026-08-31T19:22:00Z", kind: "geofence", device: "Van 03", msg: zone("enter", "Testas") },
  { id: "nt_06", at: "2026-08-31T18:47:00Z", kind: "overspeed", device: "Van 03", msg: over(112, 90) },
  { id: "nt_05", at: "2026-08-31T17:36:00Z", kind: "geofence", device: "Van 08", msg: zone("exit", "Testas") },
  { id: "nt_04", at: "2026-08-31T16:05:00Z", kind: "geofence", device: "Truck 12", msg: zone("enter", "STL bazė") },
  { id: "nt_03", at: "2026-08-31T14:58:00Z", kind: "overspeed", device: "Sprinter 07", msg: over(94, 90) },
  { id: "nt_02", at: "2026-08-31T11:49:00Z", kind: "geofence", device: "Van 08", msg: zone("enter", "Testas") },
  { id: "nt_01", at: "2026-08-31T09:34:00Z", kind: "overspeed", device: "Van 08", msg: over(101, 90) },
];

function NotificationsPage() {
  const { t, i18n } = useTranslation("admin");
  const lang: Lang = LANGUAGES.includes(i18n.resolvedLanguage as Lang) ? (i18n.resolvedLanguage as Lang) : "lt";
  const ui = L[lang];

  const [kind, setKind] = React.useState("");
  const [severity, setSeverity] = React.useState<"" | Severity>("");
  const [from, setFrom] = React.useState<Date | undefined>(undefined);
  const [to, setTo] = React.useState<Date | undefined>(undefined);

  const kindLabel = (k: Kind): string => t(`events.k.${k}`);
  const sevLabel = (sv: Severity): string => t(`events.sev.${sv}`);
  const msgText = (m: Msg): string =>
    m.type === "overspeed"
      ? ui.overspeed(m.speedKmh, m.limitKmh, t("units.kmh"))
      : m.transition === "enter"
        ? ui.zoneEnter(m.zone)
        : ui.zoneExit(m.zone);

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
      <PageHeader title={t("bell.title")} description={ui.desc} className="mb-0">
        <FilterLabel label={t("events.kind")}>
          <div className="w-40">
            <Combobox value={kind} onChange={setKind}
              options={[{ value: "", label: t("events.allKinds") }, ...KINDS.map((k) => ({ value: k, label: kindLabel(k) }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t("events.severity")}>
          <div className="w-40">
            <Combobox value={severity} onChange={(v) => setSeverity(v as "" | Severity)}
              options={[{ value: "", label: t("events.allSeverities") }, ...SEVERITIES.map((sv) => ({ value: sv, label: sevLabel(sv) }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t("events.from")}>
          <div className="w-36"><DatePicker value={from} onChange={setFrom} /></div>
        </FilterLabel>
        <FilterLabel label={t("events.to")}>
          <div className="w-36"><DatePicker value={to} onChange={setTo} /></div>
        </FilterLabel>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t("events.stat.critical")} value={<span className="inline-flex items-center gap-2"><AlertOctagon className="h-5 w-5" style={{ color: "var(--admin-danger)" }} />{critical}</span>} />
        <StatCard label={t("events.stat.warning")} value={<span className="inline-flex items-center gap-2"><TrendingUp className="h-5 w-5" style={{ color: "var(--admin-warning)" }} />{warning}</span>} />
        <StatCard label={t("events.stat.info")} value={<span className="inline-flex items-center gap-2"><Activity className="h-5 w-5" style={{ color: "var(--admin-info)" }} />{info}</span>} />
      </div>

      <div className="admin-card overflow-hidden">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {ui.empty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--admin-surface-sunken)" }}>
                  <th className={th} style={thStyle}>{t("events.when")}</th>
                  <th className={th} style={thStyle}>{t("events.kind")}</th>
                  <th className={th} style={thStyle}>{t("events.device")}</th>
                  <th className={th} style={thStyle}>{ui.message}</th>
                  <th className={`${th} hidden md:table-cell`} style={thStyle}>{t("events.severity")}</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--admin-ink)" }}>
                {shown.map((n) => {
                  const sev = severityOf(n.kind);
                  const Icon = SEV_ICON[sev];
                  return (
                    <tr key={n.id} className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]">
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>{fmtDateTime(n.at)}</td>
                      <td className="px-4 py-2.5"><Badge tone={TONE[sev]}>{kindLabel(n.kind)}</Badge></td>
                      <td className="px-4 py-2.5">{n.device}</td>
                      <td className="px-4 py-2.5" style={{ color: "var(--admin-ink-soft)" }}>{msgText(n.msg)}</td>
                      <td className="hidden px-4 py-2.5 md:table-cell" style={{ color: "var(--admin-ink-soft)" }}>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Icon className="h-3.5 w-3.5" style={{ color: SEV_COLOR[sev] }} aria-hidden />
                          {sevLabel(sev)}
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
