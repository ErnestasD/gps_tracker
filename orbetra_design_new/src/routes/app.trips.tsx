import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import * as React from "react";
import { generateTrips, type Trip } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton } from "@/components/admin/AdminKit";
import { DatePicker } from "@/components/admin/DatePicker";
import { Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/trips")({
  component: TripsPage,
});

const DATA = generateTrips();

function TripsPage() {
  const [from, setFrom] = React.useState<Date | undefined>();
  const [to, setTo] = React.useState<Date | undefined>();

  const filtered = DATA.filter((t) => {
    if (from && new Date(t.start) < from) return false;
    if (to && new Date(t.end) > to) return false;
    return true;
  });

  const columns: Column<Trip>[] = [
    { key: "start", header: "Pradžia", sortable: true, sortValue: (r) => r.start, cell: (r) => fmtDateTime(r.start) },
    { key: "device", header: "Įrenginys", sortable: true, sortValue: (r) => r.device, cell: (r) => <span className="font-medium">{r.device}</span> },
    { key: "driver", header: "Vairuotojas", cell: (r) => r.driver, hideOnMobile: true },
    { key: "route", header: "Maršrutas", cell: (r) => <span className="text-sm">{r.from} → {r.to}</span>, hideOnMobile: true },
    { key: "distance", header: "Km", align: "right", sortable: true, sortValue: (r) => r.distance, cell: (r) => r.distance.toString() },
    { key: "duration", header: "Trukmė", cell: (r) => r.duration, hideOnMobile: true },
    { key: "avgSpeed", header: "Vid. km/h", align: "right", sortable: true, sortValue: (r) => r.avgSpeed, cell: (r) => r.avgSpeed, hideOnMobile: true },
    { key: "maxSpeed", header: "Maks. km/h", align: "right", sortable: true, sortValue: (r) => r.maxSpeed, cell: (r) => r.maxSpeed, hideOnMobile: true },
    { key: "fuelUsed", header: "Kuras (l)", align: "right", sortable: true, sortValue: (r) => r.fuelUsed, cell: (r) => r.fuelUsed, hideOnMobile: true },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Kelionės" description="Visos parko kelionės su laiko filtru.">
        <div className="w-36"><DatePicker value={from} onChange={setFrom} placeholder="Nuo" /></div>
        <div className="w-36"><DatePicker value={to} onChange={setTo} placeholder="Iki" /></div>
        <AdminButton variant="secondary" onClick={() => toast.success("CSV eksportuota (demo)")}><Download className="h-4 w-4" />CSV</AdminButton>
      </PageHeader>

      <DataTable data={filtered} columns={columns} searchKeys={["device", "driver", "from", "to"]} pageSize={15} />
    </div>
  );
}
