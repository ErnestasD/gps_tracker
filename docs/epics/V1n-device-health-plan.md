# V1-nice Plan — Device-health view (TSP support-call deflector)

> PROJECT_PLAN V1-nice: „device-health view (per-device GSM signal, ext/battery voltage
> trend, last FW string from getver, last-seen) — the #1 TSP support-call deflector". All
> fields already flow through the pipeline. Autonomous session.

## What's already there

The normalize step stores IO in `positions.attrs` under `io_<id>` keys (wiki-cited, §3.7):
- **io_21** GSM Signal (0–5) · **io_66** External Voltage (mV) · **io_67** Battery Voltage
  (mV, ×0.001) · plus last-seen from `device:{id}:last` / newest position fixTime.
- Firmware string: from a `getver` Codec-12 response (E08-2) — stored on the command row's
  `response`. We surface the latest getver response per device.

So this is a READ + light chart, no pipeline change (same shape as the E08-3 fuel reader).

## Solution

- **packages/db `readHealthSeries(pool, deviceId, {from,to,limit})`** — raw SQL over positions
  (rule 1), caller scope-gates the device (like readFuelSeries): returns `{fixTime, gsm,
  extV, battV}` (extV/battV scaled mV→V by 0.001). Garbage attrs coerced/skipped, from/to
  sanitized, 10k clamp.
- **api** `GET /v1/devices/:id/health` (manifest, device-scope gate first) → the series +
  a `latest` summary (newest sample + last-seen + last getver firmware pulled from
  `commands` where text='getver' and status='acked', newest).
- **web**: Devices → per-device "Health" panel (reuse the SVG chart pattern): GSM bars,
  voltage trend line (ext + battery), last-seen relative, firmware string, a "Refresh
  firmware" button that sends `getver` via the existing command path. i18n ×4.
- **shared** `HealthSampleView` + `HealthSummary`.

## Files

**New:** packages/db/src/health.ts (+index); apps/web/src/{lib/health.ts, components/HealthChart or reuse, routes/app/devices/health.tsx}; packages/db/__tests__/health.spec.ts; apps/web/__tests__/health.spec.ts; docs/epics/V1n-device-health-plan.md.
**Changed:** apps/api/src/routes/crud.ts (health route); shared entities; i18n ×4; README.

## Tests

- db health.spec (real pg): seed positions with io_21/io_66/io_67 + garbage → gsm/extV/battV
  correct (×0.001 on voltages), scoping, bounds, empty device.
- web health.spec (pure): series mapping, voltage scaling, last-seen formatting.
- api: GET health → shape; cross-tenant 404 (isolation auto).
- e2e: driven device → Health panel shows voltage/GSM.

## Risks

- **Voltage multiplier**: io_67 Battery Voltage ×0.001 (mV→V) per fmb1xx dict; io_66 External
  Voltage likewise. wiki-cited. LLS/other analog = out of scope here.
- **Firmware string**: only present if a getver was sent + acked; else "unknown" + the
  refresh button. Documented.
- **Old rows** pre-fuel-key-fix are unaffected (io_21/66/67 were always name-or-io keyed and
  don't collide like fuel did).
