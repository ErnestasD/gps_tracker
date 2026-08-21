import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OrbetraWordmark } from "./OrbetraLogo";
import { DOCS_URL } from "@/lib/api";
import { LanguageDropdown } from "./LanguageDropdown";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-[var(--hairline)] mt-32 bg-[var(--blueprint)]/40">
      <div className="mx-auto max-w-7xl px-6 py-16 grid gap-12 md:grid-cols-4">
        <div>
          <OrbetraWordmark className="h-7 w-auto" />
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">{t("footer.tagline")}</p>
          <p className="mt-4 mono text-[10px] tracking-widest text-muted-foreground">
            LAT 54.68 · LON 25.28
          </p>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">{t("footer.product")}</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/" className="hover:text-ink text-muted-foreground">{t("nav.platform")}</Link></li>
            <li><Link to="/pricing" className="hover:text-ink text-muted-foreground">{t("nav.pricing")}</Link></li>
            <li><Link to="/tsp" className="hover:text-ink text-muted-foreground">{t("nav.resellers")}</Link></li>
            <li><Link to="/partners" className="hover:text-ink text-muted-foreground">{t("nav.partners")}</Link></li>
            <li><Link to="/demo" className="hover:text-ink text-muted-foreground">{t("nav.demo")}</Link></li>
            <li><a href={DOCS_URL} className="hover:text-ink text-muted-foreground">{t("nav.apiDocs")}</a></li>
            <li><a href="/compatibility" className="hover:text-ink text-muted-foreground">{t("nav.compat")}</a></li>
            <li><Link to="/pilot" className="hover:text-ink text-muted-foreground">{t("nav.contact")}</Link></li>
          </ul>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">{t("footer.legal")}</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/terms" className="hover:text-ink text-muted-foreground">{t("footer.terms")}</Link></li>
            <li><Link to="/privacy" className="hover:text-ink text-muted-foreground">{t("footer.privacy")}</Link></li>
            <li><Link to="/cookies" className="hover:text-ink text-muted-foreground">{t("footer.cookies")}</Link></li>
            <li><Link to="/dpa" className="hover:text-ink text-muted-foreground">{t("footer.dpa")}</Link></li>
            <li><Link to="/subprocessors" className="hover:text-ink text-muted-foreground">{t("footer.subprocessors")}</Link></li>
            <li><Link to="/impressum" className="hover:text-ink text-muted-foreground">{t("footer.impressum")}</Link></li>
          </ul>
        </div>
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">{t("footer.language")}</div>
          <LanguageDropdown align="start" variant="full" />
          <p className="mt-6 text-xs text-muted-foreground">{t("footer.copyright", { year: new Date().getFullYear() })}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            <a href="mailto:hello@orbetra.com" className="hover:text-ink">hello@orbetra.com</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
