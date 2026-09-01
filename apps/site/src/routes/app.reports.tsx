import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AdminButton, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { LANGUAGES, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

// Report types as in the real product — labels come from reports.t.* in the admin namespace
const REPORT_TYPE_VALUES = ["mileage", "trips", "stops", "overspeed", "geofence", "engine_hours"] as const;

const ACCOUNTS = [
  { value: "acc_baltlog", label: "UAB Baltijos logistika" },
  { value: "acc_kensa", label: "UAB Kensa transportas" },
];

// Device names are demo DATA — only the "all devices" option is translated
const DEVICES = [
  { value: "dev_0001", label: "Sprinter 01" },
  { value: "dev_0002", label: "Transit 02" },
  { value: "dev_0003", label: "Van 03" },
  { value: "dev_0004", label: "Truck 04" },
];

// Mileage report result — columns mirror reports.col.*: Diena / Įrenginys / Kelionės / Atstumas (km)
const RESULT_COL_KEYS = ["day", "deviceId", "trips", "distanceKm"] as const;
const RESULT_ROWS: [string, string, number, string][] = [
  ["2026-08-31", "Sprinter 01", 6, "212.4"],
  ["2026-08-31", "Transit 02", 4, "148.9"],
  ["2026-08-31", "Van 03", 7, "263.1"],
  ["2026-08-31", "Truck 04", 2, "418.6"],
  ["2026-09-01", "Sprinter 01", 5, "187.3"],
  ["2026-09-01", "Transit 02", 3, "96.2"],
  ["2026-09-01", "Van 03", 6, "241.8"],
  ["2026-09-01", "Truck 04", 1, "402.0"],
];

interface Scheduled {
  id: string;
  /** report type value — rendered via reports.t.* */
  type: (typeof REPORT_TYPE_VALUES)[number];
  cadence: { kind: "daily" | "weekly"; weekday?: number; hour: string };
  recipients: string[];
}

const SCHEDULED_SEED: Scheduled[] = [
  { id: "s1", type: "trips", cadence: { kind: "daily", hour: "06:00" }, recipients: ["ops@baltlog.lt"] },
  { id: "s2", type: "mileage", cadence: { kind: "weekly", weekday: 1, hour: "05:00" }, recipients: ["vadyba@baltlog.lt", "buhalterija@baltlog.lt"] },
];

// Demo-only strings (toasts for the pretend exports) — not part of the product locale files
const L: Record<Lang, { csvToast: string; pdfToast: string }> = {
  en: { csvToast: "CSV exported (demo)", pdfToast: "PDF exported (demo)" },
  lt: { csvToast: "CSV eksportuota (demo)", pdfToast: "PDF eksportuota (demo)" },
  pl: { csvToast: "CSV wyeksportowano (demo)", pdfToast: "PDF wyeksportowano (demo)" },
  de: { csvToast: "CSV exportiert (demo)", pdfToast: "PDF exportiert (demo)" },
};

function ReportsPage() {
  const { t, i18n } = useTranslation("admin");
  const lang = (i18n.resolvedLanguage ?? "lt").slice(0, 2) as Lang;
  const l = L[LANGUAGES.includes(lang) ? lang : "lt"];
  const [type, setType] = React.useState("mileage");
  const [account, setAccount] = React.useState("acc_baltlog");
  const [deviceId, setDeviceId] = React.useState("");
  const [from, setFrom] = React.useState<Date | undefined>(new Date(2026, 7, 31));
  const [to, setTo] = React.useState<Date | undefined>(new Date(2026, 8, 1));
  const [generated, setGenerated] = React.useState(false);
  const [scheduled, setScheduled] = React.useState<Scheduled[]>(SCHEDULED_SEED);

  const reportTypeOptions = REPORT_TYPE_VALUES.map((v) => ({ value: v, label: t(`reports.t.${v}`) }));
  const deviceOptions = [{ value: "", label: t("reports.allDevices") }, ...DEVICES];

  const cadenceText = (c: Scheduled["cadence"]) =>
    c.kind === "daily"
      ? `${t("scheduled.daily")} · ${c.hour} UTC`
      : `${t("scheduled.weekly")} · ${t(`scheduled.wd.${c.weekday ?? 1}`)} · ${c.hour} UTC`;

  const canRun = from !== undefined && to !== undefined;
  const rows = deviceId === ""
    ? RESULT_ROWS
    : RESULT_ROWS.filter((r) => r[1] === DEVICES.find((d) => d.value === deviceId)?.label);

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader title={t("reports.title")} description={t("reports.desc")} className="mb-0" />

      {/* generator card — run/export actions live in the card header (mirrors the real ReportsPage) */}
      <div className="admin-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold" style={{ color: "var(--admin-ink)" }}>{t("reports.run")}</h2>
          <div className="flex flex-wrap gap-2">
            <AdminButton disabled={!canRun} onClick={() => setGenerated(true)}>{t("reports.runBtn")}</AdminButton>
            <AdminButton variant="secondary" disabled={!generated} onClick={() => toast.success(l.csvToast)}>{t("reports.exportCsv")}</AdminButton>
            <AdminButton variant="secondary" disabled={!generated} onClick={() => toast.success(l.pdfToast)}>{t("reports.exportPdf")}</AdminButton>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("reports.type")}>
            <div className="w-44"><Combobox value={type} onChange={(v) => { setType(v); setGenerated(false); }} options={reportTypeOptions} /></div>
          </Field>
          <Field label={t("reports.account")}>
            <div className="w-44"><Combobox value={account} onChange={setAccount} options={ACCOUNTS} /></div>
          </Field>
          <Field label={t("reports.device")}>
            <div className="w-44"><Combobox value={deviceId} onChange={setDeviceId} options={deviceOptions} /></div>
          </Field>
          <Field label={t("reports.from")}>
            <div className="w-40"><DatePicker value={from} onChange={setFrom} /></div>
          </Field>
          <Field label={t("reports.to")}>
            <div className="w-40"><DatePicker value={to} onChange={setTo} /></div>
          </Field>
        </div>
      </div>

      {/* result card */}
      <div className="admin-card overflow-hidden">
        <h2 className="admin-hairline-b px-4 py-3 font-semibold md:px-5" style={{ color: "var(--admin-ink)" }}>{t("reports.result")}</h2>
        {!generated ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {t("reports.idle")}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {t("reports.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "var(--admin-surface-sunken)" }}>
                <tr className="text-left text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                  {RESULT_COL_KEYS.map((c) => <th key={c} className="px-3 py-2 font-medium md:px-4">{t(`reports.col.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody style={{ color: "var(--admin-ink)" }}>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--admin-hairline)" }}>
                    {r.map((cell, j) => <td key={j} className="px-3 py-2 tabular-nums md:px-4">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* scheduled reports card (mirrors ScheduledReportsCard tiles) */}
      <div className="admin-card space-y-3 p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold" style={{ color: "var(--admin-ink)" }}>{t("scheduled.title")}</h2>
          <AdminButton
            size="sm"
            variant="secondary"
            onClick={() =>
              setScheduled((xs) => [
                ...xs,
                { id: `s${Date.now()}`, type: "stops", cadence: { kind: "daily", hour: "07:00" }, recipients: ["dispecerine@baltlog.lt"] },
              ])
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("scheduled.add")}
          </AdminButton>
        </div>
        {scheduled.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>{t("scheduled.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {scheduled.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink)" }}>
                <FileText className="h-4 w-4 shrink-0" style={{ color: "var(--admin-brand)" }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t(`reports.t.${s.type}`)}</div>
                  <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{cadenceText(s.cadence)}</div>
                </div>
                <div className="flex max-w-[50%] flex-wrap justify-end gap-1">
                  {s.recipients.map((r) => <Badge key={r} tone="neutral">{r}</Badge>)}
                </div>
                <button
                  type="button"
                  aria-label={t("scheduled.delete")}
                  className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                  style={{ color: "var(--admin-danger)" }}
                  onClick={() => setScheduled((xs) => xs.filter((x) => x.id !== s.id))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{label}{children}</label>;
}
