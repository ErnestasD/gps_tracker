import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import * as React from "react";
import { Bell, TrendingUp, Activity, AlertOctagon } from "lucide-react";
import { generateEvents, type EventRow } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, Badge, StatCard } from "@/components/admin/AdminKit";
import { DatePicker } from "@/components/admin/DatePicker";

export const Route = createFileRoute("/app/events")({
  component: EventsPage,
});

const DATA = generateEvents();

const iconFor = (t: EventRow["severity"]) =>
  t === "critical" ? AlertOctagon : t === "warning" ? TrendingUp : Activity;

function EventsPage() {
  const [from, setFrom] = React.useState<Date | undefined>();
  const [to, setTo] = React.useState<Date | undefined>();

  const critical = DATA.filter((e) => e.severity === "critical").length;
  const warning = DATA.filter((e) => e.severity === "warning").length;
  const info = DATA.filter((e) => e.severity === "info").length;

  const filtered = DATA.filter((e) => {
    if (from && new Date(e.ts) < from) return false;
    if (to && new Date(e.ts) > to) return false;
    return true;
  });

  const columns: Column<EventRow>[] = [
    { key: "ts", header: "Data", sortable: true, sortValue: (r) => r.ts, cell: (r) => fmtDateTime(r.ts) },
    {
      key: "type", header: "Tipas", sortable: true, sortValue: (r) => r.type,
      filterValue: (r) => r.type,
      filterOptions: [
        { label: "Greičio viršijimas", value: "speeding" },
        { label: "Geozona", value: "geofence" },
        { label: "SOS", value: "sos" },
        { label: "Offline", value: "offline" },
        { label: "Aštrus stabdymas", value: "harsh-brake" },
        { label: "Aštrus greitėjimas", value: "harsh-accel" },
        { label: "Užvedimas", value: "ignition" },
      ],
      cell: (r) => <Badge tone={r.severity === "critical" ? "danger" : r.severity === "warning" ? "warning" : "info"}>{r.type}</Badge>,
    },
    { key: "device", header: "Įrenginys", cell: (r) => r.device },
    { key: "driver", header: "Vairuotojas", cell: (r) => r.driver, hideOnMobile: true },
    { key: "detail", header: "Detalė", cell: (r) => r.detail },
    {
      key: "severity", header: "Rimtumas", sortable: true, sortValue: (r) => r.severity,
      filterValue: (r) => r.severity,
      filterOptions: [
        { label: "Kritinis", value: "critical" }, { label: "Įspėjimas", value: "warning" }, { label: "Info", value: "info" },
      ],
      cell: (r) => {
        const Icon = iconFor(r.severity);
        return <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{r.severity}</span>;
      },
      hideOnMobile: true,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Įvykiai" description="Signalų srautas: geozonos, greičiai, SOS, offline.">
        <div className="w-36"><DatePicker value={from} onChange={setFrom} placeholder="Nuo" /></div>
        <div className="w-36"><DatePicker value={to} onChange={setTo} placeholder="Iki" /></div>
      </PageHeader>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Kritiniai" value={<><AlertOctagon className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-danger)" }} />{critical}</>} hint="per 24h" />
        <StatCard label="Įspėjimai" value={<><TrendingUp className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-warning)" }} />{warning}</>} hint="per 24h" />
        <StatCard label="Info" value={<><Activity className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-info)" }} />{info}</>} hint="per 24h" />
      </div>

      <DataTable data={filtered} columns={columns} searchKeys={["device", "driver", "detail"]} pageSize={15} />
    </div>
  );
}
