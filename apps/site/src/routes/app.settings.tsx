import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AdminButton, AdminInput, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

/** DEMO mirror of the real product's Settings page (apps/web app/settings.tsx), speaking the
 * product's own translations (admin namespace, settings.*): tab strip (profile / security /
 * notifications / data), profile card with account defaults (settings.accountTz.*) and display
 * prefs (settings.display.*). Static data, no backend — controls only mutate local state. */

/** t as the pages use it: plain dotted-key lookup into the admin namespace. */
type Tr = (key: string) => string;

const TABS = ["profile", "security", "notifications", "data"] as const;
type TabId = (typeof TABS)[number];

const TIMEZONES = [
  "UTC",
  "Europe/Vilnius",
  "Europe/Riga",
  "Europe/Tallinn",
  "Europe/Warsaw",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/London",
  "Europe/Stockholm",
  "Europe/Helsinki",
  "Europe/Kyiv",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

// Language endonyms are deliberately untranslated (each language names itself).
const LOCALE_LABELS = [
  { value: "en", label: "English" },
  { value: "lt", label: "Lietuvių" },
  { value: "pl", label: "Polski" },
  { value: "de", label: "Deutsch" },
];

const speedOptions = (t: Tr) => [
  { value: "kmh", label: t("units.kmh") },
  { value: "mph", label: t("units.mph") },
];
const distanceOptions = (t: Tr) => [
  { value: "km", label: t("settings.display.km") },
  { value: "mi", label: t("settings.display.mi") },
];
const volumeOptions = (t: Tr) => [
  { value: "l", label: t("settings.display.l") },
  { value: "gal", label: t("settings.display.gal") },
];

const th = "py-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider";
const thStyle: React.CSSProperties = { color: "var(--admin-ink-soft)" };

function SelectRow({
  label,
  value,
  onChange,
  options,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  wide?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: "var(--admin-ink-soft)" }}>{label}</span>
      <div className={wide ? "w-56" : "w-44"}>
        <Combobox value={value} onChange={onChange} options={options} />
      </div>
    </div>
  );
}

function SettingsPage() {
  const { t } = useTranslation("admin");
  const [activeTab, setActiveTab] = React.useState<TabId>("profile");
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  const [locale, setLocale] = React.useState("lt");

  return (
    <div className="space-y-4 p-4 md:p-8">
      <PageHeader className="mb-0" title={t("settings.title")} />

      {/* tab bar: active tab gets the brand underline, like the real dashboard */}
      <div className="admin-hairline-b flex gap-1" role="tablist" aria-label={t("settings.title")}>
        {TABS.map((id) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-controls={`settings-panel-${id}`}
              aria-selected={active}
              onClick={() => setActiveTab(id)}
              className="-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition-colors"
              style={{
                color: active ? "var(--admin-brand)" : "var(--admin-ink-soft)",
                background: active ? "var(--admin-brand-soft)" : "transparent",
                borderBottom: active ? "2px solid var(--admin-brand)" : "2px solid transparent",
              }}
            >
              {t(`settings.tab.${id}`)}
            </button>
          );
        })}
      </div>

      {/* Profile: identity + appearance + account defaults + display prefs */}
      <div role="tabpanel" id="settings-panel-profile" hidden={activeTab !== "profile"} aria-labelledby="settings-tab-profile" className="admin-card">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          {t("settings.profile")}
        </div>
        <div className="space-y-4 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--admin-ink-soft)" }}>{t("settings.email")}</span>
            <span className="mono text-xs" style={{ color: "var(--admin-ink)" }}>demo@orbetra.test</span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--admin-ink-soft)" }}>{t("settings.role")}</span>
            <Badge tone="neutral">{t("roles.tsp_admin")}</Badge>
          </div>
          <div className="admin-hairline-t flex items-center justify-between pt-4">
            <span style={{ color: "var(--admin-ink-soft)" }}>{t("settings.locale")}</span>
            <div className="w-28">
              <Combobox
                value={locale}
                onChange={setLocale}
                options={LOCALE_LABELS.map((l) => ({ value: l.value, label: l.value.toUpperCase() }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--admin-ink-soft)" }}>{t("settings.theme")}</span>
            <div className="flex gap-2">
              {(["dark", "light"] as const).map((value) => (
                <AdminButton
                  key={value}
                  variant={theme === value ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setTheme(value)}
                >
                  {t(`settings.themeOption.${value}`)}
                </AdminButton>
              ))}
            </div>
          </div>
          <AccountDefaultsSection />
          <DisplayPrefsSection />
        </div>
      </div>

      {/* Security: password change */}
      <div role="tabpanel" id="settings-panel-security" hidden={activeTab !== "security"} aria-labelledby="settings-tab-security" className="admin-card">
        <PasswordSection />
      </div>

      {/* Notifications: browser push */}
      <div role="tabpanel" id="settings-panel-notifications" hidden={activeTab !== "notifications"} aria-labelledby="settings-tab-notifications">
        <PushSection />
      </div>

      {/* Data: GDPR export */}
      <div role="tabpanel" id="settings-panel-data" hidden={activeTab !== "data"} aria-labelledby="settings-tab-data">
        <ExportSection />
      </div>
    </div>
  );
}

/** The account's server-side defaults: what reports and alert e-mails are rendered with. */
function AccountDefaultsSection() {
  const { t } = useTranslation("admin");
  const [tz, setTz] = React.useState("Europe/Vilnius");
  const [locale, setLocale] = React.useState("lt");
  const [speed, setSpeed] = React.useState("kmh");
  const [distance, setDistance] = React.useState("km");
  const [volume, setVolume] = React.useState("l");
  const [saved, setSaved] = React.useState(false);

  return (
    <div className="admin-hairline-t space-y-3 pt-4">
      <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        {t("settings.accountTz.title")}
      </div>
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        {t("settings.accountTz.hint")}
      </p>
      <div className="space-y-3 text-sm">
        <SelectRow wide label={t("settings.accountTz.tz")} value={tz} onChange={setTz} options={TIMEZONES.map((z) => ({ value: z, label: z }))} />
        <SelectRow wide label={t("settings.accountTz.locale")} value={locale} onChange={setLocale} options={LOCALE_LABELS} />
        <SelectRow wide label={t("settings.display.speed")} value={speed} onChange={setSpeed} options={speedOptions(t)} />
        <SelectRow wide label={t("settings.display.distance")} value={distance} onChange={setDistance} options={distanceOptions(t)} />
        <SelectRow wide label={t("settings.display.volume")} value={volume} onChange={setVolume} options={volumeOptions(t)} />
      </div>
      <div className="flex items-center gap-2">
        <AdminButton type="button" onClick={() => setSaved(true)}>
          {t("settings.accountTz.save")}
        </AdminButton>
        {saved && (
          <p role="status" className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            {t("settings.accountTz.saved")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Display preferences: this browser only — time/date format, units, map provider. */
function DisplayPrefsSection() {
  const { t } = useTranslation("admin");
  const [timeFormat, setTimeFormat] = React.useState("24h");
  const [timeZone, setTimeZone] = React.useState("auto");
  const [dateFormat, setDateFormat] = React.useState("auto");
  const [speed, setSpeed] = React.useState("kmh");
  const [distance, setDistance] = React.useState("km");
  const [volume, setVolume] = React.useState("l");
  const [mapProvider, setMapProvider] = React.useState("mapbox");
  const [mapScheme, setMapScheme] = React.useState("auto");

  const tzOptions = [
    { value: "auto", label: t("settings.display.tzAuto") },
    ...TIMEZONES.map((z) => ({ value: z, label: z })),
  ];

  return (
    <div className="admin-hairline-t space-y-4 pt-4">
      <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        {t("settings.display.title")}
      </div>
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        {t("settings.display.browserNote")}
      </p>
      <SelectRow label={t("settings.display.timeFormat")} value={timeFormat} onChange={setTimeFormat} options={[
        { value: "24h", label: t("settings.display.h24") },
        { value: "12h", label: t("settings.display.h12") },
      ]} />
      <SelectRow wide label={t("settings.display.timeZone")} value={timeZone} onChange={setTimeZone} options={tzOptions} />
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        {t("settings.display.tzNote")}
      </p>
      <SelectRow label={t("settings.display.dateFormat")} value={dateFormat} onChange={setDateFormat} options={[
        { value: "auto", label: t("settings.display.dfAuto") },
        { value: "ymd", label: "YYYY-MM-DD" },
        { value: "dmy", label: "DD.MM.YYYY" },
        { value: "mdy", label: "MM/DD/YYYY" },
      ]} />
      <SelectRow label={t("settings.display.speed")} value={speed} onChange={setSpeed} options={speedOptions(t)} />
      <SelectRow label={t("settings.display.distance")} value={distance} onChange={setDistance} options={distanceOptions(t)} />
      <SelectRow label={t("settings.display.volume")} value={volume} onChange={setVolume} options={volumeOptions(t)} />
      <SelectRow label={t("settings.display.mapProvider")} value={mapProvider} onChange={setMapProvider} options={[
        { value: "mapbox", label: "Mapbox" },
        { value: "google", label: "Google Maps" },
      ]} />
      <SelectRow label={t("settings.display.mapScheme")} value={mapScheme} onChange={setMapScheme} options={[
        { value: "auto", label: t("settings.display.mapSchemeAuto") },
        { value: "light", label: t("settings.display.mapSchemeLight") },
        { value: "dark", label: t("settings.display.mapSchemeDark") },
      ]} />
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        {t("settings.display.mapNote")}
      </p>
    </div>
  );
}

function PasswordSection() {
  const { t } = useTranslation("admin");
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [changed, setChanged] = React.useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setChanged(true);
    setCurrent("");
    setNext("");
  };

  return (
    <>
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        {t("settings.password.title")}
      </div>
      <div className="p-4">
        <form onSubmit={submit} className="space-y-3">
          <AdminInput
            type="password"
            autoComplete="current-password"
            aria-label={t("settings.password.current")}
            placeholder={t("settings.password.current")}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <AdminInput
            type="password"
            autoComplete="new-password"
            aria-label={t("settings.password.new")}
            placeholder={t("settings.password.new")}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
          />
          {changed && (
            <p role="status" className="text-sm" style={{ color: "var(--admin-success)" }}>
              {t("settings.password.changed")}
            </p>
          )}
          <AdminButton type="submit" disabled={current === "" || next.length < 8}>
            {t("settings.password.submit")}
          </AdminButton>
        </form>
      </div>
    </>
  );
}

function PushSection() {
  const { t } = useTranslation("admin");
  const [enabled, setEnabled] = React.useState(false);

  return (
    <div className="admin-card">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        {t("settings.push.title")}
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
          {t("settings.push.hint")}
        </p>
        <div className="flex items-center gap-3">
          <AdminButton variant={enabled ? "secondary" : "primary"} size="sm" onClick={() => setEnabled((v) => !v)}>
            {enabled ? t("settings.push.disable") : t("settings.push.enable")}
          </AdminButton>
          <Badge tone={enabled ? "success" : "neutral"}>{enabled ? t("settings.push.on") : t("settings.push.off")}</Badge>
        </div>
      </div>
    </div>
  );
}

type ExportJob = { id: string; requestedAt: string; status: "pending" | "done" };

function ExportSection() {
  const { t } = useTranslation("admin");
  const [account, setAccount] = React.useState("acc-demo");
  const [jobs, setJobs] = React.useState<ExportJob[]>([
    { id: "exp-1", requestedAt: "2026-08-12 09:14", status: "done" },
  ]);

  const request = (e: React.FormEvent) => {
    e.preventDefault();
    setJobs((prev) => [{ id: `exp-${prev.length + 1}`, requestedAt: "2026-08-31 10:02", status: "pending" }, ...prev]);
  };

  return (
    <div className="admin-card">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        {t("settings.export.title")}
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
          {t("settings.export.hint")}
        </p>
        <form onSubmit={request} className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
            {t("settings.export.account")}
            <div className="w-52">
              <Combobox
                value={account}
                onChange={setAccount}
                options={[{ value: "acc-demo", label: "Demo Logistics UAB" }]}
              />
            </div>
          </label>
          <AdminButton type="submit">{t("settings.export.request")}</AdminButton>
        </form>
        <table className="w-full text-sm">
          <thead>
            <tr className="admin-hairline-b">
              <th className={th} style={thStyle}>{t("settings.export.requested")}</th>
              <th className={th} style={thStyle}>{t("settings.export.status")}</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="admin-hairline-b last:border-b-0">
                <td className="py-2 pr-4 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{j.requestedAt}</td>
                <td className="py-2 pr-4">
                  <Badge tone={j.status === "done" ? "success" : "neutral"}>
                    {j.status === "done" ? t("settings.export.st.done") : t("settings.export.st.pending")}
                  </Badge>
                </td>
                <td className="py-2 pr-4 text-right">
                  {j.status === "done" && (
                    <AdminButton variant="secondary" size="sm">
                      {t("settings.export.download")}
                    </AdminButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
