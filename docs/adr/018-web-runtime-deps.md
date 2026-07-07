# ADR-018: apps/web runtime dependencies — the locked §5 web stack

**Date:** 2026-07-07 · **Status:** accepted · **Story:** E02-6 (CLAUDE.md rule 10 gate)

Every runtime dependency below is a named part of the locked stack (PROJECT_PLAN §5
"Web" + DASHBOARD_UI_SPEC header, which calls the stack "locked"):

- **react / react-dom 18** — the SPA framework (§5: "React 18 + Vite SPA").
- **@tanstack/react-router** — routing with `beforeLoad` auth guards (spec names
  TanStack Router; code-based tree, no codegen).
- **@tanstack/react-query** — server-state for REST calls (named in spec; used for
  the snapshot fetch now, every E03+ REST screen later).
- **maplibre-gl** — the map (rule 13 free-stack mandate; style URL from env).
- **i18next / react-i18next / i18next-browser-languagedetector** — spec §6: "strings
  via i18next only"; detector picks EN/PL/LT/DE from the browser.
- **@fontsource-variable/inter** — self-hosted Inter (no Google Fonts CDN — free-stack
  and GDPR posture).
- **lucide-react** — the locked icon set (spec header).
- **class-variance-authority / clsx / tailwind-merge / @radix-ui/react-slot /
  @radix-ui/react-tooltip** — the runtime companions of vendored shadcn/ui components
  ("shadcn/ui as the only component kit"). Radix primitives arrive one-per-component
  as stories need them; E02-6 needs only slot+tooltip.
- **@orbetra/shared** — workspace: `liveEventSchema` (the WS/live wire contract).

Dev-only (justified in the PR, not runtime): vite + @vitejs/plugin-react (build),
tailwindcss + @tailwindcss/vite (v4, CSS-first tokens — no tailwind.config.js),
vite-plugin-pwa + workbox-precaching (app-shell SW, injectManifest; workbox code is
bundled INTO dist/sw.js at build), @playwright/test + testcontainers + ioredis (e2e
harness), @types/*.

**Not added** (scope discipline): Recharts (E04-3), TanStack Table (E03-3), terra-draw
(E05-1), i18next lint plugin (E08-3), any virtualizer (500 memoized rows measured fine:
p99 frame 9.4 ms with software WebGL).
