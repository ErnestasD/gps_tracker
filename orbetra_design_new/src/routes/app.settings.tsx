import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { PageHeader, AdminButton, AdminInput, AdminLabel, AdminSwitch, AdminRadio } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [lang, setLang] = React.useState("lt");
  const [tz, setTz] = React.useState("Europe/Vilnius");
  const [dist, setDist] = React.useState("km");
  const [twofa, setTwofa] = React.useState(true);
  const [notifs, setNotifs] = React.useState({ email: true, push: true, sms: false, digest: true });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Nustatymai" description="Paskyros ir organizacijos parametrai." />

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="profile">Profilis</TabsTrigger>
          <TabsTrigger value="org">Organizacija</TabsTrigger>
          <TabsTrigger value="security">Sauga</TabsTrigger>
          <TabsTrigger value="notif">Pranešimai</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="admin-card p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div><AdminLabel>Vardas</AdminLabel><AdminInput defaultValue="Edvinas" /></div>
              <div><AdminLabel>Pavardė</AdminLabel><AdminInput defaultValue="Kazlauskas" /></div>
              <div className="md:col-span-2"><AdminLabel>El. paštas</AdminLabel><AdminInput defaultValue="edvinas@orbetra.com" /></div>
              <div><AdminLabel>Kalba</AdminLabel>
                <Combobox value={lang} onChange={setLang} options={[
                  { value: "lt", label: "Lietuvių" }, { value: "en", label: "English" }, { value: "pl", label: "Polski" },
                ]} />
              </div>
              <div><AdminLabel>Laiko juosta</AdminLabel>
                <Combobox value={tz} onChange={setTz} options={[
                  { value: "Europe/Vilnius", label: "Europe/Vilnius" }, { value: "Europe/Warsaw", label: "Europe/Warsaw" }, { value: "UTC", label: "UTC" },
                ]} />
              </div>
            </div>
            <div className="mt-4"><AdminButton onClick={() => toast.success("Profilis išsaugotas")}>Išsaugoti</AdminButton></div>
          </div>
        </TabsContent>

        <TabsContent value="org">
          <div className="admin-card p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><AdminLabel>Organizacija</AdminLabel><AdminInput defaultValue="Demo Logistics UAB" /></div>
              <div><AdminLabel>Įmonės kodas</AdminLabel><AdminInput defaultValue="305500001" /></div>
              <div><AdminLabel>PVM kodas</AdminLabel><AdminInput defaultValue="LT100005500011" /></div>
              <div>
                <AdminLabel>Matavimo vienetai</AdminLabel>
                <AdminRadio
                  name="dist" value={dist} onChange={setDist}
                  options={[
                    { value: "km", label: "Kilometrai (km)", hint: "metrinės" },
                    { value: "mi", label: "Mylios (mi)", hint: "imperinės" },
                  ]}
                />
              </div>
            </div>
            <div className="mt-4"><AdminButton onClick={() => toast.success("Išsaugota")}>Išsaugoti</AdminButton></div>
          </div>
        </TabsContent>

        <TabsContent value="security">
          <div className="admin-card p-5">
            <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--admin-hairline)" }}>
              <div>
                <div className="font-medium">Dviejų veiksnių autentifikacija</div>
                <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Apsaugo prisijungimą papildomu kodu.</div>
              </div>
              <AdminSwitch checked={twofa} onCheckedChange={setTwofa} label={twofa ? "Įjungta" : "Išjungta"} />
            </div>
            <div className="mt-4 flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--admin-hairline)" }}>
              <div>
                <div className="font-medium">Sesijos</div>
                <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Aktyvios sesijos šiame profilyje: 2</div>
              </div>
              <AdminButton variant="secondary">Atsijungti kitas sesijas</AdminButton>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div>
                <div className="font-medium">Slaptažodis</div>
                <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>Rekomenduojama keisti kas 90 d.</div>
              </div>
              <AdminButton variant="secondary">Keisti slaptažodį</AdminButton>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notif">
          <div className="admin-card p-5">
            <div className="flex flex-col gap-3">
              <ToggleRow label="El. paštas" hint="Kritiniai signalai ir savaitės santrauka" checked={notifs.email} onChange={(v) => setNotifs((n) => ({ ...n, email: v }))} />
              <ToggleRow label="Push (naršyklė)" hint="Realaus laiko įvykiai" checked={notifs.push} onChange={(v) => setNotifs((n) => ({ ...n, push: v }))} />
              <ToggleRow label="SMS" hint="Tik SOS ir kritiniai" checked={notifs.sms} onChange={(v) => setNotifs((n) => ({ ...n, sms: v }))} />
              <ToggleRow label="Dienos santrauka" hint="Kasdien 07:00 vietos laiku" checked={notifs.digest} onChange={(v) => setNotifs((n) => ({ ...n, digest: v }))} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md p-3" style={{ background: "var(--admin-surface-sunken)" }}>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{hint}</div>
      </div>
      <AdminSwitch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
