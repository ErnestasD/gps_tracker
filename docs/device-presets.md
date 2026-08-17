# Device configuration presets (design doc — pre-implementation)

Status: draft v2 for founder review, 2026-07-21. Not wired into the product yet.
Implementation target: extend `COMMAND_PRESETS` (`packages/shared/src/entities.ts`) + the
Commands panel (`apps/web/src/routes/app/devices/commands.tsx`); see §5.

## Santrauka (LT, founder-facing)

Idėja: **standartiniai paketai, kuriuos operatorius įdiegia vienu paspaudimu** — ne
parametrų medžioklė. Nei Wialon, nei GpsGate tokių one-click paketų neturi (Wialon — tik
per-modelį instrukcijos, GpsGate — pasidaryk-pats šablonai), tad tai mūsų diferenciatorius.

Kanoninis paketas `standard-vehicle` — trys elgesiai vienoje komandoje:

| Norimas elgesys | Kaip realizuojama |
|---|---|
| 1. Stovi ignition OFF + sujudinimas → trackina + aliarmas | Towing Detection scenarijus (`11600:2`, High — siunčia iškart; užsiginkluoja po 5 min nuo degimo išjungimo). Eventas = AVL IO **246**, mūsų codec žodynai jį jau dekoduoja; telieka `towing` rule tipas Rules variklyje (analogas — `panic`) |
| 2. Ignition ON → visada live | `138` (ignition kaip judėjimo šaltinis) + MOVING profilis kas 5 s (home + roaming) |
| 3. Ignition OFF, ramybė → kas 15–30 min | STOP periodas `10000:900` arba `1800` (du varianto mygtukai) |

Komanda: `setparam 138:X;10050:5;10055:5;10150:5;10155:5;10000:900;11600:2`

Svarbu:
- **Sleep būtina išjungti** (`102:0`, įeina į `platform-base`) — miegantis device'as
  stovėjime nepajus tempimo.
- IO eventai leidžiami ir be GPS fix'o (rule 6) — tempiamas automobilis požeminiame garaže
  aliarmuoja dar nepagavęs satelitų; rules varikliui towing eventų NEfiltruoti pagal
  `fix_valid`.
- Vienintelis nepatikrintas kabliukas — `138` kombinuota reikšmė „Ignition + Akselerometras"
  (kad tempiamas be degimo ne tik aliarmuotų, bet ir nepertraukiamai trackintų). FW
  ≥03.25.14 tai palaiko; tikslią reikšmę nustatysim per Configurator + `getparam 138` ant
  FMC150 (§6 V1). Iki tol fallback `138:1`: elgesiai 2+3 pilni, 1-as aliarmuoja, tęstinis
  tempimo trackinimas laukia.

Galutinis rinkinys — 4 preset'ai: `platform-base`, `standard-vehicle` (15/30 min),
`economy`, `factory-acquisition` (undo). Ilgoji uodega — tenant'o „saved command templates"
(atskira istorija). Atviri klausimai founder'iui — §7.

## 1. Context

The platform ships 10 generic command presets (getinfo/getgps/…) and an onboarding
config-SMS that sets only APN + server. Data-acquisition stays at Teltonika factory
defaults, which surprised us in the field: a freshly onboarded FMC150 reported hourly while
parked and per-5-min while moving. Field-tested fix (2026-07-21, FMC150 over SMS):
`setparam 138:1;10050:5;10055:5` → live-while-ignition-on.

Founder direction (2026-07-21): FEW presets — **predefined packages an operator installs in
one click**, not parameter hunting. The canonical package wanted:

1. Parked, ignition OFF, unexpected movement (tow/theft) → **start tracking + alarm
   notification**.
2. Ignition ON → **always live tracking**.
3. Ignition OFF, still → heartbeat every **15–30 min**.

Competitor study (2026-07-21): Wialon ships no presets — one recommended per-model baseline
(Codec 8E, sleep off; warns Static navigation can break location updates)
([FMB920 guide](https://help.wialon.com/en/wialon-hosting/user-guide/hardware/teltonika-fmb920-configuration-for-use-in-wialon)).
GpsGate ships none either — operators save their own command templates
([guide](https://support.gpsgate.com/hc/en-us/articles/360009023313-Configure-your-device-to-report-to-GpsGate)).
Nobody has one-click packages → this is a differentiator, and confirms keeping the built-in
list short: **baseline + standard package + economy + undo**, long tail via saved templates
(later story).

## 2. Verified parameter reference

Source (rule 8): FMB120/FMC150 Parameter list pages — identical tables for every ID below.
Re-verify per new device family before enabling (TAT/asset trackers differ).
- https://wiki.teltonika-gps.com/view/FMB120_Parameter_list
- https://wiki.teltonika-gps.com/view/FMC150_Parameter_list
- https://wiki.teltonika-gps.com/view/FMB120_System_settings (movement/ignition source semantics)

| ID | Name | Default | Notes |
|---|---|---|---|
| 138 | Movement source | 2 | 1=Ignition; FW ≥03.25.14.Rev.03 supports MULTIPLE sources at once (encoding: §6 V1) |
| 101 / 104 / 105 | Ignition source / high / low voltage | 4 / 30000 / 13200 mV | must match install wiring |
| 102 | Sleep settings | 2 | 0=Disable — REQUIRED for tow-tracking (sleep kills GNSS while parked) |
| 106 | Static navigation | 1 (on) | Wialon warns it can block location updates; watch during pilots |
| 113 | Data protocol | 0 | 1=Codec 8E (full CAN/fuel/iButton IO; parser supports it) |
| 10000 / 10005 | STOP min period / send period (home) | 3600 / 120 s | |
| 10050 / 10051 / 10055 | MOVING min period / min distance / send period (home) | 300 s / 100 m / 120 s | |
| 10150 / 10155 | MOVING min/send period (roaming) | 300 / 0 s | separate set — roaming SIMs ignore home values |
| 11600 | Towing detection priority | 0 (off) | 1 Low / 2 High / 3 Panic |
| 11601 / 11602 | Towing eventual records / activation timeout | 1 / 5 min | arms N min after ignition off |
| 11605–11607 | Towing threshold / angle / duration | 0.22 mG / 1° / 1000 ms | sensitivity tuning, defaults sane |
| AVL IO 246 | Towing event (0 steady, 1 towing) | — | already in our dictionaries (`packages/codec/dictionaries/fmc.json`) |

## 3. Proposed presets (4)

GPRS (Codec-12) form, sent from the Commands panel — free, instant. The SMS form prefixes
`<login> <password> ` (two spaces on default credentials). All fit the SMS 320-char bound.

### P0 — `platform-base` · „Rekomenduojama bazė“ (once, after onboarding)
Codec 8E + Sleep off. Sleep-off is not optional polish: P1's tow-tracking depends on the
device not sleeping while parked.
```
setparam 113:1;102:0
```

### P1 — `standard-vehicle` · „Standartinis automobilis“ (THE package)
Implements the founder's three behaviours in one command:

| Behaviour | Mechanism |
|---|---|
| Ignition ON → live 5 s | movement source includes Ignition (138) + MOVING profile 5 s home & roaming |
| Ignition OFF + moved → track + alarm | movement source also includes Accelerometer/GNSS → towed vehicle enters MOVING profile; Towing scenario (11600:2) emits AVL 246 event → platform rule notifies |
| Ignition OFF, still → 15/30 min | STOP min period 900 s (variant A) / 1800 s (variant B), send ≤120 s (default) |

```
setparam 138:<COMBO>;10050:5;10055:5;10150:5;10155:5;10000:900;11600:2
```
Variant B (30 min): `10000:1800`. `<COMBO>` = multi-source value for Ignition+Accelerometer
— the ONE unverified value, see §6 V1. Until verified, the shippable fallback is `138:1`
(ignition-only): behaviours 2+3 fully work, towing still ALARMS via 11600:2 (eventual
record, prio High sends immediately) but continuous tow-TRACKING waits on the combo value.
Towing sensitivity/arming stay at factory (11602:5 min arm delay, 11605:0.22 mG).

### P2 — `economy` · „Taupus“ (assets/trailers)
Moving: every 2 min or 500 m, sends batched 5 min; stop: hourly (factory).
```
setparam 10050:120;10051:500;10055:300
```

### P3 — `factory-acquisition` · „Atstatyti gamyklinius“ (undo)
```
setparam 138:2;10000:3600;10005:120;10050:300;10051:100;10052:10;10053:10;10055:120;10150:300;10155:0;11600:0
```

Long tail (parked-watch, static-nav toggle, ignition-voltage tuning, sleep profiles) →
tenant-saved command templates, separate story. Param 107 (records without timesync) stays
out of P0 until its "Always" value is wiki-verified.

## 4. Platform work needed for P1's alarm

- New rule kind `towing` in `ruleKindSchema` (`packages/shared/src/entities.ts:144`) —
  evaluates AVL IO 246 == 1, same shape as the existing `panic` rule (worker rules engine →
  notify channels email/telegram/webpush/SMS). Dictionary already decodes IO 246; no codec
  work.
- Note: rule 6 (invalid fix) permits IO events from no-fix records — a towed car in an
  underground garage still alarms even before GPS fix. The rules engine must therefore NOT
  filter towing events on `fix_valid`.

## 5. Implementation sketch (after founder OK)

- `packages/shared/src/entities.ts`: `CONFIG_PRESETS` registry
  `{ key, labelKey (i18n), command, variants?, families: string[], caveatKey, docsAnchor }`.
  Existing 10 command presets stay.
- Commands panel: grouped "Configuration profiles" section; variant picker (15/30 min) for
  P1; caveat line under selection; existing danger-gating untouched.
- Family gating by device profile family; unknown family renders with `familyCaveat`.
- SMS path: presets usable as `POST /v1/devices/:id/sms` bodies.
- Worker: `towing` rule kind (§4).
- No new deps; no migrations (rule kind is a string enum in shared + rules config JSON).
- Tests: registry shape, family filter, command regex + ≤320 chars, towing rule unit test
  (IO 246 event → notification job), invalid-fix towing event still fires.

## 6. Verification items before shipping

- **V1 (blocking P1 full behaviour): param 138 multi-source value.** Wiki confirms FW
  ≥03.25.14.Rev.03 multi-select ("if ANY selected source is active → MOVING") but not the
  encoding (range 0–8). Plan: set Ignition+Accelerometer in Teltonika Configurator on the
  FMC150, read back with `getparam 138`, cite the value here. Fallback `138:1` ships either way.
- **V2: FMC150 firmware version** ≥03.25.14.Rev.03 (`getver`) — else multi-source is a
  different param ID (100) and P1 falls back to `138:1`.
- **V3: field-test towing alarm**: park, ignition off, wait >5 min (11602 arm delay), rock
  the car → expect AVL 246 record within seconds (11600:2 High priority sends immediately).

## 7. Open questions for the founder

1. P1 default variant: 15 min (A) or 30 min (B) stop heartbeat?
2. Fold P0+P1 into the onboarding config-SMS for vehicle installs, or keep operator-triggered?
3. Towing alarm default channels: push+email, or SMS too (billable)?
