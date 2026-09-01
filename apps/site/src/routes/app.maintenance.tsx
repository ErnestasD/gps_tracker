import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, MoreHorizontal, Plus, Trash2, Wrench } from "lucide-react";
import { fmtDate } from "@/lib/admin-format";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { PageHeader, AdminButton, Badge, AdminInput, StatCard } from "@/components/admin/AdminKit";
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

export const Route = createFileRoute("/app/maintenance")({
  component: MaintenancePage,
});

// ---------------------------------------------------------------------------
// Static demo data — mirrors the real product's MaintenanceView rows.
// ---------------------------------------------------------------------------

type MaintStatus = "ok" | "due_soon" | "overdue" | "unknown";

type DemoMaint = {
  id: string;
  deviceName: string;
  title: string;
  intervalKm: number | null;
  intervalDays: number | null;
  intervalEngineH: number | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
  engineHRemaining: number | null;
  predictedDueAt: string | null;
  status: MaintStatus;
};

/** Demo-only copy that has no counterpart in the real product's locale files. */
const L: Record<Lang, { reminderSaved: string; serviced: string; planCreated: string; servicePh: string }> = {
  lt: {
    reminderSaved: "Priminimas išsaugotas (demo)",
    serviced: "Aptarnavimas užregistruotas (demo)",
    planCreated: "Planas sukurtas (demo)",
    servicePh: "pvz. Alyvos keitimas",
  },
  en: {
    reminderSaved: "Reminder saved (demo)",
    serviced: "Service recorded (demo)",
    planCreated: "Plan created (demo)",
    servicePh: "e.g. Oil change",
  },
  pl: {
    reminderSaved: "Przypomnienie zapisane (demo)",
    serviced: "Serwis zarejestrowany (demo)",
    planCreated: "Plan utworzony (demo)",
    servicePh: "np. Wymiana oleju",
  },
  de: {
    reminderSaved: "Erinnerung gespeichert (Demo)",
    serviced: "Wartung erfasst (Demo)",
    planCreated: "Plan erstellt (Demo)",
    servicePh: "z. B. Ölwechsel",
  },
};

function useL() {
  const { i18n } = useTranslation("admin");
  const lang = (i18n.resolvedLanguage ?? "lt").slice(0, 2) as Lang;
  return L[LANGUAGES.includes(lang) ? lang : "lt"];
}

const DEVICES = [
  { id: "dev_0001", name: "Van 01", plate: "KTU 421" },
  { id: "dev_0002", name: "Van 02", plate: "JRD 218" },
  { id: "dev_0003", name: "Truck 03", plate: "LKS 774" },
  { id: "dev_0004", name: "Sprinter 04", plate: "BVX 305" },
  { id: "dev_0005", name: "Truck 05", plate: "RRT 660" },
  { id: "dev_0006", name: "Van 06", plate: "DKP 148" },
];

const MAINT: DemoMaint[] = [
  { id: "mnt_01", deviceName: "Van 01", title: "Alyvos keitimas", intervalKm: 15000, intervalDays: 365, intervalEngineH: null, kmRemaining: 1240, daysRemaining: 96, engineHRemaining: null, predictedDueAt: "2026-09-18", status: "due_soon" },
  { id: "mnt_02", deviceName: "Truck 03", title: "Padangų sukeitimas", intervalKm: 40000, intervalDays: null, intervalEngineH: null, kmRemaining: -860, daysRemaining: null, engineHRemaining: null, predictedDueAt: "2026-08-21", status: "overdue" },
  { id: "mnt_03", deviceName: "Van 02", title: "Techninė apžiūra", intervalKm: null, intervalDays: 365, intervalEngineH: null, kmRemaining: null, daysRemaining: 3, engineHRemaining: null, predictedDueAt: "2026-09-04", status: "due_soon" },
  { id: "mnt_04", deviceName: "Sprinter 04", title: "Stabdžių kaladėlės", intervalKm: 30000, intervalDays: null, intervalEngineH: null, kmRemaining: 12480, daysRemaining: null, engineHRemaining: null, predictedDueAt: "2026-11-02", status: "ok" },
  { id: "mnt_05", deviceName: "Truck 05", title: "Filtrų keitimas", intervalKm: 20000, intervalDays: 180, intervalEngineH: null, kmRemaining: 6910, daysRemaining: 74, engineHRemaining: null, predictedDueAt: "2026-10-06", status: "ok" },
  { id: "mnt_06", deviceName: "Van 06", title: "Tachografo patikra", intervalKm: null, intervalDays: 730, intervalEngineH: null, kmRemaining: null, daysRemaining: -12, engineHRemaining: null, predictedDueAt: "2026-08-20", status: "overdue" },
  { id: "mnt_07", deviceName: "Truck 03", title: "Variklio diagnostika", intervalKm: null, intervalDays: null, intervalEngineH: 500, kmRemaining: null, daysRemaining: null, engineHRemaining: 210, predictedDueAt: null, status: "ok" },
  { id: "mnt_08", deviceName: "Van 02", title: "Kuro filtras", intervalKm: 25000, intervalDays: null, intervalEngineH: null, kmRemaining: null, daysRemaining: null, engineHRemaining: null, predictedDueAt: null, status: "unknown" },
];

type DemoPlan = {
  id: string;
  name: string;
  items: { title: string; intervalKm: number | null; intervalDays: number | null; intervalEngineH: number | null }[];
};

const PLANS: DemoPlan[] = [
  {
    id: "pln_01",
    name: "Standartinis servisas",
    items: [
      { title: "Alyvos keitimas", intervalKm: 15000, intervalDays: 365, intervalEngineH: null },
      { title: "Padangų sukeitimas", intervalKm: 10000, intervalDays: null, intervalEngineH: null },
      { title: "Techninė apžiūra", intervalKm: null, intervalDays: 365, intervalEngineH: null },
    ],
  },
  {
    id: "pln_02",
    name: "Sunkvežimių planas",
    items: [
      { title: "Alyvos keitimas", intervalKm: 30000, intervalDays: null, intervalEngineH: null },
      { title: "Tachografo patikra", intervalKm: null, intervalDays: 730, intervalEngineH: null },
    ],
  },
];

/** doc kind → real-product fleet.docKind.* key suffix; titles stay data. */
const EXPIRING_DOCS = [
  { id: "doc_01", deviceName: "Truck 03", kind: "inspection", title: "Metinė TA", validTo: "2026-08-27", overdueDays: 5, daysLeft: null as number | null },
  { id: "doc_02", deviceName: "Van 02", kind: "insurance", title: "Kasko draudimas", validTo: "2026-09-12", overdueDays: null as number | null, daysLeft: 11 },
  { id: "doc_03", deviceName: "Van 06", kind: "tachograph", title: "Patikros sertifikatas", validTo: "2026-09-24", overdueDays: null as number | null, daysLeft: 23 },
];

/** due status → badge tone, mirroring the product's unit-tested dueVariant mapping. */
const STATUS_TONE: Record<MaintStatus, "success" | "warning" | "danger" | "neutral"> = {
  ok: "success",
  due_soon: "warning",
  overdue: "danger",
  unknown: "neutral",
};
/** due status → real-product translation key (admin namespace). */
const STATUS_KEY: Record<MaintStatus, string> = {
  ok: "maint.status.ok",
  due_soon: "maint.status.due_soon",
  overdue: "maint.status.overdue",
  unknown: "maint.status.unknown",
};
/** due status → sort rank (most urgent first when ascending). */
const STATUS_RANK: Record<MaintStatus, number> = { overdue: 0, due_soon: 1, ok: 2, unknown: 3 };

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** The interval label, e.g. "kas 15000 km · kas 365 d." */
const intervalLabel = (
  t: TFn,
  r: { intervalKm: number | null; intervalDays: number | null; intervalEngineH: number | null },
): string =>
  [
    r.intervalKm !== null ? t("maint.everyKm", { n: r.intervalKm }) : null,
    r.intervalDays !== null ? t("maint.everyDays", { n: r.intervalDays }) : null,
    r.intervalEngineH !== null ? t("maint.everyEngineH", { n: r.intervalEngineH }) : null,
  ]
    .filter((p) => p !== null)
    .join(" · ");

/** The remaining-until-due label (km and/or days), e.g. "liko 1240 km · liko 96 d." */
const remaining = (t: TFn, r: DemoMaint): string =>
  [
    r.kmRemaining !== null ? t("maint.kmLeft", { n: r.kmRemaining }) : null,
    r.daysRemaining !== null ? t("maint.daysLeft", { n: r.daysRemaining }) : null,
    r.engineHRemaining !== null ? t("maint.hLeft", { n: r.engineHRemaining }) : null,
  ]
    .filter((p) => p !== null)
    .join(" · ");

function MaintenancePage() {
  const { t } = useTranslation("admin");
  const l = useL();
  const [items, setItems] = React.useState<DemoMaint[]>(MAINT);
  const [addOpen, setAddOpen] = React.useState(false);
  const [servicedForId, setServicedForId] = React.useState<string | null>(null);
  const [deleteForId, setDeleteForId] = React.useState<string | null>(null);

  const okCount = items.filter((m) => m.status === "ok").length;
  const dueCount = items.filter((m) => m.status === "due_soon").length;
  const overdueCount = items.filter((m) => m.status === "overdue").length;

  const servicedFor = items.find((m) => m.id === servicedForId) ?? null;
  const deleteFor = items.find((m) => m.id === deleteForId) ?? null;

  const columns: Column<DemoMaint>[] = [
    {
      key: "device",
      header: t("maint.device"),
      sortable: true,
      sortValue: (r) => r.deviceName.toLowerCase(),
      cell: (r) => <span className="font-medium">{r.deviceName}</span>,
    },
    { key: "service", header: t("maint.itemTitle"), sortable: true, sortValue: (r) => r.title.toLowerCase(), cell: (r) => r.title },
    {
      key: "interval",
      header: t("maint.interval"),
      hideOnMobile: true,
      align: "right",
      cell: (r) => (
        <span className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
          {intervalLabel(t, r)}
        </span>
      ),
    },
    {
      key: "remaining",
      header: t("maint.remaining"),
      align: "right",
      cell: (r) => (
        <span className="text-xs tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>
          {remaining(t, r) || "—"}
        </span>
      ),
    },
    {
      key: "forecast",
      header: t("maint.forecast"),
      hideOnMobile: true,
      align: "right",
      sortable: true,
      sortValue: (r) => r.predictedDueAt ?? "9999",
      cell: (r) => (
        <span className="text-xs tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>
          {r.predictedDueAt !== null ? fmtDate(r.predictedDueAt) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: t("maint.statusHeader"),
      sortable: true,
      sortValue: (r) => STATUS_RANK[r.status],
      filterValue: (r) => r.status,
      filterOptions: [
        { value: "ok", label: t("maint.status.ok") },
        { value: "due_soon", label: t("maint.status.due_soon") },
        { value: "overdue", label: t("maint.status.overdue") },
        { value: "unknown", label: t("maint.status.unknown") },
      ],
      cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(STATUS_KEY[r.status])}</Badge>,
    },
  ];

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title={t("maint.title")} description={t("maint.desc")}>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <AdminButton>
              <Plus className="h-4 w-4" aria-hidden />
              {t("maint.add")}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t("maint.addTitle")}</SheetTitle>
            </SheetHeader>
            <MaintForm
              onCreated={() => {
                setAddOpen(false);
                toast.success(l.reminderSaved);
              }}
              onCancel={() => setAddOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard
          label={t("maint.stat.ok")}
          hint={t("maint.stat.okHint")}
          value={<><CheckCircle2 className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-success)" }} />{okCount}</>}
        />
        <StatCard
          label={t("maint.stat.due")}
          hint={t("maint.stat.dueHint")}
          value={<><Wrench className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-warning)" }} />{dueCount}</>}
        />
        <StatCard
          label={t("maint.stat.overdue")}
          hint={t("maint.stat.overdueHint")}
          value={<><AlertTriangle className="mr-2 inline h-5 w-5" style={{ color: "var(--admin-danger)" }} />{overdueCount}</>}
        />
      </div>

      <DataTable
        data={items}
        columns={columns}
        searchKeys={["title", "deviceName"]}
        pageSize={10}
        emptyLabel={t("maint.empty")}
        rowAction={(m) => (
          <MaintRowMenu onServiced={() => setServicedForId(m.id)} onDelete={() => setDeleteForId(m.id)} />
        )}
      />

      <PlansSection />
      <ExpiringDocsSection />

      {/* mark-serviced re-baselines the countdown and records the service into history —
          the sheet captures the optional cost/vendor/notes */}
      <Sheet open={servicedFor !== null} onOpenChange={(o) => { if (!o) setServicedForId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("maint.markServiced")}</SheetTitle>
          </SheetHeader>
          {servicedFor !== null && (
            <ServicedForm
              key={servicedFor.id}
              item={servicedFor}
              onDone={() => {
                setServicedForId(null);
                toast.success(l.serviced);
              }}
              onCancel={() => setServicedForId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null);
        }}
        title={t("maint.delete")}
        description={deleteFor !== null ? t("maint.deleteSure", { title: deleteFor.title }) : undefined}
        confirmLabel={t("maint.delete")}
        onConfirm={() => {
          const m = deleteFor;
          if (m !== null) setItems((list) => list.filter((x) => x.id !== m.id));
        }}
      />
    </div>
  );
}

/** Danger confirm dialog (product ConfirmDialog equivalent, on the site's ui/dialog). */
function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("admin");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)", color: "var(--admin-ink)" }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription style={{ color: "var(--admin-ink-soft)" }}>{description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="gap-2">
          <AdminButton variant="secondary" onClick={() => onOpenChange(false)}>
            {t("admin.cancel")}
          </AdminButton>
          <AdminButton
            variant="danger"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </AdminButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Per-row "..." actions menu: mark serviced opens the sheet; delete arms the confirm. */
function MaintRowMenu({ onServiced, onDelete }: { onServiced: () => void; onDelete: () => void }) {
  const { t } = useTranslation("admin");
  const [open, setOpen] = React.useState(false);

  const entry = (label: string, onClick: () => void, danger = false) => (
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
          aria-label={t("maint.actions")}
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors hover:bg-[var(--admin-surface-sunken)]"
        >
          <MoreHorizontal className="h-4 w-4" style={{ color: "var(--admin-ink-soft)" }} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-48 p-1"
        style={{ background: "var(--admin-surface)", borderColor: "var(--admin-hairline)" }}
      >
        {entry(t("maint.markServiced"), onServiced)}
        {entry(t("maint.delete"), onDelete, true)}
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

function MaintForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { t } = useTranslation("admin");
  const l = useL();
  const [deviceId, setDeviceId] = React.useState(DEVICES[0].id);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreated();
      }}
      className="mt-2 flex flex-col gap-3"
    >
      <Field label={t("maint.device")}>
        <Combobox
          value={deviceId}
          onChange={setDeviceId}
          options={DEVICES.map((d) => ({ value: d.id, label: d.name, hint: d.plate }))}
        />
      </Field>
      <Field label={t("maint.itemTitle")}>
        <AdminInput maxLength={120} placeholder={l.servicePh} required />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("maint.intervalKm")}>
          <AdminInput type="number" min={1} placeholder="15000" />
        </Field>
        <Field label={t("maint.intervalDays")}>
          <AdminInput type="number" min={1} placeholder="180" />
        </Field>
      </div>
      <Field label={t("maint.intervalEngineH")}>
        <AdminInput type="number" min={1} />
      </Field>
      {/* no placeholder: a blank field baselines to the device's current odometer */}
      <Field label={t("maint.currentOdo")}>
        <AdminInput type="number" min={0} />
      </Field>
      <SheetFooter className="mt-2">
        <AdminButton type="button" variant="secondary" onClick={onCancel}>
          {t("admin.cancel")}
        </AdminButton>
        <AdminButton type="submit">{t("maint.create")}</AdminButton>
      </SheetFooter>
    </form>
  );
}

/** The serviced form — one confirm that re-baselines the reminder and records the
 * completed service (cost/vendor/notes optional) into the vehicle's history. */
function ServicedForm({ item, onDone, onCancel }: { item: DemoMaint; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation("admin");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onDone();
      }}
      className="mt-2 flex flex-col gap-3"
    >
      <p className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>
        {t("maint.servicedSure", { title: item.title })}
      </p>
      <Field label={t("maint.servicedCost")}>
        <AdminInput type="number" min={0} step="0.01" />
      </Field>
      <Field label={t("maint.servicedVendor")}>
        <AdminInput maxLength={160} />
      </Field>
      <Field label={t("maint.servicedNotes")}>
        <AdminInput maxLength={2000} />
      </Field>
      <SheetFooter className="mt-2">
        <AdminButton type="button" variant="secondary" onClick={onCancel}>
          {t("admin.cancel")}
        </AdminButton>
        <AdminButton type="submit">{t("maint.markServiced")}</AdminButton>
      </SheetFooter>
    </form>
  );
}

/** Maintenance plan templates — define interval sets once, apply to many vehicles. */
function PlansSection() {
  const { t } = useTranslation("admin");
  const l = useL();
  const [plans, setPlans] = React.useState<DemoPlan[]>(PLANS);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [applyFor, setApplyFor] = React.useState<DemoPlan | null>(null);
  const [deleteFor, setDeleteFor] = React.useState<DemoPlan | null>(null);
  const [applied, setApplied] = React.useState<string | null>(null);

  return (
    <div className="admin-card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{t("maint.plans")}</div>
          <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
            {t("maint.plansDesc")}
          </p>
        </div>
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetTrigger asChild>
            <AdminButton variant="secondary">
              <Plus className="h-4 w-4" aria-hidden />
              {t("maint.planAdd")}
            </AdminButton>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t("maint.planAdd")}</SheetTitle>
            </SheetHeader>
            <PlanForm
              onCreated={() => {
                setCreateOpen(false);
                toast.success(l.planCreated);
              }}
              onCancel={() => setCreateOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
      {plans.length === 0 && (
        <p className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>{t("maint.plansEmpty")}</p>
      )}
      <div className="space-y-1">
        {plans.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "var(--admin-hairline)" }}
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              {p.items.map((i) => `${i.title} (${intervalLabel(t, i)})`).join(" · ")}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <AdminButton variant="secondary" onClick={() => setApplyFor(p)}>{t("maint.planApply")}</AdminButton>
              <button
                type="button"
                aria-label={t("maint.delete")}
                onClick={() => setDeleteFor(p)}
                className="grid h-7 w-7 cursor-pointer place-items-center rounded transition-colors hover:bg-[var(--admin-surface-sunken)]"
              >
                <Trash2 className="h-3.5 w-3.5" style={{ color: "var(--admin-danger)" }} aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
      {applied !== null && <p className="text-xs" style={{ color: "var(--admin-success)" }}>{applied}</p>}

      <Sheet open={applyFor !== null} onOpenChange={(o) => { if (!o) setApplyFor(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{applyFor !== null ? t("maint.planApplyTitle", { name: applyFor.name }) : ""}</SheetTitle>
          </SheetHeader>
          {applyFor !== null && (
            <PlanApplyForm
              key={applyFor.id}
              onApply={(n) => {
                setApplied(t("maint.planApplied", { created: n * applyFor.items.length, skipped: applyFor.items.length }));
                setApplyFor(null);
              }}
              onCancel={() => setApplyFor(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteFor(null);
        }}
        title={t("maint.planDelete")}
        description={deleteFor !== null ? t("maint.planDeleteSure", { name: deleteFor.name }) : undefined}
        confirmLabel={t("maint.delete")}
        onConfirm={() => {
          const p = deleteFor;
          if (p !== null) setPlans((list) => list.filter((x) => x.id !== p.id));
        }}
      />
    </div>
  );
}

/** Plan create form: up to five interval rows. */
function PlanForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { t } = useTranslation("admin");
  const [rowCount, setRowCount] = React.useState(1);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreated();
      }}
      className="mt-2 flex flex-col gap-3"
    >
      <Field label={t("maint.planName")}>
        <AdminInput maxLength={120} required />
      </Field>
      {Array.from({ length: rowCount }, (_, i) => (
        <div key={i} className="space-y-2 rounded-md border p-2" style={{ borderColor: "var(--admin-hairline)" }}>
          <Field label={t("maint.itemTitle")}>
            <AdminInput maxLength={120} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t("maint.intervalKm")}>
              <AdminInput type="number" min={1} />
            </Field>
            <Field label={t("maint.intervalDays")}>
              <AdminInput type="number" min={1} />
            </Field>
            <Field label={t("maint.intervalEngineH")}>
              <AdminInput type="number" min={1} />
            </Field>
          </div>
        </div>
      ))}
      {rowCount < 5 && (
        <AdminButton type="button" variant="secondary" onClick={() => setRowCount((n) => n + 1)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("maint.planAddItem")}
        </AdminButton>
      )}
      <SheetFooter className="mt-2">
        <AdminButton type="button" variant="secondary" onClick={onCancel}>
          {t("admin.cancel")}
        </AdminButton>
        <AdminButton type="submit">{t("maint.create")}</AdminButton>
      </SheetFooter>
    </form>
  );
}

/** Device multi-select for plan apply: check the vehicles (or all) the plan lands on. */
function PlanApplyForm({ onApply, onCancel }: { onApply: (n: number) => void; onCancel: () => void }) {
  const { t } = useTranslation("admin");
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allChecked = checked.size === DEVICES.length;

  return (
    <div className="mt-2 flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--admin-ink)" }}>
        <input
          type="checkbox"
          checked={allChecked}
          onChange={() => setChecked(allChecked ? new Set() : new Set(DEVICES.map((d) => d.id)))}
        />
        {t("maint.planApplyAll", { n: DEVICES.length })}
      </label>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2" style={{ borderColor: "var(--admin-hairline)" }}>
        {DEVICES.map((d) => (
          <label key={d.id} className="flex items-center gap-2 text-sm" style={{ color: "var(--admin-ink)" }}>
            <input type="checkbox" checked={checked.has(d.id)} onChange={() => toggle(d.id)} />
            {d.name} ({d.plate})
          </label>
        ))}
      </div>
      <SheetFooter className="mt-2">
        <AdminButton type="button" variant="secondary" onClick={onCancel}>
          {t("admin.cancel")}
        </AdminButton>
        <AdminButton type="button" disabled={checked.size === 0} onClick={() => onApply(checked.size)}>
          {t("maint.planApplyN", { n: checked.size })}
        </AdminButton>
      </SheetFooter>
    </div>
  );
}

/** Fleet-wide expiring documents — the "act this month" list (due soon + overdue). */
function ExpiringDocsSection() {
  const { t } = useTranslation("admin");
  return (
    <div className="admin-card space-y-2 p-4">
      <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{t("maint.expiringDocs")}</div>
      <div className="space-y-1">
        {EXPIRING_DOCS.map((doc) => (
          <div
            key={doc.id}
            className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "var(--admin-hairline)" }}
          >
            <span className="font-medium">{doc.deviceName}</span>
            <span style={{ color: "var(--admin-ink-soft)" }}>{t(`fleet.docKind.${doc.kind}`)} · {doc.title}</span>
            <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>
              {fmtDate(doc.validTo)}
            </span>
            <Badge tone={doc.overdueDays !== null ? "danger" : "warning"}>
              {doc.overdueDays !== null
                ? t("fleet.docOverdue", { n: doc.overdueDays })
                : t("fleet.docDays", { n: doc.daysLeft ?? 0 })}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
