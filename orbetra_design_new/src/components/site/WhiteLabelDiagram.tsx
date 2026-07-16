import { Building2, Globe, Palette, Link2, Users, Server, ArrowRight } from "lucide-react";

interface Tenant {
  code: string;
  label: string;
  sub: string;
  color: string;
}

const TENANTS: Tenant[] = [
  { code: "T-01", label: "Client A", sub: "142 vehicles", color: "#2563EB" },
  { code: "T-02", label: "Client B", sub: "68 vehicles", color: "#7C5CFC" },
  { code: "T-03", label: "Client C", sub: "231 vehicles", color: "#3a3b8f" },
];

const BRAND_ATTRS = [
  { icon: Globe, label: "Domain" },
  { icon: Palette, label: "Theme" },
  { icon: Link2, label: "API" },
];

/**
 * Three-column horizontal flow:
 *   [ Orbetra core ]  →  [ Your brand (TSP) ]  →  [ End clients ]
 *   invisible layer      what YOU deliver          what THEY see
 */
export function WhiteLabelDiagram() {
  return (
    <div className="relative w-full">
      {/* Column headers */}
      <div className="hidden md:grid grid-cols-[1fr_auto_1.1fr_auto_1fr] items-center gap-4 mb-4">
        <div className="mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground text-center">
          Layer 1 · Platform
        </div>
        <div />
        <div className="mono text-[10px] tracking-[0.22em] uppercase text-[var(--brand-cyan)] text-center">
          Layer 2 · Your brand
        </div>
        <div />
        <div className="mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground text-center">
          Layer 3 · End clients
        </div>
      </div>

      {/* Desktop / tablet — three columns with arrows */}
      <div className="hidden md:grid grid-cols-[1fr_auto_1.1fr_auto_1fr] items-stretch gap-4">
        {/* ── Column 1: Orbetra core ── */}
        <div
          className="rounded-xl p-5 text-center flex flex-col justify-center h-full"
          style={{
            background: "rgba(10,20,40,0.7)",
            border: "1px dashed rgba(148,163,184,0.35)",
            boxShadow: "0 12px 30px -14px rgba(0,0,0,0.5)",
          }}
        >
          <div className="mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Invisible to end clients
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
            <span className="font-display font-semibold text-ink text-base">Orbetra</span>
          </div>
          <div className="mono text-[9px] text-muted-foreground mt-1">EU hosted · per-device</div>
          <div className="mt-4 pt-3 border-t border-[var(--hairline)] text-[11px] text-muted-foreground leading-relaxed">
            Ingest, storage, APIs,<br />reports, alerts, uptime
          </div>
        </div>

        {/* Arrow 1 */}
        <FlowArrow label="powers" />

        {/* ── Column 2: Your brand (TSP) ── */}
        <div
          className="rounded-xl p-5 flex flex-col justify-center h-full"
          style={{
            background: "linear-gradient(180deg, rgba(14,58,95,0.85) 0%, rgba(4,7,15,0.95) 100%)",
            border: "1.5px solid rgba(76,77,207,0.5)",
            boxShadow:
              "0 24px 60px -24px rgba(76,77,207,0.5), 0 8px 20px -10px rgba(0,0,0,0.6), inset 0 1px 0 rgba(76,77,207,0.2)",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="mono text-[9px] tracking-[0.2em] uppercase text-[var(--brand-cyan)] px-2 py-0.5 rounded bg-[rgba(76,77,207,0.12)] border border-[rgba(76,77,207,0.3)]">
              Your brand
            </span>
            <span className="mono text-[9px] text-muted-foreground">TSP</span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #2563EB, #7C5CFC)" }}
            >
              <Building2 className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="font-display font-semibold text-ink leading-tight truncate">Fleet.YourCo</div>
              <div className="mono text-[10px] text-muted-foreground truncate">app.fleet.yourco.eu</div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--hairline)] grid grid-cols-3 gap-2">
            {BRAND_ATTRS.map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <Icon className="h-4 w-4 text-[var(--brand-cyan)]" strokeWidth={1.75} />
                <span className="mono text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Arrow 2 */}
        <FlowArrow label="serves" />

        {/* ── Column 3: End clients ── */}
        <div className="flex flex-col gap-2.5">
          {TENANTS.map((t) => (
            <div
              key={t.code}
              className="rounded-lg p-3 flex items-center gap-2.5 h-[60px]"
              style={{
                background: "rgba(10,20,40,0.75)",
                border: "1px solid var(--hairline)",
                borderLeft: `3px solid ${t.color}`,
                boxShadow: "0 10px 24px -16px rgba(0,0,0,0.55)",
              }}
            >
              <span
                className="h-8 w-8 rounded-md grid place-items-center shrink-0"
                style={{ background: `${t.color}18`, border: `1px solid ${t.color}40` }}
              >
                <Users className="h-4 w-4" style={{ color: t.color }} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold text-ink text-sm leading-tight truncate">
                  {t.label}
                </div>
                <div className="mono text-[10px] text-muted-foreground truncate">{t.sub}</div>
              </div>
              <span className="mono text-[8px] tracking-widest uppercase text-muted-foreground shrink-0">
                {t.code}
              </span>
            </div>
          ))}
          <div className="mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground text-center mt-1">
            Sees only your brand
          </div>
        </div>
      </div>

      {/* Mobile fallback: vertical stack with down arrows */}
      <div className="md:hidden grid gap-3">
        <div className="mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
          Layer 1 · Platform
        </div>
        <div
          className="rounded-xl bg-[rgba(10,20,40,0.75)] p-4 text-center"
          style={{ border: "1px dashed rgba(148,163,184,0.35)" }}
        >
          <div className="mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Invisible to end clients
          </div>
          <div className="mt-2 flex items-center justify-center gap-1.5">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="font-display font-semibold text-ink">Orbetra</span>
          </div>
        </div>

        <DownArrow label="powers" />

        <div className="mono text-[9px] tracking-[0.22em] uppercase text-[var(--brand-cyan)]">
          Layer 2 · Your brand
        </div>
        <div
          className="rounded-xl p-4"
          style={{
            background: "linear-gradient(180deg, rgba(14,58,95,0.85) 0%, rgba(4,7,15,0.95) 100%)",
            border: "1.5px solid rgba(76,77,207,0.45)",
          }}
        >
          <div className="mono text-[9px] tracking-[0.2em] uppercase text-[var(--brand-cyan)]">
            Your brand
          </div>
          <div className="font-display font-semibold text-ink mt-1">Fleet.YourCo</div>
          <div className="mono text-[10px] text-muted-foreground">app.fleet.yourco.eu</div>
        </div>

        <DownArrow label="serves" />

        <div className="mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
          Layer 3 · End clients
        </div>
        {TENANTS.map((t) => (
          <div
            key={t.code}
            className="rounded bg-[rgba(10,20,40,0.75)] p-3 flex items-center gap-2.5"
            style={{ border: "1px solid var(--hairline)", borderLeft: `3px solid ${t.color}` }}
          >
            <Users className="h-4 w-4" style={{ color: t.color }} />
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-ink text-sm">{t.label}</div>
              <div className="mono text-[10px] text-muted-foreground">
                {t.sub} · {t.code}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className="flex items-center gap-2">
          <Server className="h-3 w-3" /> Platform core
        </span>
        <span className="flex items-center gap-2">
          <Building2 className="h-3 w-3 text-[var(--brand-cyan)]" /> White-label tenant
        </span>
        <span className="flex items-center gap-2">
          <Users className="h-3 w-3" /> End customers
        </span>
      </div>
    </div>
  );
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-1.5 px-1">
      <span className="mono text-[9px] tracking-[0.22em] uppercase text-[var(--brand-cyan)]">
        {label}
      </span>
      <div className="flex items-center">
        <span
          className="block h-px w-10"
          style={{
            background:
              "linear-gradient(90deg, rgba(76,77,207,0), rgba(76,77,207,0.6))",
          }}
        />
        <ArrowRight className="h-4 w-4 text-[var(--brand-cyan)] -ml-0.5" strokeWidth={2} />
      </div>
    </div>
  );
}

function DownArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <span
        className="block w-px h-6"
        style={{
          background:
            "linear-gradient(180deg, rgba(76,77,207,0), rgba(76,77,207,0.6))",
        }}
      />
      <span className="mono text-[9px] tracking-[0.22em] uppercase text-[var(--brand-cyan)]">
        ↓ {label}
      </span>
    </div>
  );
}
