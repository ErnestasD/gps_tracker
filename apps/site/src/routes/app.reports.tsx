import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminButton, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

// Report types as in the real product (reports.t.* in lt.json)
const REPORT_TYPES = [
  { value: "mileage", label: "Rida" },
  { value: "trips", label: "Kelionės" },
  { value: "stops", label: "Sustojimai" },
  { value: "overspeed", label: "Greičio viršijimas" },
  { value: "geofence", label: "Geozonos" },
  { value: "engine_hours", label: "Variklio valandos" },
];

const ACCOUNTS = [
  { value: "acc_baltlog", label: "UAB Baltijos logistika" },
  { value: "acc_kensa", label: "UAB Kensa transportas" },
];

const DEVICES = [
  { value: "", label: "Visi įrenginiai" },
  { value: "dev_0001", label: "Sprinter 01" },
  { value: "dev_0002", label: "Transit 02" },
  { value: "dev_0003", label: "Van 03" },
  { value: "dev_0004", label: "Truck 04" },
];

// Mileage report result — columns mirror reports.col.*: Diena / Įrenginys / Kelionės / Atstumas (km)
const RESULT_COLS = ["Diena", "Įrenginys", "Kelionės", "Atstumas (km)"];
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
  type: string;
  cadence: string;
  recipients: string[];
}

const SCHEDULED_SEED: Scheduled[] = [
  { id: "s1", type: "Kelionės", cadence: "Kasdien · 06:00 UTC", recipients: ["ops@baltlog.lt"] },
  { id: "s2", type: "Rida", cadence: "Kas savaitę · Pr · 05:00 UTC", recipients: ["vadyba@baltlog.lt", "buhalterija@baltlog.lt"] },
];

function ReportsPage() {
  const [type, setType] = React.useState("mileage");
  const [account, setAccount] = React.useState("acc_baltlog");
  const [deviceId, setDeviceId] = React.useState("");
  const [from, setFrom] = React.useState<Date | undefined>(new Date(2026, 7, 31));
  const [to, setTo] = React.useState<Date | undefined>(new Date(2026, 8, 1));
  const [generated, setGenerated] = React.useState(false);
  const [scheduled, setScheduled] = React.useState<Scheduled[]>(SCHEDULED_SEED);

  const canRun = from !== undefined && to !== undefined;
  const rows = deviceId === ""
    ? RESULT_ROWS
    : RESULT_ROWS.filter((r) => r[1] === DEVICES.find((d) => d.value === deviceId)?.label);

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader title="Ataskaitos" description="Vykdykite ataskaitas pagal laikotarpį ir planuokite reguliarias." className="mb-0" />

      {/* generator card — run/export actions live in the card header (mirrors the real ReportsPage) */}
      <div className="admin-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Sugeneruoti ataskaitą</h2>
          <div className="flex flex-wrap gap-2">
            <AdminButton disabled={!canRun} onClick={() => setGenerated(true)}>Generuoti</AdminButton>
            <AdminButton variant="secondary" disabled={!generated} onClick={() => toast.success("CSV eksportuota (demo)")}>Eksportuoti CSV</AdminButton>
            <AdminButton variant="secondary" disabled={!generated} onClick={() => toast.success("PDF eksportuota (demo)")}>Eksportuoti PDF</AdminButton>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Ataskaita">
            <div className="w-44"><Combobox value={type} onChange={(v) => { setType(v); setGenerated(false); }} options={REPORT_TYPES} /></div>
          </Field>
          <Field label="Paskyra">
            <div className="w-44"><Combobox value={account} onChange={setAccount} options={ACCOUNTS} /></div>
          </Field>
          <Field label="Įrenginys">
            <div className="w-44"><Combobox value={deviceId} onChange={setDeviceId} options={DEVICES} /></div>
          </Field>
          <Field label="Nuo">
            <div className="w-40"><DatePicker value={from} onChange={setFrom} /></div>
          </Field>
          <Field label="Iki">
            <div className="w-40"><DatePicker value={to} onChange={setTo} /></div>
          </Field>
        </div>
      </div>

      {/* result card */}
      <div className="admin-card overflow-hidden">
        <h2 className="admin-hairline-b px-4 py-3 font-semibold md:px-5" style={{ color: "var(--admin-ink)" }}>Rezultatas</h2>
        {!generated ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            Pasirinkite tipą ir intervalą, tada Generuoti.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            Šiam intervalui duomenų nėra.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "var(--admin-surface-sunken)" }}>
                <tr className="text-left text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                  {RESULT_COLS.map((c) => <th key={c} className="px-3 py-2 font-medium md:px-4">{c}</th>)}
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
          <h2 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Suplanuotos ataskaitos</h2>
          <AdminButton
            size="sm"
            variant="secondary"
            onClick={() =>
              setScheduled((xs) => [
                ...xs,
                { id: `s${Date.now()}`, type: "Sustojimai", cadence: "Kasdien · 07:00 UTC", recipients: ["dispecerine@baltlog.lt"] },
              ])
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            Pridėti
          </AdminButton>
        </div>
        {scheduled.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>Suplanuotų ataskaitų nėra.</p>
        ) : (
          <ul className="space-y-2">
            {scheduled.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" style={{ borderColor: "var(--admin-hairline)", color: "var(--admin-ink)" }}>
                <FileText className="h-4 w-4 shrink-0" style={{ color: "var(--admin-brand)" }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.type}</div>
                  <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{s.cadence}</div>
                </div>
                <div className="flex max-w-[50%] flex-wrap justify-end gap-1">
                  {s.recipients.map((r) => <Badge key={r} tone="neutral">{r}</Badge>)}
                </div>
                <button
                  type="button"
                  aria-label="Šalinti"
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
