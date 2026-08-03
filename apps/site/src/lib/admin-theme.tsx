import * as React from "react";

type Theme = "light" | "dark";
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void };

const AdminThemeContext = React.createContext<Ctx | null>(null);

const STORAGE_KEY = "orbetra.admin.theme";

export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to "light" on SSR to avoid hydration mismatch.
  const [theme, setThemeState] = React.useState<Theme>("light");
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "dark") {
        setThemeState(stored);
      } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setThemeState(prefersDark ? "dark" : "light");
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = React.useCallback(() => {
    setThemeState((t) => {
      const next = t === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  // Also mirror data-admin-theme onto <body> so Radix portals (Dialog/Sheet/Popover)
  // rendered outside this subtree inherit admin CSS tokens (--background, etc.).
  React.useEffect(() => {
    if (!hydrated) return;
    const prev = document.body.getAttribute("data-admin-theme");
    document.body.setAttribute("data-admin-theme", theme);
    return () => {
      if (prev === null) document.body.removeAttribute("data-admin-theme");
      else document.body.setAttribute("data-admin-theme", prev);
    };
  }, [theme, hydrated]);

  return (
    <AdminThemeContext.Provider value={value}>
      <div
        data-admin-theme={hydrated ? theme : "light"}
        style={{ minHeight: "100vh", background: "var(--admin-surface-2)" }}
      >
        {children}
      </div>
    </AdminThemeContext.Provider>
  );
}

export function useAdminTheme() {
  const ctx = React.useContext(AdminThemeContext);
  if (!ctx) throw new Error("useAdminTheme must be used inside AdminThemeProvider");
  return ctx;
}
