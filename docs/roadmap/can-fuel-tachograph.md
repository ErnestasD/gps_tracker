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

### Teltonika CAN acquisition paths
- **OBD-II dongle** (FMB001/003) — light vehicles, standard PIDs.
- **LV-CAN200 / ALL-CAN300 adapter** (FMB1xx via RS232) — trucks/buses, full fleet CAN.
- **Built-in CAN** (FMC640 / professional) — direct.
All arrive as AVL IO elements → **our pipeline already ingests them**.
*(TODO: confirm exact LV-CAN200 vs ALL-CAN300 parameter coverage from the wiki when populating the
FMB6xx dictionary — the fifth research thread on hardware specifics was not captured here.)*

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
- **(A) Real-time tacho-over-CAN/FMS** — driver 1/2 driving times, card ID, driving/working state.
  **We already capture these.** → build a **driver working-time dashboard** ("tacho-lite"). No extra
  hardware. **🟢–🟡 LOW–MEDIUM.** Real selling point without the legal download.
- **(B) Remote DDD download + legal 561/2006 analysis** — the compliance product. Requires signed
  `.DDD` (driver card) + `.V1B/.C1B` (VU) files, periodic download (driver card ≤28 d, VU ≤90 d per
  EU Reg 165/2014), archived ≥1 yr, and infringement analysis per EU Reg 561/2006. **🟡 integration
  project** (see below) — NOT a from-scratch build.

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
Teltonika FMC640 (+ tacho cable)          ← native remote DDD download (wiki: DIGITAL_TACHOGRAPH_MONITORING)
  → central COMPANY CARD (server-side, one reader per TSP; Mapon "Tacho Hotel" / flespi Tacho Bridge model)
  → DDD files to our server → ARCHIVE in R2/S3 (we already run R2 for exports), retention ≥1 yr, immutable, per driver/vehicle
  → PARSE + 561/2006 analysis: INTEGRATE — TACHO•API (primary) | DAKO | flespi(parse)+own-rules | Tachogram
  → surface infringements/working-time/reports in the dashboard
```
Teltonika handles step 1 (acquire DDD) natively, so the build-vs-buy decision is only steps 3–4
(binary parse + rule engine) — exactly what TACHO•API/DAKO let us outsource.

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
