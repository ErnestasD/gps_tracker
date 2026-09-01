import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { MoreHorizontal, Plus, Upload } from "lucide-react";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { AdminButton, AdminInput, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/devices")({
  component: DevicesPage,
});

// Mirrors the real Devices page: three states, because "two were a lie by omission" —
// a freshly registered tracker that has never reported is NOT "Aktyvus".
type DemoStatus = "active" | "waiting" | "retired";

type DemoDevice = {
  id: string;
  name: string;
  plate: string | null;
  imei: string;
  profileId: string;
  status: DemoStatus;
};

const STATUS_LABEL: Record<DemoStatus, string> = {
  active: "Aktyvus",
  waiting: "Niekada nepranešė",
  retired: "Išregistruotas",
};

const WAITING_HINT =
  "Užregistruotas, bet šis įrenginys dar niekada neatsiuntė pozicijos. Patikrink IMEI, SIM kortelės APN ir ar sekikliui išsiųsta serverio SMS.";

const PROFILES = [
  { value: "fmb120", label: "Teltonika FMB120" },
  { value: "fmb140", label: "Teltonika FMB140" },
  { value: "fmb920", label: "Teltonika FMB920" },
  { value: "fmc130", label: "Teltonika FMC130" },
  { value: "fmc150", label: "Teltonika FMC150" },
  { value: "fmc650", label: "Teltonika FMC650" },
  { value: "ftc887", label: "Teltonika FTC887" },
];

const VIRTUAL_IMEI_PREFIX = "9990";

const INITIAL_DEVICES: DemoDevice[] = [
  { id: "d1", name: "Krovininis 01", plate: "KRV 401", imei: "869206051234017", profileId: "fmb120", status: "active" },
  { id: "d2", name: "Krovininis 02", plate: "KRV 522", imei: "869206051234025", profileId: "fmb120", status: "active" },
  { id: "d3", name: "Krovininis 03", plate: "JKD 218", imei: "869206058812349", profileId: "fmc150", status: "active" },
  { id: "d4", name: "Vilkikas 04", plate: "LKM 730", imei: "869258046621184", profileId: "fmc150", status: "active" },
  { id: "d5", name: "Mikroautobusas 05", plate: "HNE 664", imei: "869271033448756", profileId: "fmb120", status: "active" },
  { id: "d6", name: "Autocisterna 06", plate: "KTC 095", imei: "869206059917204", profileId: "fmc150", status: "waiting" },
  { id: "d7", name: "Furgonas 07", plate: "EGL 342", imei: "869258041102938", profileId: "fmb120", status: "active" },
  { id: "d8", name: "Priekaba 08", plate: "PRK 118", imei: "869206053390561", profileId: "ftc887", status: "waiting" },
  { id: "d9", name: "Servisas 09", plate: "SRV 909", imei: "869271039981265", profileId: "fmb120", status: "active" },
  { id: "d10", name: "Vilkikas 10", plate: "DKO 458", imei: "869206050034471", profileId: "fmc150", status: "retired" },
  { id: "d11", name: "Virtualus 1", plate: null, imei: "999000000000101", profileId: "fmb120", status: "active" },
];

function DevicesPage() {
  const [devices, setDevices] = React.useState(INITIAL_DEVICES);
  const [addOpen, setAddOpen] = React.useState(false);

  const columns: Column<DemoDevice>[] = [
    {
      key: "name",
      header: "Pavadinimas",
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          {r.plate !== null && r.plate !== "" && (
            <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              {r.plate}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "imei",
      header: "IMEI",
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.imei}</span>,
    },
    {
      key: "model",
      header: "Modelis",
      hideOnMobile: true,
      sortable: true,
      sortValue: (r) => (PROFILES.find((p) => p.value === r.profileId)?.label ?? "—").toLowerCase(),
      cell: (r) => (
        <div className="w-44">
          <Combobox
            value={r.profileId}
            disabled={r.status === "retired"}
            onChange={(v) =>
              setDevices((ds) => ds.map((d) => (d.id === r.id ? { ...d, profileId: v } : d)))
            }
            options={PROFILES}
          />
        </div>
      ),
    },
    {
      key: "status",
      header: "Būsena",
      sortable: true,
      sortValue: (r) => r.status,
      filterValue: (r) => r.status,
      filterOptions: [
        { value: "active", label: "Aktyvus" },
        { value: "waiting", label: "Niekada nepranešė" },
        { value: "retired", label: "Išregistruotas" },
      ],
      cell: (r) => (
        <span title={r.status === "waiting" ? WAITING_HINT : undefined}>
          <Badge tone={r.status === "active" ? "success" : r.status === "waiting" ? "warning" : "neutral"}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} aria-hidden />
            {STATUS_LABEL[r.status]}
          </Badge>
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-2" title="Įrenginiai" description="Visi parko GPS įrenginiai vienoje vietoje.">
        <AdminButton variant="secondary" onClick={() => toast("Masinis importas (CSV)", { description: "Demo režimas — importas neatliekamas." })}>
          <Upload className="h-4 w-4" aria-hidden />
          Importuoti CSV
        </AdminButton>
        <AdminButton variant="secondary" onClick={() => toast("Naujas virtualus įrenginys", { description: "Demo režimas — veiksmas neatliekamas." })}>
          <Plus className="h-4 w-4" aria-hidden />
          Virtualus įrenginys
        </AdminButton>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton>
              <Plus className="h-4 w-4" aria-hidden />
              Pridėti įrenginį
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Naujas įrenginys</SheetTitle>
            </SheetHeader>
            <CreateDeviceForm
              onCancel={() => setAddOpen(false)}
              onCreated={() => {
                setAddOpen(false);
                toast.success("Įrenginys sukurtas (demo)");
              }}
            />
          </SheetContent>
        </Sheet>
      </PageHeader>

      <DataTable
        data={devices}
        columns={columns}
        searchKeys={["name", "plate", "imei"]}
        pageSize={12}
        emptyLabel="Įrenginių dar nėra."
        rowAction={(d) => <RowMenu device={d} />}
      />
    </div>
  );
}

/** Per-row "..." actions menu — the real page's items, demo no-ops behind a toast. */
function RowMenu({ device }: { device: DemoDevice }) {
  const [open, setOpen] = React.useState(false);
  const active = device.status !== "retired";

  const item = (label: string, danger = false) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setOpen(false);
        toast(label, { description: `${device.name} — demo režimas, veiksmas neatliekamas.` });
      }}
      className="block w-full rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--admin-surface-sunken)]"
      style={{ color: danger ? "var(--admin-danger)" : "var(--admin-ink)" }}
    >
      {label}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Veiksmai"
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        {active ? (
          <>
            {device.imei.startsWith(VIRTUAL_IMEI_PREFIX) && item("Simuliacija")}
            {item("Kortelė")}
            {item("Būklė")}
            {item("Prijungti")}
            {item("Komandos")}
            {item("Sekimo nustatymai")}
            {item("Bendrinti")}
            <div className="admin-hairline-t my-1" aria-hidden />
            {item("Išregistruoti", true)}
          </>
        ) : (
          item("Ištrinti duomenis", true)
        )}
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
      {label}
      {children}
    </label>
  );
}

/** The real create form's fields (IMEI / name / plate / SIM / APN / account / model), demo-static. */
function CreateDeviceForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [accountId, setAccountId] = React.useState("kaunas");
  const [profileId, setProfileId] = React.useState("fmb120");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreated();
      }}
      className="mt-2 flex flex-col gap-3"
    >
      <Field label="IMEI">
        <AdminInput required pattern="\d{15}" maxLength={15} placeholder="15 skaitmenų" />
      </Field>
      <Field label="Pavadinimas">
        <AdminInput required placeholder="pvz. Krovininis 12" />
      </Field>
      <Field label="Valst. numeris (nebūtina)">
        <AdminInput maxLength={32} placeholder="ABC 123" />
      </Field>
      <Field label="SIM telefono numeris">
        <AdminInput pattern="\+[1-9]\d{6,14}" placeholder="+37060000000" maxLength={20} inputMode="tel" />
      </Field>
      <Field label="SIM APN">
        <AdminInput maxLength={63} placeholder="pvz. internet" />
      </Field>
      <Field label="Paskyra">
        <Combobox
          value={accountId}
          onChange={setAccountId}
          options={[
            { value: "kaunas", label: "Kauno parkas" },
            { value: "vilnius", label: "Vilniaus parkas" },
          ]}
        />
      </Field>
      <Field label="Modelis">
        <Combobox value={profileId} onChange={setProfileId} options={PROFILES} />
      </Field>
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" type="button" onClick={onCancel}>
          Atšaukti
        </AdminButton>
        <AdminButton type="submit">Sukurti</AdminButton>
      </SheetFooter>
    </form>
  );
}
