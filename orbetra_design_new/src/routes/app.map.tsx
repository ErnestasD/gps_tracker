import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Search, MapPin, Navigation, Circle } from "lucide-react";
import { generateDevices, type Device } from "@/lib/admin-mock";
import { PageHeader, Badge, AdminInput } from "@/components/admin/AdminKit";
import { Combobox } from "@/components/admin/Combobox";

export const Route = createFileRoute("/app/map")({
  component: MapPage,
});

const ALL = generateDevices();

function MapPage() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string>("");
  const [selected, setSelected] = React.useState<string | null>(ALL[0]?.id ?? null);

  const filtered = ALL.filter(
    (d) =>
      (!q || `${d.name} ${d.plate} ${d.driver}`.toLowerCase().includes(q.toLowerCase())) &&
      (!status || d.status === status),
  );
  const active = filtered.find((d) => d.id === selected) ?? filtered[0];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="px-4 pt-4 pb-3 md:px-8">
        <PageHeader
          title="Žemėlapis"
          description={`${ALL.length} įrenginių · ${ALL.filter((d) => d.status === "active").length} aktyvūs realiu laiku`}
          className="mb-0"
        />
      </div>
      <div className="flex flex-1 min-h-0 flex-col md:flex-row md:gap-4 md:px-8 md:pb-8">
        {/* Left list */}
        <aside className="admin-card flex flex-col md:w-96 md:shrink-0 mx-4 md:mx-0 mb-3 md:mb-0">
          <div className="admin-hairline-b space-y-2 p-3">
            <AdminInput
              placeholder="Ieškoti įrenginio, vairuotojo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Combobox
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: "Visos būsenos" },
                { value: "active", label: "Aktyvūs" },
                { value: "idle", label: "Sustoję" },
                { value: "offline", label: "Neprisijungę" },
                { value: "maintenance", label: "Priežiūroje" },
              ]}
              placeholder="Būsena"
            />
          </div>
          <ul className="flex-1 overflow-y-auto">
            {filtered.map((d) => {
              const isSel = d.id === active?.id;
              return (
                <li key={d.id}>
                  <button
                    onClick={() => setSelected(d.id)}
                    className="w-full px-3 py-2.5 text-left transition-colors admin-hairline-b"
                    style={{ background: isSel ? "var(--admin-brand-soft)" : "transparent" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" style={{ color: isSel ? "var(--admin-brand)" : "var(--admin-ink)" }}>
                          {d.name}
                        </div>
                        <div className="truncate text-xs" style={{ color: "var(--admin-ink-soft)" }}>
                          {d.plate} · {d.driver}
                        </div>
                      </div>
                      <StatusDot status={d.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px]" style={{ color: "var(--admin-ink-soft)" }}>
                      <span>{d.speed} km/h</span>
                      <span>·</span>
                      <span>{d.location}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Map canvas */}
        <div className="admin-card relative flex-1 overflow-hidden mx-4 md:mx-0 min-h-[400px]">
          <StylizedMap devices={filtered} activeId={active?.id} onSelect={setSelected} />
          {active && (
            <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-96">
              <div className="admin-card p-4" style={{ boxShadow: "var(--admin-shadow-lg)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold" style={{ color: "var(--admin-ink)" }}>{active.name}</div>
                    <div className="text-xs" style={{ color: "var(--admin-ink-soft)" }}>{active.plate} · IMEI {active.imei}</div>
                  </div>
                  <Badge tone={active.status === "active" ? "success" : active.status === "offline" ? "danger" : "warning"}>
                    {active.status}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <Metric label="Greitis" value={`${active.speed}`} unit="km/h" />
                  <Metric label="Kuras" value={`${active.fuel}`} unit="%" />
                  <Metric label="Baterija" value={`${active.battery}`} unit="%" />
                  <Metric label="Rida" value={`${Math.round(active.odometer / 1000)}`} unit="k km" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: Device["status"] }) {
  const color =
    status === "active" ? "var(--admin-success)" :
    status === "offline" ? "var(--admin-danger)" :
    status === "maintenance" ? "var(--admin-warning)" : "var(--admin-ink-soft)";
  return (
    <span className="mt-1 grid h-2.5 w-2.5 place-items-center">
      <span className="absolute h-2.5 w-2.5 rounded-full opacity-30" style={{ background: color, animation: status === "active" ? "pulseDot 2.2s ease-in-out infinite" : undefined }} />
      <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-md py-1.5" style={{ background: "var(--admin-surface-sunken)" }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--admin-ink-soft)" }}>{label}</div>
      <div className="text-sm font-semibold" style={{ color: "var(--admin-ink)" }}>{value}<span className="ml-0.5 text-[10px] font-normal opacity-60">{unit}</span></div>
    </div>
  );
}

function StylizedMap({ devices, activeId, onSelect }: { devices: Device[]; activeId?: string; onSelect: (id: string) => void }) {
  // Simple procedural map background (grid + fake roads) with device pins.
  // Positions derived from lat/lng normalized into the SVG viewbox.
  const W = 1000, H = 700;
  const minLng = 21.5, maxLng = 27.0, minLat = 53.9, maxLat = 55.6;
  const proj = (lat: number, lng: number) => ({
    x: ((lng - minLng) / (maxLng - minLng)) * W,
    y: H - ((lat - minLat) / (maxLat - minLat)) * H,
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" style={{ background: "var(--admin-surface-sunken)" }}>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--admin-hairline)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      {/* fake highways */}
      <path d="M 0 380 C 200 340 340 420 500 360 S 800 340 1000 380" fill="none" stroke="var(--admin-hairline)" strokeWidth="6" />
      <path d="M 0 380 C 200 340 340 420 500 360 S 800 340 1000 380" fill="none" stroke="var(--admin-brand)" strokeWidth="1.2" strokeDasharray="6 6" opacity="0.35" />
      <path d="M 400 0 C 380 200 460 340 420 500 S 460 660 480 700" fill="none" stroke="var(--admin-hairline)" strokeWidth="5" />
      <path d="M 400 0 C 380 200 460 340 420 500 S 460 660 480 700" fill="none" stroke="var(--admin-brand)" strokeWidth="1" strokeDasharray="4 6" opacity="0.3" />
      {/* city labels */}
      {[
        { name: "Vilnius", lat: 54.687, lng: 25.283 },
        { name: "Kaunas", lat: 54.898, lng: 23.9 },
        { name: "Klaipėda", lat: 55.71, lng: 21.13 },
        { name: "Šiauliai", lat: 55.93, lng: 23.31 },
        { name: "Panevėžys", lat: 55.73, lng: 24.36 },
      ].map((c) => {
        const p = proj(c.lat, c.lng);
        return (
          <g key={c.name}>
            <circle cx={p.x} cy={p.y} r={2} fill="var(--admin-ink-soft)" />
            <text x={p.x + 8} y={p.y + 3} fontSize="11" fill="var(--admin-ink-soft)" fontFamily="Inter">{c.name}</text>
          </g>
        );
      })}
      {devices.map((d) => {
        const p = proj(d.lat, d.lng);
        const color = d.status === "active" ? "#059669" : d.status === "offline" ? "#E11D48" : d.status === "maintenance" ? "#B45309" : "#6B7280";
        const isActive = d.id === activeId;
        return (
          <g key={d.id} style={{ cursor: "pointer" }} onClick={() => onSelect(d.id)}>
            {isActive && <circle cx={p.x} cy={p.y} r={14} fill={color} opacity={0.18} />}
            <circle cx={p.x} cy={p.y} r={isActive ? 7 : 5} fill={color} stroke="#fff" strokeWidth={2} />
          </g>
        );
      })}
    </svg>
  );
}
