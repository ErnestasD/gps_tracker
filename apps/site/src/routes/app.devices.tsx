import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Plus, Upload } from "lucide-react";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { AdminButton, AdminInput, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { LANGUAGES, type Lang } from "@/lib/i18n";
import { contentFor } from "@/lib/demo-content";
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

/** Status → real-product translation key (admin namespace). */
const STATUS_KEY: Record<DemoStatus, string> = {
  active: "devices.active",
  waiting: "devices.waiting",
  retired: "devices.retired",
};

/** Demo-only copy that has no counterpart in the real product's locale files. */
const L: Record<Lang, { demoImport: string; demoAction: string; rowNoop: string; created: string; namePh: string }> = {
  lt: {
    demoImport: "Demo režimas — importas nevykdomas.",
    demoAction: "Demo režimas — veiksmas nevykdomas.",
    rowNoop: "demo režimas, veiksmas nevykdomas.",
    created: "Įrenginys sukurtas (demo)",
    namePh: "pvz. Krovininis 12",
  },
  en: {
    demoImport: "Demo mode — no import is performed.",
    demoAction: "Demo mode — no action is performed.",
    rowNoop: "demo mode, no action is performed.",
    created: "Device created (demo)",
    namePh: "e.g. Truck 12",
  },
  pl: {
    demoImport: "Tryb demo — import nie jest wykonywany.",
    demoAction: "Tryb demo — akcja nie jest wykonywana.",
    rowNoop: "tryb demo, akcja nie jest wykonywana.",
    created: "Urządzenie utworzone (demo)",
    namePh: "np. Ciężarówka 12",
  },
  de: {
    demoImport: "Demo-Modus — es wird kein Import durchgeführt.",
    demoAction: "Demo-Modus — es wird keine Aktion ausgeführt.",
    rowNoop: "Demo-Modus, keine Aktion wird ausgeführt.",
    created: "Gerät erstellt (Demo)",
    namePh: "z. B. LKW 12",
  },
};

function useL() {
  const { i18n } = useTranslation("admin");
  const lang = (i18n.resolvedLanguage ?? "lt").slice(0, 2) as Lang;
  return L[LANGUAGES.includes(lang) ? lang : "lt"];
}

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
  const { t } = useTranslation("admin");
  const l = useL();
  const [devices, setDevices] = React.useState(INITIAL_DEVICES);
  const [addOpen, setAddOpen] = React.useState(false);

  const columns: Column<DemoDevice>[] = [
    {
      key: "name",
      header: t("devices.name"),
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
      header: t("devices.imei"),
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.imei}</span>,
    },
    {
      key: "model",
      header: t("devices.model"),
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
      header: t("devices.status"),
      sortable: true,
      sortValue: (r) => r.status,
      filterValue: (r) => r.status,
      filterOptions: [
        { value: "active", label: t("devices.active") },
        { value: "waiting", label: t("devices.waiting") },
        { value: "retired", label: t("devices.retired") },
      ],
      cell: (r) => (
        <span title={r.status === "waiting" ? t("devices.waitingHint") : undefined}>
          <Badge tone={r.status === "active" ? "success" : r.status === "waiting" ? "warning" : "neutral"}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} aria-hidden />
            {t(STATUS_KEY[r.status])}
          </Badge>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-2" title={t("devices.title")} description={t("devices.desc")}>
        <AdminButton variant="secondary" onClick={() => toast(t("devices.import.title"), { description: l.demoImport })}>
          <Upload className="h-4 w-4" aria-hidden />
          {t("devices.import.open")}
        </AdminButton>
        <AdminButton variant="secondary" onClick={() => toast(t("devices.vsim.addTitle"), { description: l.demoAction })}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("devices.vsim.addButton")}
        </AdminButton>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton>
              <Plus className="h-4 w-4" aria-hidden />
              {t("devices.add")}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t("devices.addTitle")}</SheetTitle>
            </SheetHeader>
            <CreateDeviceForm
              onCancel={() => setAddOpen(false)}
              onCreated={() => {
                setAddOpen(false);
                toast.success(l.created);
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
        emptyLabel={t("devices.empty")}
        rowAction={(d) => <RowMenu device={d} />}
      />
    </div>
  );
}

/** Per-row "..." actions menu — the real page's items, demo no-ops behind a toast. */
function RowMenu({ device }: { device: DemoDevice }) {
  const { t } = useTranslation("admin");
  const l = useL();
  const [open, setOpen] = React.useState(false);
  const active = device.status !== "retired";

  const item = (label: string, danger = false) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setOpen(false);
        toast(label, { description: `${device.name} — ${l.rowNoop}` });
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
          aria-label={t("devices.actions")}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        {active ? (
          <>
            {device.imei.startsWith(VIRTUAL_IMEI_PREFIX) && item(t("devices.vsim.menu"))}
            {item(t("fleet.cardBtn"))}
            {item(t("devices.healthBtn"))}
            {item(t("devices.onboard"))}
            {item(t("devices.commands"))}
            {item(t("devices.settings.menu"))}
            {item(t("devices.share.button"))}
            <div className="admin-hairline-t my-1" aria-hidden />
            {item(t("devices.retire"), true)}
          </>
        ) : (
          item(t("devices.erase"), true)
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
  const { t, i18n } = useTranslation("admin");
  const l = useL();
  const [accountId, setAccountId] = React.useState("acc_a");
  const [profileId, setProfileId] = React.useState("fmb120");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreated();
      }}
      className="mt-2 flex flex-col gap-3"
    >
      <Field label={t("devices.imei")}>
        <AdminInput required pattern="\d{15}" maxLength={15} placeholder={t("devices.imeiPh")} />
      </Field>
      <Field label={t("devices.name")}>
        <AdminInput required placeholder={l.namePh} />
      </Field>
      <Field label={t("devices.plate")}>
        <AdminInput maxLength={32} placeholder="ABC 123" />
      </Field>
      <Field label={t("devices.onb.sim.msisdn")}>
        <AdminInput pattern="\+[1-9]\d{6,14}" placeholder={`${contentFor(i18n.language).phonePrefix}0000000`} maxLength={20} inputMode="tel" />
      </Field>
      <Field label={t("devices.onb.apn")}>
        <AdminInput maxLength={63} placeholder={t("devices.onb.apnPlaceholder")} />
      </Field>
      <Field label={t("devices.account")}>
        <Combobox
          value={accountId}
          onChange={setAccountId}
          options={[
            { value: "acc_a", label: contentFor(i18n.language).accounts[0] },
            { value: "acc_b", label: contentFor(i18n.language).accounts[1] },
          ]}
        />
      </Field>
      <Field label={t("devices.model")}>
        <Combobox value={profileId} onChange={setProfileId} options={PROFILES} />
      </Field>
      <SheetFooter className="mt-2">
        <AdminButton variant="secondary" type="button" onClick={onCancel}>
          {t("admin.cancel")}
        </AdminButton>
        <AdminButton type="submit">{t("devices.create")}</AdminButton>
      </SheetFooter>
    </form>
  );
}
