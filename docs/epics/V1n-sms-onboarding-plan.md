# V1-nice Plan — Device onboarding via SMS (server-pointing config generator)

> Founder 2026-07-13: FOTA WEB cloud API is gold-tier-only → do the SMS variant. Generate the
> exact per-model server-pointing SMS so a client points their tracker at us without any
> Teltonika software. Autonomous session.

## Problem

A Teltonika device must be told WHERE to send data (server domain + port) and its APN. Cloud
FOTA is gated to gold partners, and USB Configurator needs on-site + software. **SMS** is the
universal remote path: every FMB/FMC device accepts GPRS/server config over SMS commands.
Once pointed at us, all further config is our Codec-12 panel (E08-2).

## Teltonika SMS config (wiki-cited)

FMB/FMC SMS command syntax (https://wiki.teltonika-gps.com/view/FMB_SMS/GPRS_Commands):
`<login> <password> <command>` — default login/password are EMPTY, so a command is
`  setparam 2004:orbetra.com;2005:5027` (two leading spaces = empty login+password).
Key parameters (FMB120 param IDs, wiki-cited):
- **2004** Domain (server host)  · **2005** Port  · **2003** Server protocol (0=TCP,1=UDP)
- **2001** APN name · **2002** APN user · **(2003x)** APN pass — APN is carrier-specific.
- `setparam 2004:orbetra.com;2005:5027` points the device; multiple params in one SMS with `;`.

We generate the exact string from the device's PROFILE (host/port from env `INGEST_PUBLIC_HOST`
/ `INGEST_TCP_PORT`) + an operator-entered APN (carrier-specific — we can't know it).

## Solution

- **packages/shared**: `smsOnboarding(host, port, apn?)` PURE — returns the SMS command
  string(s) + a short human checklist. Unit-tested (exact string, empty-login prefix, APN
  optional). No secrets.
- **api**: `GET /v1/devices/:id/onboarding` (device-scope gated) → { imei, smsServer,
  smsApn?, host, port, steps[] } — the copy-paste onboarding sheet. Optional `?apn=` fills
  the APN command. READ policy = device readers.
- **web**: Devices page → per-device "Onboarding" button → a card with the SMS text (copy
  button), the target server, an APN field (operator types their carrier's APN → the APN SMS
  updates live), and numbered steps ("insert SIM, send this SMS to the device's number,
  wait ~1 min, the device appears online"). i18n ×4.
- **Config**: `INGEST_PUBLIC_HOST` (default `orbetra.com`), reuse `INGEST_TCP_PORT`.

## Files

**New:** packages/shared/src/onboarding.ts (+index export) + __tests__; apps/api route in
crud.ts (manifest, entity 'device'); apps/web/src/routes/app/devices/onboarding.tsx +
lib addition; i18n ×4; docs/epics/V1n-sms-onboarding-plan.md.
**Changed:** README (env INGEST_PUBLIC_HOST); apps/api main.ts (pass host into deps or env).

## Tests

- shared onboarding.spec (pure): exact SMS string with empty-login prefix; APN appended when
  given; host/port interpolated; printable-ASCII only.
- api: GET onboarding → 200 shape, device-scope 404 cross-tenant (isolation auto via manifest).
- web unit: the onboarding card builds the SMS + updates on APN input (pure builder).
- e2e: create device → Onboarding → SMS text present + copy testid.

## Risks / honesty

- **APN unknown**: carrier-specific; we can't auto-fill. The sheet has an APN field + a note
  "ask your SIM provider". Documented.
- **First connectivity**: SMS reaches the device only if the SIM has SMS + the device is
  powered. For a device already on another server, migration = same SMS. Documented.
- **Per-model params**: FMB/FMC share 2004/2005; exotic families (TAT) may differ — the
  generator keys on the profile family; unknown family → generic + a warning. wiki-cited.
