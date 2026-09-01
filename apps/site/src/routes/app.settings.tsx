import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { AdminButton, AdminInput, Badge, PageHeader } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

/** DEMO mirror of the real product's Settings page (apps/web app/settings.tsx):
 * tab strip (Profilis / Sauga / Pranešimai / Duomenys), profile card with account
 * defaults ("Ataskaitos ir el. laiškai") and display prefs ("Rodymo nustatymai").
 * Static data, no backend — controls only mutate local state. */

const TABS = [
  { id: "profile", label: "Profilis" },
  { id: "security", label: "Sauga" },
  { id: "notifications", label: "Pranešimai" },
  { id: "data", label: "Duomenys" },
] as const;
type TabId = (typeof TABS)[number]["id"];

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

const LOCALE_LABELS = [
  { value: "en", label: "English" },
  { value: "lt", label: "Lietuvių" },
  { value: "pl", label: "Polski" },
  { value: "de", label: "Deutsch" },
];

const SPEED_OPTIONS = [
  { value: "kmh", label: "km/val" },
  { value: "mph", label: "mph" },
];
const DISTANCE_OPTIONS = [
  { value: "km", label: "Kilometrai (km)" },
  { value: "mi", label: "Mylios (mi)" },
];
const VOLUME_OPTIONS = [
  { value: "l", label: "Litrai (l)" },
  { value: "gal", label: "JAV galonai (gal)" },
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
  const [activeTab, setActiveTab] = React.useState<TabId>("profile");
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  const [locale, setLocale] = React.useState("lt");

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title="Nustatymai" />

      {/* tab bar: active tab gets the brand underline, like the real dashboard */}
      <div className="admin-hairline-b flex gap-1" role="tablist" aria-label="Nustatymai">
        {TABS.map(({ id, label }) => {
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
              {label}
            </button>
          );
        })}
      </div>

      {/* Profilis: identity + appearance + account defaults + display prefs */}
      <div role="tabpanel" id="settings-panel-profile" hidden={activeTab !== "profile"} aria-labelledby="settings-tab-profile" className="admin-card">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
          Profilis
        </div>
        <div className="space-y-4 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--admin-ink-soft)" }}>El. paštas</span>
            <span className="mono text-xs" style={{ color: "var(--admin-ink)" }}>demo@orbetra.test</span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--admin-ink-soft)" }}>Rolė</span>
            <Badge tone="neutral">Organizacijos administratorius</Badge>
          </div>
          <div className="admin-hairline-t flex items-center justify-between pt-4">
            <span style={{ color: "var(--admin-ink-soft)" }}>Kalba</span>
            <div className="w-28">
              <Combobox
                value={locale}
                onChange={setLocale}
                options={LOCALE_LABELS.map((l) => ({ value: l.value, label: l.value.toUpperCase() }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: "var(--admin-ink-soft)" }}>Tema</span>
            <div className="flex gap-2">
              {(["dark", "light"] as const).map((value) => (
                <AdminButton
                  key={value}
                  variant={theme === value ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setTheme(value)}
                >
                  {value === "dark" ? "Tamsi" : "Šviesi"}
                </AdminButton>
              ))}
            </div>
          </div>
          <AccountDefaultsSection />
          <DisplayPrefsSection />
        </div>
      </div>

      {/* Sauga: password change */}
      <div role="tabpanel" id="settings-panel-security" hidden={activeTab !== "security"} aria-labelledby="settings-tab-security" className="admin-card">
        <PasswordSection />
      </div>

      {/* Pranešimai: browser push */}
      <div role="tabpanel" id="settings-panel-notifications" hidden={activeTab !== "notifications"} aria-labelledby="settings-tab-notifications">
        <PushSection />
      </div>

      {/* Duomenys: GDPR export */}
      <div role="tabpanel" id="settings-panel-data" hidden={activeTab !== "data"} aria-labelledby="settings-tab-data">
        <ExportSection />
      </div>
    </div>
  );
}

/** The account's server-side defaults: what reports and alert e-mails are rendered with. */
function AccountDefaultsSection() {
  const [tz, setTz] = React.useState("Europe/Vilnius");
  const [locale, setLocale] = React.useState("lt");
  const [speed, setSpeed] = React.useState("kmh");
  const [distance, setDistance] = React.useState("km");
  const [volume, setVolume] = React.useState("l");
  const [saved, setSaved] = React.useState(false);

  return (
    <div className="admin-hairline-t space-y-3 pt-4">
      <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        Ataskaitos ir el. laiškai
      </div>
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        Ką serveris naudoja šiai paskyrai: ataskaitos ir rida grupuojamos į dienas pagal šią laiko juostą, o
        pranešimai ir suplanuotos ataskaitos rašomi šia kalba ir šiais vienetais. Tai nėra tas pats, kas rodymo
        nustatymai žemiau — jie keičia tik šią naršyklę.
      </p>
      <div className="space-y-3 text-sm">
        <SelectRow wide label="Ataskaitų laiko juosta" value={tz} onChange={setTz} options={TIMEZONES.map((z) => ({ value: z, label: z }))} />
        <SelectRow wide label="Kalba" value={locale} onChange={setLocale} options={LOCALE_LABELS} />
        <SelectRow wide label="Greitis" value={speed} onChange={setSpeed} options={SPEED_OPTIONS} />
        <SelectRow wide label="Atstumas" value={distance} onChange={setDistance} options={DISTANCE_OPTIONS} />
        <SelectRow wide label="Tūris" value={volume} onChange={setVolume} options={VOLUME_OPTIONS} />
      </div>
      <div className="flex items-center gap-2">
        <AdminButton type="button" onClick={() => setSaved(true)}>
          Išsaugoti
        </AdminButton>
        {saved && (
          <p role="status" className="text-sm" style={{ color: "var(--admin-ink-soft)" }}>
            Išsaugota
          </p>
        )}
      </div>
    </div>
  );
}

/** Display preferences: this browser only — time/date format, units, map provider. */
function DisplayPrefsSection() {
  const [timeFormat, setTimeFormat] = React.useState("24h");
  const [timeZone, setTimeZone] = React.useState("auto");
  const [dateFormat, setDateFormat] = React.useState("auto");
  const [speed, setSpeed] = React.useState("kmh");
  const [distance, setDistance] = React.useState("km");
  const [volume, setVolume] = React.useState("l");
  const [mapProvider, setMapProvider] = React.useState("mapbox");
  const [mapScheme, setMapScheme] = React.useState("auto");

  const tzOptions = [
    { value: "auto", label: "Automatinė (naršyklės)" },
    ...TIMEZONES.map((z) => ({ value: z, label: z })),
  ];

  return (
    <div className="admin-hairline-t space-y-4 pt-4">
      <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        Rodymo nustatymai
      </div>
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        Šie nustatymai galioja tik šiai naršyklei. Pranešimų el. laiškai ir suplanuotos ataskaitos naudoja
        paskyros nustatymus viršuje.
      </p>
      <SelectRow label="Laiko formatas" value={timeFormat} onChange={setTimeFormat} options={[
        { value: "24h", label: "24 valandų" },
        { value: "12h", label: "12 valandų (AM/PM)" },
      ]} />
      <SelectRow wide label="Laiko juosta" value={timeZone} onChange={setTimeZone} options={tzOptions} />
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        Tik rodymui — keičia, kaip laikas rodomas jums, o ne kaip grupuojamos ataskaitos.
      </p>
      <SelectRow label="Datos formatas" value={dateFormat} onChange={setDateFormat} options={[
        { value: "auto", label: "Pagal kalbą" },
        { value: "ymd", label: "YYYY-MM-DD" },
        { value: "dmy", label: "DD.MM.YYYY" },
        { value: "mdy", label: "MM/DD/YYYY" },
      ]} />
      <SelectRow label="Greitis" value={speed} onChange={setSpeed} options={SPEED_OPTIONS} />
      <SelectRow label="Atstumas" value={distance} onChange={setDistance} options={DISTANCE_OPTIONS} />
      <SelectRow label="Tūris" value={volume} onChange={setVolume} options={VOLUME_OPTIONS} />
      <SelectRow label="Žemėlapio teikėjas" value={mapProvider} onChange={setMapProvider} options={[
        { value: "mapbox", label: "Mapbox" },
        { value: "google", label: "Google Maps" },
      ]} />
      <SelectRow label="Žemėlapio spalvos" value={mapScheme} onChange={setMapScheme} options={[
        { value: "auto", label: "Pagal temą" },
        { value: "light", label: "Šviesios" },
        { value: "dark", label: "Tamsios" },
      ]} />
      <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
        Galioja visiems žemėlapiams: gyvam, istorijos, geozonų ir maršrutų. Visas funkcionalumas veikia su
        abiem teikėjais.
      </p>
    </div>
  );
}

function PasswordSection() {
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
        Keisti slaptažodį
      </div>
      <div className="p-4">
        <form onSubmit={submit} className="space-y-3">
          <AdminInput
            type="password"
            autoComplete="current-password"
            aria-label="Dabartinis slaptažodis"
            placeholder="Dabartinis slaptažodis"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <AdminInput
            type="password"
            autoComplete="new-password"
            aria-label="Naujas slaptažodis"
            placeholder="Naujas slaptažodis"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
          />
          {changed && (
            <p role="status" className="text-sm" style={{ color: "var(--admin-success)" }}>
              Slaptažodis atnaujintas.
            </p>
          )}
          <AdminButton type="submit" disabled={current === "" || next.length < 8}>
            Atnaujinti slaptažodį
          </AdminButton>
        </form>
      </div>
    </>
  );
}

function PushSection() {
  const [enabled, setEnabled] = React.useState(false);

  return (
    <div className="admin-card">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>
        Naršyklės pranešimai
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
          Įjunkite push pranešimus šioje naršyklėje. Taisyklės su „Naršyklės pranešimai“ kanalu praneš į
          kiekvieną čia įjungtą naršyklę.
        </p>
        <div className="flex items-center gap-3">
          <AdminButton variant={enabled ? "secondary" : "primary"} size="sm" onClick={() => setEnabled((v) => !v)}>
            {enabled ? "Išjungti" : "Įjungti"}
          </AdminButton>
          <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "Įjungta" : "Išjungta"}</Badge>
        </div>
      </div>
    </div>
  );
}

type ExportJob = { id: string; requestedAt: string; status: "pending" | "done" };

function ExportSection() {
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
        Duomenų eksportas (GDPR)
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
          Atsisiųskite pilną paskyros duomenų kopiją (įrenginiai, pozicijos, kelionės, įvykiai, taisyklės,
          naudotojai) NDJSON formatu. Failai galioja 7 dienas.
        </p>
        <form onSubmit={request} className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--admin-ink-soft)" }}>
            Paskyra
            <div className="w-52">
              <Combobox
                value={account}
                onChange={setAccount}
                options={[{ value: "acc-demo", label: "Demo Logistics UAB" }]}
              />
            </div>
          </label>
          <AdminButton type="submit">Užsakyti eksportą</AdminButton>
        </form>
        <table className="w-full text-sm">
          <thead>
            <tr className="admin-hairline-b">
              <th className={th} style={thStyle}>Užsakyta</th>
              <th className={th} style={thStyle}>Būsena</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="admin-hairline-b last:border-b-0">
                <td className="py-2 pr-4 text-xs" style={{ color: "var(--admin-ink-soft)" }}>{j.requestedAt}</td>
                <td className="py-2 pr-4">
                  <Badge tone={j.status === "done" ? "success" : "neutral"}>
                    {j.status === "done" ? "Paruošta" : "Ruošiama"}
                  </Badge>
                </td>
                <td className="py-2 pr-4 text-right">
                  {j.status === "done" && (
                    <AdminButton variant="secondary" size="sm">
                      Atsisiųsti
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
