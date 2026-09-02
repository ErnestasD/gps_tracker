import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { contentFor, roster } from "@/lib/demo-content";
import { demoZones } from "@/lib/demo-zones";
import { AdminButton, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

/** DEMO mirror of the real product's Audit log page (apps/web app/audit.tsx):
 * tenant mutation trail — filter by entity/action, expand a row to see the
 * before/after snapshot, "load more" pagination. Static data, no backend.
 * All UI strings come from the admin namespace (audit.*). */

type AuditAction = "create" | "update" | "delete";

type DemoAuditRow = {
  id: string;
  at: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  userId: string | null;
  before: unknown;
  after: unknown;
};

const ACTIONS: AuditAction[] = ["create", "update", "delete"];

// Entity type values present in the demo data — labels come from audit.e.*
const ENTITY_KEYS = [
  "device",
  "rule",
  "geofence",
  "user",
  "branding",
  "domain",
  "driver",
  "accountPrefs",
  "apiKey",
  "scheduledReport",
];

/**
 * The log an operator in THIS city would have written.
 *
 * Every value here is text a person typed — device labels, zone names, the dispatcher's address,
 * a colleague's phone number — so it belongs to the operator, not to the platform. It used to be
 * Lithuanian for everyone: a German visitor read their own audit trail recording that somebody
 * renamed "Vilnius 12" and created "Kauno sandėlis". The row STRUCTURE is untouched; only the
 * words are the operator's.
 */
function rowsFor(lang: string): DemoAuditRow[] {
  const c = contentFor(lang);
  const zones = demoZones(lang);
  const people = roster(lang, 8);
  const dispatch = c.dispatchEmail;
  const manager = `${c.dispatchEmail.split("@")[0]}.mgr@${c.domain}`;
  const cityTag = c.towns[0].slice(0, 3).toUpperCase();
  const secondTag = c.towns[1].slice(0, 3).toUpperCase();
  return [
    {
      id: "a-01", at: "2026-08-31 09:41", action: "update", entity: "device",
      entityId: "01J9V4Q2M8KZT3B7NDF5W6H2C4", userId: "9f2c4e71",
      before: { label: `${cityTag}-012`, name: `${c.towns[0]} 12` },
      after: { label: `${cityTag}-012`, name: `${c.towns[0]} 12 (reserve)` },
    },
    {
      id: "a-02", at: "2026-08-31 08:17", action: "create", entity: "geofence",
      entityId: "01J9V3TCM1P8RQXW5KD2N7F9E6", userId: "9f2c4e71",
      before: null,
      after: { name: zones[1].name, type: "polygon", alertOnExit: true },
    },
    {
      id: "a-03", at: "2026-08-30 17:52", action: "update", entity: "rule",
      entityId: "01J9TZR8V4W2XKQ6MB3CD5H7N9", userId: "3b8d15ac",
      before: { name: c.rules.overspeed, threshold: 90, channels: ["email"] },
      after: { name: c.rules.overspeed, threshold: 95, channels: ["email", "webpush"] },
    },
    {
      id: "a-04", at: "2026-08-30 14:05", action: "delete", entity: "apiKey",
      entityId: "01J9TN2WQ7X4KZ8RB1MD6F3C5E", userId: "9f2c4e71",
      before: { name: "Legacy integration", scopes: ["read:positions"] },
      after: null,
    },
    {
      id: "a-05", at: "2026-08-29 11:23", action: "create", entity: "user",
      entityId: "01J9RKX5T2M9WQ4NB7CD8F1E3H", userId: "9f2c4e71",
      before: null,
      after: { email: dispatch, role: "viewer" },
    },
    {
      id: "a-06", at: "2026-08-29 10:48", action: "update", entity: "branding",
      entityId: "01J9RKJ3N6W8XT2QM4BD5C7F9E", userId: "9f2c4e71",
      before: { productName: c.company, primary: "#22d3ee" },
      after: { productName: `${c.company} Track`, primary: "#7c7df5" },
    },
    {
      id: "a-07", at: "2026-08-28 16:34", action: "create", entity: "domain",
      entityId: "01J9P8W2K5X7QT9RM3ND4C6F8E", userId: "3b8d15ac",
      before: null,
      after: { domain: `fleet.${c.domain}`, verified: false },
    },
    {
      id: "a-08", at: "2026-08-28 09:12", action: "update", entity: "driver",
      entityId: "01J9NX4T8M2W6KQ5RB9CD1F7E3", userId: "3b8d15ac",
      before: { name: people[7].name, phone: `${c.phonePrefix}1245678` },
      after: { name: people[7].name, phone: `${c.phonePrefix}5590112` },
    },
    {
      id: "a-09", at: "2026-08-27 15:58", action: "update", entity: "accountPrefs",
      entityId: "01J9MHQ7V3X5WT8KM2ND6C4F9E", userId: "9f2c4e71",
      before: { locale: "en", unitSpeed: "kmh" },
      after: { locale: lang.slice(0, 2), unitSpeed: "kmh" },
    },
    {
      id: "a-10", at: "2026-08-27 08:40", action: "delete", entity: "rule",
      entityId: "01J9M2K8T4W7XQ1RM5BD3C9F6E", userId: "9f2c4e71",
      before: { name: c.rules.idle, threshold: 60 },
      after: null,
    },
    {
      id: "a-11", at: "2026-08-26 13:26", action: "create", entity: "scheduledReport",
      entityId: "01J9JW6Q2M8XKT4NB7RD5C1F3E", userId: "3b8d15ac",
      before: null,
      after: { type: "mileage", cadence: "weekly", recipients: [manager] },
    },
    {
      id: "a-12", at: "2026-08-26 09:03", action: "create", entity: "device",
      entityId: "01J9JN8T5W2XQK7MB4RD9C6F1E", userId: "9f2c4e71",
      before: null,
      after: { imei: "8613270858*****", model: "FMC130", label: `${secondTag}-034` },
    },
    {
      id: "a-13", at: "2026-08-25 17:44", action: "update", entity: "geofence",
      entityId: "01J9H7X2K9M4WT6QB1ND8C5F3E", userId: "3b8d15ac",
      before: { name: zones[0].name, alertOnExit: false },
      after: { name: zones[0].name, alertOnExit: true },
    },
    {
      id: "a-14", at: "2026-08-25 11:19", action: "update", entity: "user",
      entityId: "01J9GTQ4V8X2WK5RM7BD3C6F9E", userId: "9f2c4e71",
      before: { email: dispatch, role: "viewer" },
      after: { email: dispatch, role: "account_manager" },
    },
    {
      id: "a-15", at: "2026-08-24 14:37", action: "delete", entity: "device",
      entityId: "01J9F5W8T1M6XQ3KB9RD2C4F7E", userId: "3b8d15ac",
      before: { imei: "8613270861*****", model: "FMB920", label: `${cityTag}-007` },
      after: null,
    },
  ];
}

const VISIBLE = 10;

const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)" };

function AuditPage() {
  const { t, i18n } = useTranslation("admin");
  const all = React.useMemo(() => rowsFor(i18n.language), [i18n.language]);
  const [entity, setEntity] = React.useState("");
  const [action, setAction] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const filtered = all.filter((r) => (entity === "" || r.entity === entity) && (action === "" || r.action === action));
  const rows = showAll ? filtered : filtered.slice(0, VISIBLE);
  const hasMore = !showAll && filtered.length > VISIBLE;

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title={t("audit.title")} description={t("audit.desc")}>
        <div className="w-44">
          <Combobox
            value={entity}
            onChange={setEntity}
            options={[
              { value: "", label: t("audit.allEntities") },
              ...ENTITY_KEYS.map((value) => ({ value, label: t(`audit.e.${value}`) })),
            ]}
          />
        </div>
        <div className="w-44">
          <Combobox
            value={action}
            onChange={setAction}
            options={[
              { value: "", label: t("audit.allActions") },
              ...ACTIONS.map((a) => ({ value: a, label: t(`audit.a.${a}`) })),
            ]}
          />
        </div>
      </PageHeader>

      <div className="admin-card overflow-hidden">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          {t("audit.trail")}
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {t("audit.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--admin-surface-sunken)" }}>
                  <th className={th} style={thStyle}>{t("audit.when")}</th>
                  <th className={th} style={thStyle}>{t("audit.action")}</th>
                  <th className={th} style={thStyle}>{t("audit.entity")}</th>
                  <th className={th} style={thStyle}>{t("audit.entityId")}</th>
                  <th className={th} style={thStyle}>{t("audit.who")}</th>
                  <th className="px-4 py-2.5"><span className="sr-only">{t("audit.details")}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]">
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--admin-ink-soft)" }}>{r.at}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={r.action === "delete" ? "warning" : "brand"}>{t(`audit.a.${r.action}`)}</Badge>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--admin-ink)" }}>{t(`audit.e.${r.entity}`, { defaultValue: r.entity })}</td>
                      <td className="mono px-4 py-2.5 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{r.entityId}</td>
                      <td className="mono px-4 py-2.5 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{r.userId ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <AdminButton
                          variant="ghost"
                          size="sm"
                          aria-expanded={open === r.id}
                          onClick={() => setOpen((o) => (o === r.id ? null : r.id))}
                        >
                          {open === r.id ? t("audit.hide") : t("audit.details")}
                        </AdminButton>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={6} className="admin-hairline-b p-3" style={{ background: "var(--admin-surface-sunken)" }}>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Snapshot label={t("audit.before")} value={r.before} />
                            <Snapshot label={t("audit.after")} value={r.after} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="admin-hairline-t p-3 text-center">
            <AdminButton variant="secondary" size="sm" onClick={() => setShowAll(true)}>
              {t("audit.loadMore")}
            </AdminButton>
          </div>
        )}
      </div>
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="pb-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>{label}</div>
      <pre
        className="mono max-h-64 overflow-auto rounded-md border p-2 text-xs"
        style={{ borderColor: "var(--admin-hairline)", background: "var(--admin-surface)", color: "var(--admin-ink)" }}
      >
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
