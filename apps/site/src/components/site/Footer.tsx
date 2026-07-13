import { Link } from "@tanstack/react-router";
import { OrbetraLogo } from "./OrbetraLogo";

export function Footer() {
  return (
    <footer className="border-t border-[var(--hairline)] mt-32 bg-[var(--blueprint)]/40">
      <div className="mx-auto max-w-7xl px-6 py-16 grid gap-12 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 font-display font-bold text-lg text-ink">
            <OrbetraLogo className="h-10 w-10" /> Orbetra
          </div>
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">
            White-label GPS tracking, purpose-built for Teltonika fleets. EU-hosted.
          </p>
          <p className="mt-4 mono text-[10px] tracking-widest text-muted-foreground">
            LAT 54.68 · LON 25.28
          </p>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">Product</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/" className="hover:text-ink text-muted-foreground">Platform</Link></li>
            <li><Link to="/tsp" className="hover:text-ink text-muted-foreground">For TSPs</Link></li>
            <li><Link to="/pricing" className="hover:text-ink text-muted-foreground">Pricing</Link></li>
            <li><a href="/docs" className="hover:text-ink text-muted-foreground">Docs</a></li>
            <li><Link to="/pilot" className="hover:text-ink text-muted-foreground">Contact</Link></li>
          </ul>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">Legal</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/terms" className="hover:text-ink text-muted-foreground">Terms</Link></li>
            <li><Link to="/privacy" className="hover:text-ink text-muted-foreground">Privacy</Link></li>
            <li><Link to="/dpa" className="hover:text-ink text-muted-foreground">DPA</Link></li>
            <li><Link to="/subprocessors" className="hover:text-ink text-muted-foreground">Subprocessors</Link></li>
            <li><Link to="/impressum" className="hover:text-ink text-muted-foreground">Impressum</Link></li>
          </ul>
        </div>
        <div>
          {/* language switcher lands with the W8 S3 i18n pass — a non-functional
              stub would be dishonest (AGENTS.md flagged it) */}
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">Product</div>
          <ul className="space-y-2 text-sm">
            <li><a href={import.meta.env.VITE_DASH_URL ?? "https://dash.orbetra.com"} className="hover:text-ink text-muted-foreground">Sign in</a></li>
            <li><Link to="/pilot" className="hover:text-ink text-muted-foreground">Request a pilot</Link></li>
          </ul>
          <p className="mt-6 text-xs text-muted-foreground">© {new Date().getFullYear()} Orbetra</p>
          <p className="mt-1 text-xs text-muted-foreground/70">© OpenStreetMap contributors</p>
        </div>
      </div>
    </footer>
  );
}
