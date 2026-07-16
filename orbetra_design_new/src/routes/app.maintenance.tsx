import { createFileRoute } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/admin-format";
import * as React from "react";
import { Plus, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import { generateMaintenance, generateDevices, type MaintenanceTask } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel, StatCard } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/maintenance")({
  component: MaintenancePage,
});

const DATA = generateMaintenance();
const DEVICES = generateDevices();

function MaintenancePage() {
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState<Date | undefined>();
  const [device, setDevice] = React.useState<string>("");

  const ok = DATA.filter((d) => d.status === "ok").length;
  const due = DATA.filter((d) => d.status === "due").length;
  const overdue = DATA.filter((d) => d.status === "overdue").length;

  const columns: Column<MaintenanceTask>[] = [
    { key: "device", header: "Įrenginys", sortable: true, sortValue: (r) => r.device, cell: (r) => <span className="font-medium">{r.device}</span> },
    { key: "service", header: "Paslauga", sortable: true, sortValue: (r) => r.service, cell: (r) => r.service },
    { key: "dueKm", header: "Terminas (km)", align: "right", sortable: true, sortValue: (r) => r.dueKm, cell: (r) => r.dueKm.toString(), hideOnMobile: true },
    { key: "currentKm", header: "Dabar (km)", align: "right", sortable: true, sortValue: (r) => r.currentKm, cell: (r) => r.currentKm.toString(), hideOnMobile: true },
    { key: "dueDate", header: "Terminas", cell: (r) => fmtDate(r.dueDate), hideOnMobile: true },
    {
      key: "status", header: "Būsena", sortable: true, sortValue: (r) => r.status,
      filterValue: (r) => r.status,
      filterOptions: [
        { label: "Tvarka", value: "ok" }, { label: "Artėja", value: "due" }, { label: "Vėluoja", value: "overdue" },
      ],
      cell: (r) => <Badge tone={r.status === "overdue" ? "danger" : r.status === "due" ? "warning" : "success"}>{r.status === "ok" ? "Tvarka" : r.status === "due" ? "Artėja" : "Vėluoja"}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Priežiūra" description="Techninių priežiūrų priminimai ir grafikas.">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><AdminButton><Plus className="h-4 w-4" />Pridėti priminimą</AdminButton></SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader><SheetTitle>Naujas priežiūros priminimas</SheetTitle></SheetHeader>
            <form onSubmit={(e) => { e.preventDefault(); setOpen(false); toast.success("Priminimas išsaugotas (demo)"); }} className="mt-4 flex flex-col gap-3">
              <div><AdminLabel>Įrenginys</AdminLabel>
                <Combobox value={device} onChange={setDevice} options={DEVICES.map((d) => ({ value: d.id, label: d.name, hint: d.plate }))} />
              </div>
              <div><AdminLabel>Paslauga</AdminLabel><AdminInput placeholder="pvz. Alyvos keitimas" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><AdminLabel>Kas (km)</AdminLabel><AdminInput type="number" placeholder="15000" /></div>
                <div><AdminLabel>Kas (d.)</AdminLabel><AdminInput type="number" placeholder="180" /></div>
              </div>
              <div><AdminLabel>Kita data</AdminLabel><DatePicker value={date} onChange={setDate} /></div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit">Pridėti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Tvarka" value={<><CheckCircle2 className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-success)" }} />{ok}</>} hint="įrenginių" />
        <StatCard label="Artėja" value={<><Wrench className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-warning)" }} />{due}</>} hint="artimiausiu metu" />
        <StatCard label="Vėluoja" value={<><AlertTriangle className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-danger)" }} />{overdue}</>} hint="reikalauja veiksmų" />
      </div>

      <DataTable data={DATA} columns={columns} searchKeys={["device", "service"]} pageSize={10} />
    </div>
  );
}
