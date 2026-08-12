# Roadmap analysis — Deep CAN, Fuel Management & Tachograph

**Date:** 2026-07-14 · **Status:** strategic analysis (pre-go-live), not yet scheduled
**Author context:** founder asked what would make Orbetra "significantly more advanced" before go-live.
Tier-1 candidates: **deep CAN decoding + fuel management** and **tachograph**. This doc records
the ground-truth of what we already do, the real gaps, competitor approaches (6 vendors), the
3rd-party DDD-analysis API landscape, and a recommended phasing. Sources at the bottom.

---

## 0. TL;DR / decisions

1. **CAN decoding is ~80% done.** Our codec dictionaries already name the full OBD + LV-CAN + FMS
   parameter set (fmc.json = 634 IDs, fmb1xx.json = 323 IDs) with units + multipliers. We
   **capture** fuel, RPM, coolant, DTC count, axle loads, AdBlue, doors, **and tachograph-over-CAN**
   (Driver 1/2 driving times, card ID, driving state). The gap is the **feature layer**, not decode.
2. **Fuel management = MEDIUM effort, high ROI, buildable pre-go-live** on data we already ingest
   (consumption reports, theft/refuel detection, tank calibration). Testable on the simulator.
3. **Tachograph has TWO layers.** (A) *Real-time tacho-over-CAN* (driver hours/state) — **we already
   receive it**; a driver-working-time dashboard is a LOW–MEDIUM "tacho-lite" quick win. (B) *Remote
   DDD download + legal 561/2006 analysis* — the premium compliance module; **do NOT build the DDD
   parser/infringement engine** (no competitor does except the giants). **Integrate**.
4. **Recommended tacho architecture:** Teltonika **FMC640** (native remote DDD download) + **central
   company-card** (server-side, one reader per TSP) + our own **R2 archive** + **integrate a
   parse+infringement API** — top candidate **TACHO•API (Infolab, Poland)**; alternatives DAKO Smart
   Services, or flespi (parse/transport) + own rules, or Tachogram. This turns tacho from "🔴 months
   from scratch" into a "🟡 real but bounded integration project" — but still needs real trucks +
   company cards to test, so it is **post-go-live with a design spike now**.

---

## 1. What we decode TODAY (ground truth from the codebase)

- **Dictionaries** (`packages/codec/dictionaries/`): `fmb1xx.json` 323 IDs, `fmc.json` **634 IDs**,
  `tat.json` 238, `fmb6xx.stub.json` **0 IDs (STUB — gap)**. 49 multipliers + 190 units present.
- **Pipeline** (`apps/worker/src/normalize.ts`): every IO value is captured and named from the
  dictionary (unknown IDs → `io_<id>`, never dropped); values stay **raw**, multipliers apply at
  read. So CAN/OBD/FMS data flows end-to-end today.
- **Parameters we already receive** (when the device has CAN/OBD/adapter):
  - Fuel: `Fuel Level` (% and L), `LLS 1–5 Fuel Level`, `BLE Fuel 1–4`, `OBD OEM Fuel`,
    `Fuel Rate/Used GPS`, `AdBlue Level`, low-fuel/AdBlue indicators.
  - Engine: `Engine RPM`, `Coolant Temp`, `Engine Load`, `Throttle`, **`Number of DTC`**,
    `Short Fuel Trim`, `Fuel Pressure`.
  - Drivetrain/body: `Axle 1–5 Load`, `PTO`, `Door Status`, door sensors, green driving.
  - **Tachograph-over-CAN**: `Driver 1/2 Continuous/Cumulative Driving Time`, `Driver Card ID`,
    `Driver card expiration/license`, `Driving State`, `Driving Records`.
- **Features already built on this data:**
  - Fuel **level graph** (`apps/web/src/lib/fuel.ts` + `FuelChart` in playback; % or litres, AVL 84).
  - Live **CAN snapshot** API `GET /v1/devices/:id/can` (RPM, coolant, load, throttle, speed, odo).
- **Not built:** fuel consumption/theft/refuel analytics, tank calibration, DTC→maintenance alerts,
  CAN history/analytics, driver working-time module, remote DDD download + legal analysis.
- **Note:** GpsGate (a serious white-label competitor) is essentially where we are today — it reads
  live tacho signals from Teltonika FMB640 (driver name, driving/rest time) but has **no** remote DDD
  download and **no** 561/2006 engine. So "tacho-lite from live signals" is a legitimate market
  position; full DDD is the upsell.

---

## 2. Part A — Deep CAN + Fuel Management

### Teltonika CAN acquisition paths (wiki-confirmed)
- **OBD-II dongle** (FMB001/003) — light vehicles, standard PIDs.
- **LV-CAN200 adapter** (FMB1xx via RS232): total fuel, fuel level (dashboard), mileage, door status
  (4 doors+trunk+hood), RPM, oil pressure/level, engine temp, speed, accelerator pedal, CNG; DTC
  fault codes only with the **LV-CAN200 + DTC** variant.
- **ALL-CAN300 adapter** (superset): adds fuel level in **% or Litres**, VIN, lights, **AdBlue**,
  Webasto, **SIMPLE TACHO** (basic tacho over CAN), seatbelts, EV data (charge/battery/range), and
  heavy/agri: **axle loads**, harvesting metrics, PTO, hydraulics.
- **Built-in CAN** (FMC640/FMB640/FMM640/FMx650) — native FMS + tacho CAN.

**⚠️ Codec gotcha — VERIFIED against our own dictionaries 2026-07-14 (agent's specific claim CORRECTED):**
the same numeric AVL ID decodes **differently** for external-adapter vs built-in-FMS devices.
- **External-adapter set ("CAN adapters elements", FMB1xx/FMC1xx + LV-CAN200/ALL-CAN300):** 81=Vehicle
  Speed, 84=**Fuel Level (L)**, 85=**Engine RPM**, 87=**Total Mileage**, 89=Fuel %, 110=Fuel Rate.
- **Built-in-FMS set (FMC640/FMB640 professional):** 85=Engine Load, 86=Total Fuel Used, 87=Fuel
  Level %, **88=Engine RPM**, 135=Fuel Rate — a DIFFERENT id→name map.
- **What we actually have (verified):** `fmb1xx.json` and `fmc.json` were generated from the FMB120 /
  FMC130 wiki pages and **already carry the ADAPTER set** (84=Fuel level, 85=Engine RPM, 87=Total
  Mileage — confirmed by reading the JSON). So **FMB1xx/FMC1xx + LV-CAN200/ALL-CAN300 decode
  CORRECTLY today** — the earlier "FMB130 would mis-map" claim was wrong.
- **The REAL gap:** the **Professional built-in-FMS family (FMC640/FMB640/FMM640)** uses the FMS-element
  ids and its dictionary `fmb6xx.stub.json` is **EMPTY**. **ACTION:** when adding tacho/pro-CAN support,
  build the FMS-elements dictionary for the pro family from its own wiki page — **do NOT reuse
  fmb1xx**, or 85/87/88 will be mis-decoded. (This same family is the tacho hardware — see §3.)

### Gaps and effort (mostly product/analytics on data we already have)
| Gap | Effort | Note |
|---|---|---|
| Fuel consumption reports (l/100km per trip/vehicle/period) | 🟡 M | Fuel Rate/Used/Level already ingested |
| Fuel-theft detection | 🟡 M | Drop without driving/refuel → event |
| Refuel detection + fuel cost (€/L) | 🟡 M | Level jump up → refuel event |
| Tank calibration (sensor value → litres) | 🟡 M | Per-vehicle capacity curve; accuracy-critical |
| DTC / fault-code alerts → maintenance | 🟡 M | Have `Number of DTC`; wire to maintenance (predictive direction) |
| CAN history/analytics (not just live snapshot) | 🟡 M | Time-series RPM/temp/axle |
| Populate `fmb6xx.stub.json` (pro CAN range) | 🟢 S | Data work from wiki |
| Per-vehicle fuel source selection (LLS/BLE/CAN/OBD) | 🟢 S | Profile setting |

**Verdict CAN+fuel: 🟡 MEDIUM** (~4–6 focused dev-days across items; the hard protocol/dictionary
work is done). **Hardware caveat:** the client's device must be CAN-capable (adapter or FMC) — not
every tracker provides CAN.

---

## 3. Part B — Tachograph

### The two layers (do not conflate)
- **(A) Real-time tacho-over-CAN/FMS** — **we already capture these** (arrive as ordinary AVL IO
  elements; HW: FMB640/FMC640/FMM640). Wiki-confirmed AVL IDs: **56/57** Driver 1/2 continuous
  driving, **58/59** break, **69** cumulative driving, **184/185** working state (0 Rest…3 Drive),
  **186** over-speed, **187/188** card presence, **189/190** time-related states (4.5h/9h reached,
  card-expiry + next-mandatory-download warnings), **191** speed, **195–198** driver IDs, **231–235**
  VRN/VIN. → build a **driver working-time dashboard** ("tacho-lite"). No extra hardware. **🟢–🟡.**
- **(B) Remote DDD download + legal 561/2006 analysis** — the compliance product. Signed
  `.DDD`/`.V1B`/`.C1B`/`.TGD` files, periodic download (driver card ≤28 d, VU ≤90 d per EU Reg
  165/2014), archived ≥12 mo, infringement analysis per EU Reg 561/2006. **🟡 integration project**
  — NOT a from-scratch build.

### Tachograph hardware (wiki-confirmed — IMPORTANT)
- Remote DDD download ("**WEB Tacho**") is **ONLY on the Professional family**: FMB630, **FMB640,
  FMM640, FMC640**, FMB641, FMC650, FMM650, FM6300/6320, FM5300+KNL200 — **NOT** the mass-market
  FMB1xx/FMC1xx. Smart Tacho v2 needs FMx640/650 + firmware ≥01.02.28.
- Supported tachographs: **VDO DTCO 1381** (1.3a/1.4+), **Stoneridge SE5000** (7.1+), **Intellic
  EFAS-4** (4.5+), Smart Tacho v2 (newer pro devices).
- **Company card is server-side & central:** Teltonika "**Remote SCard Reader**" software on a 24/7
  PC with the company card in a smart-card reader (rec. Cryptotech CLOUD 2700 R) authenticates every
  remote session. One reader per TSP — confirms the central-card model.
- Wiring: **RDD over FMS** (CAN H/L on PIN 6/9) for DAF/IVECO/Renault/Volvo; **direct to the tacho
  "C" connector** (C5/C7/C8) otherwise; MAN/Mercedes/Scania need manufacturer involvement. A
  Tachocheck SMS validates a session can open.
- **Teltonika WEB Tacho = download + scheduling + archive ONLY (NO infringement analysis)**, licensed
  **per-device/year** ("TACHOWEB LIC"); Teltonika also licenses the comms protocol to build your own
  download handler. So Teltonika gives us the DOWNLOAD layer; we integrate a 3rd party for ANALYSIS.

### How competitors do the legal layer (6 vendors)
| Vendor | Remote DDD | Analysis engine | Company card |
|---|---|---|---|
| **Ruptela** (LT) | Yes (HCV5) | **Integrate** — flespi + **VDO Fleet** | server-side (flespi Tacho Bridge) |
| **Mapon** (LV) | Yes (Mapon Expert) | **Integrate** — **Tachogram** (in-family) | server-side (Tacho Hotel, 60–105 cards) |
| **Frotcom** (PT) | Yes | **Integrate** — **VDO Fleet (Continental)** | on-premise office reader |
| **Webfleet** (giant) | Yes (Tachograph Manager) | **Own** (TachoGrade, DVSA-accredited) + export | server-side (or DAKO in DE) |
| **Wialon** (Gurtam) | Yes (Tacho Manager, command-based) | **Own** (Tacho View; apps "Outdated") | USB reader for AETR; none for CIPF |
| **GpsGate** | **No** (live signals only) | none | n/a |

**Pattern: 4 of 6 INTEGRATE; only the giants (Webfleet, Wialon) built their own** — and Wialon's is
"Outdated" + "no legal force." **VDO Fleet (Continental)** is the most common analysis backend
(Ruptela, Frotcom). In **Germany** even Webfleet often runs through **DAKO** (local tacho bureau) —
signal that partnering is the norm in your market.

### 3rd-party parse + infringement API options (the "don't build the engine" path)
| Provider | Integrator API | 561/2006 engine | Notes |
|---|---|---|---|
| **TACHO•API (Infolab, PL)** | **Yes** — white-label, JSON/XML | **Yes** + 24-country penalties | **Best structural fit; Polish (your market).** Send DDD (≥weekly) / live (≥5 min) → alerts JSON/XML + PDF. Docs sales-gated. |
| **DAKO Smart Services (DE)** | Partner interface | **Yes** (561/165 + national) | Also card hosting + remote-download auth. Protocol not public. |
| **flespi** | **Yes** — REST JSON | **No** (parse/transport only) | **Best raw layer for Teltonika** (open-source Tacho Bridge, G1/G2/G2v2, remote download, 10-yr store). Pair with own rules or another engine. |
| **Tachogram** | Export/connector API | Yes (in product) | €3.99/active driver/mo. API pulls results/pushes files; no public tech docs. Mapon's sister product. |
| **Stoneridge OPTAC3** | Import API | Yes | Inbound-import, sales-gated. |
| **VDO Fleet / DTCO Connect** | Public REST portal | Not confirmed via API | Data/telematics API; infringement-via-API unverified. |
| **TachoSafe** | Lite API + webhooks/S3 | Yes | Export/interop flavour. |
| **traconiq/tachoparser** (Go, AGPL) · **way-platform/tachograph-go** (Go, MIT) | self-host lib/gRPC/CLI | **No** | Parse-only (Gen1/2/2v2). Self-host the PARSE, still build rules. |

**Cost signals:** tachoparser.com £1/driver-week; Tachogram €3.99/active driver/mo.

### Recommended architecture for Orbetra
```
Teltonika FMC640/FMB640 (Professional; + tacho "C"/FMS wiring)
  → Teltonika WEB Tacho (download + schedule + archive; per-device/year license)
      + central server-side COMPANY CARD (Remote SCard Reader, one per TSP)   ← Teltonika does the
        regulated remote-download crypto handshake for us                        DOWNLOAD layer
  → DDD (.DDD/.V1B/.C1B/.TGD) also archived in our R2/S3 (we run R2 for exports), ≥12 mo, immutable, per driver/vehicle
  → PARSE + 561/2006 analysis: INTEGRATE — TACHO•API (primary, Polish, white-label JSON/XML + 24-country penalties)
        | DAKO Smart Services | Tachogram | flespi(parse)+own-rules
  → surface infringements / working-time / reports in the dashboard
```
Teltonika WEB Tacho handles the hard regulated DOWNLOAD (company-card Remote Session, VU handshake),
so build-vs-buy reduces to **binary parse + 561/2006 rule engine** — outsourced to TACHO•API/DAKO.
The genuinely hard parts we thereby avoid: **ERCA-rooted signature verification (RSA Gen1 / ECC Gen2)**,
Annex 1B/1C binary parsing, and maintaining the 561/2006 rule set + per-country penalty tariffs.
Alternative to WEB Tacho for download: flespi (open-source Tacho Bridge, Teltonika-native) — but WEB
Tacho is the first-party path.

### Effort
| Piece | Effort |
|---|---|
| Tacho-lite (driver working-time dashboard from live CAN) | 🟢–🟡 (data already ingested) |
| Remote DDD download integration (device → our server) | 🟡 M |
| DDD archive (R2, retention, immutable, per driver/vehicle) | 🟡 M |
| Parse + infringement (INTEGRATE TACHO•API/DAKO) | 🟡 M–L (integration, not build) |
| Hardware standardization (FMC640 + central card) + install | 🟡 M (logistics) |
**Verdict full tacho: 🟡 real but bounded** via integration — **cannot be tested without a real truck
+ digital tachograph + company card**, so post-go-live with a design spike now.

---

## 4. Recommended sequencing (pre-go-live vs post)

**Before go-live (MEDIUM, high-ROI, on data we already ingest — testable on the simulator):**
1. **Fuel management** — consumption reports + theft/refuel detection + tank calibration + source selection.
2. **Driver working-time dashboard** ("tacho-lite") from live tacho-over-CAN params we already receive.
3. **DTC / fault-code alerts** + AdBlue/axle rules → maintenance (predictive direction).
4. **Populate `fmb6xx.stub.json`** (pro CAN range) + CAN history/analytics.

**Post-go-live (flagship module; design spike now):**
5. **Remote tachograph DDD** — pick hardware (FMC640), integration partner (TACHO•API vs DAKO vs
   flespi+rules vs Tachogram), central company-card architecture, and R2 archive design now; build
   the module with pilots and real trucks. Do **not** build the DDD parser/infringement engine.

**Rationale:** 1–4 make the product genuinely more advanced using data we already ingest — fast,
cheap, simulator-testable. 5 is legally regulated + hardware-dependent + untestable without a real
truck, so it is a partner-integrated post-go-live upsell, not a pre-go-live build.

---

## 5. Sources (retrieved 2026-07-14)
- Competitors: ruptela.com/solutions/tachograph-management, mapon.com/en/fleet-management-solutions/tachograph-remote-download,
  webfleet.com Tachograph Manager, frotcom.com/features/remote-tachograph-download + integration-vdo-fleet,
  help.wialon.com tachographs, gpsgate.com/releases/august-2024-release-notes, dako.de/en/products/hardware/link-740.
- 3rd-party APIs: tachoapi.com + /faq, dako.de/en/partners/smart-services, tachogram.com/en + /pricing + /for-businesses,
  stoneridge-tachographs.com/en/products/optac3, docs.developers.vdo-fleet.com, tachosafe.ro/en/services,
  flespi.com/kb/tacho-integration; open-source: github.com/traconiq/tachoparser, github.com/way-platform/tachograph-go.
- Teltonika: wiki.teltonika-gps.com/view/DIGITAL_TACHOGRAPH_MONITORING (remote tacho download native to FMC640).
- Our codebase: packages/codec/dictionaries/*, apps/worker/src/normalize.ts, apps/web/src/lib/fuel.ts,
  apps/api GET /v1/devices/:id/can.
