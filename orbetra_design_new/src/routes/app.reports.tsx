import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Download, Plus, Trash2, FileText } from "lucide-react";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

const REPORT_TYPES = [
  { value: "trips", label: "Kelionės" },
  { value: "distance", label: "Rida" },
  { value: "fuel", label: "Kuras" },
  { value: "speeding", label: "Greičio viršijimai" },
  { value: "geofence", label: "Geozonos" },
  { value: "utilization", label: "Apkrova" },
];

function ReportsPage() {
  const [type, setType] = React.useState("trips");
  const [account, setAccount] = React.useState("kaunas");
  const [device, setDevice] = React.useState("");
  const [from, setFrom] = React.useState<Date | undefined>();
  const [to, setTo] = React.useState<Date | undefined>();
  const [generated, setGenerated] = React.useState(false);
  const [scheduled, setScheduled] = React.useState([
    { id: "s1", type: "Kelionės", freq: "Kasdien", hour: "07:00 UTC", recipients: "ops@co.com" },
    { id: "s2", type: "Rida", freq: "Kas savaitę", hour: "Pirmadienis 06:00 UTC", recipients: "boss@co.com" },
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Ataskaitos" description="Kurk ir planuok reguliarias ataskaitas.">
      </PageHeader>

      <div className="admin-card p-5">
        <h3 className="mb-3 font-semibold" style={{ color: "var(--admin-ink)" }}>Sugeneruoti ataskaitą</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div><AdminLabel>Ataskaita</AdminLabel><Combobox value={type} onChange={setType} options={REPORT_TYPES} /></div>
          <div><AdminLabel>Paskyra</AdminLabel><Combobox value={account} onChange={setAccount} options={[{ value: "kaunas", label: "Kaunas Fleet" }, { value: "vilnius", label: "Vilnius Ops" }]} /></div>
          <div><AdminLabel>Įrenginys</AdminLabel><Combobox value={device} onChange={setDevice} options={[{ value: "", label: "Visi įrenginiai" }, { value: "van12", label: "Van 12" }, { value: "van05", label: "Van 05" }]} /></div>
          <div><AdminLabel>Nuo</AdminLabel><DatePicker value={from} onChange={setFrom} /></div>
          <div><AdminLabel>Iki</AdminLabel><DatePicker value={to} onChange={setTo} /></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <AdminButton onClick={() => setGenerated(true)}>Generuoti</AdminButton>
          <AdminButton variant="secondary" disabled={!generated} onClick={() => toast.success("CSV eksportuota (demo)")}><Download className="h-4 w-4" />Eksportuoti CSV</AdminButton>
        </div>
      </div>

      <div className="mt-4 admin-card p-5">
        <h3 className="mb-2 font-semibold" style={{ color: "var(--admin-ink)" }}>Rezultatas</h3>
        {!generated ? (
          <div className="py-10 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            Pasirinkite tipą ir intervalą, tada Generuoti.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: "Kelionės", v: "128" },
              { l: "Nuvažiuota", v: "8 910 km" },
              { l: "Vid. greitis", v: "58 km/h" },
              { l: "Kuras (l)", v: "801,9" },
            ].map((s) => (
              <div key={s.l} className="rounded-md p-3" style={{ background: "var(--admin-surface-sunken)" }}>
                <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{s.l}</div>
                <div className="mt-1 text-lg font-semibold" style={{ color: "var(--admin-ink)" }}>{s.v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 admin-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold" style={{ color: "var(--admin-ink)" }}>Suplanuotos ataskaitos</h3>
          <AdminButton size="sm" variant="secondary"><Plus className="h-4 w-4" />Pridėti</AdminButton>
        </div>
        <div className="flex flex-col gap-2">
          {scheduled.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3" style={{ borderColor: "var(--admin-hairline)" }}>
              <FileText className="h-4 w-4" style={{ color: "var(--admin-brand)" }} />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{s.type}</div>
                <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{s.freq} · {s.hour}</div>
              </div>
              <Badge tone="neutral">{s.recipients}</Badge>
              <button className="grid h-8 w-8 place-items-center rounded-md text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)]" onClick={() => setScheduled((x) => x.filter((y) => y.id !== s.id))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
