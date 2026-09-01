import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Plus } from "lucide-react";
import { fmtNumber } from "@/lib/admin-format";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton, Badge, AdminInput } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { LANGUAGES, type Lang } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/drivers")({
  component: DriversPage,
});

// ---------------------------------------------------------------------------
// Static demo data — mirrors the real product's Driver / DriverScoreView rows.
// ---------------------------------------------------------------------------

type DemoDriver = {
  id: string;
  name: string;
  licenseNo: string | null;
  ibutton: string | null;
  phone: string | null;
  accountId: string;
  active: boolean;
};

type DemoScore = {
  id: string;
  driverName: string;
  trips: number;
  distanceKm: number;
  overspeedEvents: number;
  score: number | null;
};

/** Demo-only copy that has no counterpart in the real product's locale files. */
const L: Record<Lang, { savedDemo: string; createdDemo: string }> = {
  lt: { savedDemo: "Vairuotojas išsaugotas (demo)", createdDemo: "Vairuotojas sukurtas (demo)" },
  en: { savedDemo: "Driver saved (demo)", createdDemo: "Driver created (demo)" },
  pl: { savedDemo: "Kierowca zapisany (demo)", createdDemo: "Kierowca utworzony (demo)" },
  de: { savedDemo: "Fahrer gespeichert (Demo)", createdDemo: "Fahrer erstellt (Demo)" },
};

function useL() {
  const { i18n } = useTranslation("admin");
  const lang = (i18n.resolvedLanguage ?? "lt").slice(0, 2) as Lang;
  return L[LANGUAGES.includes(lang) ? lang : "lt"];
}

const ACCOUNTS = [
  { id: "acc_kaunas", name: "Kaunas Fleet" },
  { id: "acc_vilnius", name: "Vilnius Ops" },
];

const DRIVERS: DemoDriver[] = [
  { id: "drv_0001", name: "Jonas Petrauskas", licenseNo: "LT8451234", ibutton: "0114362A5D0000F1", phone: "+37061234567", accountId: "acc_kaunas", active: true },
  { id: "drv_0002", name: "Mantas Kazlauskas", licenseNo: "LT9124567", ibutton: "01A2B3C4D5E60002", phone: "+37062345678", accountId: "acc_kaunas", active: true },
  { id: "drv_0003", name: "Darius Urbonas", licenseNo: "LT7345678", ibutton: null, phone: "+37063456789", accountId: "acc_vilnius", active: true },
  { id: "drv_0004", name: "Karolis Butkus", licenseNo: "LT6234891", ibutton: "019F8E7D6C5B0003", phone: "+37064567890", accountId: "acc_vilnius", active: false },
  { id: "drv_0005", name: "Vytautas Šimkus", licenseNo: "LT5678123", ibutton: "01AB12CD34EF0004", phone: null, accountId: "acc_kaunas", active: true },
  { id: "drv_0006", name: "Andrius Balčiūnas", licenseNo: null, ibutton: null, phone: "+37066789012", accountId: "acc_vilnius", active: true },
  { id: "drv_0007", name: "Rokas Žukauskas", licenseNo: "LT4567812", ibutton: "0177665544330005", phone: "+37067890123", accountId: "acc_kaunas", active: true },
  { id: "drv_0008", name: "Simonas Ramanauskas", licenseNo: "LT3456789", ibutton: "01C0FFEE12340006", phone: "+37068901234", accountId: "acc_vilnius", active: false },
];

/** Safety scores over the last 30 days — only drivers with driving in the window. */
const SCORES: DemoScore[] = [
  { id: "drv_0005", driverName: "Vytautas Šimkus", trips: 12, distanceKm: 860, overspeedEvents: 0, score: 97 },
  { id: "drv_0001", driverName: "Jonas Petrauskas", trips: 42, distanceKm: 3840, overspeedEvents: 2, score: 92 },
  { id: "drv_0002", driverName: "Mantas Kazlauskas", trips: 38, distanceKm: 3120, overspeedEvents: 5, score: 84 },
  { id: "drv_0006", driverName: "Andrius Balčiūnas", trips: 19, distanceKm: 1540, overspeedEvents: 6, score: 76 },
  { id: "drv_0003", driverName: "Darius Urbonas", trips: 27, distanceKm: 2410, overspeedEvents: 9, score: 71 },
  { id: "drv_0007", driverName: "Rokas Žukauskas", trips: 33, distanceKm: 2980, overspeedEvents: 14, score: 58 },
];

/** Score → badge variant, mirroring the product's unit-tested mapping. */
function scoreVariant(score: number | null): "success" | "warn" | "danger" | "outline" {
  if (score === null) return "outline";
  if (score >= 80) return "success";
  if (score >= 60) return "warn";
  return "danger";
}
const SCORE_TONE = { success: "success", warn: "warning", danger: "danger", outline: "neutral" } as const;
const SCORE_BAR: Record<keyof typeof SCORE_TONE, string> = {
  success: "var(--admin-success)",
  warn: "var(--admin-warning)",
  danger: "var(--admin-danger)",
  outline: "var(--admin-hairline)",
};

/** "Vardenis Pavardenis" → "VP" for the roster avatar circle. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");

const accountName = (id: string) => ACCOUNTS.find((a) => a.id === id)?.name ?? "—";

function DriversPage() {
  const { t } = useTranslation("admin");
  const l = useL();
  const [drivers, setDrivers] = React.useState<DemoDriver[]>(DRIVERS);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [deleteForId, setDeleteForId] = React.useState<string | null>(null);

  const editing = drivers.find((d) => d.id === editingId) ?? null;
  const deleteFor = drivers.find((d) => d.id === deleteForId) ?? null;
  const formOpen = addOpen || editing !== null;
  const closeForm = () => {
    setAddOpen(false);
    setEditingId(null);
  };

  const columns: Column<DemoDriver>[] = [
    {
      key: "name",
      header: t("drivers.name"),
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
            style={{ background: "var(--admin-brand-soft)", color: "var(--admin-brand)" }}
            aria-hidden
          >
            {initials(r.name)}
          </div>
          <div>
            <div className="font-medium">{r.name}</div>
            {r.phone !== null && r.phone !== "" && (
              <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                {r.phone}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "license",
      header: t("drivers.license"),
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.licenseNo ?? "—"}</span>,
    },
    {
      key: "ibutton",
      header: t("drivers.ibutton"),
      hideOnMobile: true,
      cell: (r) => <span className="mono text-xs">{r.ibutton ?? "—"}</span>,
    },
    {
      key: "account",
      header: t("drivers.account"),
      hideOnMobile: true,
      cell: (r) => accountName(r.accountId),
    },
    {
      key: "status",
      header: t("drivers.status"),
      sortable: true,
      sortValue: (r) => (r.active ? "active" : "inactive"),
      filterValue: (r) => (r.active ? "active" : "inactive"),
      filterOptions: [
        { value: "active", label: t("drivers.active") },
        { value: "inactive", label: t("drivers.inactive") },
      ],
      cell: (r) =>
        r.active ? <Badge tone="success">{t("drivers.active")}</Badge> : <Badge tone="neutral">{t("drivers.inactive")}</Badge>,
    },
  ];

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title={t("drivers.title")} description={t("drivers.desc")}>
        <Sheet
          open={formOpen}
          onOpenChange={(o) => {
            if (o) setAddOpen(true);
            else closeForm();
          }}
        >
          <SheetTrigger asChild>
            <AdminButton>
              <Plus className="h-4 w-4" aria-hidden />
              {t("drivers.add")}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{editing !== null ? t("drivers.editTitle") : t("drivers.addTitle")}</SheetTitle>
            </SheetHeader>
            {/* key remounts the form per target — edit state never leaks across drivers */}
            <DriverForm
              key={editing?.id ?? "new"}
              editing={editing}
              onDone={() => {
                closeForm();
                toast.success(editing !== null ? l.savedDemo : l.createdDemo);
              }}
              onCancel={closeForm}
            />
          </SheetContent>
        </Sheet>
      </PageHeader>

      <DataTable
        data={drivers}
        columns={columns}
        searchKeys={["name", "licenseNo", "ibutton", "phone"]}
        pageSize={10}
        emptyLabel={t("drivers.empty")}
        rowAction={(d) => <DriverRowMenu onEdit={() => setEditingId(d.id)} onDelete={() => setDeleteForId(d.id)} />}
      />

      <DriverScores />

      <Dialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)", color: "var(--admin-ink)" }}
        >
          <DialogHeader>
            <DialogTitle>{t("drivers.delete")}</DialogTitle>
            {deleteFor !== null && (
              <DialogDescription style={{ color: "var(--admin-ink-soft)" }}>
                {t("drivers.deleteSure", { name: deleteFor.name })}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter className="gap-2">
            <AdminButton variant="secondary" onClick={() => setDeleteForId(null)}>
              {t("drivers.cancel")}
            </AdminButton>
            <AdminButton
              variant="danger"
              onClick={() => {
                const d = deleteFor;
                setDeleteForId(null);
                if (d !== null) setDrivers((list) => list.filter((x) => x.id !== d.id));
              }}
            >
              {t("drivers.delete")}
            </AdminButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Per-row "..." actions menu: edit opens the header Sheet prefilled; delete arms the confirm. */
function DriverRowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation("admin");
  const [open, setOpen] = React.useState(false);

  const item = (label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className="block w-full cursor-pointer rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--admin-surface-sunken)]"
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
          aria-label={t("drivers.actions")}
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-44 p-1"
        style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)" }}
      >
        {item(t("drivers.edit"), onEdit)}
        {item(t("drivers.delete"), onDelete, true)}
      </PopoverContent>
    </Popover>
  );
}

/** Safety scores over the last 30 days — trips/distance/score sortable and right-aligned,
 * with the thin score bar next to the badge (scoreVariant drives both colors). */
function DriverScores() {
  const { t } = useTranslation("admin");
  const columns: Column<DemoScore>[] = [
    {
      key: "name",
      header: t("drivers.name"),
      sortable: true,
      sortValue: (r) => r.driverName.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.driverName}</span>,
    },
    {
      key: "trips",
      header: t("drivers.scores.trips"),
      sortable: true,
      sortValue: (r) => r.trips,
      align: "right",
      cell: (r) => (
        <span className="tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>
          {r.trips}
        </span>
      ),
    },
    {
      key: "distance",
      header: t("drivers.scores.distance"),
      sortable: true,
      sortValue: (r) => r.distanceKm,
      align: "right",
      cell: (r) => (
        <span className="tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>
          {fmtNumber(r.distanceKm)} km
        </span>
      ),
    },
    {
      key: "overspeed",
      header: t("drivers.scores.overspeed"),
      align: "right",
      hideOnMobile: true,
      cell: (r) => (
        <span className="tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>
          {r.overspeedEvents}
        </span>
      ),
    },
    {
      key: "score",
      header: t("drivers.scores.score"),
      sortable: true,
      sortValue: (r) => r.score ?? -1,
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.score !== null && (
            <div className="h-1.5 w-16 rounded-full" style={{ background: "var(--admin-hairline)" }} aria-hidden>
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${Math.max(0, Math.min(100, r.score))}%`, background: SCORE_BAR[scoreVariant(r.score)] }}
              />
            </div>
          )}
          <Badge tone={SCORE_TONE[scoreVariant(r.score)]}>{r.score ?? "—"}</Badge>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        {t("drivers.scores.title")}
      </h2>
      <DataTable data={SCORES} columns={columns} searchable={false} pageSize={10} emptyLabel={t("drivers.scores.empty")} />
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
      {label}
      {children}
    </label>
  );
}

function DriverForm({ editing, onDone, onCancel }: {
  editing: DemoDriver | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("admin");
  const [accountId, setAccountId] = React.useState(editing?.accountId ?? ACCOUNTS[0].id);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onDone();
      }}
      className="mt-2 flex flex-col gap-3"
    >
      <FieldLabel label={t("drivers.name")}>
        <AdminInput defaultValue={editing?.name ?? ""} maxLength={120} required />
      </FieldLabel>
      <FieldLabel label={t("drivers.license")}>
        <AdminInput defaultValue={editing?.licenseNo ?? ""} maxLength={60} />
      </FieldLabel>
      <FieldLabel label={t("drivers.ibutton")}>
        <AdminInput defaultValue={editing?.ibutton ?? ""} maxLength={32} placeholder="A1B2C3D4" />
      </FieldLabel>
      <FieldLabel label={t("drivers.phone")}>
        <AdminInput defaultValue={editing?.phone ?? ""} maxLength={40} />
      </FieldLabel>
      {editing === null && (
        <FieldLabel label={t("drivers.account")}>
          <Combobox
            value={accountId}
            onChange={setAccountId}
            options={ACCOUNTS.map((a) => ({ value: a.id, label: a.name }))}
          />
        </FieldLabel>
      )}
      <SheetFooter className="mt-2">
        <AdminButton type="button" variant="secondary" onClick={onCancel}>
          {t("drivers.cancel")}
        </AdminButton>
        <AdminButton type="submit">{editing !== null ? t("drivers.save") : t("drivers.create")}</AdminButton>
      </SheetFooter>
    </form>
  );
}
