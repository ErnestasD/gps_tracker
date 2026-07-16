
# Admin panelės UI redesign

Sukursiu visiškai naują admin panelę po `/app/*` maršrutu su moderniu, švariu dizainu (Cloudflare/Stripe įkvėpimas), o dabartinis marketing site (`/`, `/pricing`, ...) liks nepaliestas.

## Dizaino kryptis

- **Estetika**: šviesus/tamsus dvitemis, plokščias, tikslus, daug oro, plonos linijos, subtilus depth (soft shadows, ne neonas). Ne Midnight-Cyan marketing paletę — atskira, ramesnė admin paletė (šviesi: paper white + slate ink + indigo accent; tamsi: near-black slate + soft indigo).
- **Tipografika**: paliekam Inter + Space Grotesk display, bet mažesni size steps, tighter density.
- **Layout shell**: kairysis sticky sidebar (collapsible į icon rail), top bar su global search (⌘K), account/theme toggle, breadcrumbai. Mobile — off-canvas drawer + bottom-safe padding.
- **Komponentai**: viskas custom pagal design tokens — `Button`, `Input`, `Select` (custom su paieška, keyboard nav, kaip Radix Combobox), `DatePicker` (savas, ne native), `Checkbox`/`Radio`/`Switch` (Radix + tokens), `Dialog`, `Sheet`, `DropdownMenu`, `Tabs`, `Table`, `Badge`, `Tooltip`, `Toast` (sonner), `EmptyState`, `StatCard`, `Skeleton`, `Kbd`. **Jokių browser default** `<select>`, `<input type=date>`, `<input type=checkbox>`.
- **Lentelės**: bendras `DataTable` — kolonų sort, per-column filter chips, global search, pagination, column visibility, row density, CSV export, sticky header, responsive (mobile — kortelinis fallback).
- **Tema**: `next-themes` stiliaus toggle su `localStorage` + `useEffect` (SSR-safe), light/dark/system.

## Maršrutai (visi `/app/*`, nenaudoju auth gate — tik demo UI su mock data)

```
/app                     → Apžvalga (dashboard, KPI + charts + recent events map)
/app/map                 → Gyvas žemėlapis (split: kairė 380px įrenginių sąrašas su paieška/filtrais, dešinė map)
/app/devices             → Įrenginiai (DataTable + „Pridėti" sheet + CSV import)
/app/drivers             → Vairuotojai
/app/maintenance         → Priežiūra
/app/trips               → Kelionės
/app/history             → Istorija (playback: map + speed/fuel charts)
/app/geofences           → Geozonos
/app/rules               → Taisyklės
/app/events              → Įvykiai (timeline + DataTable)
/app/reports             → Ataskaitos
/app/commands            → Komandos (queue view)
/app/branding            → Prekės ženklas
/app/billing             → Atsiskaitymai
/app/api-keys            → API raktai
/app/webhooks            → Webhooks
/app/audit               → Audito žurnalas
/app/settings            → Nustatymai (tabs: profile/org/security/notifications)
```

Šoninis nav grupuojamas: **Gyvai / Parkas / Automatika / Įžvalgos / Operacijos / Administravimas**.

## Landing (Apžvalga)

Cloudflare-analytics tipo: 4 KPI kortelės (aktyvūs įrenginiai, šiandien nuvažiuota km, aktyvūs signalai, avg utilization) su sparkline; du platesni chartai (fleet activity per savaitę area chart + events breakdown donut); mini live map su top-5 vehicles; „Recent events" sąrašas. Charts — `recharts` su design tokens.

## Techniniai sprendimai

- **Routing**: `_admin.tsx` pathless layout route → `app.tsx` layout (sidebar/topbar) + visi vaikai kaip `app.*.tsx`. Layout renderiuoja `<Outlet />`.
- **Duomenys**: mock in-memory (`src/lib/admin-mock.ts`) — deterministinis seed, kad demo atrodytų gyvai. Realtime „faked" per `setInterval` update state.
- **Chartai**: `recharts` (jau installed? patikrinsiu, jei ne — `bun add recharts`).
- **Datepicker**: `react-day-picker` + custom popover wrapper (shadcn kalendorius jau yra `components/ui`? patikrinsiu).
- **Combobox/Select**: shadcn `Command` + `Popover`.
- **Ikonos**: `lucide-react`.
- **Temos**: naujas `AdminThemeProvider` su class-based `dark`/`light` switch tik po `/app/*` (root marketing lieka tamsus).

## Skaidymas (ką padarysiu šiame ėjime)

Kadangi apimtis didelė (~18 puslapių + shared kit), padarysiu vientisu setu:

1. **Tokens & shell** — admin CSS layer, `AdminLayout`, `AdminSidebar`, `AdminTopbar`, theme toggle, ⌘K palette (stub).
2. **UI kit** — `Select`(combobox), `DatePicker`, `DataTable`, `StatCard`, `Chart` wrapperiai, `EmptyState`, `PageHeader`.
3. **Apžvalga** — pilnas dashboard.
4. **Map + Devices + Drivers + Trips + History + Geofences + Rules + Events + Reports + Maintenance + Commands + Branding + Billing + API keys + Webhooks + Audit + Settings** — kiekvienas puslapis su realistišku demo turiniu; lentelės pilnai funkcionalios (filter/search/sort/paginate), mobile-friendly.

Rezultatas: pasiekiama per `/app`, marketing site nepaliestas. Jei nori — galiu pridėti nuorodą iš navbar į „Prisijungti / Demo".

## Ką reikia patvirtinti

Prieš pradėdamas dirbti norėčiau vieno sprendimo: **ar viską padaryti vienu ėjimu (bus didelis diff, ~25+ failų) ar suskaidyti į 2 dalis** — (A) shell + kit + apžvalga + map + devices; (B) likę puslapiai? Rekomenduočiau vienu ėjimu, kad stilius liktų vientisas.
