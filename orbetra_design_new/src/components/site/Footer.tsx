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
            Simple GPS tracking for small fleets. EU-hosted. Runs on Teltonika.
          </p>
          <p className="mt-4 mono text-[10px] tracking-widest text-muted-foreground">
            LAT 54.68 · LON 25.28
          </p>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">Product</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/" className="hover:text-ink text-muted-foreground">Platform</Link></li>
            <li><Link to="/tsp" className="hover:text-ink text-muted-foreground">Resellers</Link></li>
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
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">Language</div>
          <div className="flex gap-2 flex-wrap">
            {["EN", "PL", "DE", "LT"].map((l) => (
              <button
                key={l}
                className="h-8 px-3 rounded-full border border-[var(--hairline)] text-xs mono font-medium text-muted-foreground hover:text-ink hover:border-[color:var(--brand-blue)]"
              >
                {l}
              </button>
            ))}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">© {new Date().getFullYear()} Orbetra</p>
          <p className="mt-1 text-xs text-muted-foreground/70">© OpenStreetMap contributors</p>
        </div>
      </div>
    </footer>
  );
}
