import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Play, Pause, SkipBack, SkipForward, Fuel, Gauge } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, ReferenceArea } from "recharts";
import { generateDevices, generateTrips } from "@/lib/admin-mock";
import { PageHeader, AdminButton, Badge } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";
import { DatePicker } from "@/components/admin/DatePicker";

export const Route = createFileRoute("/app/history")({
  component: HistoryPage,
});

const DEVICES = generateDevices();
const TRIPS = generateTrips();

// Fake speed / fuel series
const series = Array.from({ length: 200 }, (_, i) => {
  const t = i / 200;
  const speed = Math.max(0, 40 + Math.sin(t * 6) * 30 + Math.sin(t * 21) * 8);
  const fuel = 89 - t * 12 - Math.sin(t * 3) * 1.2;
  return { t: i, speed: Math.round(speed), fuel: Math.round(fuel * 10) / 10 };
});

function HistoryPage() {
  const [device, setDevice] = React.useState(DEVICES[0].id);
  const [from, setFrom] = React.useState<Date | undefined>();
  const [to, setTo] = React.useState<Date | undefined>();
  const [pos, setPos] = React.useState(120);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setPos((p) => (p >= 199 ? 199 : p + 1)), 40);
    return () => clearInterval(iv);
  }, [playing]);

  const cur = series[pos];
  const dev = DEVICES.find((d) => d.id === device)!;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title="Istorija" description="Kelionių atkūrimas su greičio ir kuro grafikais.">
        <div className="w-56"><Combobox value={device} onChange={setDevice} options={DEVICES.map((d) => ({ value: d.id, label: d.name, hint: d.plate }))} /></div>
        <div className="w-36"><DatePicker value={from} onChange={setFrom} placeholder="Nuo" /></div>
        <div className="w-36"><DatePicker value={to} onChange={setTo} placeholder="Iki" /></div>
      </PageHeader>

      <div className="admin-card overflow-hidden">
        {/* Map placeholder */}
        <div className="relative h-[360px]" style={{ background: "var(--admin-surface-sunken)" }}>
          <svg viewBox="0 0 1000 360" className="h-full w-full">
            <defs>
              <pattern id="hgrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--admin-hairline)" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="1000" height="360" fill="url(#hgrid)" />
            <path
              d="M 60 300 C 160 260 220 200 320 210 S 500 180 560 130 S 780 100 900 140"
              fill="none" stroke="var(--admin-brand)" strokeWidth="3" strokeLinecap="round"
            />
            <circle cx={60 + (pos / 199) * 840} cy={200 + Math.sin(pos / 20) * 40} r="8" fill="var(--admin-brand)" stroke="#fff" strokeWidth="3" />
            <circle cx="60" cy="300" r="6" fill="var(--admin-success)" stroke="#fff" strokeWidth="2" />
            <circle cx="900" cy="140" r="6" fill="var(--admin-danger)" stroke="#fff" strokeWidth="2" />
          </svg>
          <div className="absolute left-3 top-3 admin-card px-3 py-2">
            <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{dev.name} · {dev.plate}</div>
            <div className="mt-1 flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1"><Gauge className="h-3.5 w-3.5" style={{ color: "var(--admin-brand)" }} />{cur.speed} km/h</span>
              <span className="inline-flex items-center gap-1"><Fuel className="h-3.5 w-3.5" style={{ color: "var(--admin-brand)" }} />{cur.fuel}%</span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="admin-hairline-t p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <AdminButton variant="ghost" size="sm" onClick={() => setPos(0)}><SkipBack className="h-4 w-4" /></AdminButton>
              <AdminButton size="sm" onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {playing ? "Pauzė" : "Groti"}
              </AdminButton>
              <AdminButton variant="ghost" size="sm" onClick={() => setPos(199)}><SkipForward className="h-4 w-4" /></AdminButton>
            </div>
            <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>
              taškas {pos + 1} / {series.length} · {TRIPS.slice(0, 6).length} kelionės
            </div>
          </div>
          <input
            type="range" min={0} max={series.length - 1} value={pos}
            onChange={(e) => setPos(parseInt(e.target.value))}
            className="w-full accent-[var(--admin-brand)]"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ChartCard title="Greitis" color="var(--admin-brand)" dataKey="speed" pos={pos} />
            <ChartCard title="Kuro lygis" color="var(--admin-info)" dataKey="fuel" pos={pos} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, dataKey, color, pos }: { title: string; dataKey: "speed" | "fuel"; color: string; pos: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span style={{ color: "var(--admin-ink-soft)" }}>{title}</span>
        <Badge tone="brand">{series[pos][dataKey]}{dataKey === "speed" ? " km/h" : "%"}</Badge>
      </div>
      <div style={{ height: 90 }}>
        <ResponsiveContainer>
          <LineChart data={series}>
            <CartesianGrid stroke="var(--admin-hairline-soft)" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis hide />
            <Tooltip contentStyle={{ background: "var(--admin-surface)", border: "1px solid var(--admin-hairline)", borderRadius: 8, fontSize: 12, color: "var(--admin-ink)" }} />
            <ReferenceArea x1={pos} x2={pos} stroke={color} strokeWidth={2} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.6} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
