import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Plus } from "lucide-react";
import { generateDrivers, type Driver } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/drivers")({
  component: DriversPage,
});

const DATA = generateDrivers();

function DriversPage() {
  const [open, setOpen] = React.useState(false);
  const columns: Column<Driver>[] = [
    {
      key: "name", header: "Vardas", sortable: true, sortValue: (r) => r.name,
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold" style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}>
            {r.name.split(" ").map((p) => p[0]).join("")}
          </div>
          <div>
            <div className="font-medium">{r.name}</div>
            <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{r.phone}</div>
          </div>
        </div>
      ),
    },
    { key: "license", header: "Pažymėjimas", cell: (r) => <span className="mono text-xs">{r.license}</span>, hideOnMobile: true },
    { key: "vehicle", header: "Priskirta", cell: (r) => r.vehicle, hideOnMobile: true },
    {
      key: "status", header: "Būsena", sortable: true, sortValue: (r) => r.status,
      filterValue: (r) => r.status,
      filterOptions: [
        { label: "Aktyvūs", value: "active" },
        { label: "Atostogose", value: "on-leave" },
        { label: "Neaktyvūs", value: "inactive" },
      ],
      cell: (r) => <Badge tone={r.status === "active" ? "success" : r.status === "on-leave" ? "warning" : "neutral"}>{r.status}</Badge>,
    },
    {
      key: "score", header: "Sauga", align: "right", sortable: true, sortValue: (r) => r.score,
      cell: (r) => (
        <div className="inline-flex items-center gap-2">
          <div className="h-1.5 w-16 rounded-full" style={{ background: "var(--admin-hairline)" }}>
            <div className="h-1.5 rounded-full" style={{ width: `${r.score}%`, background: r.score > 85 ? "var(--admin-success)" : r.score > 70 ? "var(--admin-warning)" : "var(--admin-danger)" }} />
          </div>
          <span className="mono text-xs">{r.score}</span>
        </div>
      ),
    },
    { key: "trips", header: "Kelionės", align: "right", sortable: true, sortValue: (r) => r.trips, cell: (r) => r.trips.toString() },
    { key: "km", header: "Km", align: "right", sortable: true, sortValue: (r) => r.km, cell: (r) => r.km.toString(), hideOnMobile: true },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Vairuotojai" description="Vairuotojai, jų saugos balai ir priskyrimai.">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <AdminButton><Plus className="h-4 w-4" />Pridėti vairuotoją</AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader><SheetTitle>Naujas vairuotojas</SheetTitle></SheetHeader>
            <form onSubmit={(e) => { e.preventDefault(); setOpen(false); toast.success("Vairuotojas sukurtas (demo)"); }} className="mt-4 flex flex-col gap-3">
              <div><AdminLabel>Vardas pavardė</AdminLabel><AdminInput required /></div>
              <div><AdminLabel>Pažymėjimo nr.</AdminLabel><AdminInput placeholder="LT1234567" /></div>
              <div><AdminLabel>Telefonas</AdminLabel><AdminInput placeholder="+3706…" /></div>
              <div><AdminLabel>iButton / RFID</AdminLabel><AdminInput placeholder="A1B2C3D4" /></div>
              <div><AdminLabel>Paskyra</AdminLabel>
                <Combobox value="kaunas" onChange={() => {}} options={[{ value: "kaunas", label: "Kaunas Fleet" }, { value: "vilnius", label: "Vilnius Ops" }]} />
              </div>
              <SheetFooter className="mt-2">
                <AdminButton type="button" variant="secondary" onClick={() => setOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit">Pridėti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      <DataTable data={DATA} columns={columns} searchKeys={["name", "license", "phone", "vehicle"]} pageSize={10} />
    </div>
  );
}
