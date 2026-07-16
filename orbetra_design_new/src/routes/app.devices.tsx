import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Plus, Upload, MoreHorizontal, Circle } from "lucide-react";
import { generateDevices, type Device } from "@/lib/admin-mock";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton, Badge, AdminInput, AdminLabel } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/devices")({
  component: DevicesPage,
});

const DATA = generateDevices();

function DevicesPage() {
  const [open, setOpen] = React.useState(false);

  const columns: Column<Device>[] = [
    {
      key: "name",
      header: "Pavadinimas",
      sortable: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{r.plate}</div>
        </div>
      ),
    },
    { key: "imei", header: "IMEI", cell: (r) => <span className="mono text-xs">{r.imei}</span>, hideOnMobile: true },
    {
      key: "driver",
      header: "Vairuotojas",
      sortable: true,
      sortValue: (r) => r.driver,
      cell: (r) => r.driver,
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Būsena",
      sortable: true,
      sortValue: (r) => r.status,
      filterValue: (r) => r.status,
      filterOptions: [
        { label: "Aktyvūs", value: "active" },
        { label: "Sustoję", value: "idle" },
        { label: "Neprisijungę", value: "offline" },
        { label: "Priežiūra", value: "maintenance" },
      ],
      cell: (r) => (
        <Badge tone={r.status === "active" ? "success" : r.status === "offline" ? "danger" : r.status === "maintenance" ? "warning" : "neutral"}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
          {r.status}
        </Badge>
      ),
    },
    { key: "speed", header: "Greitis", align: "right", sortable: true, sortValue: (r) => r.speed, cell: (r) => `${r.speed} km/h`, hideOnMobile: true },
    { key: "odometer", header: "Rida", align: "right", sortable: true, sortValue: (r) => r.odometer, cell: (r) => `${(r.odometer / 1000).toFixed(0)}k km`, hideOnMobile: true },
    { key: "location", header: "Vieta", cell: (r) => r.location },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Įrenginiai" description="Visi parko GPS įrenginiai vienoje vietoje.">
        <AdminButton variant="secondary"><Upload className="h-4 w-4" />Importuoti CSV</AdminButton>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <AdminButton><Plus className="h-4 w-4" />Pridėti įrenginį</AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader><SheetTitle>Naujas įrenginys</SheetTitle></SheetHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setOpen(false);
                toast.success("Įrenginys sukurtas (demo)");
              }}
              className="mt-4 flex flex-col gap-3"
            >
              <div><AdminLabel>IMEI (15 skaičių)</AdminLabel><AdminInput required maxLength={15} placeholder="860…" /></div>
              <div><AdminLabel>Pavadinimas</AdminLabel><AdminInput required placeholder="pvz. Van 25" /></div>
              <div><AdminLabel>Numeris</AdminLabel><AdminInput placeholder="ABC 123" /></div>
              <div>
                <AdminLabel>Profilis</AdminLabel>
                <Combobox
                  value=""
                  onChange={() => {}}
                  options={[
                    { value: "teltonika-fmb1xx", label: "Teltonika FMB1xx", hint: "vehicle" },
                    { value: "teltonika-fmc650", label: "Teltonika FMC650", hint: "asset" },
                    { value: "queclink-gv75", label: "Queclink GV75" },
                  ]}
                />
              </div>
              <div>
                <AdminLabel>Paskyra</AdminLabel>
                <Combobox
                  value="kaunas"
                  onChange={() => {}}
                  options={[
                    { value: "kaunas", label: "Kaunas Fleet" },
                    { value: "vilnius", label: "Vilnius Ops" },
                  ]}
                />
              </div>
              <SheetFooter className="mt-2">
                <AdminButton variant="secondary" type="button" onClick={() => setOpen(false)}>Atšaukti</AdminButton>
                <AdminButton type="submit">Sukurti</AdminButton>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </PageHeader>

      <DataTable
        data={DATA}
        columns={columns}
        searchKeys={["name", "plate", "imei", "driver", "location"]}
        pageSize={12}
        rowAction={(r) => (
          <button
            className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--admin-surface-sunken)]"
            onClick={() => toast(`Įrenginys ${r.name}`, { description: "Meniu (demo)" })}
            aria-label="Veiksmai"
          >
            <MoreHorizontal className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} />
          </button>
        )}
      />
    </div>
  );
}
