# No-hardware production-testing stack (multi-manufacturer, 90–95% device coverage)

**Date:** 2026-08-18 · **Status:** verified research → decision-grade recommendation (not yet implemented)
**Method:** 13-agent workflow — 6 research threads, each independently re-verified by a skeptic
(CONFIRMED/REFUTED/UNVERIFIED), then synthesized. 555k tokens, 199 web lookups. Extends the earlier
5-layer testing-strategy debate; this one adds multi-manufacturer + the concrete tool picks + coverage math.

## TL;DR — two axes, two load-bearing tools

The system must be tested on **two independent axes; no single tool covers both:**
- **Axis A — decode/value correctness** ("does Orbetra read the bytes right"). Owned by **Traccar's
  decoder + its `*ProtocolDecoderTest.java` hex fixtures** — across the WHOLE multi-manufacturer gamut.
- **Axis B — transport/ACK/framing state machine** ("does Orbetra respond right"). Owned by a
  **bespoke Scapy L1 ACK/resend harness**. This is the class that owns 2 of our 3 live bugs (Codec-16
  resend loop, park-frame/ACK-declared-count) — no decoder oracle can test it.

Everything else is supporting. Real hardware (L0) remains the only proof of **device-side behavior**
(the residual 5–10%), but is NOT required to reach ~90–95% decode coverage now.

## The stack (verified)

### Load-bearing
1. **Traccar decoder + hex-fixture corpus** — Apache-2.0, maintained (v6.14.5, Jun 2026), free, offline,
   deterministic. **266 protocol test files** with inline real-device hex + expected-value assertions
   (`ProtocolTest.verifyPosition(binary("hex"))`, zero network). Independently authored → breaks our
   `parse(encode(x))==x` circularity **at scale**. Teltonika **Codec 8/8E/12/13/16 present** — the
   ONLY public source carrying Codec-16 bytes. **Codec 14 (0x0E) absent.** Role = our L2 decode-diff
   oracle AND immutable fixture corpus (vendor the hex + Apache-2.0 NOTICE + ADR per CLAUDE.md rule 10).
   *(We already name Traccar as the oracle in CLAUDE.md and harvested 26 Traccar packets — this
   OPERATIONALIZES that into a mechanized diff across 6 families.)*
2. **Bespoke Scapy L1 ACK/resend harness** — Scapy GPLv2, maintained, free, offline, containerizable.
   The only verified building block that can **send a frame → read the 4-byte ACK → branch → decide to
   resend** = model the device's reaction to the server's response. Exactly the Codec-16 endless-resend
   and park-frame bugs. **Seed bytes from an INDEPENDENT encoder (alim-zanibekov Go lib), never our own**
   — else the harness is circular. `tcpliveplay` can't (fixed payload, no app-layer reaction); AFLNet
   can't (C-only, our server is TS).

### Supporting
- **boofuzz** (GPL-2.0, maintained 2026-08) — nightly framing/CRC/declared-count/duplicate-IO fuzz,
  black-box TCP (works against the TS server unmodified). Caveat: detecting a *hung/looping* Node
  process needs a custom health-probe hook (its monitors target native segfaults). Pinned-seed nightly,
  not the always-on lane.
- **alim-zanibekov/teltonika** (Go, MIT) — the independent encoder seeding Scapy. Encode+decode Codec
  8/8E/12/13/14/15/16 TCP+UDP. **Has Codec 14, which Traccar lacks** → our only offline Codec-14 oracle.
  ⚠️ **Correction from re-verification: last commit 2024-07-10 → stable/DORMANT, not actively
  maintained.** Fine as a frozen oracle; PIN the commit.
- **neilberkman/teltonika_codec** (Elixir, Apache-2.0, maintained 2026-06) — a 2nd, independently
  authored Codec-16 fixture donor. Two independent Codec-16 byte sets for the codec that bit us live.
- **Vendor spec fixtures** (immutable ground truth): Teltonika wiki Codec page (sanctioned truth);
  **Queclink Protocol Pro V10** public portal `qdc.queclinksz.com` (more open than assumed, CRC-8
  examples); **Meitrack GPRS Protocol PDF** (no-login download).
- **Telemify** ($29/mo Starter) — MANUAL staging smoke ONLY. The only tool that drives a real stateful
  Teltonika IMEI handshake + retransmit-on-missing-ACK against our server — but **Codec 8/8E only**
  (no 16/12/14), cloud-only, undisclosed residency. Synthetic data only, never a CI gate.
- **flespi** — MANUAL out-of-band frame lookup only. Raw hex→JSON on ~150+ protocols incl. new binary
  variants Traccar trails (e.g. Queclink @Track Pro). NL datacenters. Never CI, never hot path, never
  real customer bytes.

### Correctly REJECTED (do not reconsider)
- **flespi TrackBox** — emits only into flespi's own REST/HTTP/MQTT, cannot send raw TCP to our ingest.
- **Traccar `test-integration.py`** — ASCII-only corpus (136 text protocols), ZERO Teltonika/GT06
  binary frames. The value is the *decoder + ProtocolDecoderTest fixtures*, not this script.
- **AFLNet** — best stateful fuzzer conceptually but needs C/C++ source instrumentation; can't touch TS.
- **gpsd / OpenGTS / GeoGate** — wrong protocol layer or unmaintained (~2017).
- **vondraussen/gt06** — no LICENSE (all-rights-reserved); read as reference, never vendor.
- **Galileosky Configurator** — Russia-HQ vendor → data-residency / sanctions risk vs the EU-GDPR
  pillar. Flag before any adoption.

## Multi-manufacturer fit — Traccar is the single lever

Every family on the expansion roadmap already has an independently-authored decoder + hex-fixture test
file in the SAME Traccar corpus (verified present): GT06/Concox/Jimi (`Gt06`, 187 verify-calls),
Queclink (`Gl200Text` 192 / `Gl200Binary` 8), Ruptela (`Ruptela` 16), Suntech (`Suntech` 81), Meitrack
(`Meitrack` 51), Galileosky (`Galileo` 15). Adding a family = (a) harvest Traccar hex fixtures for the
value-diff, (b) point the Scapy L1 harness at the new framing/ACK contract, (c) add a boofuzz grammar.
The *value* oracle is essentially free breadth; the *transport* harness is per-protocol engineering.

## 90–95% coverage math (honest)

Market weights ordinal, from the Wialon Top-10 GPS Hardware Manufacturers 2025 (Teltonika #1, 900k+
devices — a device-count proxy for PL/DE/Baltics, NOT audited share). On the **decode/value axis**,
the six families plausibly reach **~90–95% of addressable devices with NO hardware** (Traccar =
offline/deterministic/free oracle for each). On the **transport/ACK axis**, coverage = only as good as
the bespoke Scapy harness + synthetic seeds — it *reproduces known bug shapes*, cannot prove every real
one. The last 5–10% is a **behavioral** gap no third-party tool closes (see Honest Limits).

## CI vs manual vs external-fenced
- **Always-on CI (deterministic/offline/free):** Traccar fixture-diff (Axis A, all 6 families), Scapy
  L1 harness (Axis B), Go encoder seeds (incl. Codec 14/16), neilberkman + vendor-spec fixtures.
- **Nightly (offline/free):** boofuzz (pinned seed, custom Node health-probe).
- **Manual staging smoke (online, synthetic only):** Telemify ($29/mo, 8/8E ACK loop), flespi (free
  tier, one-off decode when Traccar trails a new binary variant).

## Cost & residency
- CI stack = **$0 licenses** (Apache-2.0 / MIT / GPL). Real cost = engineering to build the Scapy
  harness + boofuzz grammars. Optional: Telemify $29/mo; flespi free tier (paid €130/mo, not needed).
- **Local-only, real-data-safe:** Traccar, Scapy, boofuzz, Go encoder, neilberkman, vendor specs —
  nothing leaves our infra (clean for the EU self-hosted pillar).
- **Synthetic-only external:** Telemify (undisclosed host), flespi (NL DC) — redacted/synthetic frames
  only, off the hot path, never CI, never real IMEIs/customer traffic. Real captures pass `tools/redact`
  before commit (CLAUDE.md rule 12).

## Ordered action plan (this week, no hardware)
1. **Traccar value-diff harness FIRST** — harvest Teltonika + GT06 + Ruptela + Queclink + Suntech +
   Meitrack hex fixtures → immutable corpus; assert Orbetra-decode == Traccar-expected. ADR + NOTICE.
   Catches the shared-encoder blind spot across all 6 families on day one; fastest ROI. ⚠️ canonicalize
   IO as an ordered `(id,value)` list, never a keyed dict (a dict rebuilds the duplicate-IO bug in the
   comparator).
2. **Scapy L1 ACK/resend harness** — frame → read 4-byte ACK → branch → assert: no endless resend,
   ACK ≤ persisted, undecodable → park-frame + `raw:unsupported`. Seed from the Go encoder (Codec 16 + 14).
3. **neilberkman** as 2nd Codec-16 source + vendor worked-hex (Teltonika wiki, Queclink Pro, Meitrack).
4. **boofuzz nightly** with a Node hung-process health-probe.
5. *(Optional)* Telemify Starter on staging for a real 8/8E ACK-loop smoke (synthetic data).

**When real devices (L0) arrive:** real captures become the true oracle (replace synthetic Scapy seeds
with redacted real frames); confirm actual device resend-on-wrong-ACK timing; capture real Codec 14/16
frames (thin/no open coverage) and freeze. The harnesses were built to accept real bytes from the start.

## Honest limits — the residual hardware-only gap (state plainly)
1. **Device-side ACK/resend timing/retransmit behavior** — every fixture source is uplink frames only;
   the device's reaction to our response can be *modeled* in Scapy but only *proven* on hardware.
2. **The exact malformed shape that broke us may be in no public corpus** — boofuzz raises the odds, no
   guarantee.
3. **Firmware ahead of open decoders** — confirmed pattern (Queclink @Track Pro "Data ID 82"
   received-but-not-decoded by Traccar until a user supplied the spec). Open corpora trail firmware by months.
4. **Codec 14 (0x0E)** — no Traccar oracle, only the dormant Go lib.
5. **Encrypted/TLS-wrapped Teltonika & MDVR video (Howen/Streamax)** — no open no-hardware corpus (deferred).

**One line:** Traccar makes decode-value correctness ~90–95% coverable with zero hardware across the
whole roadmap; the Scapy harness reproduces the transport bugs we already know; neither proves real
device *behavior* — that residual 5–10% is genuinely hardware-only and no tool on the market closes it.

## Sources (verified, retrieved 2026-08-18)
Traccar decoder + tests (github.com/traccar/traccar, Apache-2.0, v6.14.5); Scapy (scapy.net, GPLv2);
boofuzz (github.com/jtpereyda/boofuzz, GPL-2.0); alim-zanibekov/teltonika (MIT, last commit 2024-07-10);
neilberkman/teltonika_codec (Elixir, Apache-2.0); Teltonika wiki Codec page; Queclink Protocol Pro V10
(qdc.queclinksz.com); Meitrack GPRS Protocol PDF; flespi (flespi.com, NL DC); Telemify (telemify.io);
Wialon Top-10 GPS Hardware Manufacturers 2025.
