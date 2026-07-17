# ADR-028: Admin UI redesign (orbetra_design_new) + minimal new dependencies

Status: accepted · 2026-07-16

## Context

The founder delivered a new Lovable-generated admin design (`orbetra_design_new/`, untracked
reference — like `orbetra_design/` before it). Every page reachable by an authenticated user
(any role: platform_admin, tsp_admin/white-label, account_manager, viewer) must adopt it. The
design is a visual reference only: its data is 100% mock, it has no role gating, no i18n (LT
hardcoded), and hand-drawn SVG placeholders where we have real MapLibre. **Our current
functionality is the contract** — every feature, role gate, i18n string, and `data-testid`
(e2e contract) survives the re-skin; the design dictates only the look and layout idiom.

## Decision

**Port the design system, not the design app.** apps/web keeps its stack (React 18, TanStack
Router/Query, i18next, MapLibre + terra-draw, vendored shadcn, hand-rolled SVG charts). We port:

1. **Tokens** — the design's admin palette replaces the values in `tokens.css` under the SAME
   token names (`--surface`, `--border`, `--accent`, …), so every existing page re-themes
   without markup churn; new `--admin-*` aliases + `.admin-card`/hairline/skeleton utilities
   support the ported components. Theme mechanism stays ours (`.light` class, `orbetra.theme`
   localStorage, `theme-dark`/`theme-light` testids) — the design's `[data-admin-theme]`
   attribute is not adopted.
2. **White-label survives**: `--admin-brand: var(--accent)` and every `*-soft` tint is derived
   via `color-mix(… var(--accent) N%, var(--surface))`, so `applyBranding` keeps re-theming
   the whole admin with zero changes.
3. **Primitives** — `components/admin/{AdminKit,DataTable,Combobox}.tsx` ported nearly verbatim
   (labels i18n-ized). New shell (grouped sidebar + topbar with route-aware breadcrumb, theme
   toggle, user identity, mobile drawer) keeps our role gating and the `logout` testid.
4. **Pages** migrate in follow-up PRs, wiring the design's mock/stub UI to the real `lib/*`
   data layer. The design's SVG map placeholders are ignored — MapLibre/terra-draw stay.

## New runtime dependencies (rule 10)

| Dep | Why | Alternative rejected |
|---|---|---|
| `@fontsource/space-grotesk` | display headings — core of the visual identity | none (font) |
| `@fontsource/jetbrains-mono` | mono for IMEI/keys/codes — design idiom | system mono looks off-brand |
| `@radix-ui/react-popover` | Combobox + future date/bell popovers; we already ship two Radix pkgs (slot, tooltip) | hand-rolled popover = a11y/focus-trap liability |
| `@radix-ui/react-dialog` | Sheet drawers + confirm dialogs + ⌘K palette (round-2 founder feedback: the design's interaction idiom, not just its look) | hand-rolled modal = focus-trap/scroll-lock/Esc liability |

**Amendment (2026-07-17, redesign round 2):** `@radix-ui/react-dialog` moved from the excluded
list to the table above. Round-1 ported the design system but not its interaction patterns;
the founder's round-2 feedback requires the Sheet side-drawer (`ui/sheet.tsx`), confirmation
modals (`admin/ConfirmDialog.tsx`) and the topbar ⌘K command palette — all Dialog-based in the
design. Sheet/dialog are restyled to our tokens with the animation classes dropped (still no
`tw-animate-css`).

**Deliberately NOT added** (design uses them; we don't need them): `recharts` (we have
hand-rolled SVG charts pinned by e2e testids; AdminKit's Sparkline covers the rest),
`react-day-picker`+`date-fns` (native `datetime-local` inputs are testid-pinned and work),
`sonner` (inline success/error patterns are testid-pinned), `@radix-ui/react-tabs`
(trivial hand-rolled tabs), `tw-animate-css`, `framer-motion` (marketing-only).

## Consequences

- One foundation PR re-themes everything at the token level; per-page PRs then adopt the new
  layout idiom (PageHeader/StatCard/DataTable) incrementally — the app never breaks in between.
- The design's dashboard (Apžvalga `/app`) is NEW functionality we build from real data
  (devices/events/trips APIs) in a follow-up PR.
- e2e smoke + 4-locale i18n remain the regression gate for every re-skin PR.
