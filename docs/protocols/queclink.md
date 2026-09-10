# Queclink @Track — implementation-ready specification

**Status of this document.** Every factual claim carries a label and a source. Do not remove the labels.

| Label | Meaning |
|---|---|
| **VERIFIED** | Stated in a rank-1 vendor document *and* reproduced by me against a real frame (length closes, CRC matches, or the value matches the vendor's own prose), or arithmetic I performed myself and can be re-checked from the bytes printed here. |
| **INFERRED** | Derived from length arithmetic, from a decoder implementation, or from one source only. Plausible, not proven. Ship behind a model gate or not at all. |
| **UNKNOWN** | I could not settle it. Section 9 says what would settle it and what it costs to be wrong. |

**Source ranks.** R1 = Queclink vendor document (PDF or `qdc.queclinksz.com` HTML). R2 = Traccar decoder + its test corpus (Apache-2.0). R3 = flespi protocol page + changelog. R4 = other open-source implementations (`jaayesta/queclink-parser` MIT, `jpmens/qtripp` GPL-2.0+, `404minds/avl-receiver` AGPL-3.0 — read-only evidence). R5 = forums, issue trackers, field reports.

**Licence warning that governs section 8.** Vendor PDFs are R1 and **not redistributable** — cite the section, never vendor the file. Traccar's corpus is Apache-2.0 and reusable with attribution. `404minds/avl-receiver` is AGPL-3.0: read it as an oracle, never copy a line of it or vendor its testdata. `queclink-parser` is MIT and is the friendliest source in the harvest. Every real IMEI, ICCID and VIN in this document must go through `tools/redact` before it reaches a committed fixture (CLAUDE.md hard rule 12).

---

## 1. What speaks this protocol

### 1.1 The structural fact that governs everything

"Queclink protocol" is **three incompatible wire formats served on one TCP/UDP port**. Traccar serves all three under one decoder name (`gl200`, port 5004). They share a vendor, a command language and a vocabulary of report names — and nothing else. **VERIFIED** (R2 `Gl200FrameDecoder`, R1 GL601 V10 frame table).

| # | Family | Framing | Terminator | Integrity | Era | Traccar class |
|---|---|---|---|---|---|---|
| **A** | @Track Air Interface, **ASCII** | `+RESP:` / `+BUFF:` / `+ACK:` / `+NACK:` + CSV | `$` (0x24); **`\0` on the GT300/GL100 dialect** | **none — no checksum of any kind** | 2009 → now | `Gl200TextProtocolDecoder` |
| **B** | @Track Air Interface, **HEX** (same document, §4) | `+RSP` `+BSP` `+EVT` `+BVT` `+INF` `+BNF` `+HBD` `+CRD` `+BRD` `+CAN` `+DAT` `+ATI` `+ACC` `+ACK` `+LGN` — **mask-driven variable layout** | `0D 0A` | CRC-16/CCITT-FALSE | 2014 → now | `Gl200BinaryProtocolDecoder.decodeLocation/Event/Information` |
| **C** | **@Track Protocol Pro** (2nd generation, separate document set) | `2B`/`2D` + `00` + u16 length; TLV records and data-IDs | `24` (`$`) | CRC-8 | 2022 → now | `Gl200BinaryProtocolDecoder.decodeBinary` |

Format A is the **default** (`<Protocol Format>` = 0 in `AT+GTSRI`/`AT+GTQSS`), so it is what almost every deployed unit speaks. Format B is an opt-in configuration of the *same* device. Format C is a different product generation.

**Operational recommendation, and it is not a cop-out.** flespi — a commercial platform with 104 Queclink models in production — states flatly: *"Alternative HEX format of Track Air Interface protocol is completely unsupported"* (R3), and they removed the partial support they had in July 2022 because nobody used it. If a customer's device arrives in HEX mode, the cheapest correct action is `AT+GTSRI=...,<Protocol Format>=0,...` — reconfigure it to ASCII, do not implement format B. This document specifies B anyway, because you will still receive its frames from a misconfigured unit and you must not desync the socket on them.

### 1.2 Models

**VERIFIED** — Traccar's `PROTOCOL_MODELS` map keyed on the `<Protocol Version>` prefix (R2, 43 entries as of master). This is a *decoder's* map, not a vendor catalogue; see trap T17 for why the map itself is contested.

| Prefix | Model | Prefix | Model | Prefix | Model |
|---|---|---|---|---|---|
| `02`, `21` | GL200 | `31` | GV65 | `C2` | GV600M |
| `04`, `35` | GV200 | `36` | GV500 | `C3` | GL320M |
| `06`, `25` | GV300 | `41` | GV75W | `DC` | GV600MG |
| `08`, `3F` | GMT100 | `42` | GT501 (qtripp: GMT200N) | `DE` | GL500M |
| `09` | GV50P | `44` | GL530 | `DF` | CV100LG |
| `0F`, `2F` | GV55 | `45` | GB100 | `F1` | GV350M (qtripp: GV350MB) |
| `10` | GV55LITE | `4F` | GV56 | `F8` | GV800W |
| `11`, `40` | GL500 | `50` | GV55W | `FC` | GV600W |
| `1A`, `30` | GL300 | `52` | GL50 | `802004` | GV58LAU |
| `1F` | GV500 | `55` | GL50B | `802005` | GV355CEU |
| `27` | GV300W | `5E` | GV500MAP | `80201E` | GV30CEU |
| `28` | GL300VC | `6E` | GV310LAU | `8203` (Pro devType) | GV500CNA |
| `2C` | GL300W | `BD` | CV200 | `8300`-class | GL601 (Protocol Pro reference) |
| `2D` | GV500VC | | | | |

Prefixes seen in the wild that are in **no** published map: `FE1712` (GV50MG, R5 traccar#5373), `970208` (GL30MEU, R5 traccar#5939), `07` (GT500, per R4 404minds only), `802003` (GV58CEU, per qtripp only), `840502`, `423031`, `271002`, `310701`, `410502`, `660400`, `120113`, `210102`, `2E0503`, `060800`. **Unmapped prefixes are routine, not exotic.**

### 1.3 Firmware ranges — and why "model" is not enough

**VERIFIED, and this is the single most important architectural consequence in the document.** The wire layout is a function of `(model, firmware)`, and the vendor changes it *within* a model line.

- `jpmens/qtripp` (R4) keys its field maps on the **full 6-character protocol version**, not the 2-character model prefix, and gives GV65 `310603` and GV65 `310905` **different GTERI field lists** — the newer one adds three trailing fields.
- GL300 versions `300800` / `301500` split `<Report ID>` and `<Report Type>` into **two separate CSV fields** where every other version packs them into one hex byte (R4 qtripp).
- Prefix `9702xx` moved the cell block **out of** the repeated position group to once per message (R5 traccar#5939).
- GV58LAU inserted a reserved field into GTFRI during 2026 (R3 flespi changelog).
- CV200 GTIGN/GTIGF carry two extra leading fields and a **second** trailing timestamp that no other family has (R2 corpus; Traccar crashed on them until December 2025).
- A fleet of "over 2,000 GV200 devices from 7000", all on firmware `358803`, send ERI mask bits that the GV200 V5.01 PDF says that model cannot produce (R5 traccar#5391).

flespi's public Queclink changelog is **552 posts** and reads almost entirely as *"fixed parsing of `<report>` for `<model>`"* — the same report type fixed for GL320M four separate times; the Position Append Mask fixed for six model families across three years, most recently **2026-09-01 and 2026-09-02**. Two commercial platforms and one open-source decoder have independently converged on the same rule:

> **Key every offset on the resolved `(prefix, version)`. Refuse to decode an unknown one. Make "we saw a protocol version we have no table for" an alert, never a silent best-effort parse.**

### 1.4 Coverage of the vendor's line

flespi lists **104 Queclink devices** and **640 named parameters** (R3). Queclink's public product line spans asset trackers (GL2xx/GL3xx/GL5xx), OBD dongles (GV500 family), hard-wired vehicle units (GV2xx/GV3xx/GV6xx/GV7xx), CAN/FMS units (GV300CAN, GV355CEU, GV350M), dashcams (CV100/CV200/CV5000) and the second-generation Protocol Pro line (GL601, GV500CNA, GL533CG). **All of them** speak format A. A subset can be switched to format B. Only the newest generation speaks format C.

Report-type coverage observed in real captures: **49 distinct ASCII report types** across 192 sentences in Traccar's corpus (R2) — FRI ERI RTL IGN IGF VGN VGF TOW EPS DIS IOB SPD SOS GEO GES GIN GOT DOG IGL HBM STT STR STP NMR PNA PFA MPN MPF EPN EPF BPL BTC STC JDR JDS GPJ RMD CRA UPD UPC IDA IDN IDF LSW TSW LSA WIF GSM LBS DAR DTT DAT BAA BID OBD CAN INF GPS CID CSQ VER BAT IOS TMZ HBD PDP ANT SWG TMP TEM FLA CLT PHL FTP.

---

## 2. Transport and session

### 2.1 Discriminating the three formats — run this on raw bytes, before any parse

**VERIFIED**, corrected against R1 (Traccar's own version is wrong on case 1b; see trap T25):

```
1a. b[0] in {0x2B, 0x2D} and b[1] == 0x00  ->  format C, report      (2B = real-time, 2D = buffered)
1b. b[0] == 0x2B          and b[1] == 0x10  ->  format C, heartbeat   (fixed 24 bytes)
2.  b[0..3] == "+ACK"                       ->  format A if b[4] == ':' else format B
3.  b[0..3] in BINARY_HEADERS               ->  format B
4.  otherwise                               ->  format A
```

`BINARY_HEADERS` must be **all fifteen**: `+RSP +BSP +EVT +BVT +INF +BNF +HBD +CRD +BRD +LGN +CAN +DAT +ATI +ACC +ACK`. Traccar ships only the first ten; see trap T26 for why the missing five are guaranteed stream corruption. **The buffered forms of the last five (`+BAN`, `+BAT`, `+BBD`, `+BCK`, …) are generated by the documented "replace the 2nd byte with B" rule but appear in no published header set — UNKNOWN, see Q22.**

### 2.2 Transport modes — what the device does at the socket

`AT+GTSRI` field 2 `<Report Mode>` — **VERIFIED** R1 GV300CAN V12.00 pp.15-16.

| Val | Mode | What your server sees |
|---|---|---|
| 0 | Stop | nothing |
| 1 | TCP short-connection preferred | **one short-lived TCP connection per report**; falls back to SMS |
| 2 | TCP short-connection forced | one connection per report; on failure buffers, or **drops** if buffering is off |
| 3 | TCP long-connection | one connection, kept alive by the heartbeat |
| 4 | UDP | heartbeat and `+RESP:GTPDP` recommended so the server learns the source port |
| 5 | Forced SMS | only `GTGSM/GTPHL/GTALM/+DAT` come over a TCP short connection |
| 6 | UDP, fixed local port = main-server port | |
| 7 | TCP long-connection with backup-server failover | |
| 9 | **MQTT** (GV500CG V3.02 only; default user `admin`/`password`, topics `quec_msg`/`quec_ctrl`) | |

Consequences for ingest:
- Modes 1 and 2 mean **connection close is not "device offline"**. Do not build session state that outlives a connection.
- Mode 4/6: bind identity to `(srcIP, srcPort)` and refresh it on **every** datagram. Mode 4 uses an ephemeral port; mode 6 pins it.
- `<Connection Retry Pattern>` 0-4 gives escalating reconnect period triples in minutes — `0: 3/3/3, 1: ⅓/1/3, 2: 1/3/10, 3: 3/10/20, 4: 3/30/60`. Five failures at period 1 promote to period 2, then period 3 forever; one successful connect resets to period 1. **No effect in UDP mode.** (R1 GV300CAN p.17, VERIFIED.)
- **There is no server-silence watchdog.** `AT+GTDOG` / `AT@DOG` is a *scheduled reboot* (interval in days + HHMM), not a link watchdog (R1 GL601 `DOG.html`, VERIFIED). The only reaction to a mute server is the SACK retry ladder (§2.7).

Protocol Pro replaces the mode table with `AT@BSS`: `<Connection Mode>` 0 automatic / 1 online-on-demand (+ `Stay Time` 0-3600 s, + up to 3 daily `Connection Time` HHMM) / 2 always-online / 10 offline; `<Transmission Mode>` 0 = TCP, 1 = UDP; `Port` may be written `ServerPort|LocalPort`. **VERIFIED** R1 `BSS.html`.

### 2.3 Format A framing — delimiter only, and the delimiter is not safe

```
+RESP:GTFRI,<protoVer>,<IMEI>,<devName>,…,<sendTime>,<countNumber>$
```

- *"All of the @Track Air Interface Protocol messages are composed of printable ASCII characters… The entire message string ends with the character '$'."* — **VERIFIED** identically in GL200 V1.02, GL300 V6.00, GV200G V3.01, GV500 V1.06, GV55W V1.01, GT500MA V1.27, P61 V1.19, GV300CAN V12.00, GV500CG V3.02.
- **Exception, VERIFIED:** GT300 V4.02 §3.1 — *"The entire message string ends with `\0`."* A `$`-only framer blocks forever on a GT300/GL100. **Frame on `$` or `0x00`, whichever comes first.** (R3 flespi added "GL100 legacy device type … messages end with `\0`" on 2019-11-15.)
- **There is no length field and no checksum.** See trap T15.
- **`$` is not escaped and can legally appear inside a payload.** `AT+GTDAT` `<Data>` is "≤245, ASCII Code", free-form (R1 GV300CAN p.110); GV500CG p.155 concedes the framing is breakable: *"`<Data>` sent to the backend server cannot contain the character `"$"` when the value of `<SACK Mode>` … is 1."* GTBDR raw Bluetooth data is up to 1200 characters and may be raw peripheral bytes. Enforce a max-frame guard — ASCII GTERI carries a CAN block of up to 1000 bytes (R1 GV300CAN p.184), so use **≥4096** — and on overflow **drop the accumulator and resync, never block**.
- Multiple complete sentences arrive in one TCP segment; one sentence straddles segments. `<Multi-packet Sending>` = 1 packs several buffered reports into one packet capped at **1460 bytes** (**VERIFIED** R1 GL320M V3.03 p.11). Buffer and rescan. See trap T14.
- **Traccar's framer has a bug you must not copy:** `if (endIndex > 0)` means a delimiter sitting at readerIndex 0 yields no frame and consumes nothing, so a single leading stray `0x00` stalls that connection's buffer indefinitely. **INFERRED** from R2 `Gl200FrameDecoder.java`.

**Field 1 has three mutually exclusive shapes — this is the identification fork.** **VERIFIED.**

| Shape | Length | Meaning | Frequency in R2's 192-sentence corpus |
|---|---|---|---|
| `XXMMmm` | 6 | devType(2 hex) + major(2) + minor(2). *"'4B' means GV300CAN … '0100' means version 1.00"* | 180/192 |
| `XXXXXXMMmm` | 10 | 6-char devType (always begins `80`; range `8000000000`-`80FFFFFFFF`) + version | 10/192 |
| `<IMEI>` | 15 | **no version field at all**; a 10-char `HHHHSSPPPP` version sits at/near the END | GT300 family |

Resolution rule (matches R2): `len > 6 ? substring(0,6) : substring(0,2)`. Traccar additionally bails with `if (protocolVersion.length() > 10) return null; // gt300 protocol`.

### 2.4 Format B framing — length offset varies by header AND by model

Every HEX message ends `… <Count Number:2> <Checksum:2> 0D 0A`.

**`<Length>` = the TOTAL frame length including the 4-byte header, the checksum and the `0D 0A` tail.** **VERIFIED** on all 50 frames I checked (31 from GV500CG V3.02, 19 from GV300CAN V12.00) — the length field equals the byte count exactly.

| Header | Layout before Length | Length offset / width | Verified on |
|---|---|---|---|
| `+ACK` | type(1) mask(1) | **6, 1 B** | GV300CAN 36 B; GV500CG 38 B ×3; R2 `2b41434b017f2445…` |
| `+RSP`/`+BSP`, `+EVT`/`+BVT`, `+DAT`, `+CAN` | type(1) mask(4) | **9, 2 B** | GV300CAN 93/96/165 B; GV500CG 97 B ×6; R2 1422 B |
| `+INF`/`+BNF` | type(1) mask(2) **[+ INF Expansion Mask(2) on some models]** | **7 or 9, 2 B — MODEL DEPENDENT** | both verified numerically; see trap T5 |
| `+CRD`/`+BRD`, `+LGN` | mask(2) / 2 unknown bytes | **6, 2 B** | GV300CAN field table (537 = 0x0219); R2 `+LGN` 38 B |
| `+HBD` | mask(1) | **5, 1 B** | GV300CAN 32 B |
| `+ATI` | — | **4, 1 B** | GV300CAN 35 B |
| `+ACC` | — | **NO LENGTH FIELD** — fixed **478 B** (4+1+2+8+450+7+2+2+2) | **INFERRED**, arithmetic from GV300CAN §4.12 field table; the doc's own example is unreadable in the PDF text layer. **Do not trust this constant — see Q11.** |

**CRC — the vendor prose names only "CRC16" and never states the polynomial. I derived it.**

> **CRC-16/CCITT-FALSE — poly `0x1021`, init `0xFFFF`, refin = false, refout = false, xorout `0x0000`, computed over `bytes[4 : L-4]`** — i.e. from `<Message Type>` through `<Count Number>`, excluding the 4-byte `+XXX` header, the checksum and the `0D 0A` tail.

**VERIFIED**: brute-forced against 13 CRC-16 variants over **50 real frames** plus every `binary(...)` sample in Traccar's `Gl200BinaryProtocolDecoderTest` and `Gl200FrameDecoderTest` (36 B → 1422 B). **50/50 match, 0 failures.** Vendor statement of scope: GV300CAN p.353 — *"The CRC16 checksum of data between the fields of `<Message Header>` and `<Checksum>` (exclude `<Message Header>` and `<Checksum>`)"*.

**Buffered HEX:** *"the device will replace the 2nd byte of the report messages with 'B'"* → `+RSP`→`+BSP`, `+INF`→`+BNF`, `+EVT`→`+BVT`, `+CRD`→`+BRD`. Rest unchanged. **VERIFIED** R1 §4.10.

### 2.5 Format C framing — Protocol Pro

**Report frame** (**VERIFIED** byte-for-byte against the doc's own 78-byte worked example and two real GV500CNA captures; R1 `frames/report.html`):

| Off | Len | Field |
|---|---|---|
| 0 | 1 | `2B` real-time / `2D` **buffered** |
| 1 | 1 | always `00` — *"Used as an identifier"* |
| 2 | 2 | Frame Length, u16 BE — Header..Tail **inclusive** |
| 4 | 1 | bit7 = multi-packet flag; bits 0-6 reserved |
| 5 | 0 or 2 | Frame Count, Frame Number — **present only if bit7 set** |
| +0 | 8 | IMEI, **packed BCD with the leading nibble dropped** (`0123456789012345H` → `"123456789012345"`) |
| +8 | 2 | Device Type (`8203H` = GV500CNA) |
| +10 | 2 | Protocol Version (`000C` = V12) |
| +12 | 1 | Custom Version |
| +13 | 1 | Reserved Field Length **N** |
| +14 | N | Reserved Field Data — **skip by the length byte, never assume N = 0** |
| … | var | Records |
| L-4 | 2 | Count Number |
| L-2 | 1 | Check Byte (CRC-8) |
| L-1 | 1 | `24` (`$`) |

**Record:** `RecordLength(1|2) | GeneratedTime(u32 UNIX s) | RecordCountNumber(2) | RecordID(1) | EventCode(1)` then `{DataID(1|2) DataLength(1|2) DataContent(N)}*`. Record length **includes itself**. Records end at `frameStart + FrameLength - 4`.

> **Variable-length integers — this applies to Record Length, Data ID and Data Length alike. VERIFIED, R1 `frames/report.html`: *"The data ID is represented by 1 or 2 bytes… The highest bit of 1 means that Data ID occupies 2 bytes."* High bit 0 ⇒ 1 byte, value = low 7 bits (range 0x00-0x7F). High bit 1 ⇒ 2 bytes, value = `(b0 & 0x7F) << 8 | b1` (range 0x80-0xFFFF).**

This is trap T27 and it is the highest-severity latent bug in the Protocol Pro path: Data IDs 140 (harsh behaviour) and 142-144 (crash) and 178-181 (Bluetooth) are all ≥ 0x80 and therefore go on the wire as two bytes. **No published example exercises the 2-byte branch** — every Data ID and Data Length in all three available Pro fixtures has the high bit clear.

`DataLength == 0` means the device could not obtain the value and `DataContent` is **absent**. **VERIFIED.**

Max report size **1440 B**; longer reports are auto-split via the multi-packet flag. **What may straddle a fragment boundary is UNKNOWN — see Q13.**

> **CRC-8: poly `0x31` (x⁸+x⁵+x⁴+1), init `0xFF`, refin = false, refout = false, xorout `0x00`, over `Header .. Count Number` inclusive = `bytes[0 : L-2]`.**

**VERIFIED 4/4**: the doc's own vector `CRC(2B 01 23 45 67 89 01 23 45 FE 01 06 01 02 01 FF 5D B3 8C 80) = FE`; the 78-byte doc parse example → `4F`; the 24-byte heartbeat example → `14`; the real GV500CNA capture → `F8`.

**Heartbeat frame — fixed 24 bytes, and byte 1 is `10H`, not `00H`.** **VERIFIED** R1 `frames/heartbeat.html`:
`2B | 10 | 18 (len, 1 B) | IMEI(8) | DevType(2) | ProtoVer(2) | CustomVer(1) | GeneratedTime(4) | Count(2) | CRC8(1) | 24`

### 2.6 Identification — there is no login

**VERIFIED.** Formats A and B have **no handshake**. Every message carries the IMEI in the clear: ASCII field 2 (field 1 on GT300), HEX `<Unique ID>` at a model-dependent offset. Bind the device to the connection on first message.

**HEX `<Unique ID>` encoding — it is NOT a 64-bit integer and NOT ordinary BCD. VERIFIED** R1 GV300CAN §4.9 and §4.12:

> *"IMEI is a 15-digit string. In the HEX format message, each 2 digits are encoded into one byte as an integer."*
> `13 57 90 24 68 11 22 0` → `0D 39 5A 18 44 0B 16 00`
> `86 80 34 00 10 00 39 7` → `56 50 22 00 0A 00 27 07`

Decode: `digits = concat(f"{b[i]:02d}" for i in 0..6) + f"{b[7]:d}"` → 15 digits. So byte `0x0D` holds the *integer* 13, not the BCD nibbles `0x13`.

Cross-checks: `56 4F 5F 03 00 52 0A 04` → **867995030082104**, which appears verbatim as an ASCII IMEI elsewhere in the same PDF and passes Luhn. R2 test frames give **865084030003675** and **865284041305735**, both Luhn-valid. Traccar instead does `String.format("%015d", buf.readLong())`, which cannot recover an IMEI under any rule — see trap T22.

**The same 8 bytes may instead be an ASCII device name, NUL-padded**, when the corresponding mask bit is set. For `+RSP`/`+EVT` that is Report Mask bit 6 (**VERIFIED** in both directions from R2 frames). **For `+ACK` the bit-6 rule is demonstrably false** — mask `0x7F` (bit6 set) carries the name `gb100\0\0\0` while mask `0xEF` (bit6 set) carries a packed IMEI. See trap T37; the fallback heuristic is unsound and must never be load-bearing.

**`+HBD` can be completely anonymous. VERIFIED** R1 §4.9: *"If the mask of `<UID>` in the `<+HBD Mask>` is set to 0, the heartbeat message reported will not include device name or IMEI information."* A HEX heartbeat then identifies the device **only by the TCP connection it arrived on**. Handle "heartbeat on an unidentified socket" explicitly or a long-connection device looks dead.

The closest things to a login: **`+RESP:GTPDP`** (GPRS connection established; notably **excluded from buffering**) and, on newer HEX models, **`+LGN`** — which appears in Traccar's header set and one real frame but **is documented in none of the eight vendor PDFs**. From that one frame `2b4c474e00ff0026fe110b07020106563454040d054905000007e4031911213905083abd0d0a`: total 38 B, length at offset 6 (u16) = 38 ✔, CRC-16/CCITT-FALSE over `[4:-4]` ✔, IMEI at offset 15 = 865284041305735 (Luhn ✔), send time at 25-31 = 2020-03-25 17:33:57, count `0508`. **Offsets 8-14 and 23-24 are UNKNOWN — Q21.**

Protocol Pro carries the IMEI in every report and every heartbeat. Still no login.

### 2.7 The ACK contract — stated as rules

This section owns your data-loss and your data-*multiplication* behaviour. Read it as rules, not prose.

#### The two counters (confusing them silently disables the ack)

- **`<Count Number>`** — 4 ASCII hex, **self-incrementing per message**, from `0000`, **rolls at `FFFF`**, present on **every** report and every `+ACK`. Continues across reboots on Protocol Pro. It is the **last CSV field** of an ASCII sentence. **VERIFIED** R1 GL300 V6.00 §3.2.
- **`<Serial Number>`** — 4 ASCII hex, the value the **server** put in its `AT+GT…` command; echoed only in the `+ACK` for that command. **Never acked back.** It is the command correlator.

Both are 4 hex characters and they sit in adjacent-looking positions. **The SACK echoes the Count Number.**

#### The reply shapes

```
+SACK:<CountNumber:4hex>$              <- any report, if SACK is enabled
+SACK:GTHBD,<ProtocolVersion>,<Count>$ <- after a +ACK:GTHBD heartbeat; version may be EMPTY
+SACK:XXXX$                            <- Protocol Pro report, same shape, 11 bytes
```

`+SACK:GTHBD,4B0303,11F0$` and `+SACK:GTHBD,,11F0$` are **both legal** — **VERIFIED** R1 GV300CAN §3.4: *"The device type and the protocol version that the backend server supports. This field is optional. The backend server could just send an empty field to decrease the length."* On 6-char-devtype models the heartbeat SACK carries a **10-char** `<Full Protocol Version>`: `+SACK:GTHBD,8020090302,11F0$`.

#### The rules

**R-ACK-1. Echo the count byte-for-byte. Never parse-then-reformat.** Do not upper-case it, do not re-pad it, do not strip leading zeros. `+SACK:GTHBD,070002,FFFF$` for count `FFFF`; `+SACK:GTHBD,070002,11f0$` for a lowercase `11f0`. Echo a non-conforming 7-char protocol version verbatim rather than truncating. (R4 404minds' test matrix is the strictest of the three implementations and is right; `queclink-parser` gets this wrong, emitting `32` for the integer 32 instead of `0020`.)

**R-ACK-2. What the acknowledged value MEANS to the device: "the last message I sent arrived intact — advance."** It is **not** a record count, **not** a byte count, and **not** a persistence receipt from the protocol's point of view. It is a pure sequence echo. With `<SACK Enable>` = 1 the device *checks* it and treats a mismatch as identical to silence; with mode 2 it does not check. Contrast Teltonika, where the acknowledged value is the number of records the server accepted and is therefore load-bearing for delivery. **Queclink's ack carries no per-record semantics at all.** You cannot ack "3 of 5".

**R-ACK-3. Ack AFTER the durable write, never before.** A resend after a wrong ack costs one duplicate message; an ack before persistence loses the record forever. This is CLAUDE.md hard rule 4 restated for a protocol that gives you no partial-ack escape hatch: if you cannot persist the whole sentence, do not ack it at all.

**R-ACK-4. Only ack a sentence you actually recognised.** Send a `+SACK` only when the sentence parsed to a known message type **and** its last field is exactly 4 hex characters. Anything else is stored raw and left unacked. Rationale: a stray `$` inside a payload splits a sentence, and the tail fragment is a syntactically complete "sentence" whose last field is arbitrary payload; echoing it produces a count the device matches against nothing, which starts a retransmit loop that never converges because the same `$` recurs in the resend.

**R-ACK-5. Never `+SACK` a frame with no count field.** Truncated frames exist in real captures (see fixture `ascii-gtfri-truncated`). Do not send `+SACK:$`.

**R-ACK-6. Answer `+ACK:GTHBD` whenever received, independently of `<SACK Enable>`, and answer it exactly once.** **VERIFIED** R1 GV500CG: *"If the terminal receives `+SACK:GTHBD` from the backend server, the terminal must check the serial number of the SACK message `+SACK:GTHBD` regardless of the value of `<SACK Mode>`."* Traccar with `gl200.ack=true` sends **two** replies to one heartbeat (once from `decodeAck`, once from the unconditional tail block) — untested behaviour against a mode-1 device. See trap T10.

**R-ACK-7. Dedupe on `(imei, message_type, count_number, send_time)` — never on count alone.** The counter wraps at `FFFF` and a `+BUFF` replay reuses a count a live report already used. The count is stable across SACK-triggered resends, which is exactly what makes it useful *inside* that key.

**R-ACK-8. Non-consecutive counts are normal, not an error.** **VERIFIED** R1: *"If you find that the count numbers of the received reports are not consecutive, a possible reason is that the terminal has successfully sent the missing report but it was lost during network transmission or discarded by the backend server."* Do not build a gap detector that pages someone.

**R-ACK-9. Budget for the tightest documented deadline: 20 s.** The vendor documents disagree, each is right for its own generation, and a server that assumes one number mis-sizes its deadline for the other:

| Source | Wait | Resends | Mismatch handling | Then |
|---|---|---|---|---|
| **GV500CG V3.02** (2024-11-26) | **20 s** | up to **4** | *"or the serial number of the SACK message does not match the last message sent"* → treated as no-ack | (unstated) |
| **Protocol Pro V10** (2022) | **40 s** | **3 resends = 4 sends total** | mode 1 checks the count, mode 2 does not | **reconnect to the backend server** |
| GV300CAN V12.00 (2024-07-01) | not stated | not stated | not stated (`<SACK Enable>` is `0\|1` only) | — |
| GL200 V1.02, GV350M V4.03, GV200 V5.01, CV200 V2.21, GL320M V3.03 | **not stated** | **not stated** | not stated | — |

I grepped GV350M V4.03, GV200 V5.01, CV200 V2.21 and GL320M V3.03 for "resend" and "does not receive": **zero hits**. The retry policy is simply absent from four current vendor documents.

**R-ACK-10. Assume four identical copies of one report is a normal outcome.** Ingest must be idempotent by construction, not by luck.

**R-ACK-11. With SACK on, the device waits.** Your ack latency is the hard cap on flush throughput — roughly one message per RTT. 10 000 buffered reports at a 200 ms RTT is ~33 minutes; at the 20/40 s timeout it is days. (Whether devices pipeline is **UNKNOWN** — Q3.)

**R-ACK-12. Do not enable SACK on a HEX-mode or GT300-dialect device until it has been bench-tested.** No document defines a HEX SACK, and no document says whether the GT300's `\0` terminator applies to the server's reply. Getting it wrong does not lose data — it **wedges the hardware**. Mode 0 loses the (nonexistent) delivery guarantee but cannot wedge a unit.

**Mode semantics.** Protocol Pro `AT@ACK` `<SACK Mode>`: `0` no SACK expected; `1` SACK required **and the count is checked**; `2` SACK required, count **not** checked (**VERIFIED** R1 `ACK.html`). GV500CG uses the same 0/1/2. **GV300CAN V12.00 defines only `0|1`.** Same protocol name, same year, different value space — **never hardcode the enum; trust the per-model doc.**

**`+NACK`.** Documented for Protocol Pro only, and it is a **device→server** frame rejecting a *command*, never a report ack: `+NACK:APN,123456789012345,C031,10,0,,0,012F,20210407101530,1234$` (Header 5, `:`, Command Word ≤10, IMEI 15, DevType 4, ProtoVer 1-5, CustomVer 1-3, flexible body, Sequence 4, GeneratedTime 14, Count 4, `$`). Causes per R4 `queclink-parser`: `0` wrong password/params, `1` unsupported command, `2` not allowed now. **Zero occurrences of the string "NACK" in GV300CAN V12.00, GV500CG V3.02, GL200 V1.02 or GT300 V4.02.** Treat ASCII `+NACK` as real-but-undocumented: log it, never crash on it, never turn it into a position.

### 2.8 Buffered / offline flush

**VERIFIED**, R1 GV300CAN §3.3.6 (p.318), GV350M V4.03 p.283, GV500CG §4.11:

- Triggers: GSM unavailable · PDP/GPRS activation failure · TCP connect failure. **A missing SACK is NOT a documented buffering trigger** — see Q4.
- Stored in **non-volatile memory**, survives reset. Capacity **10 000 messages** (GV500CG adds "160 bytes per message"). R1 GV300 firmware release notes A18V05 record the day the depth was *raised* to 10 000 — **so the depth is firmware-dependent.**
- **Only `+RESP` is buffered.** Excluded: `GTALM`, `GTPDP`, `GTHBD`, `GTALC` (GV300CAN); `GTPDP`, `GTALM` (GV500CG). Command acks are never buffered.
- *"the original header string '+RESP' is replaced by '+BUFF' while the other content including the original sending time and count number is kept unchanged."* → **`<Send Time>` and `<Count Number>` in a `+BUFF` are the ORIGINAL values, possibly weeks old.** Never treat a `+BUFF` send time as "now"; never use it for freshness or online state. Ack it with its own (old) count anyway.
- `<Buffer Mode>`: `0` disabled (data is **dropped** in report mode 2) · `1` buffered **after** real-time · `2` buffered **before** real-time except `GTSOS/GTPFA/GTPDP/GTUPD/GTHBD` — SOS always jumps the queue · `5` (GV500CG) strict generation order except a `<High Priority Report Mask>`.
- Buffered messages go **only over TCP/UDP, never SMS**, even in forced-SMS mode.
- **Out-of-order arrival is a supported configuration, not an anomaly.** A real GV58LAU flush captured on the Traccar forum in November 2023 delivered September 2023 fixes at one frame per second, interleaved with a live `+ACK:GTSRI`.

Protocol Pro instead flips the header byte `2B`→`2D` and layers Top/High/Normal priority on top: Top and High jump ahead of everything regardless of generation time; only Normal-priority ordering is configurable (`AT@RPS`). Any priority can become a buffer report.

### 2.9 Time — the one rule that survives all the contradictions

- **`<GNSS UTC Time>` is UTC in every document.** Use it, and only it, for anything arithmetic that reaches a customer.
- **`<Send Time>` is untrusted.** GV300CAN V12.00 p.14 and GV500CG §4.2 call it *"The local time to send the ACK message"*; GT300 V4.02 §3.2 calls it *"UTC time converted from the terminal local time"*. **Nothing on the wire distinguishes them.** flespi added per-model Time Zone settings for at least eight device types to correct `<Send Time>` to UTC, shipped a DST bug on CV100LG in 2022, and on **2026-06-24** shipped *"Fixed CV200 report timestamps being shifted by the configured time zone — timestamps are stored as UTC again."*
- flespi reached the same conclusion publicly: *"to build accurate tracks basing on the GNSS data sent by Queclink devices, we recommend using parameter `position.timestamp`"* — their name for `<GNSS UTC Time>`.
- **There is no clock-valid flag on the wire.** A device that has never had a fix stamps from an undisciplined RTC; the observed default is **2020-01-01T00:00:0x** in two independent captures. See trap T13.
- CLAUDE.md hard rule 7 applies unchanged: DB stores UTC `timestamptz`; account-timezone formatting happens at render via `date-fns-tz`.

---

## 3. Packet catalogue

**47 packet types are specified below: P1-P31 ASCII, P32-P43 HEX, P44-P47 Protocol Pro.** For format A "byte-by-byte" means field-by-field with index, maximum width, range, unit and scaling — the format is positional CSV, so the index *is* the offset. Formats B and C are given with byte offsets, widths, endianness and signedness.

**Global format A conventions.** All numbers are ASCII decimal unless the table says hex. Timestamps are 14 characters `YYYYMMDDHHMMSS`. Empty fields are `,,` and are legal for almost every field. Big-endian everywhere in formats B and C.

### 3.0 ASCII message-type → layout family map

| Family | Message types | Packet |
|---|---|---|
| Generic location (one shared layout) | GTTOW GTEPS GTDIS GTIOB GTGEO GTSPD GTSOS GTRTL GTDOG GTIGL GTHBM GTGES GTGIN GTGOT GTLSA GTPNL | **P1** |
| Fixed report | GTFRI | **P2** |
| Extended report | GTERI | **P3** |
| Ignition on / off | GTIGN / GTIGF | **P4 / P5** |
| Virtual ignition | GTVGN GTVGF GTVGL | **P6** |
| Vehicle CAN | GTCAN | **P7** |
| OBD-II | GTOBD | **P8** |
| Device information | GTINF | **P9** |
| Wi-Fi / GSM / LBS position | GTWIF / GTGSM / GTLBS | **P10 / P11 / P12** |
| Transparent data | GTDAT GTDTT GTBDR GTSVR | **P13** |
| Heartbeat | `+ACK:GTHBD` | **P14** |
| Command ack | `+ACK:GTxxx` | **P15** |
| Command reject | `+NACK:xxx` | **P16** |
| Server ack | `+SACK` / `+SACK:GTHBD` | **P17 / P18** |
| Power events | GTPNA GTPFA GTMPN GTMPF GTEPN GTEPF GTPDP | **P19, P23** |
| Battery | GTBPL GTBTC GTSTC GTBAT | **P20** |
| Motion state | GTSTT GTSTR GTSTP GTNMR | **P21** |
| Jamming | GTJDR GTJDS GTGPJ | **P22** |
| Bluetooth | GTBAA GTBID GTBAR | **P24** |
| OBD events | GTOPN GTOPF GTJES | **P25** |
| Fuel sensor | GTFSD GTEXP GTUVN | **P26** |
| Photo | GTPHL | **P27** |
| Temperature alarm | GTTMP GTTEM GTFLA | **P28** |
| Crash | GTCRA | **P29** |
| Firmware | GTUPD GTUPC GTEUC GTCFU | **P30** |
| Roaming | GTRMD GTCML GTCSN | **P31** |

### P1 — Generic location report (GTTOW, GTEPS, GTDIS, GTIOB, GTGEO, GTSPD, GTSOS, GTRTL, GTDOG, GTIGL, GTHBM, …)

**VERIFIED** R1 GV300CAN V12.00 pp.177-178.

| Idx | Field | Width | Range / unit | Notes |
|---|---|---|---|---|
| 0 | Header | — | `+RESP:GT<XXX>` / `+BUFF:GT<XXX>` | |
| 1 | Protocol Version | 6 or 10 | hex | §2.3 |
| 2 | Unique ID (IMEI) | 15 | decimal | |
| 3 | Device Name | ≤20 | free text | may contain **spaces and pipes**; may be removed entirely by Report Composition Mask bit 6 |
| 4 | Reserved | ≤5 | | on some models `<External Power Supply>` mV |
| 5 | **Report ID / Report Type** | 2 | **ONE HEX BYTE AS TWO ASCII CHARS** | high nibble = ID, low nibble = Type. **Per-message meaning — see §3.0a** |
| 6 | Number | 1-2 | 1-15 | count of position blocks that follow |
| — | *position block ×Number* | | | §3.0b |
| 7+ | Reserved | 2 | `00` | on newer firmware this slot is `<Position Append Mask>` — see trap T3 |
| 8+ | Mileage | ≤9 | 0.0 - 4294967.0 **km**, 1 dp | |
| −2 | Send Time | 14 | `YYYYMMDDHHMMSS` | **untrusted timezone** |
| −1 | Count Number | 4 | hex | last field before `$` |

**§3.0a — `<Report ID>` / `<Report Type>` semantics are per-message.** **VERIFIED** R1 GV300CAN §3.3.1 and GV350M V4.03 p.161.

| Message | Report ID (high nibble) | Report Type (low nibble) |
|---|---|---|
| GTFRI / GTERI | 1 fixed-time, 2 fixed-distance, 3 fixed-mileage, 4 time+mileage, 5 time-or-mileage, 6 shipping mode | 0 normal, 1 corner, 2 frequency change (geofence/roaming FFC), 3 corner during FFC, 4 mileage in mode 5, 6 FFC mileage |
| GTDIS / GTSOS / GTPNL | triggering digital input port 1-2 or 9-C | new logic level |
| GTIOB | bound IO id 0-3 | new logic level |
| GTSPD | 0 | 0 outside range, 1 inside range |
| GTHBM | speed band: 3 high, 2 medium, 1 low, 0 unknown | 0 braking, 1 acceleration, 2 cornering, 3 braking+cornering, 4 acceleration+cornering, 5 unknown |
| GTDOG | reboot cause 1-7 | 0 |
| GTIGL / GTVGL | **0 = ignition ON, 1 = ignition OFF on GV/GL models; INVERTED on CV200** | see trap T1 |
| everything else | 0 | 0 |

**In a multi-position report the reported type is that of the LAST position.** **VERIFIED** R1 p.182.

**§3.0b — The position block.** One block, repeated `<Number>` times.

| # | Field | Width | Range / unit | Encoding |
|---|---|---|---|---|
| 1 | **GNSS Accuracy** | ≤2 | `0` or `1`-`50` | **THIS IS THE NO-FIX FLAG.** *"0 indicates the current GNSS fix fails and the last known GNSS position is used. A non-zero value (1-50) … represents the HDOP"* — **VERIFIED** R1 GV300CAN p.179, identical wording GV500CG V3.02 and CV200 V2.21 p.159 |
| 2 | Speed | ≤5 | 0.0 - 999.9 **km/h** | 1 dp |
| 3 | Azimuth | ≤3 | 0-359 **degrees** | integer |
| 4 | Altitude | ≤8 | `(-)xxxxx.x` **metres** | signed, 1 dp |
| 5 | Longitude | ≤11 | ±180, **6 dp** | plain signed decimal text |
| 6 | Latitude | ≤10 | ±90, **6 dp** | |
| 7 | GNSS UTC Time | 14 | `YYYYMMDDHHMMSS` | **UTC — the only trustworthy clock** |
| 8 | MCC | 4 | `0XXX` | decimal-looking; radix **UNKNOWN** — trap T5 |
| 9 | MNC | 4 | `0XXX` | as above |
| 10 | LAC | 4 or 8 | hex | |
| 11 | Cell ID | **4 or 8** | hex; 8 = LTE ECI | **VERIFIED** R1 GV500CG |
| 12 | Position Append Mask **or** GNSS Trigger Type **or** Reserved `00` | 2 | hex `00`-`FF` | **model-dependent meaning — trap T3** |
| 12a | Satellites in use/view | ≤2 | 0-99 | present only if the append mask says so |
| 12b | GNSS Trigger Type | 1 | 0 time, 1 corner, 2 distance, 3 mileage, 4 optimum | present only if the append mask says so |

**Fields 2, 3, 4 and the whole 8-12 block can be ABSENT on a per-device basis.** `<Report Composition Mask>` in `AT+GTCFG` gates `<Speed>`(bit0), `<Azimuth>`(bit1), `<Altitude>`(bit2), the **entire cell block**(bit3), `<Mileage>`(bit4), `<Send Time>`(bit5), `<Device Name>`(bit6). **VERIFIED** R1 GV300CAN p.21. **Whether the mask removes fields or blanks them is UNKNOWN — Q1, and the entire decoder architecture hangs on it.** The mask is **not** echoed in any report; it appears only in `+ACK:GTCFG`.

### P2 — GTFRI (fixed report)

**VERIFIED** R1 GV300CAN §3.3.1, cross-checked against the vendor's own single- and dual-position examples.

`+RESP:GTFRI, protoVer, IMEI, devName, ExternalPowerVCC, ReportID/Type, Number, {position block}×N, Mileage, HourMeterCount, AnalogInput, Reserved, BackupBatteryPercentage, DeviceStatus, Reserved×3, SendTime, Count $`

| Field | Width | Unit / encoding |
|---|---|---|
| External Power Supply | ≤5 | **millivolts**, 0-32000 — inserted *before* Report ID, unlike P1 |
| Mileage | ≤9 | km, 1 dp |
| Hour Meter Count | 11 | **`HHHHH:MM:SS` TEXT** — not seconds, not hours |
| Analog Input | ≤5 | **millivolts**, 0-30000 |
| Backup Battery Percentage | ≤3 | 0-100 % |
| Device Status | **6 or 10** | hex; branch on **string length** — §3.0c |

**GV500-family only:** `+RESP:GTFRI` carries the **VIN at index 3** and appends `<Engine RPM>, <Fuel Consumption>, <Fuel Level Input>` after `<Device Status>`. **VERIFIED** R1 GV500 V1.06 pp.71-72, independently encoded by R4 qtripp as `rpm:26 fcon:27 flvl:28` for versions `360701/360801/360901`.

**§3.0c — `<Device Status>`.** **VERIFIED** R1 GV350M V4.03 pp.161-162: *"From right to left, the first two characters indicate the status of output ports, the second two the status of input ports, the third two the current motion status, the fourth two EIO100 output status, and the fifth two EIO100 input status. If there are only six characters in this field, it means EIO100 output status and EIO100 input status are not present."*

Motion byte enum (bits 16-23 of the value):

| Value | Meaning | Ignition | Motion |
|---|---|---|---|
| `11` | Ignition off, Rest | off | no |
| `12` | Ignition off, Motion | off | yes |
| `16` | **Tow** | off | yes — **real tow alarm** |
| `1A` | **Fake Tow** | off | maybe |
| `21` | Ignition on, Rest | on | no |
| `22` | Ignition on, Motion | on | yes |
| `41` | Sensor Rest — *"motionless and no ignition signal is detected"* | **UNKNOWN, never false** | no |
| `42` | Sensor Motion — no ignition signal detected | **UNKNOWN, never false** | yes |

Bit table: bit 8 = Ignition detection, bit 9 = DIN1, bit 10 = DIN2, bit 0 = DOUT1, bit 1 = DOUT2. **Precedence between the motion enum and bit 8 is UNKNOWN — Q9.**

### P3 — GTERI (extended report) = P2 + `<ERI Mask>` + trailing peripheral blocks

**VERIFIED** R1 GV300CAN §3.3.1.

`<ERI Mask>` is **8 hex characters inserted immediately after `<Device Name>`**. Trailing blocks appear in **ascending bit order**, each self-delimited by a leading count.

| ERI bit | GV300CAN meaning | GV350M V3.11/V4.03 meaning |
|---|---|---|
| 0 | `<Digital Fuel Sensor Data>` (raw, ≤20 B) | **"reserved"** — yet Traccar has a GV350M-specific path emitting a UART id + hex fuel value, and flespi shipped a fix for it on 2026-07-28 |
| 1 | `<1-Wire Data>` | `<1-Wire Data>` |
| 2 | **`<CAN Data>`** (ASCII only, ≤1000 B) | **"reserved"** |
| 3 | `<Percentage>` → emits a `<Fuel Sensor Data>` block | same |
| 4 | `<Volume>` → emits a `<Fuel Sensor Data>` block | same |
| 7 | *undocumented* | R2 decodes temp/humidity; GL320M treats it as `externalBattery` — **UNKNOWN, Q7** |
| 8 | `<Bluetooth Accessory Data>` | absent in V3.11 |

**The ERI mask is per-model. Trust the document matching the resolved model; treat an unmapped model as undecodable.** Traccar's `BitUtil.check(mask,0) && !model.equals("GV350M")` branch exists precisely because of this.

**1-Wire block:** `<count>` then `count × (DeviceID 16 hex, DeviceType, Data)`. DeviceType **1 = temperature**, **2 = iButton**. If count is 0 the three sub-fields are **not displayed at all** — the field count varies run to run on the same device. Temperature = **int16 two's complement × 0.0625 °C**. iButton data must **not** go through that conversion (trap T34).

**Fuel-sensor block:** `<count>` then `count × (type [, uart id], percentage, volume)`.

**Bluetooth block:** `<count>` then `count × (index, accessoryType, accessoryModel, rawData, <Accessory Append Mask>, …)`. Append mask bits (**VERIFIED** R1 GV300CAN p.44): 0 Name, 1 MAC, 2 Status, 3 Battery Level, 4 Temperature, 5 Humidity. Traccar additionally consumes bits 7-14 (input/output, event notification, tyre pressure, timestamp, enhanced temperature, magnet, battery, relay) — **undocumented in V12.00, INFERRED**. **Bluetooth temperature and humidity are PLAIN INTEGERS, not ×0.0625** (trap T33).

**CAN block:** see P7 / §6.

**Parse GTERI from BOTH ends.** Head fields forward from index 0 by protocol version; tail fields backward from the count number; let the variable middle absorb the sensors. Traccar does this (`DateUtil.parse(DATE_FORMAT, v[v.length - 2])`) and it is the only shape-robust approach.

### P4 / P5 — GTIGN / GTIGF (ignition on / off)

**VERIFIED** R1 GV300CAN p.275. **The tail order is INVERTED relative to GTFRI.**

`+RESP:GTIGF, protoVer, IMEI, devName, DurationOfIgnitionOn, {position block}, Reserved, HourMeterCount, Mileage, SendTime, Count $`

- Index 4 = **`<Duration of Ignition On>`** (for GTIGF) or **`<Duration of Ignition Off>`** (for GTIGN), **0-999999 seconds**, prepended before the fix.
- Tail is **Hour Meter THEN Mileage** — the reverse of GTFRI.
- **These counters reset to 0 on reboot.** **VERIFIED** R1 GV300 firmware release notes A18V05: *"Fixed The Counter of `<Duration of Ignition ON>` and `<Duration of Ignition OFF>` are reset to 0 if the device reboots"* — i.e. on older firmware they did not, and a backwards jump must be treated as a counter reset, never as negative engine time.
- **GNSS Accuracy is documented as literally `0` ("0, Last known") for these two message types on GV350M V4.03 pp.251/253** — so on those models every ignition event carries a **stale** position. Real GV310LAU captures (`6E0202`) show `1`. **Per-model — Q6.**
- **CV200 (`BD` prefix) carries two extra leading fields and a SECOND trailing timestamp.** **INFERRED** from length arithmetic on a real frame; no CV200 protocol PDF was found.

### P6 — GTVGN / GTVGF / GTVGL (virtual ignition)

**INFERRED.** Same shape as P4/P5 with a `<Report ID/Type>` carrying the virtual-ignition state. `GTVGN` exists in R2's corpus with an asserted `ignition = true`; **GTVGF and GTVGL have no example frame anywhere.** This matters: virtual ignition is what you use when there is no physical ignition wire — the common light-vehicle install. See Q17.

### P7 — GTCAN (vehicle CAN report)

**VERIFIED** R1 GV300CAN §3.3.8 pp.319-326, GV350M V3.11 §3.3.

`+RESP:GTCAN, protoVer, IMEI, devName, <DistType/ReportType:2>, <CANBUS Device State:1>, <CAN Report Mask:≤8 hex>, {masked fields in ascending bit order}, [GNSS block if bit30], [GSM block if bit31], SendTime, Count $`

`<Distance Type / Report Type>`: digit 1 = 0 distance from CAN chipset / 1 computed from GNSS; digit 2 = 0 periodic / 1 RTO / 2 ignition event. **flespi's 2026-02-14 changelog fixed exactly this: the composite value `10`/`12` was being treated as one invalid Report Type and the whole message failed to parse.**

**The field count is governed by the mask. You cannot index into a GTCAN by position without expanding the mask first.** Full mask table in §6.

### P8 — GTOBD (OBD-II report, GV500 / GV500MAP)

**VERIFIED** R1 GV500 V1.06 pp.120-123.

`+RESP:GTOBD, protoVer, IMEI, VIN, devName, ReportType, <OBD Report Mask:≤8 hex>, {masked fields}, [GNSS block], [GSM block], Mileage, SendTime, Count $`

**Note the VIN at index 3.** On every other model that comma position holds the empty reserved field. This is the clearest single example of why the protocol-version prefix must drive the field map. Mask table in §6.

### P9 — GTINF (device information)

**VERIFIED** R1 GV350M V3.11 §3.3.2, cross-checked against two R2 frames with asserted values.

`protoVer, IMEI, devName, State, ICCID, CSQ RSSI, CSQ BER, ExternalPowerSupplyState, MainPowerVoltage, BackupPowerVoltage, BatteryVoltage, Charging, LED, …, LastFixUTC, …, TimeZoneOffset, …, SendTime, Count`

| Field | Unit |
|---|---|
| Main Power Voltage | **millivolts** (`12295` → 12.295 V) |
| Backup Power Voltage | **millivolts** (`13985` → 13.985 V, asserted by R2) |
| Battery Voltage | **volts**, 2 dp (`4.25`) |
| Time Zone Offset | `±HHMM` string, e.g. `+0000` |
| ICCID | 20 digits |

Some GTINF frames have **no trailing `$`**. `<Send Time>` can be **earlier** than `<Last Fix UTC>` (observed: 16:20:09 vs 22:09:34, i.e. UTC-6) — another proof that Send Time is local.

### P10 — GTWIF (Wi-Fi position)

`protoVer, IMEI, devName, <AP count>, {MAC 12 lowercase hex no separators, RSSI (negative dBm), 3 empty fields}×count, …, BatteryPercentage, SendTime, Count`

**No lat/lon.** Classify as presence/diagnostic. **INFERRED** from R2 corpus; no vendor table read.

### P11 — GTGSM (GSM neighbour cells)

`protoVer, IMEI, <trigger tag e.g. "STR" or "FRI">, {MCC, MNC, LAC, CellID, RxLevel, empty}×6 neighbours, {serving cell as the LAST group}, SendTime, Count`

**No lat/lon.** The **last** group is the serving cell. **INFERRED** from R2 `decodeGsm`.

### P12 — GTLBS (LBS position)

Fixed slot count with empty groups padded out; shape differs again from P11. **INFERRED**; observed on GL50B LITE (`660400`).

### P13 — GTDAT / GTDTT / GTBDR / GTSVR (transparent serial / Bluetooth payload)

`protoVer, IMEI, devName, <Data Format>, …, <Data>, …, {position block}, …, SendTime, Count`

**`<Data>` is arbitrary third-party payload.** Documented as ≤245 ASCII for GTDAT (GV300CAN p.110) and **≤1200 characters, possibly raw Bluetooth bytes**, for GTBDR. Real captures contain:
- `>I:5014|DB|607|0|0.00|0.00|0.00|0|0|0|0|1679|4|<` — pipe-delimited, survives comma splitting.
- `45637561747261636b0d0a434f4d422c302c39342e302c2d312e302c2c2c4844430d0a` — **hex-encoded**, decoding to ASCII `Ecuatrack\r\nCOMB,0,94.0,-1.0,,,HDC\r\n`, i.e. a payload containing **commas and CRLF**.

**Consequence:** a splitter that scans for `,` before locating field boundaries, or that treats `0x0D`/`0x0A` as a frame terminator, corrupts GTDAT/GTDTT. Only `$` (or `0x00`) terminates. **If a payload ever contains `$` the frame is unrecoverable — the protocol has no escaping.** That is a documented gap, not a solved problem.

### P14 — `+ACK:GTHBD` (heartbeat, device→server)

**VERIFIED** R1 GV300CAN §3.4, GL300 V6.00 §3.4.

`+ACK:GTHBD, <Protocol Version 6|10>, <IMEI 15>, <Device Name ≤20>, <Send Time 14>, <Count Number 4> $`

Emitted every `<Heartbeat Interval>` seconds set by `AT+GTSRI`/`AT+GTQSS`; 0 disables. *"Whenever the backend server receives a heartbeat package, it should reply with an acknowledgement to the device."* **This is the only reply the spec words as mandatory.**

**GL320M caveat, VERIFIED** R1 V3.03 p.11: *"If the `<Heartbeat Interval>` is longer than `<DNS Lookup Interval>`, the device won't send the heartbeat message (+ACK:GTHBD) to the backend server."*

**It is a `+ACK`-class message.** Every decoder that routes `+ACK` to "command result, ignore" silently stops heartbeating a long-connection device, which then drops and reconnects at every heartbeat interval. See trap T10.

### P15 — `+ACK:GTxxx` (command acknowledgement, device→server)

`+ACK:GT<CMD>, <protoVer>, <IMEI>, <devName>[, <sub-index>], <Serial Number 4 hex>, <Send Time 14>, <Count Number 4> $`

`GTRTO` additionally echoes the sub-command it answered (`VER`); `GTGEO` carries the geofence index before the serial. **This class is the only way to learn that a config command landed, and `<Serial Number>` is the correlation key — allocate it per device, not globally.**

### P16 — `+NACK:xxx` (command rejection, device→server)

`+NACK:<Command Word ≤10>, <IMEI 15>, <DevType 4>, <ProtoVer 1-5>, <CustomVer 1-3>, <flexible body>, <Sequence 4>, <GeneratedTime 14>, <Count 4> $`

Causes `0` wrong password/params, `1` unsupported command, `2` not allowed now. **VERIFIED for Protocol Pro** (R1 `frames/configuration.html`); **UNDOCUMENTED for ASCII @Track** yet modelled by R4 `queclink-parser`. Never a position.

### P17 — `+SACK:<count>$` (server→device, generic)

**VERIFIED** R1 GV300CAN §3.5. Exactly `<Count Number 4 hex>` + `$`. No message name, no protocol version, no IMEI. Total 11 bytes.

### P18 — `+SACK:GTHBD,<protoVer>,<count>$` (server→device, heartbeat)

**VERIFIED** R1 GV300CAN §3.4. Protocol version **may be empty**. See rules R-ACK-1, R-ACK-6.

### P19 / P23 — Power events

`GTPNA` power on, `GTPFA` power off, `GTMPN`/`GTMPF` main power connect/disconnect, `GTEPN`/`GTEPF` external power connect/disconnect, `GTPDP` **GPRS connection established** (never buffered). Most carry a position block; GTPNA often carries nothing but a timestamp. **INFERRED** shape from R2 corpus.

### P20 — Battery: GTBPL (low battery), GTBTC (charging), GTSTC (charge complete), GTBAT

Position block plus a battery voltage or percentage. **INFERRED.**

### P21 — Motion state: GTSTT (state change), GTSTR (start moving), GTSTP (stop), GTNMR (non-movement)

Position block plus the motion state enum. **A factory GT500 ships with motion detection OFF (GTINF state 99), so GTSTT 41/42 never fire until `AT+GTNMD` is sent** — the device looks permanently stationary and you fall back to GPS speed (R5 404minds runbook). Same lesson as Teltonika's `send period 0`: a default-configured device is not a usable device.

### P22 — Jamming: GTJDR / GTJDS (jamming detected/stopped), GTGPJ (GPS jamming)

GTGPJ carries a CW jamming value and a jamming state. **INFERRED.**

### P24 — Bluetooth: GTBAA (accessory alarm), GTBID (beacon id), GTBAR (accessory report)

`GTBAR` is referenced by the ERI-mask bit-8 text (*"will be reported in +RESP:GTERI and +RESP:GTBAR"*) and has HEX event id 70, **but neither vendor PDF prints an example** — Q18.

### P25 — OBD events: GTOPN / GTOPF (OBD connect/disconnect), GTJES (journey engine summary: fuel consumed, max & average RPM, throttle, engine load)

### P26 — Fuel sensor: GTFSD (digital fuel sensor data), GTEXP (malfunction), GTUVN (version)

**Only a truncated GTFSD line survives in the GV350M PDF.** Fuel is on the Orbetra roadmap and there is **no fuel-sensor frame with a known-good expected decode** anywhere in this harvest — Q18.

### P27 — GTPHL (photo location) / P30 — GTUPD, GTUPC, GTEUC, GTCFU (firmware) / P28 — GTTMP, GTTEM, GTFLA (temperature/fuel alarm) / P29 — GTCRA (crash) / P31 — GTRMD, GTCML, GTCSN (roaming, CAN model/serial)

All carry a position block plus event-specific fields. `GTPHL` is the location **before** a photo; the multi-part binary payload frames that follow it (`GTPHD`, `GTEHD`) are **not documented anywhere in this harvest and are the frames most likely to break framing** — Q18.

---

### P32 — HEX `+ACK`

**VERIFIED** R1 GV300CAN §4.2; both a vendor and an R2 frame close at exactly the length byte.

| Off | Len | Field |
|---|---|---|
| 0 | 4 | `+ACK` |
| 4 | 1 | Message Type = command id |
| 5 | 1 | Report Mask |
| 6 | 1 | **Length** (whole frame) |
| 7 | 1 | Device Type |
| 8 | 2 | Protocol Version |
| 10 | 2 | Firmware Version |
| 12 | 8 | Device Name **or** packed IMEI — bit-6 rule does **not** hold here, see T37 |
| 20 | 1 | ID |
| 21 | 2 | Serial Number |
| 23 | 7 | Send Time: u16 year, u8 mon, day, hour, min, sec |
| 30 | 2 | Count Number |
| 32 | 2 | CRC-16 |
| 34 | 2 | `0D 0A` |

Command-id table (**VERIFIED** §4.2): 0 GTBSI, 1 GTSRI, 2 GTQSS, 4 GTCFG, 5 GTTOW, 6 GTEPS, 7 GTDIS, 8 GTOUT, 9 GTIOB, 10 GTTMA, 11 GTFRI, 12 GTGEO, 13 GTSPD, 14 GTSOS, 15 GTCAN, 16 GTRTO.

### P33 — HEX `+RSP` / `+BSP` (location report) and P34 — `+EVT` / `+BVT` (event report)

**VERIFIED** R1 GV300CAN §4.3 / §4.5, byte-exact on **six** frames (three vendor, three R2).

**The 4-byte `<Report Mask>` from `AT+GTHRM` decides which fields are physically present.** Fields appear in this order; a field is present only if its gate bit is set.

| Field | Bytes | Gate bit | Encoding |
|---|---|---|---|
| Header | 4 | always | `+RSP`/`+BSP`/`+EVT`/`+BVT` |
| Message Type | 1 | always | see enums below |
| Report Mask | 4 | always | |
| Length | 2 | **bit 7** | whole frame incl. `0D 0A` — **but see T5** |
| Device Type | 1 | bit 8 | **3 bytes on GV500CG-class models** — trap T29 |
| Protocol Version | 2 | bit 9 | |
| Firmware Version | 2 | bit 10 | |
| Device Name / IMEI | 8 | always | bit 6 selects which; §2.6 |
| Battery Level | 1 | bit 11 | % |
| External Power | 2 | bit 12 | **mV** |
| Analog Input | 2 | bit 14 | **mV** |
| EIO100 In | 1 | bit 26 | |
| Digital In | 1 | bit 17 | |
| EIO100 Out | 1 | bit 26 | |
| Digital Out | 1 | bit 17 | |
| Motion Status | 1 | bit 18 | same enum as §3.0c |
| Antenna \| Satellites | 1 | bit 19 | high nibble bits 3-2 = ext-antenna state, low nibble = satellite count |
| **type-specific insert** | var | — | **§3.0d — this is where decoders break** |
| Report ID / Type | 1 | always (**`+RSP` only**) | high nibble ID, low nibble type |
| Number | 1 | always | position block count |
| *per position:* GNSS Accuracy | 1 | always | **`00` = no fix** |
| Speed | 3 | bit 0 | `u16 integer` + `u8 fraction` km/h — **fraction is tenths or hundredths, UNKNOWN, Q12** |
| Azimuth | 2 | bit 1 | u16 degrees |
| Altitude | 2 | bit 2 | **int16 two's complement, metres** — *"If the altitude is negative, it is represented in 2's complement format. Unit: meter"*. **Scaling UNKNOWN (m vs 0.1 m) — Q8** |
| Longitude | 4 | always | **int32 two's complement ÷ 1e6** |
| Latitude | 4 | always | int32 two's complement ÷ 1e6 |
| GNSS UTC | 7 | always | u16 year, u8 mon, day, hour, min, sec |
| MCC | 2 | bit 3 | **BCD** — trap T28 |
| MNC | 2 | bit 3 | **BCD** |
| LAC | 2 | bit 3 | **binary** |
| Cell ID | 2 | bit 3 | **binary — cannot hold a 28-bit LTE ECI, Q8** |
| Trigger / Reserved | 1 | bit 3 | |
| Current Mileage | 3 | bit 20 | `u16 km` + `u8 fraction` |
| Total Mileage | 5 | bit 21 | `u32 km` + `u8 fraction` |
| Current Hour Meter | 3 | bit 22 | HH, MM, SS bytes |
| Total Hour Meter | 6 | bit 23 | `u32 hours`, MM, SS |
| RFID | 4 | bit 24 | |
| CAN Data | ≤99 | bit 25 | |
| Send Time | 7 | bit 4 | device **local** time |
| Count Number | 2 | bit 5 | |
| Checksum | 2 | always | CRC-16/CCITT-FALSE |
| Tail | 2 | always | `0D 0A` |

**`+RSP` Message Type enum (VERIFIED §4.3):** 1 TOW, 3 **LBC**, 4 EPS, 5 DIS, 6 IOB, 7 **FRI**, 8 GEO, 9 SPD, 10 SOS, 11 RTL, 12 DOG, 15 HBM, 16 IGL, 17 IDA, 18 ERI. **Plus an undocumented type 100 (`0x64`) = compressed batch — P43.**

**`+EVT` Message Type enum — CONTESTED. VERIFIED §4.5:** 6 BPL, 9 STT, 13 **IGN**, 14 **IGF**, 15 UPD, 21 GSS, 23 CRA, 25 DOS, 26 GES, 31 GPJ, 32 RMD, 34 JDS, 35 UPC, 45/46 **Reserved**, 50 VGN, 51 VGF. **Traccar's constants disagree on five:** JDS = 33, UPC = 34, RMD = 35, VGN = 45, VGF = 46. I proved by length arithmetic that Traccar's id 45 with a 7-byte insert is **correct for its device-type-`0x45` sample**. Both are right for their own model. **There is no cross-model table published anywhere — Q15.**

**§3.0d — type-specific inserts, between Antenna|Satellites and Number.** **VERIFIED** by length arithmetic on vendor frames:

| Type | Insert | Size |
|---|---|---|
| `+EVT` 13 (GTIGN), 14 (GTIGF) | `<Duration of Ignition Off/On>` u32 seconds | **4 B** — and *"the `<Current Mileage>` and `<Total Mileage>` fields will always be present regardless of the `<+EVT Mask>` setting"* |
| `+EVT` 15 (GTUPD) | code u16 + retry u8 | 3 B |
| `+EVT` 21 (GTGSS) | status u8 + 4 reserved | 5 B |
| `+EVT` 25 (GTDOS) | 2 B | 2 B |
| `+EVT` 31 (GTGPJ) | CW jamming value u8 + jamming state u8 | 2 B |
| `+EVT` 6 (GTBPL) | backup battery mV | 2 B |
| `+EVT` 45 (GTVGN on devType 0x45) | reserved 2 + reportType 1 + ignition duration 4 | 7 B |
| `+RSP` 3 (GTLBC) | phone-length byte + **BCD phone consumed until an `0xF` nibble sentinel** | var — **INFERRED**, trap T29 |

**Traccar has no case for types 13, 14 or 25**, so real HEX ignition events decode **4 bytes out of alignment** — producing a coordinate that is wrong but plausible.

### P35 — HEX `+INF` / `+BNF` (device information)

`+INF | MessageType(1) | Report Mask(2) | [INF Expansion Mask(2)] | Length(2) | …`

**Length offset is 7 or 9 and is MODEL-DEPENDENT — VERIFIED numerically in both directions.** GV300CAN §4.4 defines the expansion mask ⇒ offset 9, and its own 145-byte example confirms it; a GB100 frame (`2b494e4601fd7f0076…`, 118 B) has no expansion mask and needs offset 7. Traccar contradicts *itself*: its frame decoder uses 7, its protocol decoder reads a 4-byte mask ⇒ 9. See trap T5 for the mandatory validation rule.

**The `+INF` field ORDER is not the `+RSP` order.** From my decode of the GB100 frame: the 8-byte identity `gb100\0\0\0` sits at **offset 9** and Device Type `0x45` at **offset 17** — the reverse of `+RSP`, where devType is at 11 and identity at 16-23. Body (per §4.4): motion status, satellites, mode, 7-byte last-fix time, response report mask, GTIGN/GTIGF intervals, **10-byte ICCID**, timezone flags and offset, and for the GIR sub-type a list of cell towers as `{MCC, MNC, LAC, CID, RxLevel}` groups. **The full `+INF` field table is not reproduced in any source I can cite offset-by-offset — Q10.**

### P36 — HEX `+HBD` (heartbeat)

**VERIFIED**, 32 bytes.

| Off | Len | Field |
|---|---|---|
| 0 | 4 | `+HBD` |
| 4 | 1 | Report Mask |
| 5 | 1 | **Length** |
| 6 | 1 | Device Type |
| 7 | 2 | Protocol Version |
| 9 | 2 | Firmware Version |
| 11 | 8 | **Unique ID — may be ABSENT entirely if the UID mask bit is 0** |
| 19 | 7 | Send Time |
| 26 | 2 | Count Number |
| 28 | 2 | CRC-16 |
| 30 | 2 | `0D 0A` |

### P37 — HEX `+CRD` / `+BRD` (crash data) · P38 — `+CAN` · P39 — `+DAT` · P40 — `+ATI` · P41 — `+ACC`

- `+CRD`/`+BRD`: mask(2) then **Length at offset 6, u16**. Frame sizes up to 537 B (`0x0219`) per the vendor field table.
- `+CAN`: type(1) mask(4), **Length at offset 9, u16**. 165 B vendor example. Field semantics in §6.5.
- `+DAT`: type(1) mask(4), **Length at offset 9, u16**. **Can carry a JPEG.** Framing it as ASCII on `$` is guaranteed stream corruption.
- `+ATI`: **Length at offset 4, u8**. 35 B vendor example.
- `+ACC` (acceleration): **NO LENGTH FIELD.** Computed 478 B = 4 header + 1 mask + 2 ? + 8 uid + **450 payload** + 7 time + 2 count + 2 crc + 2 tail. **INFERRED and unverified — a wrong constant desynchronises the socket permanently. Drop the connection on `+ACC` rather than guess. Q11.**

### P42 — HEX `+LGN` (login)

**Undocumented in all eight vendor PDFs.** From one real frame: Length at offset 6 (u16), same CRC-16, IMEI (decimal-pair encoded) at offset 15, send time at 25-31, count at 32-33. **Offsets 8-14 and 23-24 UNKNOWN — Q21. Treat as unsupported: log, ack nothing, store raw.**

### P43 — HEX `+RSP` message type 100 (`0x64`) — compressed delta batch

**INFERRED, no vendor documentation exists.** Read entirely from R2's `MSG_RSP_COMPRESSED` branch and confirmed only by the fact that a 1422-byte frame's length field closes.

After the usual header it reads a **u16 count of points**, then a bit-packed delta stream. A leading 2-bit tag selects the record form:
- tag `1` = **ABSOLUTE**: 3 bytes of `{2-bit point attribute, 1-bit fix type, 12-bit speed, 9-bit heading}`, then int32 lon, int32 lat, and **on the first point only** a u32 epoch time.
- tag `2` = **DELTA**: 5 bytes of `{2-bit attr, 1-bit fix, 7-bit signed speed delta, 7-bit signed heading delta, 12-bit signed lon delta, 11-bit signed lat delta}`, and **time is implicitly +1 second per record**.
- anything else = one skipped byte meaning "invalid or same".

Coordinates ÷ 1e6, speed ÷ 10 km/h. **Traccar sets `valid = true` on every emitted point and never consults the 1-bit fix type — so in compressed mode the invalid-fix signal is discarded outright.**

> **This is the highest-risk packet in the whole catalogue: a 1422-byte frame expanding to hundreds of one-second positions, with no spec, an undocumented bit layout, a 1-bit fix flag nobody reads, and an implicit clock that drifts permanently if a single tag byte is misread. Treat as UNSUPPORTED until the vendor document exists.**

---

### P44 — Protocol Pro report frame

Layout in §2.5. **Record IDs** (**VERIFIED** R1 GL601 V10 `records/`): `50H` = Fixed Report; the catalogue also defines Location Care, Behaviors, Device Itself, Peripherals, Bluetooth and Vehicle record families. `EventCode` is a u8 within the record.

**Data IDs** — §5.4.

### P45 — Protocol Pro heartbeat frame

Fixed 24 bytes, byte 1 = `10H`, 1-byte length at offset 2. Layout in §2.5.

### P46 — Protocol Pro `+SACK:XXXX$` (server→device)

Identical ASCII shape to P17. Confirmed examples `+SACK:0058$`, `+SACK:0A2F$`, `+SACK:D3FE$`.

### P47 — Protocol Pro `+ACK:` / `+NACK:` configuration frames (ASCII, device→server)

Both use a `:` after the header and therefore fall through the format discriminator to the ASCII path correctly. See P16 for the `+NACK` field list.

---

## 4. Worked examples

Every frame below is real: either a verbatim vendor example (R1) or a capture from Traccar's corpus / a forum post (R2, R5). Every decode is mine unless marked SOURCE-ASSERTED, and every length and CRC claim was recomputed.

### W1 — ASCII GTFRI, vendor reference, GV300CAN

**Source:** R1 GV300CAN @Track Air Interface Protocol V12.00 §3.3.1, verbatim vendor example. **VERIFIED** — the field table is printed beside it, so this frame *is* the definition.

```
+RESP:GTFRI,4B0303,867995030082104,,,10,1,1,0.0,0,47.3,117.129238,31.838810,20190416081145,0460,0000,550B,B969,00,0.0,,,,0,210100,,,,20190416081146,0856$
```

| Idx | Raw | Decode |
|---|---|---|
| 0 | `+RESP:GTFRI` | real-time fixed report |
| 1 | `4B0303` | devType `4B` = GV300CAN, version 3.03 |
| 2 | `867995030082104` | IMEI (Luhn ✔) |
| 3 | *(empty)* | Device Name |
| 4 | *(empty)* | External Power Supply, mV — present only if `AT+GTEPS` enables periodic voltage |
| 5 | `10` | **hex byte**: Report ID 1 = fixed-**time**, Report Type 0 = normal. **Decimal parsing gives 10 = 0b1010 — trap T19** |
| 6 | `1` | Number = 1 position block |
| 7 | `1` | GNSS Accuracy = 1 ⇒ **VALID fix**, HDOP 1 |
| 8 | `0.0` | speed km/h |
| 9 | `0` | azimuth ° |
| 10 | `47.3` | altitude m |
| 11 | `117.129238` | longitude |
| 12 | `31.838810` | latitude (Hefei, CN) |
| 13 | `20190416081145` | **GNSS UTC** 2019-04-16T08:11:45Z |
| 14-17 | `0460,0000,550B,B969` | MCC 460, MNC 0, LAC 0x550B, CID 0xB969 |
| 18 | `00` | GNSS Trigger Type / Reserved / Position Append Mask (model-dependent — trap T3) |
| 19 | `0.0` | Mileage km |
| 20 | *(empty)* | Hour Meter Count `HHHHH:MM:SS` |
| 21 | *(empty)* | Analog Input mV |
| 22 | *(empty)* | Reserved |
| 23 | `0` | Backup Battery % |
| 24 | `210100` | **Device Status**: motion `21` = Ignition On Rest, inputs `01`, outputs `00` |
| 25-27 | *(empty)* | Reserved ×3 |
| 28 | `20190416081146` | Send Time — **local, untrusted** |
| 29 | `0856` | **Count Number** → `+SACK:0856$` |

Its `+BUFF` twin appears verbatim in §3.3.6 and is **byte-identical except for the five header characters**:
```
+BUFF:GTFRI,4B0303,867995030082104,,,10,1,1,0.0,0,47.3,117.129238,31.838810,20190416081145,0460,0000,550B,B969,00,0.0,,,,0,210100,,,,20190416081146,0856$
```

### W2 — ASCII GTFRI with Number = 2 — the repeat rule

**Source:** R1 GV300CAN V12.00 §3.3.1, verbatim.

```
+RESP:GTFRI,4B0303,867995030082104,,,10,2,1,0.0,0,47.3,117.129238,31.838810,20190416081255,0460,0000,550B,B969,00,1,0.0,0,47.3,117.129238,31.838810,20190416081310,0460,0000,550B,B969,00,0.0,,,,0,210100,,,,20190416081311,085F$
```

`[6] = 2`, then **two** complete 12-field position blocks (08:12:55 and 08:13:10 — note the cell block repeats **inside** each block on this firmware), then the **single shared tail**: Mileage `0.0`, Hour Meter, Analog, Reserved, Battery `0`, Status `210100`, Reserved ×3, Send Time `20190416081311`, Count `085F`.

**This must produce two rows, not one, and the tail attributes (odometer, battery, status) attach to the LAST position only** — copying the odometer onto every block double-counts distance.

The four-position variant from R2's corpus, showing a vehicle actually moving:
```
+RESP:GTFRI,1A0900,860599000306845,G3-313,0,0,4,1,2.1,0,426.7,8.611466,47.681639,20181214134603,0228,0001,077F,4812,25.2,1,5.7,34,437.3,8.611600,47.681846,20181214134619,0228,0001,077F,4812,25.2,1,4.4,62,438.2,8.611893,47.681983,20181214134633,0228,0001,077F,4812,25.2,1,4.8,78,436.6,8.612236,47.682040,20181214134648,0228,0001,077F,4812,25.2,83,20181214134702,0654$
```
Four fixes 15 s apart moving north-east near Zurich; battery 83 %; count `0654`. **Note field 12 here is `25.2`, not `00` — on GL300-class firmware that slot holds a per-position odometer that repeats identically across all fixes (R4 qtripp). A third meaning for the same offset.**

### W3 — ASCII GTERI with 1-Wire temperature — the sign oracle

**Source:** R2 corpus, Apache-2.0. **SOURCE-ASSERTED:** Traccar asserts `temp1 == 25.0`.

```
+RESP:GTERI,271002,863457051562823,,00000002,,10,1,1,0.0,15,28.2,-58.695253,-34.625413,20230119193305,0722,0007,1168,16B3BB,00,0.0,,,,99,210100,2,1,28F8A149F69A3C25,1,0190,20230119193314,07C7$
```

`[4] = 00000002` → ERI mask bit 1 only = 1-Wire data. `[5]` external power empty. `[6] = 10` → ID 1 / Type 0. `[7] = 1` position. Accuracy 1 = **valid**. Alt 28.2 m, lon −58.695253, lat −34.625413 (Buenos Aires). MCC 722 MNC 7. Mileage 0.0. Battery 99 %. Status `210100`. Then `2` = UART device type, `1` = 1-Wire device count, then one triplet: id `28F8A149F69A3C25`, type `1` (temperature), data `0190`.

**Arithmetic, independently verified against the rank-1 rule (×0.0625 on a two's-complement int16):** `0x0190 = 400`; `400 × 0.0625 = 25.0 °C` exactly.

**The negative case — this is the vector that separates a correct implementation from a plausible one.** Source: R2 corpus; **SOURCE-ASSERTED at R4** (`404minds`, AGPL — read-only) as `−1.875 °C` and odometer `15529`:
```
+RESP:GTERI,040A00,862894022579562,gv200,00000002,,10,1,1,96.1,180,749.7,39.222692,24.165463,20210225065756,0420,0004,759C,3360,00,15529.8,,,2789,,01,00,2,2,282BD47A0B000063,1,FFE2,281FDD5D0B000057,1,FFC8,20210225065800,6974$
```
`0xFFE2` as int16 = −30 → **−1.875 °C**. `0xFFC8` = −56 → **−3.5 °C**. An unsigned parse gives `65506 × 0.0625 = 4094.1 °C`.

**The seven-sensor case that breaks fixed-width parsers.** Source: R1 GV350M V3.11 §3.3.1, verbatim vendor example:
```
+RESP:GTERI,F10310,868446036599153,gv350m,00000002,11636,10,1,2,0.0,0,247.8,114.015482,22.537480,20190826034720,0460,0001,253D,AEC3,,0.0,,,100,110000,,7,2880219F0A0000D0,1,01AD,28BAFC7D08000041,1,01AF,2866EE9E0A000089,1,01B2,28D64BC50800006C,1,01AE,2809769D0A00006F,1,01AC,28E3597E08000090,1,01AD,28CBCA7D080000F6,1,01AF,20190826114719,15BF$
```
Count = 7 ⇒ **21 extra CSV fields**. Values `01AD 01AF 01B2 01AE 01AC 01AD 01AF` = 26.8125 / 26.9375 / 27.125 / 26.875 / 26.75 / 26.8125 / 26.9375 °C. Note also that the GNSS-trigger slot is **empty**, not `00` — another per-firmware variation.

**The iButton case, which must NOT be temperature-converted.** Source: R1 GV300CAN V12.00 §3.3.1, verbatim:
```
+RESP:GTERI,4B0306,867995030009362,,00000002,,10,1,1,0.0,0,40.4,117.129326,31.839245,20190522064541,0460,0000,550B,B969,00,0.0,,,65,210100,,2,3C00000340FD1128,2,019E,FD0000034129ED28,2,01AC,20190522064542,0541$
```
Both triplets have **device type 2 = iButton**. Running ×0.0625 on `019E`/`01AC` fabricates 25.875 °C and 26.75 °C for a presence code.

### W4 — ASCII GTIGF — the inverted tail

**Source:** R1 GV300CAN V12.00 p.275, verbatim vendor example.

```
+RESP:GTIGF,4B0305,867995030082104,gv300can,170791,0,0.0,352,81.2,117.129386,31.839294,20190422030853,0460,0000,550B,B969,00,,0.0,20190422030854,8536$
```

`[4] = 170791` = **Duration of Ignition On, seconds** (≈47.4 h), prepended before the fix. `[5] = 0` = **GNSS Accuracy 0 ⇒ FIX FAILED, the coordinates are the last known position.** Then speed 0.0, azimuth 352, alt 81.2, lon/lat, UTC, cell block, trigger `00`, `[16]` **Hour Meter (empty)**, `[17]` **Mileage 0.0** — hour meter *then* mileage, the reverse of GTFRI. Send time, count `8536`.

**The invalid-fix oracle pair**, R2 corpus, three seconds apart from one device:
```
+RESP:GTIGF,270302,867162025085234,,3519,0,0.0,92,111.2,-116.867638,32.450321,20180327070835,0334,0020,2B24,52CC3DE,00,,243.1,20180327070837,2A98$
+RESP:GTIGL,270302,867162025085234,,,01,1,1,0.0,92,111.2,-116.867638,32.450321,20180327070838,0334,0020,2B24,52CC3DE,00,243.1,20180327070839,2A9A$
```
Identical coordinates. The first has accuracy **0** (fix failed, last-known position); the second has accuracy **1** (real fix). A correct decoder marks the first `fix_valid = false`; Traccar marks both `true`.

### W5 — ASCII GTCAN, full mask — the fleet oracle

**Source:** R1 GV350M Series V3.11 §3.3, verbatim vendor example, with the field table printed beside it. **VERIFIED.**

```
+RESP:GTCAN,F10310,868446036599153,gv350m,0,1,FFFFFFFF,LFV82A1BS36355376,2,H20460,1040.50,528,25,98,L/H51.2,,,66,154.30,150.80,281.90,2517.00,6684,,,1,,,,0,,,1,0.0,0,118.9,114.015458,22.537211,20190823021704,0460,0001,253D,AEC3,,20190823101706,0FB1$
```

`[4] = 0` report type · `[5] = 1` CANBUS device state · `[6] = FFFFFFFF` **all fields present** · VIN `LFV82A1BS36355376` · Ignition Key `2` (= **engine on**, a third state) · Total Distance `H20460` → **`H` = hectometres ⇒ 2046.0 km** · Total Fuel Used 1040.50 L · **Engine RPM 528** · **Vehicle Speed 25 km/h** (note the order — bit 5 before bit 4) · Coolant 98 °C · Fuel Consumption `L/H51.2` → **51.2 L/h** · Fuel Level empty · Range empty · Pedal 66 % · Engine Hours 154.30 h · Driving Time 150.80 h · Idle Time 281.90 h · Idle Fuel 2517.00 L · Axle Weight 6684 kg · Tacho empty · Indicators empty · Lights `1` · Doors empty · overspeed times empty · Expansion Mask `0` · AdBlue empty · then Number `1`, speed 0.0, azimuth 0, alt 118.9, lon 114.015458, lat 22.537211, MCC 460 MNC 1.

**The plausible-wrong-number demonstration.** R1 GV300CAN's own GTCAN example with mask `C03FFFFF`:
```
+RESP:GTCAN,4B0305,867995030082104,gv300can,00,1,C03FFFFF,,2,I6782,50.56,1705,40,55,,L87.40,3960,32,860.64,755.43,105.21,7436.00,4365,BF,FFFF,3F,3F,6.38,21.61,0,0.0,0,1.4,117.1299493,31.839403,20190418055225,0460,0000,550B,B969,00,20190418055227,0DC0$
```
`1705` is **RPM** and `40` is **km/h**. Iterating the mask bits naively in ascending order yields **speed 1705 km/h and RPM 40** — both plausible-looking, neither an error. Also note `I6782` — the `I` prefix means **impulses**, not a distance at all.

### W6 — HEX `+RSP` GTFRI, 93 bytes, vendor reference

**Source:** R1 GV300CAN V12.00 p.354, verbatim vendor example. **VERIFIED — consumes exactly 93/93 bytes and the CRC recomputes.**

```
2B525350 07 00FE0FBF 005D 4B 0305 0318 564F5F0300520A04
00 01 00 21 18 10 01 01 000000 00AF 0043 06FB3FDE 01E5D3C8
07E3 04 18 02 09 39 0460 0000 550B B969 00
000000 0000000000 000000 000000000000 07E3 04 18 02 09 3A BBCD 1D7C 0D0A
```

| Bytes | Field | Value |
|---|---|---|
| `2B525350` | header | `+RSP` |
| `07` | Message Type | 7 = GTFRI |
| `00FE0FBF` | Report Mask | bits 12, 14, 26 **clear** ⇒ no External Power, no Analog Input, no EIO100 |
| `005D` | Length | 93 = actual byte count ✔ |
| `4B` | Device Type | GV300CAN |
| `0305` / `0318` | Protocol / Firmware Version | 3.05 / 3.24 |
| `564F5F0300520A04` | Unique ID | 56→86, 4F→79, 5F→95, 03→03, 00→00, 52→82, 0A→10, 04→4 ⇒ **867995030082104** (Luhn ✔) |
| `00` | Battery Level | 0 % |
| `01` / `00` | Digital In / Digital Out | |
| `21` | Motion Status | Ignition On, Rest |
| `18` | Antenna \| Satellites | ext-antenna state 1, **8 satellites** |
| `10` | Report ID / Type | 1 / 0 |
| `01` | Number | 1 position |
| `01` | GNSS Accuracy | HDOP 1 ⇒ **valid** |
| `000000` | Speed | 0 km/h + 0 fraction |
| `00AF` | Azimuth | 175° |
| `0043` | Altitude | **int16 = 67 m** (or 6.7 m — Q8) |
| `06FB3FDE` | Longitude | 117129182 ÷ 1e6 = **117.129182** |
| `01E5D3C8` | Latitude | 31839176 ÷ 1e6 = **31.839176** |
| `07E3 04 18 02 09 39` | GNSS UTC | 2019-04-24T02:09:57Z |
| `0460 0000 550B B969 00` | cell | **MCC BCD 0460 → 460**, MNC 0, LAC 0x550B, CID 0xB969, trigger 00 |
| `000000` `0000000000` `000000` `000000000000` | mileages, hour meters | all zero |
| `07E3 04 18 02 09 3A` | Send Time | 02:09:58 local |
| `BBCD` | Count | |
| `1D7C` | CRC-16/CCITT-FALSE over `[4:-4]` | **computed 1D7C ✔** |
| `0D0A` | tail | |

### W7 — HEX `+RSP`, real capture — the BCD proof

**Source:** R2 `Gl200BinaryProtocolDecoderTest`, Apache-2.0. Traccar asserts only sanity bounds; this decode is mine and **closes at 93/93 with a valid CRC**.

```
2b5253500700fc1fbf005d4501020209563254030003430564377e42071001000000000000007eff75a151025c6a8107e10801081a2a02680003189c1ac500000000000002100700000000000000000007e1080108241019e17ebe0d0a
```

Mask `00FC1FBF`, Length 0x005D = 93 ✔, devType `0x45`, proto 1.02, fw 2.09, **Unique ID `5632540300034305` → 865084030003675** (Luhn ✔), battery 100 %, external power `0x377E` = **14206 mV**, motion `0x42` = sensor motion, satellites 7, ReportID/Type `0x10`, Number 1, **GNSS Accuracy `00` ⇒ FIX FAILED**, speed 0.0, azimuth 0, altitude `0x007E` = 126, longitude `0xFF75A151` = **−9.068207**, latitude `0x025C6A81` = **39.611009**, UTC 2017-08-01T08:26:42Z, MCC bytes `02 68`, MNC `0003`, LAC `0x189C`, CID `0x1AC5`, total mileage `0x0000021007` = 135175, send time 08:36:16, count `0x19E1`, CRC `0x7EBE`, tail.

> **MCC `02 68` read as BCD = 268 = Portugal. The coordinates are Torres Vedras, PT. Read as `u16` it is 616, which is not an allocated MCC.** This single frame proves MCC/MNC are BCD and LAC/CID are not — a fact no vendor table states.

Note the mask difference: `00FC1FBF` (this frame) versus `00FE5FBF` (the GV300CAN **factory default**). The default adds Analog Input (bit 14) and Digital In/Out (bit 17) — **three extra bytes before the motion byte**. A decoder that hardcodes Traccar's mask shifts every coordinate on a factory-configured device.

### W8 — HEX `+EVT` GTIGN, 100 bytes — the 4-byte insert

**Source:** R1 GV300CAN V12.00 §4.5, verbatim vendor example. **VERIFIED: it only closes at 100/100 with a four-byte ignition-duration insert.**

```
2B4556540D00FE5FBF00644B03050318564F5F0300520A0455000000000100221900001CC7010000000000F8006906FB404901E5D43B07E3041805103A04600000550BB96900000000000000000000000000000000000007E30418051102BE1D62A20D0A
```

`+EVT` · type `0D` = **13 = GTIGN** · mask `00FE5FBF` (factory default) · **Length 0x0064 = 100 = 96 + 4** · devType `4B` · IMEI 867995030082104 · battery `55` = 85 % · … motion `22` = Ignition On Motion · satellites `19`→9 · **insert `00001CC7` = 7367 s = Duration of Ignition Off** · Number 1 · accuracy 0 · … lon `06FB4049`, lat `01E5D43B` · UTC 2019-04-24T05:16:58Z · … CRC `1D62`… tail `0D0A`.

**Traccar has no case for type 13 or 14, so it decodes this frame four bytes out of alignment and produces a wrong-but-plausible coordinate.**

Five sibling vendor frames from the same section, all of which I verified close exactly at their own Length byte:

| Frame prefix | Type | Length | Insert |
|---|---|---|---|
| `2B4556540900FE5FBF0060…` | 9 = GTSTT | 96 | none |
| `2B4556540F00FE5FBF0063…` | 15 = GTUPD | 99 = 96+3 | `00C8 01` = code 200, retry 1 |
| `2B4556541500FE5FBF0065…` | 21 = GTGSS | 101 = 96+5 | status + 4 reserved |
| `2B4556541F00FE5FBF0062…` | 31 = GTGPJ | 98 = 96+2 | `0D 01` = CW value 13, jamming state 1 |
| `2B4556541900FE5FBF0062…` | 25 = GTDOS | 98 = 96+2 | 2 bytes — **Traccar has no case for this either** |

### W9 — HEX `+ACK`, 36 bytes

**Source 1:** R1 GV300CAN V12.00 §4.2, verbatim.
```
2B41434B02EF244B03050318564F5F0300520A0400002807E30418020918BBCA4CD10D0A
```
`+ACK` · type `02` = AT+GTQSS · mask `EF` · **Length `0x24` = 36 ✔** · devType `4B` · proto 3.05 · fw 3.24 · UID `564F5F0300520A04` → **867995030082104** · ID `00` · serial `0028` · send time `07E3 04 18 02 09 18` = 2019-04-24T02:09:24 · count `BBCA` · **CRC `4CD1` recomputed ✔** · tail.

**Source 2:** R2, Apache-2.0.
```
2b41434b017f244501010108676231303000000000ffff07e1070b03112d054dfe030d0a
```
Same length 36. type `01` = AT+GTSRI · mask **`7F`** · devType `45` · **identity bytes = ASCII `gb100\0\0\0`** · ID `00` · serial `FFFF` · send time 2017-07-11T03:17:45 · count `054D` · CRC `FE03`.

> **Both frames have `+ACK` mask bit 6 SET (`0xEF` and `0x7F`) yet one carries a packed IMEI and the other an ASCII name. The `+RSP` bit-6 rule does not hold for `+ACK`. Trap T37.**

### W10 — HEX `+HBD`, 32 bytes

**Source:** R1 GV300CAN V12.00 §4.9, verbatim.
```
2B484244EF204B03060319564F5F0300520A0407E3041A082D010455D37B0D0A
```
`+HBD` · mask `EF` · **Length `0x20` = 32 ✔** · devType `4B` · proto 3.06 · fw 3.25 · UID → 867995030082104 · send time `07E3 04 1A 08 2D 01` = 2019-04-26T08:45:01 · count `0455` · **CRC `D37B` ✔** · tail.

### W11 — Protocol Pro, real GV500CNA capture, 56 bytes

**Source:** R5 traccar.org forum thread *"gv500cna gl200 binary data id 82 frames received but not decoded to position"* (also in R2's corpus after commit `35555d03`). **VERIFIED — length, CRC-8 and Luhn all check.**

```
2b 00 0038 00  0865134050947226  8203 0003 00 00
21 6a3ed6f1 0189 50 00
   52 16  29 fa8b28f4 02ac1a8e 6a3ed6f1 0000 16 0000 0010f5 05
010f f8 24
```

| Bytes | Field | Value |
|---|---|---|
| `2B` | header | real-time (`2D` would be buffered) |
| `00` | identifier | format C confirmed |
| `0038` | Frame Length | 56 = actual ✔ |
| `00` | multi-packet flag | bit7 clear ⇒ no Frame Count/Number |
| `0865134050947226` | IMEI | BCD hex-dump, **drop the leading nibble** ⇒ **865134050947226** (Luhn ✔) |
| `8203` | Device Type | GV500CNA |
| `0003` | Protocol Version | v3 |
| `00` | Custom Version | |
| `00` | Reserved Length | 0 bytes follow |
| `21` | Record Length | 33 (varint, high bit clear) |
| `6a3ed6f1` | Generated Time | u32 epoch = 2026-06-26T19:45:53Z |
| `0189` | Record Count Number | |
| `50` | Record ID | `50H` = Fixed Report |
| `00` | Event Code | |
| `52` | Data ID | 0x52 = 82 = Full Location (varint, 1 byte) |
| `16` | Data Length | 22 |
| `29` | fix byte | signal level 2, **fix state `0b10` = FIX**, mode `0b01` = 3D |
| `fa8b28f4` | Longitude | int32 = −91543308 ⇒ **−91.543308** |
| `02ac1a8e` | Latitude | 44833422 ⇒ **44.833422** (Eau Claire, WI) |
| `6a3ed6f1` | UTC | same as Generated Time |
| `0000` | Speed | u16 ×0.1 = 0.0 km/h |
| `16` | HDOP | u8 ×0.1 = **2.2** |
| `0000` | Azimuth | 0° |
| `0010f5` | Altitude | **int24 two's complement** = 4341 ×0.1 = **434.1 m** |
| `05` | Satellites | 5 |
| `010f` | Count Number | |
| `f8` | CRC-8 | poly 0x31 init 0xFF over `[0:-2]` ⇒ **computed F8 ✔** |
| `24` | tail | `$` |

Two more frames from the same capture (the third exists only in the forum post):
```
2b000038000865134050947226820300030000216a908d67247f5000521619fa8b85e702ab64326a908d670000050082000aa51da13d0424
   -> lon -91.519513, lat 44.786738, 2026-08-27T19:17:59Z, 0.0 km/h, HDOP 0.5, az 130, alt 272.5 m, 29 sats
2b000038000865134050947226820300030000216a3ed6d301885000521629fa8b28f402ac1a8e6a3ed6d300001600000010f505010ecb24
   -> near-duplicate of W11, three minutes earlier
```

### W12 — Protocol Pro CRC-8 vector and heartbeat

**Source:** R1 GL601 @Track Protocol Pro V10 `frames/report.html` and `frames/heartbeat.html`, verbatim. **VERIFIED, both recomputed.**

```
CRC-8 test vector:
  2B 01 23 45 67 89 01 23 45 FE 01 06 01 02 01 FF 5D B3 8C 80  ->  FE

78-byte report parse example (CRC-8 = 4F):
  2B 00 00 4E 00 01 23 45 67 89 01 23 45 00 00 00 1B 00 00 37 64 F9 AA F6 00 00 03 00
  02 0B 4D 79 49 6F 54 64 65 76 69 63 65 51 0F 09 07 3C 46 FF 01 DB 88 57 5F 17 9D A0
  01 7D 55 0E 06 04 BC 8A 00 10 00 02 10 00 10 0C 13 03 01 23 4F 24

24-byte heartbeat (CRC-8 = 14):
  2B 10 18 01 23 45 67 89 01 23 45 80 01 00 07 00 5E 36 2F 5A 10 F2 14 24
```
Heartbeat breakdown: `2B` header · **`10` — not `00`** · `18` = 24 bytes (1-byte length) · IMEI `0123456789012345` → 123456789012345 · devType `8001` · proto `0007` · custom `00` · time `5E362F5A` = 2020-02-02T14:31:22Z · count `10F2` · CRC `14` · `24`.

The Data-82 field example from `dataids/Location/82.html`, with the vendor's own values, **VERIFIED**: `F920A8E1H` → **−115.300127**; `5DD52EFAH` → 2019-11-20T20:18:02Z; `017DH` → **38.1 km/h**; `0AH` → **HDOP 1.0** (`FFH` = ≥25.5); `0001B3H` → **43.5 m**; 12 satellites; fix state `0b10`, 3D.

### W13 — ASCII GTHBM — the nibble split, two ways

**Source:** R2 corpus, Apache-2.0. **SOURCE-ASSERTED:** Traccar asserts `ALARM_CORNERING` for the first and `ALARM_BRAKING` for the second.

```
+RESP:GTHBM,BD0214,869409069481243,cv100,,12,1,1,5.6,344,274.7,-1.601826,6.666228,20250114094616,0620,0001,3EE8,00016E04,,,20250114094616,20250114094616,2862$
+RESP:GTHBM,4B0101,135790246811220,,,10,1,1,4.3,92,70.0,121.354335,31.222073,20090214013254,0460,0000,18d8,6141,00,2000.0,20090214093254,11F0$
```

`12` → ID 1 (low speed band) + Type 2 (**cornering**). `10` → ID 1 + Type 0 (**braking**). Two independent sources agree, and the R1 nibble rule explains both. **Note the second frame has lowercase hex `18d8` in the LAC — parse cell fields case-insensitively.**

### W14 — GT300 dialect — NUL terminator, IMEI first, count second-to-last

**Source:** R1 GT300 @Track Air Interface Protocol V4.02 §4.3, verbatim vendor example.

```
+RESP:GTTRI,135790246811220,1,0,0,1,4.3,92,70.0,1,121.354335,31.222073,20090101000000,0460,0000,18d8,6141,00,11F0,0102070202\0
```

**No `$`.** Field 1 is the **IMEI**, not a protocol version. `<count num>` = `11F0` is **second-to-last**; `<ver>` = `0102070202` is **last**. An implementation that acks `values[last]` sends the *version string* as the count on this dialect — the device rejects it and resends forever.

**Contrast a real 2017 GT-series capture from R2's corpus**, same message type, incompatible field order:
```
+RESP:GTTRI,862370030005908,1,0,99,1,0.0,354,18.5,18.821100,-34.084002,20170607152024,0655,0001,00DD,1CAE,00,0103010100,20170607172115,3E7D$
```
Here the version `0103010100` is **third-from-last**, then send time, then count `3E7D`, terminated with `$`. **Same message type, two incompatible field orders, both from rank-1-adjacent sources. Trust the capture for modern firmware and branch on the terminator.**

---

## 5. Parameter / IO dictionary

### 5.0 The structural fact

**There is no numeric IO-ID dictionary in ASCII @Track.** Unlike Teltonika (AVL ID → value), format A fields are **positional CSV** and presence is controlled by **bitmasks the server itself configured**. The only true ID-keyed dictionary in the whole protocol family is **Protocol Pro's TLV** (§5.4).

**Where each dictionary lives:**

| Dictionary | Set by | Echoed in the report? | Width | Governs |
|---|---|---|---|---|
| `<ERI Mask>` | `AT+GTFRI` | **yes** — GTERI field 4 | 8 hex, fixed | which peripheral blocks trail the position block |
| `<CAN Report Mask>` | `AT+GTCAN` | **yes** — GTCAN, and again **inside** the GTERI CAN block | ≤8 hex, **not zero-padded** | 22-32 vehicle fields |
| `<CAN Report Expansion Mask>` | `AT+GTCAN` | yes, **only if** CAN mask bit 29 = 1 | ≤8 hex | 23 more vehicle fields |
| `<Electric Report Mask>` | `AT+GTCAN` | yes, **only if** CAN mask bit 28 = 1 | ≤4 hex | 6 EV fields |
| `<OBD Report Mask>` | `AT+GTOBD` | **yes** — GTOBD field 6 | ≤8 hex | 16+ OBD-II fields |
| `<Accessory Append Mask>` | `AT+GTBAS` | yes, per accessory inside the GTERI BLE block | ≤4 hex | BLE sensor sub-fields |
| `<Position Append Mask>` | `AT+GTCFG` | **yes** — the 2 chars after Cell ID | 2 hex | satellites / trigger-type fields |
| `<+RSP/+EVT/+INF/+CAN/+ACK/+HBD/+CRD/+DAT Mask>` | `AT+GTHRM` | **yes** — in the HEX header | 8 hex | HEX report composition |
| **`<Report Composition Mask>`** | `AT+GTCFG` | **NO — appears only in `+ACK:GTCFG`** | ≤2 hex | **whether Speed/Azimuth/Altitude/cell block/Mileage/Send Time/Device Name are in the report at all** |

> **The claim "a report is self-describing if you read the mask" is FALSE for the one mask that changes the position block's field count.** The Report Composition Mask is not on the wire. Correct this in any derived document.

Masks are **variable-length, case-insensitive hex**. Real captures show `C03FFFFF` (8 chars), `FFFFF` (5), `E00FFFFF`, and the vendor's own GTOBD example uses lowercase `1fff`. **Never slice by width — `parseInt(s, 16)`.**

### 5.1 Position-report scalar fields (fixed positional, no mask)

**VERIFIED** R1 GV300CAN §3.3 pp.184-186.

| Field | Max width | Range | Unit | Scaling | Confidence |
|---|---|---|---|---|---|
| External Power Supply | 5 | 0 - 32000 | **mV** | ÷1000 → V | VERIFIED (R5 traccar#3758 fixed exactly this) |
| GNSS Accuracy | 2 | `0` \| 1-50 | HDOP | `0` = **no fix** | VERIFIED |
| Speed | 5 | 0.0 - 999.9 | **km/h** | 1 dp as text | VERIFIED |
| Azimuth | 3 | 0 - 359 | degrees | integer | VERIFIED |
| Altitude | 8 | ±99999.9 | **m** | 1 dp as text, signed | VERIFIED |
| Longitude | 11 | ±180 | degrees | 6 dp as text | VERIFIED |
| Latitude | 10 | ±90 | degrees | 6 dp as text | VERIFIED |
| GNSS Trigger Type | 1 | 0-4 | enum | 0 time, 1 corner, 2 distance, 3 mileage, 4 optimum | VERIFIED |
| Mileage | 9 | 0.0 - 4294967.0 | **km** | ×1000 → m | VERIFIED |
| Hour Meter Count | 11 | `00000:00:00` - `99999:00:00` | **h:m:s TEXT** | parse, do not `parseFloat` | VERIFIED |
| Analog Input | 5 | 0 - 30000 | **mV** | ÷1000 → V | VERIFIED |
| Backup Battery Percentage | 3 | 0 - 100 | % | — | VERIFIED |
| Device Status | **6 or 10** | hex | enum + bits | §3.0c — **branch on string length** | VERIFIED |
| Duration of Ignition On/Off | 6 | 0 - 999999 | **seconds** | **resets to 0 on reboot** | VERIFIED |
| Satellites in use | 2 | 0 - 99 | count | present only per append mask | VERIFIED |
| Count Number | 4 | `0000`-`FFFF` | hex | per-device wrapping sequence | VERIFIED |
| Serial Number | 4 | `0000`-`FFFF` | hex | command correlator, **not** the count | VERIFIED |

**Cross-check assertions to encode as tests:** `11888` → 11.888 V; `01476:55:53` → 1476 h 55 m 53 s; `12295`/`13985` → 12.295 V / 13.985 V (R2-asserted).

### 5.2 `<ERI Mask>` and the peripheral blocks

Bit table in §P3. Block encodings:

| Block | Encoding | Units / scaling | Confidence |
|---|---|---|---|
| 1-Wire temperature | 4 hex chars | **int16 two's complement × 0.0625 °C** | **VERIFIED** — R1 GV300CAN p.186 (*"convert the data to a decimal value … then multiply the decimal value by 0.0625"*), R2 asserts 25.0 for `0190`, R4 asserts −1.875 for `FFE2` |
| 1-Wire iButton | 4 hex chars | **presence code — NOT a temperature** | VERIFIED (device type 2) |
| 1-Wire, GL320M-class | plain decimal `32.4` | **°C directly** | **VERIFIED** R5 traccar#5727, #5391, forum "Problem with GL200 Protocol after version 5.12" (`29.7`) |
| Digital Fuel Sensor Data | hex chars, no prefix | **integer, base 16** — `0099` = **153**, `01DF` = **479** | **VERIFIED** R2 asserts both values |
| Fuel Sensor `<Percentage>` | decimal | % | VERIFIED |
| Fuel Sensor `<Volume>` | decimal | litres | VERIFIED |
| BLE `<Battery Level>` | integer | **mV** in observed captures (`3466`) | **INFERRED** — the append-mask table says only "Battery Level" |
| BLE `<Temperature>` | integer | **°C, plain** — `24` means 24 °C | **VERIFIED** by contradiction: ×0.0625 on the neighbouring `0x3466` gives 838 °C |
| BLE `<Humidity>` | integer | **%rh, plain** | VERIFIED same way |

`<Accessory Append Mask>` bits: 0 Name, 1 MAC, 2 Status, 3 Battery Level, 4 Temperature, 5 Humidity. **VERIFIED** R1 p.44. Bits 7-14 (input/output, event notification, tyre pressure, timestamp, enhanced temperature, magnet, battery, relay) are **INFERRED from R2 only**.

Accessory type observed: `6` = Beacon Multi-Functional Sensor. Accessory model `5`. **The full enum is UNKNOWN.**

### 5.3 HEX `AT+GTHRM` report-composition mask bits

**VERIFIED** R1 GV300CAN V12.00 pp.342-345, implemented and confirmed on six frames that each consume exactly their declared length.

| Bit | Field gated | Bit | Field gated |
|---|---|---|---|
| 0 | Speed | 14 | Analog Input |
| 1 | Azimuth | 17 | Digital In / Digital Out |
| 2 | Altitude | 18 | Motion Status |
| 3 | MCC/MNC/LAC/CellID + trigger | 19 | Antenna \| Satellites |
| 4 | Send Time | 20 | Current Mileage |
| 5 | Count Number | 21 | Total Mileage |
| 6 | **device name instead of IMEI** | 22 | Current Hour Meter |
| 7 | **Length** | 23 | Total Hour Meter |
| 8 | Device Type | 24 | RFID |
| 9 | Protocol Version | 25 | CAN Data |
| 10 | Firmware Version | 26 | EIO100 In / Out |
| 11 | Battery Level | | |
| 12 | External Power | | |

**Known real mask values:** `00FC1FBF` (R2 captures), `00FE5FBF` (**GV300CAN factory default**), `00FE0FBF` (vendor example), `00FC1FFF` (GTLBC frame), `00FC5FFF`. GV350M V3.11's factory default is `AT+GTHRM=gv350m,,,7F,FEFFFF,FEFFFF,2F7F,FF,,7F,,,0018$` — **a different default mask per model, hence a different HEX layout per model out of the box.**

**No sample anywhere has bit 24 (RFID), bit 25 (CAN Data) or bit 26 (EIO100) set** — the tail of the HEX position block is completely untested. Q16.

### 5.4 Protocol Pro Data IDs — the one real ID dictionary

`Data ID (1 or 2 bytes, varint) | Data Length (1 or 2 bytes, varint) | Content`. Published per model as browsable HTML with a worked example per field. **VERIFIED** R1 GL601 V10 and GV500CNA V3.

| ID | Category | Field | Len | Encoding / unit | Confidence |
|---|---|---|---|---|---|
| **81** | Location | Mini Location | 15 | `fixByte, lon i32/1e6, lat i32/1e6, utc u32 epoch, speed u16 ×0.1 km/h` | VERIFIED |
| **82** | Location | **Full Location** | 22 | `fixByte(1), lon i32/1e6, lat i32/1e6, utc u32 epoch, speed u16 ×0.1 km/h, hdop u8 ×0.1, azimuth u16 deg, altitude int24 two's-complement ×0.1 m, sats u8` | VERIFIED, worked example per field |
| 85 | Location | Registered cell | var | — | VERIFIED (exists) |
| 89 | Location | GSV (satellites in view) | var | — | VERIFIED (exists) |
| 92 / 93 | Location | Geofence | var | — | VERIFIED (exists) |
| 100 | Location | Wi-Fi | var | **≥0x80 ⇒ 2-byte ID on the wire** | VERIFIED |
| 1, 2, 4, 10, 19, 22, 88, 90, 97, 120, 121 | Device Itself | device state | var | — | VERIFIED (exist) |
| 23, 40, 91 | Behaviors | — | var | — | VERIFIED (exist) |
| 95 | Behaviors | Overspeed | var | — | VERIFIED |
| 96 | Behaviors | Tow mileage | var | — | VERIFIED |
| 98 | Behaviors | Idling | var | — | VERIFIED |
| **140** | Behaviors | Harsh behaviour | var | **≥0x80 ⇒ 2-byte ID `80 8C`** | VERIFIED |
| **142-144** | Behaviors | Crash | var | **≥0x80 ⇒ 2-byte ID** | VERIFIED |
| 87 | Peripherals | External power voltage | var | — | VERIFIED |
| 122 | Peripherals | Temperature / humidity | var | — | VERIFIED |
| **178-181** | Bluetooth | — | var | **≥0x80 ⇒ 2-byte ID** | VERIFIED |
| **12** | Vehicle | Speed | var | — | VERIFIED |
| **27** | Vehicle | Ignition | 1 | `00` off, `01` on, **`02` unknown** | VERIFIED |
| **31** | Vehicle | Total Mileage | 4 | **u32 METRES** (`000900B0H` = 590000 m) | VERIFIED |
| **32** | Vehicle | Current Mileage | 4 | u32 metres (INFERRED by symmetry) | INFERRED |
| **34** | Vehicle | Total Hour Meter | 4 | **u32 SECONDS** | VERIFIED |
| **35** | Vehicle | Current Hour Meter | 4 | u32 seconds (INFERRED by symmetry) | INFERRED |

**`fixByte` layout, VERIFIED:** bits 7-4 = signal level (0 unknown … 4 weak); **bits 3-2 = fix state (`00` GNSS off, `01` no fix, `10` FIX)**; bits 1-0 = fix mode (`00` 2D, `01` 3D, `11` unknown). On fix states `00` and `01`, R1 says verbatim: *"the 'longitude', 'latitude', 'speed', 'UTC time' etc. are the same as the last valid positioning."*

**Unit change versus ASCII, and it will bite you:** mileage in **metres** (Pro) vs **km** (ASCII); hour meter in **seconds** (Pro) vs `HHHHH:MM:SS` text (ASCII).

**There are NO CAN/OBD data IDs in the GL601 V10 or GV500CNA V3 catalogues.** Vehicle data in Protocol Pro is limited to the six Vehicle IDs above. **VERIFIED by absence.**

### 5.5 Parameters whose scaling is ambiguous — ship a cross-check, not a number

**Every row here is a place where a plausible wrong number reaches a customer.**

| Parameter | The ambiguity | Recommendation |
|---|---|---|
| **`<Ad-Blue Level>`** | GV300CAN V12.00 p.321 says `0-100%`; GV350M V3.11 says `0-100L` in one report table and `0-100%` in another; the HEX table says only "2 bytes"; Traccar strips one leading character (`substring(1)`), implying an `L`/`P` prefix **no table documents** — and a real capture does carry `P100.00`. | **Do not emit a number until one live capture is cross-checked against the vehicle's own gauge.** AdBlue is compliance-relevant: an empty tank derates the engine. |
| **HEX `<Engine Coolant Temperature>`** | 2 bytes, stated range −40…+215 °C. The vendor's own HEX example yields `0x005A` = 90 where the parallel ASCII example shows 55. Plain signed °C vs J1939 SPN 110 raw (value = °C + 40) is undecidable from the document. | Emit only from ASCII until a simultaneous ASCII+HEX capture settles it. |
| **HEX `<Fuel Consumption>`** | 3 bytes, "0-9999 L/100km \| L/H". The sample is `FE 00 00` where the ASCII example is empty — suggesting byte 0 is a unit/validity selector with `FE` = unavailable. **Not stated anywhere.** | Do not emit. |
| **HEX Speed / Mileage fraction byte** | Documented as "integer + fraction". The vendor states the fraction has **2 digits** for 5-byte CAN totals (`0x38` = 56 hundredths) but nothing states it for speed or mileage, and every published sample has fraction `0x00`. Tenths vs hundredths differ by 10×. | **Truncate to the integer km/h and km** — wrong by <1 unit under either reading. |
| **HEX `<Altitude>`** | "Unit: meter", two's complement, 2 bytes. `0x0043` = 67 m is plausible for the Hefei test site, but the ASCII form definitely carries one decimal. No vendor example ever prints an altitude value. | Emit metres; flag the model for re-check. A 10× error is visible on any hill. |
| **`<Total Distance>` `I` prefix** | `I` = **impulses**, not a distance. `H` = hectometres. | An `I`-prefixed value must **never** become an odometer. Emit it as a separate impulse counter or not at all. |
| **`<Fuel Level>` `L`/`P` prefix** | `L84.00` is 84 litres; `P84.00` is 84 percent. | The classic Queclink fleet bug. Store the unit with the value or store nothing. |
| **`<Fuel Consumption>` prefix length** | GV300CAN sends `M23` (one letter). **GV350M sends `L/H1.5` (three characters)** — and the documented field width is `≤5`, which cannot even hold `L/H` plus a value. Traccar tests `startsWith("L/H")` and therefore records **nothing** on GV300CAN/GV355CEU. | Match a **leading non-numeric run of any length**; map `{M, H, L/H, L/100km, L, P, I}` to units; emit nothing for an unrecognised or absent prefix. **Never strip a fixed character count.** |
| **`<Total Power Recovered>`** | `0 - 99999999 (×1.820 Wh)` — the factor appears **only in the range column**. | Emit raw counts alongside the derived Wh. |
| **`<Detailed Information/Indicators>`** | **16 bits on CAN chipset ≤2.1.xx, 32 bits from 2.2.0** — determined by **chipset firmware**, not device model or protocol version. Bit 14 in the 16-bit era means "doors"; in the 32-bit era bits 16-31 add CHG / FS / PTO. | Emit the raw hex; decode bits only for a known chipset version. |
| **`<Ignition Key>`** | `0` off, `1` on, **`2` engine on** — a tri-state where most consumers expect a boolean. | Map 2 to "on + engine running", never collapse to `true`/`false` blindly. |
| **GTOBD `<Fuel Consumption>`** | Legitimately carries the literal strings `Inf` and `NaN`/`nan`. R1 GV500 V1.06 p.122: *"Because the consumption is caculated depend to values which read from vehicle. There will have Inf and NaN value"*. | Map to null. Never let a non-finite number reach the positions layer. |
| **`<Diagnostic Trouble Codes>`** | Encoding is **not specified**. My decode of a real 10-code sample as SAE J2012 2-byte packing gives a coherent misfire set — see §6.6. | Emit the raw hex plus the J2012 interpretation, labelled INFERRED. |

---

## 6. Vehicle data — CAN / FMS / J1939 / OBD-II

### 6.1 What is actually available, and what is not

**VERIFIED, and this is the headline: there is no SPN-level exposure in this protocol.**

Queclink's CAN units read the vehicle bus through a **CAN chipset** that decodes it into a **fixed, vendor-defined field list**. You receive *fields*, not PGNs and not SPNs. `AT+GTCAN <Mode>`: `0` disable, **`1` J1939**, `2` CAN100. `AT+GTPGN` can configure raw PGNs — but R1 GV350M V3.11 p.103 says those *"can be output from the serial port which is configured by AT+GTURT command"*, i.e. **raw PGNs never go over the air.**

Three delivery paths:

| Path | Packet | When |
|---|---|---|
| Standalone CAN report | `+RESP:GTCAN` (**P7**) | periodic / RTO / ignition event, per `AT+GTCAN` |
| Embedded in a position report | `+RESP:GTERI` **ERI mask bit 2** (**P3**) | with every fixed report; **ASCII only**, ≤1000 bytes |
| HEX | `+CAN` (**P38**) | HEX mode only, and the field encodings **differ** from ASCII — §6.5 |
| OBD-II (GV500 family only) | `+RESP:GTOBD` (**P8**), plus RPM/consumption/fuel-level appended to `+RESP:GTFRI` | §6.6 |
| Protocol Pro | Data IDs 12, 27, 31, 32, 34, 35 only | §5.4 — **no CAN dictionary at all** |

**Inside GTERI the CAN block is:** `<CANBUS Device State:1> , <CAN Report Mask:≤8 hex> , {masked fields in ascending bit order}` with **mask bits 30 (GNSS) and 31 (GSM) forced off** (**VERIFIED** R1 GV300CAN p.132). Verified by exact field-count decode of a real capture: `+RESP:GTERI,310701,863286023712855,,00000004,…,110000,2,0,C03FFFFF,<22 fields>,20181111185252,2DFF` — indices 28..49 are exactly the 22 fields of bits 0-21.

### 6.2 `<CAN Report Mask>` — the vehicle dictionary

**VERIFIED** R1 GV300CAN V12.00 pp.131-132 (mask), pp.319-326 (field table). Fields are emitted in ascending bit order **except bits 4 and 5, which are inverted**.

| Bit | Field | ASCII width | Unit / encoding | Confidence |
|---|---|---|---|---|
| 0 | VIN | 17 | `0-9 A-Z` minus I, O, Q | VERIFIED |
| 1 | Ignition Key | 1 | 0 off, 1 on, **2 engine on** | VERIFIED |
| 2 | Total Distance | ≤12 | **`H`+hectometres** (×100 → m) **or `I`+impulses** | VERIFIED |
| 3 | Total Fuel Used / **EV Total Power Used** | ≤9 | **L**, or **Wh** if the Electric mask is active | VERIFIED |
| **5** | **Engine RPM** | ≤5 | 0-16383 rpm — **EMITTED FIRST** | VERIFIED (R1 example + R2 code agree) |
| **4** | **Vehicle Speed** | ≤3 | 0-455 km/h — **EMITTED SECOND** | VERIFIED |
| 6 | Engine Coolant Temperature | ≤4 | −40…+215 **°C**, leading `-` allowed | VERIFIED (ASCII) |
| 7 | Fuel Consumption / **EV Total Current** | ≤5 | **`M` = L/100 km, `H` = L/h** (GV350M sends `L/H`); or **A** | VERIFIED |
| 8 | Fuel Level | ≤7 | **`L`+litres or `P`+percent** | VERIFIED |
| 9 | Range | ≤8 | **hectometres** (×100 → m) | VERIFIED |
| 10 | Accelerator Pedal Pressure | ≤3 | **%** | VERIFIED |
| 11 | Total Engine Hours | ≤8 | **hours**, 2 dp | VERIFIED |
| 12 | Total Driving Time | ≤8 | hours, 2 dp | VERIFIED |
| 13 | Total Engine Idle Time | ≤8 | hours, 2 dp | VERIFIED |
| 14 | Total Idle Fuel Used | ≤9 | **litres** | VERIFIED |
| 15 | Axle Weight (2nd axle) | ≤5 | **kg** | VERIFIED |
| 16 | Tachograph Info | 4 | hi byte = driver 2, lo byte = driver 1; per byte `V R W1 W0 C T2 T1 T0` | VERIFIED |
| 17 | Detailed Info / Indicators | ≤8 | **16-bit on chipset ≤2.1.xx, 32-bit from 2.2.0** | VERIFIED (the version split is the ambiguity) |
| 18 | Lights | 2 | b0 running, b1 low beam, b2 high beam, b3 front fog, b4 rear fog, b5 hazard | VERIFIED |
| 19 | Doors | 2 | b0 driver … b5 hood — **but see J1939 below** | VERIFIED |
| 20 | Total Vehicle Overspeed Time | ≤8 | hours | VERIFIED |
| 21 | Total Engine Overspeed Time | ≤8 | hours | VERIFIED |
| 22 | Total Distance Impulses | — | **HEX report only** | VERIFIED |
| 28 | ⇒ `<Electric Report Mask>` present | ≤4 | | VERIFIED |
| 29 | ⇒ `<CAN Report Expansion Mask>` present | ≤8 | | VERIFIED |
| 30 | GNSS block appended | — | ASCII GTCAN only | VERIFIED |
| 31 | GSM block appended | — | ASCII GTCAN only | VERIFIED |

**Indicator bits 0-31** (R1 pp.324-325): FL, DS, AC, CC, brake, clutch, handbrake, central lock, reverse, running lights, low beam, high beam, rear fog, front fog, doors, trunk, Webasto, BFL, CLL, BAT, BF, OP, EH, ABS, —, CHK, AIR, SC, OLL, **CHG, FS (gas/petrol), PTO**.

### 6.3 `<CAN Report Expansion Mask>`

**VERIFIED** R1 GV300CAN pp.133-134, ascending emission order.

| Bit | Field | Bit | Field |
|---|---|---|---|
| 0 | **Ad-Blue Level** (units ambiguous — §5.5) | 12 | Cruise time |
| 1 | Axle Weight 1st | 13 | Kick-down time |
| 2 | Axle Weight 3rd | 14 | Brake applications |
| 3 | Axle Weight 4th | 15 / 16 | Driver 1 / Driver 2 card |
| 4 | Tachograph overspeed | 17 / 18 | Driver 1 / Driver 2 name |
| 5 | Tachograph motion | 19 | Registration |
| 6 | Tachograph direction | 20 | Expansion info |
| 7 | Analog input (**mV**) | 21 | Rapid brakings |
| **8** | **Engine Braking Factor** | 22 | Rapid accelerations |
| **9** | **Pedal Braking Factor** | 23-31 | **Reserved per R1** |

> **Traccar's source comments invert bits 8 and 9** (bit 8 "pedal breaking factor", bit 9 "engine breaking factor"). Traccar skips both fields, so its own decode is unaffected — but anyone copying those comments as a field map ships **two swapped driver-behaviour counters**. Trust R1.

Traccar additionally decodes **undocumented bits 23-31** (engine torque, service distance, ambient temperature, driver working-time masks, DTC codes, gaseous fuel level, tachograph info expand, and a further `reportMaskCan` carrying retarder usage / power mode / tachograph timestamp) with **no vendor citation**. GV300CAN V12.00 and GV350M V3.11 both mark 23-31 Reserved. **INFERRED at best — Q19.**

### 6.4 `<Electric Report Mask>` (EV)

**VERIFIED** R1 GV300CAN p.135.

| Bit | Field | Unit |
|---|---|---|
| 0 | Total Voltage | **V** |
| 1 | Charging Times | count |
| 2 | Total Power Recovered | **×1.820 Wh** — the factor appears only in the range column |
| 3 | Single Charge Capacity | kWh |
| 4 | Single Discharge Capacity | kWh |
| 5 | Remaining Power | — |

### 6.5 J1939 mode and the HEX `+CAN` divergences

**J1939 mode (`AT+GTCAN <Mode>` = 1) changes semantics, VERIFIED** R1 GV350M V3.11 pp.78, 103, 328:

- **Only 17 items are populated**: VIN, Ignition Key, Total Distance, Total Fuel Used, Vehicle Speed, Engine RPM, Coolant, Fuel Consumption, Fuel Level, Accelerator Pedal, Engine Hours, Driving Time, Idle Time, Idle Fuel, Axle Weight, Lights, Doors.
- **`<Doors>` degenerates to a single any-door-open flag**: *"For J1939, this byte indicates all the doors' status. 1 means at least one door is open"*. **Bit 0 no longer means "driver door".** A door-ajar alert built on bit 0 fires for the bonnet.

**HEX `+CAN` is NOT the ASCII report in binary. VERIFIED** byte-for-byte against the vendor's own 165-byte frame `2B43414E21000007BF00A54B…0D0A`:

| Difference | Detail |
|---|---|
| **5-byte time/fuel totals** | `u32 integer part` + `u8` **two-digit** fraction. `00 00 00 32 38` = **50.56 L**, matching the ASCII example. Reading the 5 bytes as a 40-bit integer ÷100 gives **2,158,558,776.32**. R1 GV350M V3.11 p.328 states the rule verbatim: *"5 bytes in total. The first 4 bytes are for the integer part … the last byte is for the fraction part. The fraction part has 2 digits."* |
| **`<Fuel Level>` occupies TEN bytes, not five** | litres (4+1) **then** percentage (4+1). Verified: offsets 66-70 `00 00 00 57 28` = 87.40 L (ASCII showed `L87.40`) and 71-75 `00 00 00 43 14` = 67.20 %. **Only with both consumed** do `<Range>` = `0x00000F78` = 3960 and `<Accelerator Pedal Pressure>` = `0x0020` = 32 land on the ASCII example's values. **This is the single most likely place to lose the rest of the record.** |
| **Indicators are 2 bytes in HEX** | so indicator bits 16-31 are unreachable; they arrive via `<Expansion Information>` instead |
| GNSS / GSM blocks | lon/lat int32 ×1e-6, altitude 2 B ×0.1 m, UTC 7 B (`YYYY MM DD HH MM SS`), GSM 9 B (MCC, MNC, LAC, CID, reserved) |

**flespi refuses this variant outright.** If you must support HEX CAN, budget for it as its own project.

### 6.6 OBD-II layer (GV500 / GV500MAP)

`<OBD Report Mask>`, ascending. **VERIFIED** R1 GV500 V1.06 pp.58-59, 120-123, except where marked.

| Bit | Field | Unit / encoding | Confidence |
|---|---|---|---|
| 0 | VIN | 17 chars | VERIFIED |
| 1 | OBD Connect | 0/1 | VERIFIED |
| 2 | OBD Power Voltage | **mV** | VERIFIED |
| 3 | Support PIDs | 8 hex bitmap | VERIFIED |
| 4 | Engine RPM | rpm | VERIFIED |
| 5 | Vehicle Speed | **km/h** | VERIFIED |
| 6 | Engine Coolant Temperature | −40…215 **°C** | VERIFIED |
| 7 | Fuel Consumption | **may be `Inf` / `NaN` / `nan`** | VERIFIED |
| 8 | DTCs Cleared Distance | **km** | VERIFIED |
| 9 | MIL Activated Distance | **km** | VERIFIED |
| 10 | MIL Status | 0/1 | VERIFIED |
| 11 | Number of DTCs | 0-127 | VERIFIED |
| 12 | Diagnostic Trouble Codes | `4 × <Number of DTCs>` hex chars, **no separators** | width VERIFIED, **encoding INFERRED** |
| 13 | Throttle Position | **%** | VERIFIED |
| 14 | Engine Load | **%** | VERIFIED |
| 15 | Fuel Level Input | **%** | VERIFIED |
| **16** | **OBD Protocol** (single char 0-9/A) | — | **UNDOCUMENTED in V1.06 ("Reserved"); named by R2, values fit** |
| **19** | **OBD odometer** | **km, integer** | **UNDOCUMENTED in V1.06; named by R2, values fit (1286, 53557)** |
| 20 | GNSS block | — | VERIFIED |
| 21 | GSM block | — | VERIFIED |
| 22 | Mileage | km, 1 dp | VERIFIED |

**DTC encoding — INFERRED but strongly supported.** A real 10-code sample `0300 0301 0303 0304 0012 0031 0351 0352 0353 0354` with `<Number of DTCs> = 10` decodes cleanly under standard **SAE J2012 2-byte packing** to **P0300, P0301, P0303, P0304, P0012, P0031, P0351, P0352, P0353, P0354** — a coherent misfire / ignition-coil set for one engine. That coherence is the evidence; the encoding is stated nowhere in R1.

**Related reports:** `GTOPN` / `GTOPF` (OBD connect/disconnect), `GTJES` (journey engine summary: fuel consumed, max and average RPM, throttle, engine load).

**GV500 position reports carry OBD data inline:** `+RESP:GTFRI` trailer becomes `… Backup Battery Percentage, Device Status, Engine RPM, Fuel Consumption, Fuel Level Input, Send Time, Count`. **VERIFIED** R1 GV500 V1.06 pp.71-72, independently encoded by R4 qtripp at indices 26/27/28.

**Known vendor errata:** GV500 V1.06 p.120's own GTOBD example uses mask `1fff` (13 bits) but carries **16** masked fields. The mask bit table and the field order both imply the payload is right and the mask is a typo for `FFFF`. Real captures always use `70FFFF`, `78FFFF`, `19FFFF`. **Traccar ignores the OBD mask entirely and matches a fixed regex, so any partially-masked GTOBD fails to match and falls through to the heuristic decoder.**

### 6.7 What a fleet product can and cannot promise on Queclink

| Promise | Deliverable today? |
|---|---|
| Odometer from the vehicle | **Yes**, if `H`-prefixed. **No** if `I`-prefixed (impulses). |
| Fuel level | **Yes**, if you carry the `L`/`P` unit with the value. |
| Fuel consumption | **Yes** in ASCII, with a robust prefix parser. **No** in HEX. |
| Engine hours / idle time | **Yes** (hours, 2 dp). |
| RPM, coolant, pedal, speed | **Yes** in ASCII. |
| VIN | **Yes**. |
| Tachograph driver cards / activity | **Partially** — mask bits 16, 15-18 exist, but there is **no example frame anywhere** for GTDMR/GTTRD/GTTRL/GTTTR. Consistent with the roadmap conclusion "integrate, do not build". |
| AdBlue | **Not until cross-checked against a gauge.** |
| Raw SPNs / PGNs | **No. Not over the air, by design.** |
| CAN data over Protocol Pro | **No.** Six vehicle Data IDs, no CAN catalogue. |

---

## 7. THE TRAP LIST

**46 known decoding bugs. This is the most valuable section of the document. Do not compress it.**

Each trap: what the customer sees · why it happens · the source · the test that catches it. Every one of these has been shipped to production by at least one real implementation.

---

### T1 — GTIGL/GTVGL ignition polarity is inverted between model families

**Symptom.** Every trip on a GV-series vehicle is recorded upside down: "ignition off" the moment the engine starts, "ignition on" when it stops. Trip lists show driving during parking and idling during motion. Engine-hours and idle-time billing invert. **No error is logged — the value is a clean boolean.**

**Cause.** `<Report ID/Report Type>` low nibble. Three vendor documents say **0 = ignition ON, 1 = ignition OFF**. CV200 says the **exact opposite**. Traccar hardcodes one global rule `reportType % 0x10 == 1 ⇒ ignition true`, which matches CV200 and is wrong for GV200/GV350M/GL320M.

**Source.** R1 GV350M V4.03 p.159: *"In the report of ignition on and ignition off report +RESP:GTIGL/+RESP:GTVGL / 0: Ignition on. / 1: Ignition off."* — same wording GV200 V5.01 p.107 and GL320M V3.03 p.70. **CONTRADICTED** by R1 CV200 V2.21 p.159: *"0: Ignition off / 1: Ignition on"*. R2 `Gl200TextProtocolDecoder.java:1648` `case "IGL" -> position.set(Position.KEY_IGNITION, reportType % 0x10 == 1);` — https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/Gl200TextProtocolDecoder.java · R5 https://github.com/traccar/traccar/issues/4776 (*"when turning on my car, an IGN message is sent, along with an IGL that reports ignition as OFF"* — the user shipped a config flag `gl200.ReverseIgnitionIGL` in PR #4777 rather than get it fixed) · R3 flespi changelog **2026-07-08**: *"Fixed inverted ignition status polarity in GTVGL for GV53MG, GV57MG, GB100MG, GB100, GB130MG and in GTIGL for GV53MG, GV57MG"* — https://forum.flespi.com/d/27-changelog-queclink-protocol

**Test.** Two fixtures with **opposite** expected values keyed on model, in one test file. `+RESP:GTIGL,F1030A,868446036599153,gv350m,,00,1,2,0.0,0,151.0,114.015284,22.537202,20190823065816,0460,0001,253D,AEC3,,0.0,20190823145817,12C8$` must decode `ignition = true`; a `BD`-prefixed CV200 GTIGL with report type `00` must decode `ignition = false`. **A decoder with a single global rule cannot pass both.** Add a third case asserting that an unmapped protocol-version prefix yields `ignition = undefined`, never a guess.

---

### T2 — `GNSS Accuracy = 0` means "no fix, this is the last known position" — and the record still carries a full, plausible lat/lon and a fresh Send Time

**Symptom.** A parked vehicle in an underground garage teleports: the trail jumps to wherever it last saw sky, then back. Trip distance accrues kilometres never driven. On some models **every** ignition event carries a stale coordinate, so trip start and end points are wrong by whatever the vehicle moved while unfixed.

**Cause.** The vendor reuses the position slot for the cached fix and signals staleness **only** through the accuracy field. Traccar has two `decodeLocation` implementations in one file: the Parser one does `setValid(hdop == null || hdop > 0)`; the array-based one (used by GTERI, GTIGN/GTIGF, GTLBS) sets `setValid(true)` whenever longitude is non-empty and **never looks at accuracy**; `decodeBasic` sets `setValid(true)` unconditionally.

**Source.** R1 CV200 V2.21 pp.159-160: *"0 means the current GNSS fix fails and the last known GNSS position is used. A non-zero value (1 - 50) means the current GNSS fix is successful"* · R1 GV350M V4.03 p.159 and its GTIGN/GTIGF field tables pp.251/253 giving Range/Format literally `0` annotated *"0, Last known"* · R2 the two disagreeing `decodeLocation` overloads · **CONTRADICTION** R3 flespi 2022-06-22: *"parameter position.hdop (GNSS Accuracy field) was skipped if it's value is 0. This is a bug and it's fixed"* — flespi deliberately started registering `hdop = 0` as a normal value.

**Test.** `+RESP:GTIGF,500101,868570000393782,,0,0,,,,,,,0730,0002,A08F,872B36,00,,0.0,20240921021804,E3B1$` (accuracy empty, no coordinates) and the W4 pair (accuracy `0` then `1`, identical coordinates). Assert `fix_valid === false` on both zero-accuracy cases, and assert that a trip-distance accumulator fed `[valid fix A, accuracy-0 record at B, valid fix A]` adds **zero** distance.

> **Orbetra note.** This is the @Track analogue of hard rule 6 / ADR-039, but the mechanism is different: **Queclink never emits null island.** `isNullIsland` catches none of this. The invalid-fix gate for @Track is `accuracy === 0` (ASCII/HEX) or `fixState !== 0b10` (Pro). Add it as a *sibling* guard, not a replacement.

---

### T3 — `<Position Append Mask>` is hexadecimal, is parsed as decimal, and its bit map differs per model

**Symptom.** Two failure modes on one field. Masks containing `A`-`F` **throw and the device is disconnected mid-flush**. Masks in `10`-`99` parse to the wrong number, so the decoder consumes the wrong count of appended fields and **everything after the cell block shifts by one** — satellite counts land in the odometer, odometer in the battery, send time is parsed as a number.

**Cause.** `<Position Append Mask> 2 bytes, 00 - FF`. Traccar: `int appendMask = Integer.parseInt(v[index - 1]);` — **no radix**. Separately the bit assignment is not stable: CV200 defines **bit 0 = satellites in VIEW, bit 2 = satellites USED (no bit 1)**; GV500CG defines **bit 0 = satellites in use, bit 1 = GNSS trigger type**. Traccar checks bits 0 and 1 only, so on a CV200 with mask `05` it consumes one field where two are present.

**Source.** R1 CV200 V2.21 p.18 and p.20 · R1 GV500CG V3.02 p.126, verified on the vendor's own example `…,0460,0001,DF5C,05FE6667,03,15,0,123.5,00123:04:44,…` · R2 `Gl200TextProtocolDecoder` array path · R3 flespi **2026-09-01** (nine days before this document): *"Fixed parsing of the Position Append Mask field, which was read as a decimal number instead of hexadecimal. Masks containing digits A-F caused a parsing error and disconnect; masks in the range 10-99 were decoded to the wrong value… Affects CV200, CV5000, GB100CG, GV30CAU, GV30CEU, GV350CEU, GV355CEU, GV50CEU, GV58CEU and GV58LAU"*, plus follow-ups **2026-09-02**, and earlier fixes 2023-04-24 (GV300W), 2023-07-10 (GV350CEU), 2026-05-06 (GV58LAU), 2026-06-22, 2026-07-24 · R2 commit `8860d4a7` *"Ignition is not correctly decoded when Position Append Masked is configured with value 1"*

**Test.** Property test over the mask: for each of `00 01 04 05 0A 10 FF`, build a synthetic GTFRI whose appended-field count matches the **model's** bit map, and assert the decoder consumes exactly that many fields **and the Send Time still lands on the Send Time**. A decimal parser fails at `0A` (throw) and at `10` (phantom field). Also assert the decoder **rejects rather than guesses** when the model is unresolved.

---

### T4 — A multi-fix GTFRI/GTERI silently degrades to one position when the pattern does not match, because the fallback decoder always succeeds

**Symptom.** Track resolution silently drops from the fix interval to the send interval. One reporter measured **3,430 of 5,218 fixes (65.7 %) discarded** over a 5-hour capture; at the protocol maximum of 15 fixes per report you lose **14 of 15 (93 %)**. Nothing is logged. The map still shows a moving vehicle, just a coarser one, and the customer's distance report is short.

**Cause.** Newer firmware (prefix `9702xx`) moved the network block **out of** the repeated position group to once per message. `PATTERN_FRI` requires the network fields inside each group, so `decodeFri` returns null, and `decode()` calls **`decodeBasic`** — a heuristic scanner that finds the FIRST pair of adjacent `-?\d{1,3}\.\d{6}` fields, calls them lon/lat, backs up four fields for hdop/speed/course/altitude, sets `valid = true`, and returns exactly **one** position. **A silent fallback that always produces a plausible answer is worse than a crash.**

**Source.** R5 https://github.com/traccar/traccar/issues/5939 with the loss measurement (1,792 reports, 5,218 fixes, 1,713 three-fix batches in 5 h). Reproduced locally against Traccar's own `PatternBuilder` + `PATTERN_FRI`: the three-fix frame `+BUFF:GTFRI,970208,867963069900001,GL30MEU,0,0,3,1,27.4,75,475.0,16.372215,48.208327,20260702130741,1,30.2,49,476.7,16.372300,48.208482,20260702130742,1,33.3,32,476.9,16.372357,48.208598,20260702130743,0232,0001,A1B2,0001A2B4,13,0,4063,95,1,1,,20260702130743,0084$` → **NO MATCH**, while the single-fix variant of the same firmware matches. R2 the fallback chain `if (result == null) { result = decodeBasic(...); }` · R3 flespi 2020-09-29: *"if device sends multiple positions in one packet - all positions will be registered as separate channel messages. Before the update only the last position was registered"*, then GL320M multi-position GTFRI fixed **four separate times** (2022-02-02, 2022-06-22, 2022-10-19, 2022-12-06).

**Test.** **Never let a fallback path produce a position.** Feed the 3-fix `970208` frame and assert `records.length === 3` with three distinct GNSS UTC times; then feed a deliberately mutated frame and assert the result is `undecodable`, not a single position. Add a metric `codec_fallback_total` and alert on it — a customer losing 65 % of their track must be a number, not a shrug.

---

### T5 — The `+INF` length-field offset is model-dependent, and "try 7 then 9 and take whichever looks plausible" desyncs the socket permanently

**Symptom.** A HEX-mode device delivers one report and then the connection produces garbage forever, or blocks. Every subsequent report on that socket is corrupted. With SACK on, the device retransmits into a dead socket.

**Cause.** GV300CAN §4.4 defines `Message Type(1) | Report Mask(2) | INF Expansion Mask(2) | Length(2)` ⇒ **offset 9**, and its 145-byte example confirms it. A GB100 frame (`2b494e4601fd7f0076…`, 118 B = `0x0076` at offset 7) has **no** expansion mask and needs **offset 7**. Traccar contradicts itself: frame decoder uses 7, protocol decoder reads a 4-byte mask ⇒ 9. The naive fix — "try both, accept the plausible one" — has **no validation criterion**: the competing candidate at offset 9 on a GV300CAN-class `+INF` is the **INF Expansion Mask**, a 16-bit configuration value that can hold any number. An expansion mask of `0x0055` against a real 145-byte frame yields the perfectly plausible candidate 85; the framer cuts 85 bytes and parses the remaining 60 as a fresh frame. **That desync is permanent and self-sustaining.**

**Source.** R1 GV300CAN V12.00 §4.4 · R2 `Gl200FrameDecoder.java` `case "+INF", "+BNF" -> buf.getUnsignedShort(buf.readerIndex() + 7)` vs `Gl200BinaryProtocolDecoder.decodeInformation` · both verified numerically by me.

**Test / mandatory rule.** **Accept a candidate length `L` only if `buf[L-2:L] == 0D 0A` AND `CRC-16/CCITT-FALSE(buf[4:L-4]) == buf[L-4:L-2]`.** Try 7, then 9, then **drop the connection**. Both candidates passing CRC is a ~1-in-65 536 coincidence rather than a configuration value. Test: a `+INF` frame whose expansion mask happens to be a plausible length, asserting the framer picks the CRC-valid candidate.

---

### T6 — Cell LAC and Cell ID radix is guessed from which characters happen to be present

**Symptom.** LBS-only positions (tunnels, garages, jammed GPS) land in the wrong cell, sometimes the wrong city — roughly whenever the hex CID contains no letters. For a 4-hex-char CID that is about **15 %** of towers, and the wrong ones are silently plausible. Worse: **FRI and ERI from the same device disagree with each other.**

**Cause.** The vendor tables give LAC/Cell ID only as widths (`XXXX`, `4|8`), **never an encoding statement**. Traccar's `PATTERN_LOCATION` has an alternation that tries an all-decimal branch first and falls back to hex; the array-based `decodeLocation` (GTERI, GTIGN, GTLBS) always calls `Integer.parseInt(..., 16)`.

**Source.** Reproduced locally against Traccar's verbatim `PATTERN_LOCATION`: `+RESP:GTFRI,423031,866873025895726,,0,1,1,0,1,16,0.0,351,51.6,121.391063,31.164633,20181212072535,460,00,1877,DAE,00,3,85,20181212072535,002C$` binds the **hex** groups (LAC `1877` → 6263), while `+RESP:GTFRI,210102,A10000458356CE,,0,1,1,15,1.4,0,190.6,-85.765763,42.894896,20160208164505,4126,210,0,18673,00,92,20160208164507,00A6` binds the **decimal** groups (CID 18673 decimal, not `0x18673` = 100467). Both frames are in R2's corpus.

**Test.** Golden fixture pair from one IMEI — a GTFRI and a GTERI reporting the **same tower** — asserting both decode to the identical `(mcc, mnc, lac, cid)` tuple. Then a property test: for every CID in the corpus, assert the decoder's radix choice is a **function of the resolved model**, never of the characters in the value. If the model cannot be resolved, emit the raw string and **no numeric cell id**.

---

### T7 — 1-Wire temperature is a signed 16-bit value in 1/16 °C encoded as hex — except on GL320M-class devices where the same slot is a plain decimal °C

**Symptom.** Two symptoms from one field. Where the hex reading is right but the sign is dropped, **−1 °C is reported as +4094.1 °C**, so a refrigerated-trailer alarm never fires below zero (or fires constantly). Where the model actually sends `32.4`, the hex parse **throws and the device is disconnected**, so the customer loses all positions from that tracker after a server upgrade.

**Cause.** The block encodes DS18B20 raw counts (two's complement, 0.0625 °C/LSB) as four ASCII hex characters; Traccar does `(short) Integer.parseInt(v[index-1], 16) * 0.0625` and the `(short)` cast is the **only** thing making negatives work. GL320M/GL30x firmware puts a human-readable decimal in the same position.

**Source.** R1 GV300CAN V12.00 p.186 + Appendix A · R2 commit `8ae0436e` asserting `temp1 = 25.0` for `0190` · R3 flespi 2023-10-20: *"fixed parsing negative temperature sensor values received as 1-Wire Device Data parameter in GTERI reports from GV300, GV300W, GV300L, GV300CAN, GV350M, GV600, GV600M, GV600MG, GV620MG, GV58CEU, GV355CEU, GV310LAU"* · R5 https://github.com/traccar/traccar/issues/5727 (*"For input string: \"32.4\" - NumberFormatException"*) · R5 traccar forum *"Problem with GL200 Protocol after version 5.12"*: `+RESP:GTERI,C30205,…,87,1,29.7,1,900,…` → *"For input string: \"29.7\" … disconnected"* · R5 https://github.com/traccar/traccar/issues/3806 (same block with an **empty** temperature when ignition is off)

**Test.** Four cases in one fixture: `0190` → **+25.0 °C**; `FFE2` → **−1.875 °C**; `FFF0` → **−1.0 °C** (the case a naive parser gets wrong by 4096.9); empty → attribute absent, **no throw**. Plus a GL320M-family case with `32.4` asserting 32.4 °C. **Write the negative case first** — it is the only one that distinguishes correct from plausible.

---

### T8 — The digital fuel-sensor value is hex-encoded ASCII in a field that looks decimal

**Symptom.** Fuel reads low by a plausible amount and never above 99. `0099` reports 99 when the tank is at 153 units; `01DF` reports 1 when it is at 479. A fuel-theft threshold set on the wrong scale either never fires or fires nightly.

**Cause.** ERI mask bit 0 carries the sensor reading as hex characters with **no prefix and no marker**. Values under 100 containing no letters are indistinguishable from decimal, so the bug survives casual inspection and only shows on a full tank.

**Source.** R2 `decodeEri` `Integer.parseInt(v[index - 1], 16)`, asserted against two real frames: `+BUFF:GTERI,410502,864802030794634,,00000001,,10,1,1,0.0,0,3027.8,-78.706612,-0.955699,20230418170736,0740,0002,A08C,2AB72D,00,0.0,,,,100,110000,1,0099,20230418171004,8B98$` → **KEY_FUEL 153**, and `+RESP:GTERI,F10415,862599050680717,GV350M,00000001,,50,1,1,0.0,274,2963.1,-78.691767,-0.951295,20250512214226,,,,,,0.0,,,100,210100,,1,1,1,01DF,20250512214226,009D$` → **479**. R1 caveat: GV350M V4.03 marks ERI bit 0 reserved for that model, which is why Traccar carries `!model.equals("GV350M")` and then a *second* GV350M-specific hex read; R3 flespi 2026-07-28 *"Fixed parsing of GTERI report for GV350M devices when ERI mask bit 0 (Digital Fuel Sensor Data) is set"* confirms the model split is real.

**Test.** Assert the **exact integers 153 and 479**. A decimal implementation returns 99 and 1 — both inside a plausible range, so the assertion must be on the exact value, never "is a number between 0 and 1000".

---

### T9 — CAN fuel and AdBlue fields carry a leading unit letter, and the letter convention differs between models in the same protocol family

**Symptom.** AdBlue level and fuel consumption are missing entirely from the customer's dashboard, or the whole GTCAN throws. On a truck fleet AdBlue is the compliance-relevant reading — an empty tank derates the engine and the operator never saw it coming.

**Cause.** `H1.5` (L/h), `M23` (L/100 km), `P84.00` (percent), `L87.40` (litres), `P100.00` (AdBlue), **and `L/H1.5` on GV350M** — a three-character prefix in a field documented as `≤5`. Traccar strips exactly one character for AdBlue (right) but tests `value.startsWith("L/H")` for fuel consumption (wrong for GV300CAN/GV355CEU, which send `M`/`H`), so it silently records **nothing**.

**Source.** R2 commit `899902b5` *"Fix GTCAN in GV355CEU"* changing `Integer.parseInt` to `Double.parseDouble(v[index-1].substring(1))` and asserting `adBlueLevel = 100.0` on `+BUFF:GTCAN,8020050402,867488060267845,,00,1,E00FFFFF,YS2K4X20001928588,1,H149381,…,P94.80,…,001FFFFF,P100.00,5571,…` · counter-example in the same test file: `+RESP:GTCAN,F10413,862599050467479,GV350M,0,1,C18CFDFF,3BKHHZ8X7GF723380,2,H2898058,232160.50,896,0,64,L/H1.5,P99.20,…` vs `+RESP:GTCAN,310603,863286023346480,gv65,00,1,C03FFFFF,,2,H2843820,373.76,1440,44,77,M23,P35.00,…` · R3 flespi 2023-07-18 and 2024-04-08 fixes across GV300CAN, GV58CEU, GV355CEU, GV350CEU, GV58LAU, GV305CEU.

**Test.** One fixture per observed encoding — `H1.5`, `L/H1.5`, `M23`, `P84.00`, `P100.00`, `H149381`, `I6782` — asserting **both** the numeric value **and** the resolved unit, plus a case with an unknown leading letter asserting the value is emitted as an undecoded string rather than dropped or coerced. **Do not ship an AdBlue number until one live capture is cross-checked against the vehicle's gauge.**

---

### T10 — The heartbeat is disguised as a command acknowledgement, and its reply format differs from every other acknowledgement

**Symptom.** In TCP long-connection mode the device drops the connection at every heartbeat interval and reconnects, so live tracking becomes a stutter of first-position-only sessions. Because the server logged the heartbeat as an "ACK", nobody looks at it.

**Cause.** The heartbeat is `+ACK:GTHBD,…` — the `+ACK` class, which most decoders route to "command result, ignore". It requires `+SACK:GTHBD,<protoVer>,<count>$`; the plain `+SACK:<count>$` used for reports is **not accepted**. On GL320M the heartbeat also stops being sent at all if `<Heartbeat Interval>` exceeds `<DNS Lookup Interval>`.

**Source.** R1 GV350M V4.03 p.301 (both `+SACK:GTHBD,F10101,11F0$` and `+SACK:GTHBD,,11F0$` examples) against the device-side `+ACK:GTHBD,F1030A,868446036599153,gv350m,20190826105726,14D6$` on p.300 · R1 GL320M V3.03 p.11 · R3 flespi 2021-11-11: *"Heartbeat packet requires a special ACK in the following format: +SACK:GTHBD,,<serial number>$ whereas the format of the ACKs all the other reports is as follows: +SACK:<serial number>$. Previously due to our mistake the latest format of ACK was used for both"* · R2 `Gl200TextProtocolDecoder.java:162-181`.

**Test.** Socket-level test in the `tools/simulator` shape: open a connection, send a `+ACK:GTHBD` frame, assert the server writes **exactly** `+SACK:GTHBD,<version>,<count>$` within the heartbeat window, and assert it writes **exactly one** reply. **Traccar with `gl200.ack=true` writes two** (`+SACK:GTHBD,…$` from the ack handler plus `+SACK:<count>$` from the tail of `decode()`) — untested behaviour against a mode-1 device. Negative test: withhold the reply and assert the simulated device tears down the connection.

---

### T11 — Getting the server acknowledgement wrong does not lose data — it multiplies it, or wedges the device until someone pulls the battery

**Symptom.** Either **four identical rows per real position** (duplicated trips, quadrupled distance, quadrupled per-record billing), or a device that reports the same buffered packet over and over and never advances. The operator's only field fix has been a power cycle **with the battery removed**.

**Cause.** With SACK Enable = 1 the device waits for `+SACK:<count>$` echoing the exact Count Number and resends on timeout **or on a mismatch**. Three sources give three retry policies; four current vendor documents give **none**. Traccar's `gl200.ack` defaults to **false**, so out of the box it never acknowledges a report; and when it does, it echoes `values[values.length - 1]`, which is the Count Number only if Send Time is second-to-last — false for the GT300/GL100 dialect (T46).

**Source.** R1 GV350M V4.03 p.16 (`<SACK Enable>` 1 checks the serial, 2 does not) and p.302 (*"The backend server uses the `<Count Number>` extracted from the received message as the `<Count Number>` in the server acknowledgement"*) · I grepped GV350M V4.03, GV200 V5.01, CV200 V2.21 and GL320M V3.03 for "resend"/"does not receive": **zero hits** · R3 flespi: *"unsynchronized configuration can cause unexpected behavior of the tracker — repetition of the same report several times"*, and 2026-03-17 *"Previously, SACK was controlled by the generic backend server setting which could become desynchronized from the device-specific setting, causing retransmission loops on GV53MG"* · **R5 field report with a frame attached**, OpenGTS group, Leonardo Manrique, 2017-10-17: *"cuando tengo activo el SACK los dispositivos se congelan al recibir la respuesta, tengo casos en los que se quedan reportando una y otra vez un mismo paquete del buffer para sacarlo dese loop hay que apagarlos y sacarles la bateria"* — https://groups.google.com/g/opengts/c/g2o6CjMlOSQ · R5 traccar forum GL320M: the device *"would frequently disconnect and reconnect, this was because SACK was configured incorrectly"*.

**Test.** Simulator scenario `sack-mismatch`: a modelled device with SACK Enable = 1 that resends on any reply whose count differs. Assert the server's ack echoes the count **byte-for-byte** for (a) a frame ending in `$`, (b) a frame with no terminator, (c) a GT300-dialect frame whose last CSV field is the version. Then end-to-end: **100 sent reports produce exactly 100 stored positions, not 400.** Dedupe on `(imei, message_type, count, send_time)` — never count alone.

---

### T12 — Buffered reports replay the ORIGINAL Send Time and Count Number, and can be configured to arrive BEFORE live data

**Symptom.** After a coverage hole, hours-old positions arrive interleaved with, or ahead of, the current one. A pipeline that dedupes on `(imei, count)` **drops genuine records** because the counter is not monotonic and wraps at `FFFF`. A pipeline that stamps arrival time reconstructs a trip that never happened. A gap detector on the counter fires continuously.

**Cause.** Vendor design: `+BUFF` is byte-identical to the original except the header. **Buffer Mode 2 explicitly sends buffered reports BEFORE real-time ones** (SOS excepted). Out-of-order delivery is a supported configuration, not an anomaly.

**Source.** R1 GV350M V4.03 p.283 §3.3.6 and p.13 (*"It counts from 0000 and increases by 1 for each report. And it rolls back after \"FFFF\""*) · R1 GV300 Firmware Release Notes A18V05 *"Increase buffer size to 10000"* (depth is firmware-dependent) · R5 traccar forum GV58LAU 2023-11-20: a burst of `+BUFF:GTEPS`/`+BUFF:GTFRI` frames whose GNSS UTC times are **2023-09-26** arriving on **2023-11-20**.

**Test.** Simulator scenario `buffered-flood` extended for @Track: after a simulated outage, replay 500 `+BUFF` frames whose counts overlap a live `+RESP` stream and **include one full `FFFF`→`0000` wrap**. Assert (a) every distinct record stored exactly once, (b) no live record suppressed by a colliding buffered count, (c) positions ordered by GNSS UTC time not arrival, (d) the trip engine produces the same trips as if the data had arrived live. **Store `buffered: true` from the header** so a support engineer can tell a replay from a live fix.

---

### T13 — A device that has never had a GPS fix stamps records at its RTC default, observed as 2020-01-01

**Symptom.** A freshly installed tracker's first flush lands **six years in the past**. It never appears on the map (off the end of the time window), the vehicle's odometer takes a giant jump when the first real fix arrives, and any "first seen" or trial-start logic reads the wrong date.

**Cause.** **There is no RTC-valid flag on the wire.** GNSS UTC Time and Send Time are both populated from a battery-backed clock that was never disciplined by GPS, and the buffer preserves them verbatim through the flush.

**Source.** Two independent captures. R2 corpus: `+BUFF:GTFRI,2E0503,861106050005423,,,0,1,,,,,,,,,,,,0,0,,98,1,0,,,20200101000001,0083$` · R5 traccar forum GV58LAU thread, hex log decoding to `+BUFF:GTPNA,8020040200,866314060249032,,20200101000004,1547$` · R5 adjacent failure https://github.com/traccar/traccar/issues/5355 where a misaligned field produced device time `2168-08-06 23:01:15`, MySQL rejected the row, and *"the devices table 'positionid' gets updated or set as NULL, thus the last known location of the device is no longer visible on the UI or available via API"*.

**Test.** Assert a record whose GNSS UTC Time is `2020-01-01T00:00:0x` is flagged `clock_unsynced`, **excluded from trip distance and odometer**, and still **persisted** (it is real evidence the device powered on). Plus a bound check in the codec: the existing `traccar.spec` asserts `tsMs` inside 2010..2035 — tighten it for @Track to reject anything before the device's first seen fix or more than a few minutes in the future, and assert such a record never becomes the device's last known position.

---

### T14 — Several complete messages arrive in one TCP segment, single messages are split across segments, the terminator is optional, and a leading stray NUL stalls the connection

**Symptom.** With a naive one-read-one-message framer, a buffer flush delivers a handful of positions and drops the rest, or a message is truncated at 1460 bytes and the tail is parsed as a fresh message with garbage fields. With Traccar's framer specifically, a leading `0x00` stalls that connection's buffer indefinitely.

**Cause.** `<Multi-packet Sending>` = 1 packs multiple buffered reports into one packet capped at **1460 bytes**; short-connection mode opens a new TCP connection per report; the trailing `$` is genuinely optional (dozens of frames in R2's corpus have none) and the GT300/GL100 dialect terminates with `0x00`. Traccar scans the whole readable buffer for `$` and only then falls back to `0x00`, so a NUL-terminated frame followed by a `$`-terminated one in the same buffer is **merged**; and `if (endIndex > 0)` means a delimiter at index 0 yields no frame and no consumption.

**Source.** R1 GL320M V3.03 p.11 (multi-packet, 1460 bytes) · R1 GV350M V4.03 p.14 (short-connection modes) · R3 flespi 2019-11-15 (GL100 `\0`) · R2 `Gl200FrameDecoder.java` · R5 the traccar#5391 log containing a stray fragment `26$` on its own line between complete frames.

**Test.** Framer tests mirroring `packages/codec/__tests__/frame.spec.ts`: (a) three complete `+RESP` frames concatenated in one `feed()` → **exactly three** frames out; (b) one frame delivered byte-by-byte → one frame, nothing emitted early; (c) a `$`-terminated frame followed by a `0x00`-terminated frame in one buffer → **two** frames, correctly split; (d) a **leading stray `0x00`** → consumed, framer still makes progress (this is the case that hangs Traccar); (e) a 1460-byte truncation → the partial tail retained, not parsed. Cap the accumulator and throw a typed `FrameError` above it, as the Teltonika framer already does.

---

### T15 — The ASCII @Track frame has no checksum of any kind

**Symptom.** A corrupted field survives all the way to the customer: a single flipped digit in a coordinate is a silently teleported vehicle; in the odometer it is a permanent jump in total distance. **There is no layer that can catch it and no error to log.**

**Cause.** The Count Number is a sequence counter, not a CRC — the vendor is explicit that it *"counts from 0000 and increases by 1 for each report"*. CRC16 exists **only** in the HEX variant, over `<Message Type>` to `<Count Number>`. Traccar's ack path names the echoed count `checksum`, which has propagated the misconception.

**Source.** R1 GV350M V4.03 p.13 (count definition) and its only CRC discussion in "4. HEX Format Message" · I grepped GL320M V3.03 (an ASCII-only model) for "CRC" and "checksum": **zero occurrences** · R2 commit `5e4b1f4b` *"Ack response for all types"* introducing `String checksum; if (sentence.endsWith("$")) …` for what is actually the count.

**Test.** There is nothing to verify, so the test is a **shape test**: assert every numeric field is range-checked before it reaches the database — latitude |x| ≤ 90, longitude |x| ≤ 180, speed ≤ 999.9 km/h, azimuth 0-359, altitude −500..10000 m, accuracy 0..50, hour meter matching `HHHHH:MM:SS` — and that a value outside range produces an **undecodable record**, not a stored position. Add monotonic-odometer guards at the trip-engine level, since a corrupt mileage field cannot be distinguished from a real one on the wire.

---

### T16 — `<Device Status>` is an enumeration wearing a bitfield's clothes, and its width varies

**Symptom.** Two losses. Vehicles reporting "no ignition signal detected" (status `41`/`42`) carry **no ignition attribute at all**, and downstream code that reads a missing ignition as `false` shows the fleet permanently parked. And **"ignition off but moving" — the towing signal, sitting right there in the byte — is thrown away**, so a stolen vehicle on a flat-bed generates no alert.

**Cause.** Bits 16-23 are a documented **enum** (`11 12 16 1A 21 22 41 42`). Traccar tests **bits 4 and 5** of that byte, which accidentally works for the `1x`/`2x` values and yields nothing for `4x`. Separately the field is six hex characters normally and **ten** when an EIO100 expander is attached, and Traccar's `PATTERN_FRI` only allows `(x{6})?` — so an expander-equipped truck's whole FRI silently falls through to the heuristic decoder.

**Source.** R1 GV350M V4.03 pp.161-162 (the "right to left" width rule, the eight-value enum, and the bit table with *"Bit 16-23 Motion status of the device / Bit 8 Ignition detection"*) · R2 `decodeStatus` `BitUtil.between(value, 2*8, 3*8)` then `check(ignition, 4)` / `check(ignition, 5)`, and `PATTERN_FRI .number("(x{6})?,")` · R3 flespi 2023-08-24 *"fixed Device Status field parsing of GTFRI, GTERI reports from GV350M and GV310LAU"* and 2026-07-08 *"Fixed GV57MGP GTERI/GTFRI reports incorrectly clearing engine.ignition.status when virtual ignition is active (the physical-input bit no longer overrides the motion-derived ignition state)"*.

**Test.** Table-driven fixture over **all eight** documented values asserting a **tri-state** result — ignition on / off / **unknown** — never a two-state boolean, plus separate `motion` and `tow` outputs. Corpus values already available: `110000 210100 220100 410000 420000 1A0201`. Add a **ten-character** status fixture (EIO100 attached) asserting the report still decodes fully rather than falling back. Assert explicitly that `41xxxx` yields `ignition = unknown` and that the trip engine treats unknown as "do not change state".

---

### T17 — Which bytes a field occupies is decided by a model string, and the model is resolved from an operator-typed free-text box before the wire is consulted

**Symptom.** A customer renames a device in the UI and its positions start landing in the wrong place, or its ignition stops decoding — **with no deployment and no error**. New hardware whose protocol prefix is not in the lookup table decodes as a generic device: every model-specific field is skipped and the message quietly shifts.

**Cause.** Traccar's `getDeviceModel` returns the **operator-entered `model` column uppercased if present**, and only falls back to a 2- or 6-character prefix of `<Protocol Version>`. Downstream, byte offsets hang off `model.equals("CV200")`, `model.equals("GV350M")`, `model.startsWith("GL5")`, `model.equals("GL320M")`, `model.startsWith("GV3") && model.endsWith("CEU")`. An unmapped prefix yields the empty string, so **every branch is false**.

**Source.** R2 `getDeviceModel(DeviceSession, String)` + the 43-entry `PROTOCOL_MODELS` map + branches such as `if (model.equals("CV200")) { index += 1; index += 1; }` in `decodeIgn` and `if (!model.equals("GL320M") && !v[index++].isEmpty())` in `decodeLocation` — **note the Java short-circuit there also skips the field entirely for GL320M** · R5 unmapped prefixes are routine: `FE1712` (traccar#5373), `970208` (traccar#5939) · R3 flespi errors loudly instead: *"If you see parsing errors mentioning '(unknown type XX)' in device logs, this indicates the device is registered with an incorrect device type"* · R4 qtripp advertises *"configurable reports per/device and on a per/firmware basis"* as a headline feature.

**Test.** Assert model resolution is a **pure function of `<Protocol Version>`** — decode the same frame with three different operator-supplied device names and assert identical output. Assert an unmapped prefix produces an `UnknownModel` undecodable record **with the prefix recorded**, never a best-effort parse. Add a metric so a new prefix appearing in the fleet is an **alert**, not a silent degradation. Keep the prefix→model table as a JSON dictionary with `source_url` per entry, the way the AVL dictionaries already work.

---

### T18 — `<Number>` (the count of position groups) has shipped wrong in firmware, and can legitimately be zero

**Symptom.** An off-by-one walks the parser off the end of the field array (crash → connection dropped → whole buffer replayed) or leaves a trailing group unparsed. A **zero** count crashes any decoder that reaches for the last position after the loop.

**Cause.** Field-count-driven layouts have no redundancy: if the device's own counter is wrong, nothing on the wire says so. Traccar does `int count = Integer.parseInt(v[index++]); for (…) …; Position position = positions.getLast();` and `LinkedList.getLast()` on an empty list throws.

**Source.** **R1 vendor errata** — GV300 Firmware Release Notes A18V05 §2.28.4: *"Fix the bug that find the number count of multi-point fixed packet error when the AT+GTEPS synchronization with FRI is enabled"* · R3 flespi 2023-02-13 *"fixed GTEPS report parsing with 0 as positions number value"* · R2 `Gl200TextProtocolDecoder.java:951` and `:960`; a 2026 commit (`e892eea3`) added the band-aid guard `&& index < v.length - 2` to a downstream loop rather than validating the count · R5 traccar#5391 *"Index 33 out of bounds for length 31 - ArrayIndexOutOfBoundsException"* on a real GV200 GTERI.

**Test.** Fixtures for `count = 0`, `count = 1`, and `count = N` where N disagrees with the groups actually present **in both directions**. Assert: `count = 0` yields a record with no position and no crash; a count larger than the available groups yields an **undecodable record**, not a truncated parse; a count smaller than the groups present is **detected** (the leftover fields will not line up with the trailing block) rather than silently discarding fixes. Cross-check the parsed group count against the remaining field count before trusting it.

---

### T19 — `<Report ID/Report Type>` is a hex byte read as two nibbles — and Traccar parses it as decimal in the FRI path while parsing it as hex in the fallback path

**Symptom.** The very common value `10` (report ID 1, type 0 — a plain fixed-timing report) is read as decimal 10 = `0b1010`, from which Traccar derives **motion = false and charging = true**. Vehicles show as charging that are not, and motion flags contradict the speed field in the same record.

**Cause.** Two code paths in one file. `decodeBasic` does `Integer.parseInt(v[index + 2], 16)` (correct); `decodeFri` does `parser.nextInt()` (base 10) and then `BitUtil.check(reportType, 0)` / `check(reportType, 1)` for motion and charge — semantics borrowed from an asset-tracker model and applied to vehicle trackers whose report type is a 0-6 enum with **no motion and no charge meaning at all**.

**Source.** R1 GV350M V4.03 p.158 (*"4 high bits mean report ID and 4 low bits mean report type"*) and p.161 (the FRI enums) · R1 CV200 V2.21 p.159 states the same nibble rule · R2 `Gl200TextProtocolDecoder.java:867`, `:916-917`, versus `:1644` · R3 flespi 2026-02-14 on the adjacent GTCAN trap: *"the composite 'Distance Type / Report Type' field is now correctly split into two values. Previously, when Distance Type was 1 (GNSS), the combined value (e.g., '10', '12') was treated as an invalid single Report Type, causing the entire GTCAN message to fail parsing"*.

**Test.** Assert `10` → `{reportId: 1, reportType: 0}` and `4B` → `{reportId: 4, reportType: 11}` — a decimal parser produces 10 and **throws** respectively. Assert the decoder does **not** emit motion or charging from this field for GV/CV models, and that it emits the documented enum name (`fixedTiming`, `corner`, …) so a support engineer can read it.

---

### T20 — Fields carry the literal strings `nan` and `Inf`, and lowercase `nan` defeats the case-sensitive guard added for exactly this

**Symptom.** The whole OBD message fails to match its pattern and drops to the heuristic fallback, so RPM, coolant, DTCs, throttle, fuel level and OBD odometer **vanish while a position still appears**. In JavaScript `parseFloat('nan')` yields `NaN`, which JSON-serialises to `null` or poisons a numeric column.

**Cause.** Traccar's `PATTERN_OBD` anticipates it with `(\d+\.?\d*|Inf|NaN)?` — but `PatternBuilder` compiles with only `Pattern.DOTALL`, so the alternation is **case-sensitive** and the observed lowercase `nan` does not match. Traccar's unit test still passes because `verifyPosition` only asserts that *some* position came out.

**Source.** Reproduced locally with Traccar's verbatim `PatternBuilder` + `PATTERN_OBD` against their own test frame `+RESP:GTOBD,360701,864251020253807,LSGTC58UX7Y067312,GV500,0,70FFFF,…,33,nan,…$` → **NO MATCH**. The same literal appears again in `+RESP:GTFRI,360100,864251020141408,3VWGW6AJ0FM237324,gv500,,10,1,1,0.0,0,2258.4,-99.256948,19.555800,20160929214743,0334,0020,0084,65AC,00,0.0,,,,100,410000,0,nan,,20160929214743,13BA$`. R1 GV500 V1.06 p.122 documents the placeholder.

**Test.** Fixture set containing `nan`, `NaN`, `Inf`, `-Inf` and empty in numeric slots, asserting each maps to a **null/absent attribute** and that the surrounding message **still decodes fully**. Add a repository-level guard: **reject non-finite numbers before they reach the raw-SQL positions layer**, plus a property test asserting no parsed record ever contains `NaN` or `Infinity`.

---

### T21 — External power is millivolts, engine hours are a `HHHHH:MM:SS` string, and the ignition-duration counters reset on reboot

**Symptom.** A 12 V battery displayed as **12,052 V** (or a low-voltage alert that never fires); engine hours off by a factor of 3600; an hours-based service reminder that **jumps backwards** every time the device reboots.

**Cause.** Unit conventions are per-field and mostly implicit. `<Hour Meter Count>` is `00000:00:00`-`99999:00:00` **text**, not a number. `<Mileage>` is km with one decimal and must be scaled to metres. `<Duration of Ignition ON/OFF>` is a seconds counter held in RAM, not derived from a monotonic clock.

**Source.** R5 https://github.com/traccar/traccar/issues/3758 *"Queclink devices report external power in mV, not Volts"* (fixed after the reporter pasted the GV55 spec page) · R1 GV350M V4.03 p.161 (hour meter format, mileage range) · **R1 vendor errata** GV300 Firmware Release Notes A18V05: *"Fixed The Counter of `<Duration of Ignition ON>` and `<Duration of Ignition OFF>` are reset to 0 if the device reboots"* and, elsewhere, *"Modified the mileage count arithmetic"* between firmware versions · R3 flespi 2026-06-03: *"trip.engine.motorhours from 'Current Hour Meter Count' was stored in seconds and is corrected to hours"* · R2 https://github.com/traccar/traccar/issues/2233 catalogues odometer units across 30 protocols.

**Test.** A **units table test**: every emitted field has a declared unit in the dictionary JSON with a `source_url`, and a test iterates the dictionary asserting each parsed sample lands in a documented physical range (power 8-32 V, hours 0-99999 h, mileage 0-4,294,967 km). Specifically assert `11888` → **11.888 V** and `01476:55:53` → **1476 h 55 m 53 s**. For the reboot-reset counters, a trip-engine test asserting a **backwards jump** in `<Duration of Ignition ON>` is treated as a counter reset, never as negative engine time.

---

### T22 — The HEX device identifier is decoded as a 64-bit integer instead of seven decimal pairs

**Symptom.** Every HEX-mode device presents an 18-19 digit identifier that matches nothing in the registry. In our architecture that means positions are dropped or bound to a phantom device; in Traccar it "works" only because `ProtocolTest` mocks a device session for any id.

**Cause.** `Gl200BinaryProtocolDecoder` does `getDeviceSession(channel, remoteAddress, String.format("%015d", buf.readLong()))` — reads the 8 identity bytes as a big-endian int64 and formats it as 15 digits. That cannot recover an IMEI under either documented rule.

**Source.** R1 GV300CAN V12.00 p.356 with both worked tables (§2.6). Decoding `56 4F 5F 03 00 52 0A 04` the vendor's way yields **867995030082104** (printed in ASCII elsewhere in the same PDF, Luhn-valid); Traccar's way yields **6219294076916861444**. Four IMEIs recovered from HEX/Pro frames using the documented encodings all pass Luhn: 865084030003675, 867995030082104, 865134050947226, 864696060004173.

**Test.** Assert `5632540300034305` → `865084030003675` and `564F5F0300520A04` → `867995030082104`, and that both pass a Luhn check. Assert the decoder **rejects** an identity that does not yield 15 Luhn-valid digits rather than fabricating one (see T37).

---

### T23 — Protocol Pro altitude is read as an unsigned 24-bit integer, so any below-sea-level fix renders as ~1.68 million metres

**Symptom.** A vehicle in the Netherlands, at the Dead Sea, or in a mine reports an altitude of **1,677,718.6 m**. Any altitude-based filter or display is nonsense for that fleet.

**Cause.** The vendor says *"if its value is negative, it is represented in 2's complement format"*; Traccar does `position.setAltitude(buf.readUnsignedMedium() / 10.0);`. `FFFFCE` = −5.0 m becomes 1677718.6.

**Source.** R1 https://qdc.queclinksz.com/protocols/gl601$A39To8VF2U/air/v10/html/dataids/Location/82.html · R2 `Gl200BinaryProtocolDecoder`.

**Test.** Fixture with altitude bytes `FFFFCE` asserting **−5.0 m**, and `0001B3` asserting **43.5 m** (the vendor's own example value). An unsigned reader fails the first and passes the second — so the negative case is the only discriminating one.

---

### T24 — Buffered HEX frames are framed and then silently discarded, and the binary path never acknowledges anything

**Symptom.** A device that spent a day out of coverage delivers its backlog and it **vanishes with no error**. Because the binary path never sends a SACK, the device retransmits the backlog forever.

**Cause.** `Gl200FrameDecoder` frames `+BSP`/`+BVT`/`+BNF`/`+HBD`/`+CRD`/`+BRD`/`+LGN`, then `Gl200BinaryProtocolDecoder.decode` switches on only `+RSP`/`+INF`/`+EVT` and returns `null` for the rest.

**Source.** R2 `Gl200BinaryProtocolDecoder.java`.

**Test.** Feed a `+BSP` frame (a `+RSP` with byte 1 changed to `B`) and assert it decodes to the **same record set** as its `+RSP` twin, flagged `buffered: true`, and that an ack is produced. Assert `+HBD`, `+CRD` and `+BRD` each produce a typed record rather than `null`.

---

### T25 — Protocol Pro heartbeats are not recognised because byte 1 is `0x10`, not `0x00`

**Symptom.** Intermittent stream desync on Protocol Pro devices — roughly **1.5 % of heartbeats**, i.e. whenever a `0x24` byte appears inside the IMEI or the 4-byte epoch.

**Cause.** `isBinary()` tests `b[1] == 0`, but the HBD frame has `b[1] == 0x10`. It falls to the ASCII path and is framed by scanning for `$`. It happens to work only because the tail is also `0x24`.

**Source.** R1 https://qdc.queclinksz.com/protocols/gl601$A39To8VF2U/air/v10/html/frames/heartbeat.html · R2 `Gl200FrameDecoder.isBinary`.

**Test.** Feed the 24-byte vendor heartbeat `2B 10 18 …` and assert exactly one frame is produced with the documented field decode. Then feed a synthetic heartbeat whose epoch contains a `0x24` byte and assert the framer still emits exactly one frame.

---

### T26 — `+CAN`, `+DAT`, `+ATI` and `+ACC` are missing from the binary header set, so binary payloads are framed as ASCII

**Symptom.** Guaranteed, unrecoverable stream corruption on any model that emits them. `+DAT` can carry a **JPEG**.

**Cause.** Traccar's `BINARY_HEADERS` has ten entries; four documented HEX categories are not among them, so those frames fall to the ASCII `$`-scanner.

**Source.** R1 GV300CAN V12.00 §4.6-§4.12 documents all of them · R2 `Gl200FrameDecoder.BINARY_HEADERS`.

**Test.** Feed a `+DAT` frame whose payload contains `0x24` bytes and assert the framer consumes exactly `<Length>` bytes and emits one frame. **And for `+ACC` specifically:** since its length constant is INFERRED (Q11), assert the decoder **drops the connection** on `+ACC` rather than guessing — a reconnect costs one buffered flush; a desync costs the socket.

---

### T27 — Protocol Pro Data ID and Data Length are variable-length integers, and reading them as one byte destroys every record after the first ≥0x80 id

**Symptom.** Harsh-braking and crash events — precisely what a fleet-safety product is sold on — silently corrupt the rest of the frame. **The frame still passes CRC-8, so nothing alerts.**

**Cause.** A 1-byte reader takes `0x80` as the ID and then reads `0x8C` = 140 as the Data Length, consumes 140 bytes of unrelated payload, and destroys that record and every record after it. Data ID 140 goes on the wire as `80 8C`; IDs 142-144 and 178-181 are all ≥ 0x80.

**Source.** R1 https://qdc.queclinksz.com/protocols/gl601$A39To8VF2U/air/v10/html/frames/report.html — *"The data ID is represented by 1 or 2 bytes… The highest bit of 1 means that Data ID occupies 2 bytes"*. **No published example exercises the 2-byte branch**: every Data ID and Data Length in the three available Pro fixtures (`0x02, 0x51, 0x55, 0x0B, 0x0F, 0x0E, 0x52, 0x16`) has the high bit clear.

**Test.** Synthesise a Pro frame carrying Data ID 140 (`80 8C`) with a valid recomputed CRC-8 and assert the record parses and the **following** record in the same frame parses too. A 1-byte reader loses both. Also synthesise a record longer than 127 bytes to exercise the 2-byte Record Length.

---

### T28 — HEX MCC and MNC are BCD while LAC and Cell ID are binary, and no vendor table says so

**Symptom.** Cell-fallback positions resolve to the wrong country. MCC bytes `02 68` read as `u16` give 616 — not an allocated MCC — so the lookup either fails or lands somewhere absurd.

**Cause.** The vendor lists all four as "2 bytes, 0000 - FFFF", which is a **width** statement, not an encoding statement. Traccar reads all four with `readUnsignedShort()`.

**Source.** My decode of the real R2 capture in W7: MCC bytes `02 68` with coordinates at lon −9.068207 / lat 39.611009, which is Torres Vedras, **Portugal — MCC 268**.

**Test.** Assert the W7 frame decodes to `mcc = 268`. A binary reader gives 616 and fails.

---

### T29 — The HEX device-type width, the `+EVT` message-id table and the `+RSP` type-3 phone field are all per-model, and every one of them shifts the position block

**Symptom.** A coordinate that is **wrong but plausible** — off by whatever the misalignment happens to be. No exception, no CRC failure (the CRC covers the whole frame regardless of how you interpret it).

**Cause, three ways:**
1. **Device Type width.** GV300CAN V12.00 §4.2/4.3: *"Device Type 1 `4B`"*. GV500CG V3.02 §5.1/5.2: *"Device Type 3 `802009`"*. Traccar hardcodes one byte and mis-parses every GV500CG HEX frame from that field onward. **The width must be keyed off the resolved model, and the only way to resolve the model is the field whose position you are trying to compute.** This is the reason flespi abandoned HEX entirely.
2. **`+EVT` ids.** R1 GV300CAN §4.5: GTRMD = 32, GTJDS = 34, GTUPC = 35, **45/46 Reserved**, GTVGN = 50, GTVGF = 51. R2 constants: JDS = 33, UPC = 34, RMD = 35, **VGN = 45, VGF = 46**. I proved by length arithmetic that Traccar's id 45 with a 7-byte insert is correct for its device-type-`0x45` sample. **Both are right for their own model.** Each of these ids triggers a type-specific insert of 1-7 bytes **before** the coordinates.
3. **`+RSP` type 3 (GTLBC).** Traccar reads a phone-length byte then consumes **BCD nibbles until it sees an `0xF` half-byte sentinel** — a variable-length field with a nibble terminator, the classic place to drift by one byte. GV300CAN §4.3 lists GTLBC as message id 3 but the phone field is not in the shared table, and the GB100 capture `2B5253500300FC1FFF0064…` does not close cleanly under the shared layout.

**Source.** R1 GV300CAN V12.00 §4.2/§4.3/§4.5 · R1 GV500CG V3.02 §5.1/§5.2 · R2 `Gl200BinaryProtocolDecoder` `MSG_EVT_*` constants · R3 flespi's blanket refusal.

**Test.** Length-closure as the oracle: for every HEX fixture, assert the decoder consumes **exactly** `<Length>` bytes and the last two bytes consumed are `0D 0A`. That single assertion catches all three misalignments. Additionally assert that an `+EVT` type not in the resolved model's table produces an undecodable record — **never a position**.

---

### T30 — In the HEX `+CAN` report `<Fuel Level>` occupies ten bytes, not five

**Symptom.** Everything after fuel level in the CAN block is shifted by five bytes: Range, Accelerator Pedal, engine hours, axle weight — all wrong but all plausible.

**Cause.** The ASCII form emits one `L`/`P`-prefixed field; the HEX form emits **two** 5-byte values, litres (4+1) then percentage (4+1). The field table lists them as two separate rows and it is easy to read as one.

**Source.** My byte-for-byte decode of R1's own 165-byte `+CAN` frame `2B43414E21000007BF00A54B…0D0A`: offsets 66-70 `00 00 00 57 28` = **87.40 L** (ASCII showed `L87.40`) and 71-75 `00 00 00 43 14` = **67.20 %**. Only with both consumed do `<Range>` = `0x00000F78` = 3960 and `<Accelerator Pedal Pressure>` = `0x0020` = 32 land on the ASCII example's values.

**Test.** Decode the vendor `+CAN` frame and assert Range = 3960 and Pedal = 32. Consuming five bytes fails both.

---

### T31 — HEX 5-byte time and fuel totals are `u32 integer + u8 two-digit fraction`, not a 40-bit scaled integer

**Symptom.** Total fuel used reported as **2,158,558,776.32 L**.

**Cause.** Reading the five bytes as one big integer ÷ 100.

**Source.** R1 GV350M V3.11 p.328 verbatim: *"5 bytes in total. The first 4 bytes are for the integer part … the last byte is for the fraction part. The fraction part has 2 digits."* Verified: `00 00 00 32 38` = **50.56 L**, matching the paired ASCII example.

**Test.** Assert `00 00 00 32 38` → 50.56.

---

### T32 — A decoder that hits ERI mask bit 2 abandons the rest of the record

**Symptom.** On any device with CAN enabled inside GTERI, the **fuel-sensor, Bluetooth and trailing blocks are lost entirely** — silently.

**Cause.** R2 `decodeEri`: `if (BitUtil.check(mask, 2)) { return positions; // can data not supported }`.

**Source.** R2 `Gl200TextProtocolDecoder.java` line ~1031 · R5 open issue https://github.com/traccar/traccar/issues/5964 (GV56 `4F1206`).

**Test.** A GTERI with ERI mask `00000104` (CAN **and** Bluetooth) asserting **both** the CAN fields and the BLE accessories are decoded, and that the send time and count still land correctly.

---

### T33 — Bluetooth accessory temperature and humidity are plain integers, not 1/16 °C

**Symptom.** A beacon reporting 24 °C shows as **838 °C**.

**Cause.** Applying the 1-Wire ×0.0625 rule to the BLE block. In the real frame the neighbouring values `0x3466` and `0x283F` are a **battery level in mV** and an **append mask** respectively — running the temperature conversion on them yields 838 °C and 644 °C.

**Source.** My decode of `+RESP:GTERI,6E0A03,868589060745174,,00000100,…,2,00,6,5,0E7109BB,283F,SENTEMP1,7805412CF2DD,1,3466,24,36,24.91,100,01,6,2,,083F,SENTEMP2,7805412CF25C,0,,,,,20250307182820,1ABC$` against R1 GV300CAN §3.3.1 `<Bluetooth Accessory Data>`. ERI mask `00000100` = **bit 8, Bluetooth — not bit 1, 1-Wire.**

**Test.** Assert this frame yields accessory 1 temperature = **24 °C** and humidity = **36 %**, and accessory 2 with status 0 and **absent** measurements. Assert the 1-Wire conversion is never applied inside a BLE block.

---

### T34 — iButton data is run through the temperature conversion

**Symptom.** A phantom temperature sensor reporting 26.125 °C that is actually a driver-ID presence code.

**Cause.** Converting unconditionally instead of branching on `<1-wire Device Type>` (1 = temperature, 2 = iButton).

**Source.** R1 GV300CAN V12.00 §3.3.1 vendor examples with device type 2 and data `019E`/`01AC`.

**Test.** Assert type-2 triplets emit an **iButton id**, not a temperature, and that no `temp*` attribute is produced.

---

### T35 — `$` is unescaped and can appear in a payload; so can commas and CRLF

**Symptom.** One unescaped `$` does not lose one record — it **starts a retransmit loop that never converges**, because the tail fragment becomes a syntactically complete "sentence" whose last field is arbitrary payload, you echo it as a count, the device matches it against nothing, resends, and the same `$` recurs.

**Cause.** No escaping in the protocol. `GTDAT`/`GTDTT`/`GTBDR` payloads are free-form: R2's corpus contains one payload that hex-decodes to `Ecuatrack\r\nCOMB,0,94.0,-1.0,,,HDC\r\n` — commas **and** CRLF inside a field.

**Source.** R1 GV500CG p.155 concedes it (*"cannot contain the character \"$\" when the value of `<SACK Mode>` … is 1"*) · R1 GV300CAN p.110 (`<Data>` ≤245 free-form ASCII) · R2 corpus GTDTT frame with `KEY_FUEL == 94.0` asserted from that payload.

**Test.** Feed a GTDAT frame whose payload contains commas and CRLF and assert it decodes with the payload intact and the socket healthy. Then feed one containing `$` and assert the framer produces two records of which the tail is **undecodable and unacked** (rule R-ACK-4), and the connection survives. Provision devices with `<Data Format>` non-raw.

---

### T36 — Protocol Pro multi-packet splitting: it is unknown whether a record or a TLV may straddle a fragment

**Symptom.** If a TLV can straddle, each fragment parses "successfully" on its own — **CRC-8 covers only that frame** — and yields a truncated record with a garbage trailing TLV. **Wrong data that passes every integrity check you have**, which is the worst category.

**Cause.** The vendor states only that reports over 1440 B are auto-split via the multi-packet flag, with `Frame Count` and `Frame Number` in the header. Nothing states whether records may straddle, whether Frame Number is 0- or 1-based, whether each fragment carries its own valid CRC-8 and Count Number, or whether you SACK each fragment or only the last.

**Source.** R1 `frames/report.html`.

**Test / mandatory rule.** Buffer fragments by `(imei, frameCount)` and **refuse to parse any fragment in isolation**. Test: a synthetic 2-fragment report asserting a single reassembled record set, and asserting that fragment 1 alone yields nothing rather than a truncated record.

---

### T37 — The HEX identity heuristic ("all bytes ≤ 0x63 ⇒ IMEI") fabricates IMEIs from numeric device names

**Symptom.** A device named `0123456` is decoded as IMEI **484950515253540**, which matches nothing in `registry:imei`. Positions are dropped or bound to a phantom device. Numeric device names — plate numbers, asset ids — are the **common** case.

**Cause.** The bit-6 rule is correct for `+RSP`/`+EVT` but **false for `+ACK`** (W9 shows both directions under bit 6 set), so implementations fall back to a heuristic. That heuristic is unsound: `0123456` NUL-padded is `30 31 32 33 34 35 36 00` — all bytes ≤ 0x63, last ≤ 9.

**Source.** W9, both frames · R2's `+ACK` frames with masks `0xEF` and `0x7F`.

**Test / mandatory rule.** **Never identify a HEX device by heuristic.** Require the packed-decimal form to yield 15 digits that pass **Luhn** *and* match a device already in the registry; otherwise reject the frame with an `UnidentifiedDevice` record. Test: feed an `+ACK` with identity bytes `30 31 32 33 34 35 36 00` and assert the frame is rejected, not bound to 484950515253540.

---

### T38 — The HEX speed and mileage fraction byte: tenths or hundredths, and every published sample is zero

**Symptom.** Overspeed alerts fire 2.7 km/h early or late on **every** device, and total mileage carries up to 9.9 km of fabricated distance per report.

**Cause.** The vendor states the fraction has 2 digits for 5-byte CAN totals (T31) but says only "integer + fraction" for speed and mileage. Every published sample has fraction `0x00`, so no fixture distinguishes them. A device at 47.3 km/h sends fraction `0x1E` (= 30 hundredths); read as tenths that becomes 47 + 30/10 = **50.0 km/h**.

**Source.** R1 GV300CAN §4.3 field table vs R1 GV350M V3.11 p.328.

**Test / interim rule.** **Truncate to the integer km/h and km** until a non-zero fraction byte is captured — wrong by less than 1 unit under either reading. Test: assert the decoder emits an integer and records the raw fraction byte as an attribute for later reconciliation.

---

### T39 — "The mask is echoed in the report, so a report is self-describing" is false for the one mask that changes the field count

**Symptom.** A decoder written on that assumption has no way to know whether the cell block is present, and shifts by four fields on any device with `<Report Composition Mask>` bit 3 cleared.

**Cause.** `<Report Composition Mask>` lives in `AT+GTCFG` and appears **only** in `+ACK:GTCFG`. It gates Speed, Azimuth, Altitude, the entire cell block, Mileage, Send Time and Device Name.

**Source.** R1 GV300CAN V12.00 p.21.

**Test / open item.** Whether the mask **removes** fields or **blanks** them is Q1 and is a 10-minute bench test. Until it is answered: assert the decoder validates the parsed field count against the expected count for the resolved model and emits an undecodable record on mismatch, rather than indexing blindly. Note that **every real capture in the harvest shows fields present-and-empty, never absent** — `…20171017153221,,,,,,9995.1,00465:53:49,,,87,110000,…` — which is evidence for "blanks", not proof.

---

### T40 — CAN mask bits 4 and 5 are emitted in inverted order, so naive bit iteration swaps RPM and vehicle speed

**Symptom.** **Speed 1705 km/h and RPM 40.** Both are numbers; neither is an error.

**Cause.** Fields are emitted in ascending bit order **except** that `<Engine RPM>` (bit 5) precedes `<Vehicle Speed>` (bit 4).

**Source.** Verified by decoding R1's own GTCAN example (W5, second frame) — every one of the 22 masked fields plus the GNSS and GSM blocks lands exactly, with 1705 rpm / 40 km/h · R2 `decodeCan` reads bit 5 before bit 4, independently confirming it.

**Test.** Decode the vendor GTCAN example and assert `rpm = 1705, speed = 40`. Ascending iteration gives the swap.

---

### T41 — A single unparseable record kills the TCP connection, and with buffering on the device replays it forever

**Symptom.** A device goes permanently dark, or reconnects every few seconds and delivers only its first message. The customer sees one position and then nothing; the tracker looks broken but is healthy. **Because the poison record sits at the head of a 10,000-report buffer, the device can never drain and every position behind it is lost.**

**Cause.** Traccar throws `NumberFormatException` / `ArrayIndexOutOfBounds` / "Unparseable date" out of the decoder and Netty closes the channel. The device reconnects, resends the same buffered record, and the cycle repeats. The trigger is nearly always a per-model field the decoder did not expect.

**Source.** R5 with logs: https://github.com/traccar/traccar/issues/5391 (*"error - For input string: \"20240817120401\""*, *"Index 33 out of bounds for length 31"*, *"[T89e4b37e] disconnected"*, across *"over 2,000 GV200 devices from 7000"*) · #5729 (*"Unparseable date: \"-2.278890\" … disconnected"*, *"Longitude out of range … disconnected"* on CV200) · #5776, #5727, #4173 · R3 flespi names *"causing device disconnections"* as a recurring bug class: 2026-06-02, 2026-05-25 (GV75CG ACK parsing), 2026-06-22 (*"Devices on V2.24 firmware no longer disconnect on these reports"*) · R5 traccar forum GL320M.

**Test.** Feed `[good frame, malformed frame, good frame]` over one socket and assert: both good frames persisted; the malformed one captured as an **undecodable record with its raw bytes**; **the socket stays open**; and the ACK reflects only what was persisted (hard rule 4). Fuzz on top: mutate every field of every corpus frame one at a time and assert the connection survives all of them. **This is exactly the ingest/worker split the project already mandates — a decode failure belongs in the worker's dead-letter path, never on the socket.**

---

### T42 — A GTCAN with no GNSS block is not a parse failure

**Symptom.** Valid vehicle telemetry is discarded as malformed.

**Cause.** `<CAN Report Mask>` bits 30/31 gate the GNSS and GSM blocks. With mask `003FFFFF` the frame **ends at send time + count** with no position at all; with `E07FFFFF` it carries an expansion mask, 21 more fields and a full GNSS block. Same message name, same device family, two completely different lengths, one with no position.

**Source.** R2 corpus contains both: `+RESP:GTCAN,310701,867162025056839,gv300w,0,1,E07FFFFF,…,20181031203002,9F50$` (position present) and `+RESP:GTCAN,310701,863286023712855,,10,0,003FFFFF,,2,H46358,12305.50,601,0,83,,P53.00,,0,2749.15,0.19,2.80,,,,40,,0,,,20181110103016,2945$` (no position). Traccar uses `verifyPosition` on the first and `verifyAttributes` on the second.

**Test.** Assert the second frame yields a **zero-position, attributes-only record** and is acked normally.

---

### T43 — The same physical moment arrives as two or three different message types

**Symptom.** Duplicate ignition events, duplicate trips, or — if you suppress the wrong one — **no ignition events at all**.

**Cause.** `GTIGL`/`GTVGL` are *location* reports that echo an ignition change `GTIGN`/`GTIGF` already reported as an *event*. `GTERI` is documented to be sent **instead of** `GTFRI` when enabled, but operators enable both.

**Source.** R5 https://github.com/traccar/traccar/issues/4776 — a GV50M user observed IGN and IGL arriving back to back on every ignition change, and turning IGL off left him with **no ignition events at all** because the server only derived ignition from IGL.

**Test.** Feed an `IGN` + `IGL` pair 1 s apart and assert the trip engine records **one** ignition transition. Feed `FRI` and `ERI` for the same fix and assert one position.

---

### T44 — Some model families document `<GNSS Accuracy>` as literally `0` for GTIGN/GTIGF

**Symptom.** On those models, **every** trip start and end coordinate is stale by whatever the vehicle moved while unfixed.

**Cause.** GV300CAN and GV500CG both give the field Range/Format `0` for these two messages, and the vendor examples show 0; GV350M V4.03 annotates it *"0, Last known"*. Real GV310LAU captures (`6E0202`) show `1`.

**Source.** R1 GV350M V4.03 pp.251/253 · R2 corpus GV310LAU frames.

**Test.** Per-model fixture asserting that a GTIGF with accuracy 0 does **not** set the trip start coordinate, and that the trip engine falls back to the nearest preceding valid fix.

---

### T45 — A HEX heartbeat can be completely anonymous

**Symptom.** A long-connection device that heartbeats but never reports looks **dead**, because the heartbeat carries no identity and the server drops it.

**Cause.** R1 §4.9: *"If the mask of `<UID>` in the `<+HBD Mask>` is set to 0, the heartbeat message reported will not include device name or IMEI information."*

**Test.** Feed a `+HBD` with the UID mask bit clear on a connection already bound to a device and assert the heartbeat is attributed to that device and answered. Feed the same frame on an unbound connection and assert an explicit `UnidentifiedHeartbeat` record, not a silent drop.

---

### T46 — On the GT300/GL100 dialect the last CSV field is the protocol version, not the count

**Symptom.** The ack echoes a 10-character version string, the device rejects it, and resends forever.

**Cause.** `+SACK:` + `values[values.length - 1]` assumes Send Time is second-to-last. On the 2011 GT300 dialect the tail is `…,<count>,<ver>` with **no `$`**.

**Source.** R1 GT300 V4.02 §4.3 (W14) · R2 `Gl200TextProtocolDecoder` final lines of `decode()`.

**Test.** Assert that for a GT300-dialect frame the ack echoes `11F0`, not `0102070202`, and that for the 2017 GT-series capture (version third-from-last, `$`-terminated) it echoes `3E7D`. Branch on the terminator, and never ack a last field that is not exactly 4 hex characters (rule R-ACK-5).

---

## 8. Test vectors

**69 cases across five fixture files**, shaped to match `packages/codec/__fixtures__/wiki/codec8.hex.json`. ASCII frames use a `raw` field instead of `hex`. Each case carries `redact` naming the fields `tools/redact` must scrub before commit, and `confidence` mirroring the labels in section 0.

`"assert": "source"` means the cited implementation asserts that exact value in its own test suite (an oracle). `"assert": "mine"` means the decode is mine and re-checkable from the bytes.

> **Licence rules for these files.** Vendor-example frames (`provenance: "R1"`) are quoted facts about the protocol — transcribe them, never vendor the PDF. Traccar frames are Apache-2.0 — attribute in the file header. **Do not copy anything from `404minds/avl-receiver` (AGPL-3.0); its assertions are cited here as an oracle only.** `queclink-parser` is MIT and safe to reuse with attribution.

### 8.1 `queclink-ascii.vendor.json` — cases 1-13

```json
{
  "source_url": "https://easynt.com/wp-content/uploads/2024/10/GV300CAN-@Track-Air-Interface-Protocol-V12.00.pdf",
  "also_from": [
    "https://www.traccar.org/protocol/5004-gl200/GT300%20@Track%20Air%20Interface%20Protocol%20V4.02.pdf",
    "GV350M Series @Track Air Interface Protocol V3.11 / V4.03 (vendor PDF, not redistributable)"
  ],
  "retrieved_at": "2026-09-10",
  "attribution": "Frames are verbatim worked examples printed in Queclink @Track Air Interface Protocol documents alongside their own field tables. The PDFs are NOT redistributable - cite the section, never vendor the file. Expected values are the vendor's own stated numbers where printed, otherwise my decode from the printed field table.",
  "cases": [
    {
      "name": "01-gtfri-single-vendor",
      "direction": "device->server",
      "provenance": "R1 GV300CAN V12.00 3.3.1",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+RESP:GTFRI,4B0303,867995030082104,,,10,1,1,0.0,0,47.3,117.129238,31.838810,20190416081145,0460,0000,550B,B969,00,0.0,,,,0,210100,,,,20190416081146,0856$",
      "expect": {
        "kind": "ascii", "type": "GTFRI", "buffered": false,
        "model": "GV300CAN", "protocolVersion": "4B0303", "imei": "867995030082104",
        "reportId": 1, "reportType": 0, "positionCount": 1,
        "records": [{
          "fixValid": true, "hdop": 1, "speedKmh": 0.0, "azimuth": 0, "altitudeM": 47.3,
          "lon": 117.129238, "lat": 31.838810, "tsMs": 1555402305000,
          "mcc": 460, "mnc": 0, "lac": "550B", "cid": "B969"
        }],
        "mileageKm": 0.0, "backupBatteryPct": 0,
        "deviceStatus": { "raw": "210100", "motion": "ignitionOnRest", "ignition": true, "moving": false },
        "sendTimeLocal": "20190416081146", "count": "0856", "ack": "+SACK:0856$"
      }
    },
    {
      "name": "02-gtfri-two-positions-vendor",
      "direction": "device->server",
      "provenance": "R1 GV300CAN V12.00 3.3.1",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+RESP:GTFRI,4B0303,867995030082104,,,10,2,1,0.0,0,47.3,117.129238,31.838810,20190416081255,0460,0000,550B,B969,00,1,0.0,0,47.3,117.129238,31.838810,20190416081310,0460,0000,550B,B969,00,0.0,,,,0,210100,,,,20190416081311,085F$",
      "expect": {
        "kind": "ascii", "type": "GTFRI", "positionCount": 2,
        "records": [
          { "fixValid": true, "hdop": 1, "tsMs": 1555402375000, "lon": 117.129238, "lat": 31.838810 },
          { "fixValid": true, "hdop": 1, "tsMs": 1555402390000, "lon": 117.129238, "lat": 31.838810 }
        ],
        "tailAttachesTo": "lastRecordOnly",
        "mileageKm": 0.0, "backupBatteryPct": 0, "count": "085F"
      }
    },
    {
      "name": "03-gtfri-buffered-vendor",
      "direction": "device->server",
      "provenance": "R1 GV300CAN V12.00 3.3.6",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+BUFF:GTFRI,4B0303,867995030082104,,,10,1,1,0.0,0,47.3,117.129238,31.838810,20190416081145,0460,0000,550B,B969,00,0.0,,,,0,210100,,,,20190416081146,0856$",
      "expect": {
        "kind": "ascii", "type": "GTFRI", "buffered": true,
        "note": "byte-identical to case 01 except the five header characters; send time and count are the ORIGINAL values",
        "count": "0856", "ack": "+SACK:0856$",
        "dedupeKey": ["imei", "GTFRI", "0856", "20190416081146"]
      }
    },
    {
      "name": "04-gtigf-vendor-inverted-tail",
      "direction": "device->server",
      "provenance": "R1 GV300CAN V12.00 p.275",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+RESP:GTIGF,4B0305,867995030082104,gv300can,170791,0,0.0,352,81.2,117.129386,31.839294,20190422030853,0460,0000,550B,B969,00,,0.0,20190422030854,8536$",
      "expect": {
        "kind": "ascii", "type": "GTIGF",
        "durationOfIgnitionOnS": 170791,
        "records": [{ "fixValid": false, "hdop": 0, "staleLastKnown": true, "lon": 117.129386, "lat": 31.839294 }],
        "hourMeter": null, "mileageKm": 0.0,
        "tailOrder": ["hourMeter", "mileage"],
        "count": "8536"
      }
    },
    {
      "name": "05-gteri-1wire-ibutton-vendor",
      "direction": "device->server",
      "provenance": "R1 GV300CAN V12.00 3.3.1",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+RESP:GTERI,4B0306,867995030009362,,00000002,,10,1,1,0.0,0,40.4,117.129326,31.839245,20190522064541,0460,0000,550B,B969,00,0.0,,,65,210100,,2,3C00000340FD1128,2,019E,FD0000034129ED28,2,01AC,20190522064542,0541$",
      "expect": {
        "kind": "ascii", "type": "GTERI", "eriMask": "00000002", "eriBits": ["oneWire"],
        "oneWire": [
          { "id": "3C00000340FD1128", "deviceType": 2, "kind": "ibutton", "data": "019E", "temperatureC": null },
          { "id": "FD0000034129ED28", "deviceType": 2, "kind": "ibutton", "data": "01AC", "temperatureC": null }
        ],
        "note": "TRAP T34 - running x0.0625 on these yields 25.875 and 26.75 C for a presence code",
        "backupBatteryPct": 65, "count": "0541"
      }
    },
    {
      "name": "06-gteri-seven-1wire-sensors-vendor",
      "direction": "device->server",
      "provenance": "R1 GV350M V3.11 3.3.1",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+RESP:GTERI,F10310,868446036599153,gv350m,00000002,11636,10,1,2,0.0,0,247.8,114.015482,22.537480,20190826034720,0460,0001,253D,AEC3,,0.0,,,100,110000,,7,2880219F0A0000D0,1,01AD,28BAFC7D08000041,1,01AF,2866EE9E0A000089,1,01B2,28D64BC50800006C,1,01AE,2809769D0A00006F,1,01AC,28E3597E08000090,1,01AD,28CBCA7D080000F6,1,01AF,20190826114719,15BF$",
      "expect": {
        "kind": "ascii", "type": "GTERI", "model": "GV350M",
        "externalPowerMv": 11636, "hdop": 2, "fixValid": true,
        "gnssTriggerSlot": "",
        "oneWireCount": 7,
        "temperaturesC": [26.8125, 26.9375, 27.125, 26.875, 26.75, 26.8125, 26.9375],
        "note": "21 extra CSV fields; parse from BOTH ends",
        "count": "15BF"
      }
    }
  ]
}
```

`queclink-ascii.vendor.json`, `cases` continued — 7-13:

```json
[
    {
      "name": "07-gtcan-full-mask-vendor",
      "direction": "device->server",
      "provenance": "R1 GV350M V3.11 3.3 +RESP:GTCAN",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei", "vin"],
      "raw": "+RESP:GTCAN,F10310,868446036599153,gv350m,0,1,FFFFFFFF,LFV82A1BS36355376,2,H20460,1040.50,528,25,98,L/H51.2,,,66,154.30,150.80,281.90,2517.00,6684,,,1,,,,0,,,1,0.0,0,118.9,114.015458,22.537211,20190823021704,0460,0001,253D,AEC3,,20190823101706,0FB1$",
      "expect": {
        "kind": "ascii", "type": "GTCAN", "canReportMask": "FFFFFFFF",
        "vin": "LFV82A1BS36355376", "ignitionKey": 2, "ignitionKeyMeaning": "engineOn",
        "totalDistance": { "raw": "H20460", "unit": "hectometre", "km": 2046.0 },
        "totalFuelUsedL": 1040.50, "engineRpm": 528, "vehicleSpeedKmh": 25, "coolantC": 98,
        "fuelConsumption": { "raw": "L/H51.2", "unit": "L/h", "value": 51.2 },
        "acceleratorPedalPct": 66,
        "totalEngineHoursH": 154.30, "totalDrivingTimeH": 150.80, "totalEngineIdleTimeH": 281.90,
        "totalIdleFuelUsedL": 2517.00, "axleWeightKg": 6684, "lights": "1",
        "gnss": { "speedKmh": 0.0, "altitudeM": 118.9, "lon": 114.015458, "lat": 22.537211 },
        "count": "0FB1"
      }
    },
    {
      "name": "08-gtcan-c03fffff-rpm-speed-oracle",
      "direction": "device->server",
      "provenance": "R1 GV300CAN V12.00 3.3.8",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+RESP:GTCAN,4B0305,867995030082104,gv300can,00,1,C03FFFFF,,2,I6782,50.56,1705,40,55,,L87.40,3960,32,860.64,755.43,105.21,7436.00,4365,BF,FFFF,3F,3F,6.38,21.61,0,0.0,0,1.4,117.1299493,31.839403,20190418055225,0460,0000,550B,B969,00,20190418055227,0DC0$",
      "expect": {
        "kind": "ascii", "type": "GTCAN", "canReportMask": "C03FFFFF",
        "engineRpm": 1705, "vehicleSpeedKmh": 40,
        "note": "TRAP T40 - ascending bit iteration yields speed 1705 km/h and rpm 40",
        "totalDistance": { "raw": "I6782", "unit": "impulses", "km": null, "warn": "impulses are NOT a distance" },
        "totalFuelUsedL": 50.56, "coolantC": 55,
        "fuelLevel": { "raw": "L87.40", "unit": "litre", "value": 87.40 },
        "rangeHectometres": 3960, "acceleratorPedalPct": 32,
        "count": "0DC0"
      }
    },
    {
      "name": "09-ack-gthbd-vendor",
      "direction": "device->server",
      "provenance": "R1 GV300CAN V12.00 3.4",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+ACK:GTHBD,4B0305,867995030009362,gv300can,20190423070213,0517$",
      "expect": {
        "kind": "ascii", "type": "GTHBD", "class": "heartbeat", "position": null,
        "mustReply": "+SACK:GTHBD,4B0305,0517$",
        "replyIsMandatory": true, "replyCountMustBeExactly": "0517", "replyCount": 1
      }
    },
    {
      "name": "10-sack-gthbd-with-version",
      "direction": "server->device",
      "provenance": "R1 GV300CAN V12.00 3.4",
      "confidence": "VERIFIED",
      "assert": "source",
      "redact": [],
      "raw": "+SACK:GTHBD,4B0303,11F0$",
      "expect": { "kind": "serverAck", "protocolVersion": "4B0303", "count": "11F0" }
    },
    {
      "name": "11-sack-gthbd-empty-version",
      "direction": "server->device",
      "provenance": "R1 GV300CAN V12.00 3.4 - the version field is documented optional",
      "confidence": "VERIFIED",
      "assert": "source",
      "redact": [],
      "raw": "+SACK:GTHBD,,11F0$",
      "expect": { "kind": "serverAck", "protocolVersion": "", "count": "11F0", "legal": true }
    },
    {
      "name": "12-sack-generic",
      "direction": "server->device",
      "provenance": "R1 GV300CAN V12.00 3.5",
      "confidence": "VERIFIED",
      "assert": "source",
      "redact": [],
      "raw": "+SACK:11F0$",
      "expect": {
        "kind": "serverAck", "count": "11F0", "bytes": 11,
        "echoRule": "byte-for-byte; never upper-case, never re-pad, never strip leading zeros",
        "cases": [
          { "in": "FFFF", "out": "+SACK:FFFF$" },
          { "in": "11f0", "out": "+SACK:11f0$" },
          { "in": "085F", "out": "+SACK:085F$" }
        ]
      }
    },
    {
      "name": "13-gt300-dialect-nul-terminated",
      "direction": "device->server",
      "provenance": "R1 GT300 V4.02 4.3",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": [],
      "raw_encoding": "the frame ends with a literal 0x00 byte, NOT a dollar sign - encode it as \\u0000 in the fixture; shown below with the terminator removed",
      "raw_without_terminator": "+RESP:GTTRI,135790246811220,1,0,0,1,4.3,92,70.0,1,121.354335,31.222073,20090101000000,0460,0000,18d8,6141,00,11F0,0102070202",
      "expect": {
        "kind": "ascii", "dialect": "gt300", "terminator": "0x00",
        "field1": "imei", "imei": "135790246811220",
        "countPosition": "secondToLast", "count": "11F0",
        "versionPosition": "last", "version": "0102070202",
        "ack": "+SACK:11F0$",
        "note": "TRAP T46 - acking values[last] sends the version string",
        "imeiIsSynthetic": true, "luhnValid": false
      }
    }
]
```

### 8.2 `queclink-ascii.traccar.json` — cases 14-44

```json
{
  "source_url": "https://github.com/traccar/traccar/blob/master/src/test/java/org/traccar/protocol/Gl200TextProtocolDecoderTest.java",
  "retrieved_at": "2026-09-10",
  "licence": "Apache-2.0 - reusable with attribution",
  "attribution": "Frames from the Traccar project's Gl200TextProtocolDecoderTest (Apache-2.0). CAVEAT: Traccar's verifyPosition/verifyPositions assert plausibility (lat/lon in range, non-null), NOT expected values - they prove 'does not throw'. Only cases marked assert:source carry a real upstream assertion. All other expected values are my decode against the rank-1 field tables.",
  "cases": [
    { "name": "14-gtfri-cv100lg-accuracy-zero", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTFRI,DF0200,868487004353181,cv100,14051,10,1,0,0.0,0,264.1,114.015515,22.537178,20210608064328,0460,0001,25F8,061A7D02,,0.0,,,,100,21,,,,20210608144354,32DB$",
      "expect": { "type": "GTFRI", "model": "CV100LG", "externalPowerMv": 14051, "reportId": 1, "reportType": 0,
        "records": [{ "fixValid": false, "hdop": 0, "staleLastKnown": true, "lon": 114.015515, "lat": 22.537178, "tsMs": 1623134608000, "mcc": 460, "mnc": 1, "lac": "25F8", "cid": "061A7D02", "cidWidth": 8 }],
        "backupBatteryPct": 100, "deviceStatus": { "raw": "21" }, "count": "32DB",
        "note": "10-hour gap between fixTime and sendTime; Traccar stores this as valid=true" } },
    { "name": "15-gtrtl-cv100lg", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTRTL,DF0200,868487004353181,cv100,,00,1,0,0.0,0,102.2,114.015295,22.537250,20210608063942,0460,0001,25F8,061A7D02,,0.0,20210608143939,32CF$",
      "expect": { "type": "GTRTL", "layoutFamily": "P1", "records": [{ "fixValid": false, "hdop": 0 }], "mileageKm": 0.0, "count": "32CF",
        "note": "no externalPower field in the P1 family - GTRTL and GTFRI have different field counts on the same device" } },
    { "name": "16-gtigf-invalid-fix-half", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTIGF,270302,867162025085234,,3519,0,0.0,92,111.2,-116.867638,32.450321,20180327070835,0334,0020,2B24,52CC3DE,00,,243.1,20180327070837,2A98$",
      "expect": { "type": "GTIGF", "model": "GV300W", "durationOfIgnitionOnS": 3519, "records": [{ "fixValid": false, "hdop": 0, "lon": -116.867638, "lat": 32.450321 }], "mileageKm": 243.1, "count": "2A98" } },
    { "name": "17-gtigl-valid-fix-half", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTIGL,270302,867162025085234,,,01,1,1,0.0,92,111.2,-116.867638,32.450321,20180327070838,0334,0020,2B24,52CC3DE,00,243.1,20180327070839,2A9A$",
      "expect": { "type": "GTIGL", "reportId": 0, "reportType": 1, "records": [{ "fixValid": true, "hdop": 1, "lon": -116.867638, "lat": 32.450321 }],
        "pairsWith": "16", "oracle": "identical coordinates, one stale one real - the invalid-fix oracle for @Track" } },
    { "name": "18-gtigf-gv310lau-ignition-false", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+RESP:GTIGF,6E0202,868589060169789,ra79,145,1,0.0,83,532.2,-70.616413,-33.393457,20240610201937,0730,0001,333A,00CFA301,01,12,,0.0,20240610201938,3AE9$",
      "expect": { "type": "GTIGF", "model": "GV310LAU", "ignition": false, "sourceAsserts": "Position.KEY_IGNITION == false",
        "durationOfIgnitionOnS": 145, "records": [{ "fixValid": true, "hdop": 1, "lon": -70.616413, "lat": -33.393457, "mcc": 730, "mnc": 1 }],
        "positionAppendMask": "01", "satellitesInUse": 12,
        "note": "TRAP T3 - on GV300CAN the same slot is documented Reserved 00 or GNSS Trigger Type" } },
    { "name": "19-gtign-buffered-gv310lau-ignition-true", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+BUFF:GTIGN,6E0202,868589060169789,ra79,379,1,0.0,105,532.2,-70.616413,-33.393457,20240610201712,0730,0001,333A,00CFA301,01,11,,0.0,20240610201713,3AE2$",
      "expect": { "type": "GTIGN", "buffered": true, "ignition": true, "sourceAsserts": "Position.KEY_IGNITION == true",
        "durationOfIgnitionOffS": 379, "satellitesInUse": 11, "count": "3AE2",
        "dedupeKey": ["imei", "GTIGN", "3AE2", "20240610201713"] } },
    { "name": "20-gteri-temp-positive", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+RESP:GTERI,271002,863457051562823,,00000002,,10,1,1,0.0,15,28.2,-58.695253,-34.625413,20230119193305,0722,0007,1168,16B3BB,00,0.0,,,,99,210100,2,1,28F8A149F69A3C25,1,0190,20230119193314,07C7$",
      "expect": { "type": "GTERI", "eriMask": "00000002", "sourceAsserts": "PREFIX_TEMP+1 == 25.0",
        "oneWire": [{ "id": "28F8A149F69A3C25", "deviceType": 1, "kind": "temperature", "raw": "0190", "temperatureC": 25.0 }],
        "arithmetic": "0x0190 = 400; 400 * 0.0625 = 25.0" } },
    { "name": "21-gteri-temp-negative", "direction": "device->server", "confidence": "VERIFIED", "assert": "source (R4 404minds, AGPL - oracle only, do not copy)", "redact": ["imei"],
      "raw": "+RESP:GTERI,040A00,862894022579562,gv200,00000002,,10,1,1,96.1,180,749.7,39.222692,24.165463,20210225065756,0420,0004,759C,3360,00,15529.8,,,2789,,01,00,2,2,282BD47A0B000063,1,FFE2,281FDD5D0B000057,1,FFC8,20210225065800,6974$",
      "expect": { "type": "GTERI", "model": "GV200", "sourceAsserts": "temperature -1.875, odometer 15529",
        "oneWire": [ { "raw": "FFE2", "temperatureC": -1.875 }, { "raw": "FFC8", "temperatureC": -3.5 } ],
        "mileageKm": 15529.8, "analogMv": 2789, "digitalIn": "01", "digitalOut": "00",
        "note": "THE SIGN ORACLE - an unsigned parse gives 4094.125 C" } },
    { "name": "22-gteri-fuel-hex-153", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+BUFF:GTERI,410502,864802030794634,,00000001,,10,1,1,0.0,0,3027.8,-78.706612,-0.955699,20230418170736,0740,0002,A08C,2AB72D,00,0.0,,,,100,110000,1,0099,20230418171004,8B98$",
      "expect": { "type": "GTERI", "buffered": true, "eriMask": "00000001", "sourceAsserts": "KEY_FUEL == 153", "fuelRaw": "0099", "fuelRadix": 16, "fuel": 153 } },
    { "name": "23-gteri-fuel-hex-479", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+RESP:GTERI,F10415,862599050680717,GV350M,00000001,,50,1,1,0.0,274,2963.1,-78.691767,-0.951295,20250512214226,,,,,,0.0,,,100,210100,,1,1,1,01DF,20250512214226,009D$",
      "expect": { "type": "GTERI", "model": "GV350M", "sourceAsserts": "KEY_FUEL == 479", "fuelRaw": "01DF", "fuel": 479,
        "note": "GV350M marks ERI bit 0 reserved yet emits the block - trap T8; cell block entirely empty" } },
    { "name": "24-gteri-bluetooth-accessories", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTERI,6E0A03,868589060745174,,00000100,,10,1,1,0.0,0,1509.0,-90.544928,14.584461,20250307182819,0704,0001,13A7,000B60AB,01,12,358.6,,,,,100,1A0000,0,2,00,6,5,0E7109BB,283F,SENTEMP1,7805412CF2DD,1,3466,24,36,24.91,100,01,6,2,,083F,SENTEMP2,7805412CF25C,0,,,,,20250307182820,1ABC$",
      "expect": { "type": "GTERI", "eriMask": "00000100", "eriBits": ["bluetooth"],
        "deviceStatus": { "raw": "1A0000", "motion": "fakeTow" }, "satellitesInUse": 12, "mileageKm": 358.6,
        "accessories": [
          { "index": 0, "type": 6, "typeName": "beaconMultiFunctionalSensor", "model": 5, "raw": "0E7109BB", "appendMask": "283F", "name": "SENTEMP1", "mac": "7805412CF2DD", "status": 1, "batteryMv": 3466, "temperatureC": 24, "humidityPct": 36 },
          { "index": 1, "type": 6, "model": 2, "appendMask": "083F", "name": "SENTEMP2", "mac": "7805412CF25C", "status": 0, "temperatureC": null, "humidityPct": null }
        ],
        "note": "TRAP T33 - 0x3466 and 0x283F are NOT temperatures; x0.0625 gives 838 C and 644 C" } },
    { "name": "25-gteri-with-embedded-can", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTERI,310701,863286023712855,,00000004,28378,10,1,1,0.0,294,358.4,14.271475,50.110771,20181111185001,0230,0003,94D4,3B30,00,14.5,,,,110000,2,0,C03FFFFF,,0,H46400,12310.70,0,0,83,,,,0,,0.53,3.43,,,,40,,0,,,20181111185252,2DFF",
      "expect": { "type": "GTERI", "model": "GV65", "eriMask": "00000004", "eriBits": ["canData"], "externalPowerMv": 28378,
        "can": { "canbusDeviceState": 0, "canReportMask": "C03FFFFF", "vin": "", "ignitionKey": 0,
          "totalDistance": { "raw": "H46400", "unit": "hectometre", "km": 4640.0 },
          "totalFuelUsedL": 12310.70, "engineRpm": 0, "vehicleSpeedKmh": 0, "coolantC": 83,
          "totalEngineHoursH": 0.53, "totalDrivingTimeH": 3.43, "axleWeightKg": 40 },
        "terminator": "none", "note": "NO trailing dollar sign - the framer must not require it" } },
    { "name": "26-gtcan-adblue-gv355ceu", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei", "vin", "driverCard"],
      "raw": "+BUFF:GTCAN,8020050402,867488060267845,,00,1,E00FFFFF,YS2K4X20001928588,1,H149381,4236.08,0,0,58,,P94.80,,0,529.00,0.03,0.33,0.77,8688,0008,0042,00,00,001FFFFF,P100.00,5571,,,0,0,,,20,7,0,0.36,0.00,0.00,0,E E05653940B000003,,C*********,,4054MTX,0000,,,1,0.0,101,698.5,-3.647673,40.481997,20241213113715,0214,0003,04D2,B801,00,20241213113715,1A47$",
      "expect": { "type": "GTCAN", "buffered": true, "model": "GV355CEU", "protocolVersionLength": 10,
        "sourceAsserts": "adBlueLevel == 100.0",
        "canReportMask": "E00FFFFF", "canReportExpansionMask": "001FFFFF",
        "vin": "YS2K4X20001928588", "ignitionKey": 1,
        "totalDistance": { "raw": "H149381", "unit": "hectometre", "km": 14938.1 },
        "totalFuelUsedL": 4236.08, "coolantC": 58,
        "fuelLevel": { "raw": "P94.80", "unit": "percent", "value": 94.80 },
        "adBlue": { "raw": "P100.00", "unit": "UNKNOWN", "value": 100.0, "emit": false, "reason": "trap T9 / open question Q5" },
        "axleWeight1stKg": 5571, "driverId": "E E05653940B000003",
        "note": "driverId contains a SPACE inside a field - do not trim-and-split naively" } },
    { "name": "27-gtcan-no-gnss-block", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTCAN,310701,863286023712855,,10,0,003FFFFF,,2,H46358,12305.50,601,0,83,,P53.00,,0,2749.15,0.19,2.80,,,,40,,0,,,20181110103016,2945$",
      "expect": { "type": "GTCAN", "canReportMask": "003FFFFF", "hasGnssBlock": false, "positionCount": 0,
        "kindForPipeline": "attributesOnly", "mustNotBe": "parseFailure",
        "distanceType": 1, "reportType": 0, "engineRpm": 601, "coolantC": 83,
        "fuelLevel": { "raw": "P53.00", "unit": "percent", "value": 53.0 } } },
    { "name": "28-gthbm-cornering", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+RESP:GTHBM,BD0214,869409069481243,cv100,,12,1,1,5.6,344,274.7,-1.601826,6.666228,20250114094616,0620,0001,3EE8,00016E04,,,20250114094616,20250114094616,2862$",
      "expect": { "type": "GTHBM", "sourceAsserts": "ALARM_CORNERING", "reportIdRaw": "12", "reportId": 1, "reportType": 2,
        "speedBand": "low", "behaviour": "cornering", "records": [{ "fixValid": true, "hdop": 1, "speedKmh": 5.6 }] } },
    { "name": "29-gthbm-braking", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": [],
      "raw": "+RESP:GTHBM,4B0101,135790246811220,,,10,1,1,4.3,92,70.0,121.354335,31.222073,20090214013254,0460,0000,18d8,6141,00,2000.0,20090214093254,11F0$",
      "expect": { "type": "GTHBM", "sourceAsserts": "ALARM_BRAKING", "reportIdRaw": "10", "reportId": 1, "reportType": 0, "behaviour": "braking",
        "lac": "18d8", "lacCaseInsensitive": true, "mileageKm": 2000.0, "imeiIsSynthetic": true, "luhnValid": false,
        "note": "decimal parsing of 10 gives 0b1010 - Traccar derives motion=false, charge=true (trap T19)" } },
    { "name": "30-gtsos", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+RESP:GTSOS,DF0200,868487004358800,cv100,,00,1,1,0.0,0,138.0,114.015465,22.537372,20210714115224,0460,0001,25F8,061A7D02,,,20210714195224,20210714195224,03A6$",
      "expect": { "type": "GTSOS", "sourceAsserts": "KEY_ALARM == ALARM_SOS", "records": [{ "fixValid": true, "hdop": 1 }],
        "trailingTimestamps": 2, "sendTimeOffsetFromFixHours": 8,
        "note": "send time is device LOCAL on this firmware - never use it as a position timestamp" } }
  ]
}
```

`queclink-ascii.traccar.json`, `cases` continued — 31-44:

```json
[
    { "name": "31-gtfri-four-positions", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTFRI,1A0900,860599000306845,G3-313,0,0,4,1,2.1,0,426.7,8.611466,47.681639,20181214134603,0228,0001,077F,4812,25.2,1,5.7,34,437.3,8.611600,47.681846,20181214134619,0228,0001,077F,4812,25.2,1,4.4,62,438.2,8.611893,47.681983,20181214134633,0228,0001,077F,4812,25.2,1,4.8,78,436.6,8.612236,47.682040,20181214134648,0228,0001,077F,4812,25.2,83,20181214134702,0654$",
      "expect": { "type": "GTFRI", "model": "GL300", "positionCount": 4,
        "records": [
          { "tsMs": 1544795163000, "lon": 8.611466, "lat": 47.681639, "fixValid": true },
          { "tsMs": 1544795179000, "lon": 8.611600, "lat": 47.681846, "fixValid": true },
          { "tsMs": 1544795193000, "lon": 8.611893, "lat": 47.681983, "fixValid": true },
          { "tsMs": 1544795208000, "lon": 8.612236, "lat": 47.682040, "fixValid": true }
        ],
        "batteryPct": 83, "count": "0654",
        "appendSlotValue": "25.2", "appendSlotMeaning": "per-position odometer on GL300-class firmware (R4 qtripp) - a THIRD meaning for that offset",
        "mustProduce": 4 } },
    { "name": "32-gtfri-empty-position-block", "direction": "device->server", "confidence": "VERIFIED", "assert": "source (negative)", "redact": ["imei"],
      "raw": "+BUFF:GTFRI,2E0503,861106050005423,,,0,1,,,,,,,,,,,,0,0,,98,1,0,,,20200101000001,0083$",
      "expect": { "type": "GTFRI", "buffered": true, "positionCount": 1,
        "records": [{ "fixValid": false, "lon": null, "lat": null, "tsMs": null, "cell": null }],
        "mustNotCreatePositionRow": true,
        "clockUnsynced": true, "rtcDefault": "2020-01-01",
        "sourceAsserts": "verifyPositions(decoder, FALSE, ...) - Traccar's own test author disables location checking on this frame" } },
    { "name": "33-gtfri-cell-only-no-gnss", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTFRI,120113,555564055560555,,1,1,1,,,,,,,,0282,0380,f080,cabf,6900,79,20140824165629,0001$",
      "expect": { "type": "GTFRI", "records": [{ "fixValid": false, "lon": null, "lat": null }], "cellOnly": true, "mustNotCreatePositionRow": true } },
    { "name": "34-gtfri-truncated-no-count", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTFRI,5E0100,862061048023666,,,12940,10,1,1,0.0,97,179.8,-90.366478,38.735379,20230616183231,0310,0410,6709,03ADF710,00,6223.7,,,,,110000,,,,202306161834$",
      "expect": { "type": "GTFRI", "model": "GV500MAP", "externalPowerMv": 12940,
        "records": [{ "fixValid": true, "hdop": 1, "lon": -90.366478, "lat": 38.735379, "mcc": 310, "mnc": 410 }],
        "mileageKm": 6223.7, "sendTimeRaw": "202306161834", "sendTimeChars": 12, "countPresent": false,
        "ackDecision": "DO NOT ACK - rule R-ACK-5; never send a SACK with an empty count" } },
    { "name": "35-gtinf-power2", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei", "iccid"],
      "raw": "+RESP:GTINF,C20113,869653060997976,,1A,89464278206103756482,19,0,11,12295,13985,4.25,0,0,,,20241104220934,0,0,,00,00,,,20241104162009,06D6$",
      "expect": { "type": "GTINF", "model": "GV600M", "sourceAsserts": "power2 == 13.985",
        "state": "1A", "iccid": "89464278206103756482", "csqRssi": 19, "csqBer": 0,
        "mainPowerV": 12.295, "backupPowerV": 13.985, "batteryV": 4.25,
        "lastFixUtc": "20241104220934", "sendTimeLocal": "20241104162009",
        "note": "send time is EARLIER than last fix - UTC-6 local clock" } },
    { "name": "36-gtinf-with-timezone-field", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei", "iccid"],
      "raw": "+RESP:GTINF,6E0202,868589060187625,RA82,11,89883030000091225018,41,0,1,12349,,4.15,0,1,0,0,20240328231013,0,0,0,0,00,00,+0000,0,20240328231015,7D4F",
      "expect": { "type": "GTINF", "sourceAsserts": "power == 12.349, adc3 == 0", "timeZoneOffset": "+0000", "terminator": "none" } },
    { "name": "37-gtwif", "direction": "device->server", "confidence": "INFERRED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTWIF,210102,354524044608058,,4,c413e200ff14,-39,,,,c413e2010e55,-39,,,,c8d3ff04a837,-43,,,,42490f997c6d,-57,,,,,,,,100,20170201020055,0001$",
      "expect": { "type": "GTWIF", "apCount": 4, "hasGnss": false, "classify": "presence/diagnostic",
        "aps": [ { "mac": "c413e200ff14", "rssiDbm": -39 }, { "mac": "c413e2010e55", "rssiDbm": -39 }, { "mac": "c8d3ff04a837", "rssiDbm": -43 }, { "mac": "42490f997c6d", "rssiDbm": -57 } ],
        "batteryPct": 100, "mustNotAffect": ["tripDistance", "geofence"] } },
    { "name": "38-gtgsm", "direction": "device->server", "confidence": "INFERRED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTGSM,400201,862365030025161,STR,0234,0015,003a,62a2,16,,0234,0015,003a,56a2,14,,0234,0015,003a,062a,13,,0234,0015,003a,32d9,11,,0234,0015,003a,56a0,11,,,,,,,,0234,0015,003a,7489,17,,20170219200048,0033$",
      "expect": { "type": "GTGSM", "triggerTag": "STR", "neighbourGroups": 6, "servingCellIsLastGroup": true, "hasGnss": false, "classify": "presence/diagnostic" } },
    { "name": "39-gtlbs", "direction": "device->server", "confidence": "INFERRED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTLBS,660400,863574046265138,GL50BLITE,0,0,92,,2,,,0000,0204,0008,0cee,b951,18,,0204,0008,0cee,cd83,15,,0204,0008,0cee,3994,13,,,,,,,,,,,,,,,,,,,,0204,0008,0cee,d071,11,,20240826085102,00C6$",
      "expect": { "type": "GTLBS", "model": "GL50B LITE", "hasGnss": false, "fixedSlotCount": true, "emptyGroupsPadded": true, "classify": "presence/diagnostic" } },
    { "name": "40-gtobd-gv500", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei", "vin"],
      "raw": "+RESP:GTOBD,1F0109,864251020135483,4T1BE46KX7U018210,gv500,0,78FFFF,4T1BE46KX7U018210,1,13411,981B81C0,787,3,43,,921,463,1,10,0300030103030304001200310351035203530354,20,55,,1286,0,6.5,74,21.6,3.379710,6.529714,20150813074824,0621,0030,51C0,A2B3,00,0.0,20150813074828,A7E9$",
      "expect": { "type": "GTOBD", "model": "GV500", "obdReportMask": "78FFFF",
        "vin": "4T1BE46KX7U018210", "vinAppearsTwice": true,
        "obdConnected": 1, "obdVoltageMv": 13411, "supportedPids": "981B81C0",
        "engineRpm": 787, "vehicleSpeedKmh": 3, "coolantC": 43, "fuelConsumption": null,
        "dtcsClearedDistanceKm": 921, "milDistanceKm": 463, "milStatus": 1, "numberOfDtcs": 10,
        "dtcsRaw": "0300030103030304001200310351035203530354",
        "dtcs": ["P0300","P0301","P0303","P0304","P0012","P0031","P0351","P0352","P0353","P0354"],
        "dtcEncoding": "SAE J2012 2-byte packing (INFERRED - not stated in R1)",
        "throttlePct": 20, "engineLoadPct": 55, "fuelLevelPct": null, "obdOdometerKm": 1286,
        "records": [{ "speedKmh": 6.5, "azimuth": 74, "altitudeM": 21.6, "lon": 3.379710, "lat": 6.529714 }] } },
    { "name": "41-gtobd-lowercase-nan", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei", "vin"],
      "raw": "+RESP:GTOBD,360701,864251020253807,LSGTC58UX7Y067312,GV500,0,70FFFF,LSGTC58UX7Y067312,1,12309,983A8140,0,0,33,nan,,0,0,0,,10,0,,0,4.4,0,83.7,36.235142,49.967324,20170829112348,0255,0001,2760,9017,00,690.1,20170829112400,3456$",
      "expect": { "type": "GTOBD", "fuelConsumption": null, "fuelConsumptionRaw": "nan",
        "mustDecodeFully": true, "mustNotEmitNaN": true,
        "note": "Traccar's PATTERN_OBD accepts Inf or NaN but compiles case-sensitively - I reproduced the NO MATCH locally" } },
    { "name": "42-gtdat-pipe-payload", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+RESP:GTDAT,270B01,867162027893742,gv300w,1,,,>I:5014|DB|607|0|0.00|0.00|0.00|0|0|0|0|1679|4|<,0,37.6,184,1940.4,-101.041169,22.143452,20240726234344,0334,0020,2F03,BDB2E4B,00,,,,,20240726234346,4CFE$",
      "expect": { "type": "GTDAT", "sourceAsserts": "attribute data == >I:5014|DB|607|0|0.00|0.00|0.00|0|0|0|0|1679|4|<", "dataPassthrough": true } },
    { "name": "43-gtdtt-hex-payload-with-commas-and-crlf", "direction": "device->server", "confidence": "VERIFIED", "assert": "source", "redact": ["imei"],
      "raw": "+RESP:GTDTT,410502,864802030541621,,,,1,35,45637561747261636b0d0a434f4d422c302c39342e302c2d312e302c2c2c4844430d0a,20230421034626,EA2E$",
      "expect": { "type": "GTDTT", "sourceAsserts": "KEY_FUEL == 94.0",
        "payloadDecodedEscaped": "Ecuatrack\\r\\nCOMB,0,94.0,-1.0,,,HDC\\r\\n",
        "note": "payload contains COMMAS and CRLF - a splitter that scans for a comma or treats 0x0D/0x0A as a terminator corrupts this" } },
    { "name": "44-gteri-10char-protocol-version", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "raw": "+RESP:GTERI,80201E0100,860201067144330,,00000100,,10,1,1,0.0,0,30.2,121.348427,31.163316,20251126093749,0460,0000,1807,00775892,00,0.0,,,,,99,210100,,1,00,6,4,0D1C099A,283F,WMS301_Test,7805414BA78A,1,3453,24,33,24.58,100,20251126093751,77E4$",
      "expect": { "type": "GTERI", "protocolVersion": "80201E0100", "protocolVersionLength": 10,
        "modelPrefix": "80201E", "model": "GV30CEU", "resolutionRule": "len>6 ? first 6 : first 2",
        "eriMask": "00000100", "accessories": [{ "name": "WMS301_Test", "mac": "7805414BA78A", "temperatureC": 24, "humidityPct": 33 }],
        "contestedMap": { "traccar": { "42": "GT501", "30": "GL300", "F1": "GV350M" }, "qtripp": { "42": "GMT200N", "30": "GL300N", "F1": "GV350MB", "802003": "GV58CEU" }, "404minds": { "07": "GT500", "28": "GT500-family" } } } }
]
```

### 8.3 `queclink-regression.json` — case 45, the one that must never be deleted

This is the only frame in the harvest that proves the silent-degradation bug (T4). Keep it in its own file with a comment saying why.

```json
{
  "source_url": "https://github.com/traccar/traccar/issues/5939",
  "retrieved_at": "2026-09-10",
  "attribution": "Frame quoted from an open Traccar issue (2026-07-02) by the reporting operator. Reproduced locally: Traccar's verbatim PATTERN_FRI does NOT match it, so decode() falls through to decodeBasic and emits ONE position instead of three.",
  "cases": [
    {
      "name": "45-gtfri-970208-three-fixes-cell-block-once",
      "direction": "device->server",
      "confidence": "VERIFIED",
      "assert": "mine",
      "redact": ["imei"],
      "raw": "+BUFF:GTFRI,970208,867963069900001,GL30MEU,0,0,3,1,27.4,75,475.0,16.372215,48.208327,20260702130741,1,30.2,49,476.7,16.372300,48.208482,20260702130742,1,33.3,32,476.9,16.372357,48.208598,20260702130743,0232,0001,A1B2,0001A2B4,13,0,4063,95,1,1,,20260702130743,0084$",
      "expect": {
        "type": "GTFRI", "buffered": true, "model": "UNMAPPED (970208 = GL30MEU)",
        "positionCount": 3,
        "cellBlockPosition": "ONCE, after the last fix group - NOT inside each group",
        "records": [
          { "lon": 16.372215, "lat": 48.208327, "speedKmh": 27.4, "azimuth": 75, "altitudeM": 475.0, "fixValid": true },
          { "lon": 16.372300, "lat": 48.208482, "speedKmh": 30.2, "azimuth": 49, "altitudeM": 476.7, "fixValid": true },
          { "lon": 16.372357, "lat": 48.208598, "speedKmh": 33.3, "azimuth": 32, "altitudeM": 476.9, "fixValid": true }
        ],
        "mustProduce": 3,
        "mustNotFallBackTo": 1,
        "measuredLossIfWrong": "3430 of 5218 fixes (65.7%) over a 5-hour capture; 14 of 15 (93%) at the protocol maximum of 15"
      }
    }
  ]
}
```

### 8.4 `queclink-hex.json` — cases 46-63

Every HEX case carries `lengthCloses` and `crc16` because **length-closure plus CRC is the oracle** that catches all three alignment traps (T29) at once. All eighteen were decoded and CRC-verified by me.

```json
{
  "source_url": "https://raw.githubusercontent.com/traccar/traccar/master/src/test/java/org/traccar/protocol/Gl200BinaryProtocolDecoderTest.java",
  "vendor_source": "GV300CAN @Track Air Interface Protocol V12.00 sections 4.2-4.12 (vendor PDF, NOT redistributable)",
  "retrieved_at": "2026-09-10",
  "crc": { "name": "CRC-16/CCITT-FALSE", "poly": "0x1021", "init": "0xFFFF", "refin": false, "refout": false, "xorout": "0x0000", "over": "bytes[4 : L-4]" },
  "attribution": "Traccar frames are Apache-2.0. Vendor frames are verbatim worked examples from the GV300CAN V12.00 PDF - transcribe the frame, never vendor the file. All decodes and all CRC recomputations are mine.",
  "cases": [
    { "name": "46-hex-rsp-gtfri-vendor-93b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B52535007 00FE0FBF 005D 4B 0305 0318 564F5F0300520A04 00 01 00 21 18 10 01 01 000000 00AF 0043 06FB3FDE 01E5D3C8 07E304180209 39 0460 0000 550B B969 00 000000 0000000000 000000 000000000000 07E30418020 93A BBCD 1D7C 0D0A",
      "hex_canonical": "2b525350 0700fe0fbf005d4b03050318564f5f0300520a040001002118100101000000 00af0043 06fb3fde01e5d3c8 07e30418020939 04600000550bb96900 000000 0000000000 000000 000000000000 07e30418020 93abbcd1d7c0d0a",
      "note": "spaces are for reading only - strip before decoding; the canonical byte stream is the 93 bytes listed in worked example W6",
      "expect": { "header": "+RSP", "messageType": 7, "typeName": "GTFRI", "reportMask": "00FE0FBF",
        "length": 93, "lengthCloses": true, "deviceType": "4B", "protocolVersion": "0305", "firmwareVersion": "0318",
        "uniqueId": "867995030082104", "uniqueIdEncoding": "sevenDecimalPairsPlusOneDigit", "luhnValid": true,
        "batteryPct": 0, "digitalIn": "01", "digitalOut": "00", "motionStatus": "21", "satellites": 8,
        "reportId": 1, "reportType": 0, "positionCount": 1,
        "records": [{ "hdop": 1, "fixValid": true, "speedKmh": 0.0, "azimuth": 175, "altitudeM": 67,
          "lon": 117.129182, "lat": 31.839176, "tsMs": 1556071797000,
          "mcc": 460, "mccEncoding": "BCD", "mnc": 0, "lac": "550B", "cid": "B969", "lacCidEncoding": "binary" }],
        "sendTimeLocal": "2019-04-24T02:09:58", "count": "BBCD", "crc16": "1D7C", "crc16Recomputed": "1D7C", "tail": "0D0A" } },
    { "name": "47-hex-rsp-gtfri-traccar-93b-bcd-proof", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2b5253500700fc1fbf005d4501020209563254030003430564377e42071001000000000000007eff75a151025c6a8107e10801081a2a02680003189c1ac500000000000002100700000000000000000007e1080108241019e17ebe0d0a",
      "expect": { "header": "+RSP", "messageType": 7, "reportMask": "00FC1FBF", "length": 93, "lengthCloses": true,
        "maskNote": "bits 14 and 17 CLEAR - no analog input, no digital IO; the GV300CAN FACTORY DEFAULT 00FE5FBF sets them and adds three bytes before motionStatus",
        "deviceType": "45", "uniqueId": "865084030003675", "luhnValid": true,
        "batteryPct": 100, "externalPowerMv": 14206, "motionStatus": "42", "satellites": 7,
        "records": [{ "hdop": 0, "fixValid": false, "staleLastKnown": true, "speedKmh": 0.0, "azimuth": 0, "altitudeM": 126,
          "lon": -9.068207, "lat": 39.611009, "tsMs": 1501576002000,
          "mcc": 268, "mccProof": "bytes 02 68 as BCD = 268 = Portugal; as uint16 = 616 which is not an allocated MCC; the coordinates are Torres Vedras PT",
          "mnc": 3, "lac": "189C", "cid": "1AC5" }],
        "totalMileage": 135175, "count": "19E1", "crc16": "7EBE", "crc16Recomputed": "7EBE" } },
    { "name": "48-hex-evt-gtstt-vendor-96b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B4556540900FE5FBF00604B03050318564F5F0300520A04000000000001002219010000000000F8007F06FB402E01E5D4AB07E30418030D0C04600000550BB96900000000000000000000000000000000000007E30418030D0FBD013A290D0A",
      "expect": { "header": "+EVT", "messageType": 9, "typeName": "GTSTT", "reportMask": "00FE5FBF",
        "length": 96, "lengthCloses": true, "eventInsertBytes": 0,
        "uniqueId": "867995030082104", "motionStatus": "22", "satellites": 9,
        "records": [{ "lon": 117.129262, "lat": 31.839403, "tsMs": 1556075292000 }],
        "crc16Recomputed": "3A29" } },
    { "name": "49-hex-evt-gtign-vendor-100b-4byte-insert", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B4556540D00FE5FBF00644B03050318564F5F0300520A0455000000000100221900001CC7010000000000F8006906FB404901E5D43B07E3041805103A04600000550BB96900000000000000000000000000000000000007E30418051102BE1D62A20D0A",
      "expect": { "header": "+EVT", "messageType": 13, "typeName": "GTIGN",
        "length": 100, "lengthCloses": true, "lengthArithmetic": "96 + 4",
        "eventInsert": { "field": "durationOfIgnitionOffS", "bytes": 4, "raw": "00001CC7", "value": 7367 },
        "batteryPct": 85, "motionStatus": "22", "satellites": 9,
        "mileageAlwaysPresent": true,
        "note": "Traccar has NO case for type 13 or 14 and therefore decodes this frame FOUR BYTES out of alignment (trap T29)" } },
    { "name": "50-hex-evt-gtupd-vendor-99b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B4556540F00FE5FBF00634B03050318564F5F0300520A0453000000000000111900C801010000000000F8FFEC06FB410B01E5D48F07E3041805113704600000550BB96900000000000000000000000000000000000007E3041805113ABE2D0C000D0A",
      "expect": { "messageType": 15, "typeName": "GTUPD", "length": 99, "lengthArithmetic": "96 + 3",
        "eventInsert": { "code": 200, "retry": 1, "bytes": 3, "raw": "00C801" }, "lengthCloses": true } },
    { "name": "51-hex-evt-gtgss-vendor-101b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B4556541500FE5FBF00654B03050318564F5F0300520A0400000000000103211300000000000100000903007C000C06FB407B01E5D27507E3041807312E04600000550BB96900000000000000000000000000000000000007E30418073230C0BB808A0D0A",
      "expect": { "messageType": 21, "typeName": "GTGSS", "length": 101, "lengthArithmetic": "96 + 5",
        "eventInsert": { "statusBytes": 1, "reservedBytes": 4 }, "lengthCloses": true } },
    { "name": "52-hex-evt-gtgpj-vendor-98b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B4556541F00FE5FBF00624B03060319564F5F0300520A0400000000000100211B0D0101000000000000004F06FB40AF01E5D44A07E3041D01093204600000550BB96900000000000000000000000000000000000007E3041D01093403B749C00D0A",
      "expect": { "messageType": 31, "typeName": "GTGPJ", "length": 98, "lengthArithmetic": "96 + 2",
        "eventInsert": { "cwJammingValue": 13, "jammingState": 1, "raw": "0D01" }, "lengthCloses": true } },
    { "name": "53-hex-evt-gtdos-vendor-98b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B4556541900FE5FBF00624B03050318564F5F0300520A0464000000000000111A020101000000000000004006FB415B01E5D43D07E3041805283904600000550BB96900000000000000000000000000000000000007E30418052A2ABEA058FC0D0A",
      "expect": { "messageType": 25, "typeName": "GTDOS", "length": 98, "lengthArithmetic": "96 + 2", "eventInsertBytes": 2,
        "lengthCloses": true, "note": "Traccar has NO case for type 25 either" } },
    { "name": "54-hex-evt-traccar-type12-92b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2b4556540c00fc1fbf005c4501010108563254030003430564312a41090100000000003f007dff75a11a025c6a7807e1070a14041202680003189c1ac500000000000000000000000000000000000007e1070b041134054e5c6e0d0a",
      "expect": { "messageType": 12, "length": 92, "lengthCloses": true, "eventInsertBytes": 0,
        "batteryPct": 100, "externalPowerMv": 12586, "motionStatus": "41", "satellites": 9,
        "records": [{ "hdop": 0, "fixValid": false, "azimuth": 63, "altitudeM": 125, "lon": -9.068262, "lat": 39.611000, "tsMs": 1499716218000 }],
        "count": "054E" } },
    { "name": "55-hex-evt-traccar-type45-99b", "direction": "device->server", "confidence": "INFERRED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2b4556542d00fc1fbf0063450102020956325403000343056437f8220700000200000000010000160100f2007eff75a1f0025c6b1a07e1080108241a02680003189c1ac500000000000002100800000000000000000007e1080108241a19e24e4e0d0a",
      "expect": { "messageType": 45, "length": 99, "lengthCloses": true,
        "eventInsert": { "bytes": 7, "raw": "00000200000000", "traccarInterpretation": "reserved(2) + reportType(1) + ignitionDuration(4) = GTVGN" },
        "contradiction": "R1 GV300CAN 4.5 marks id 45 RESERVED and puts GTVGN at 50. Length arithmetic proves Traccar is right for THIS device type (0x45). Both are right for their own model - open question Q15." } },
    { "name": "56-hex-ack-vendor-36b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B41434B02EF244B03050318564F5F0300520A0400002807E30418020918BBCA4CD10D0A",
      "expect": { "header": "+ACK", "messageType": 2, "commandName": "AT+GTQSS", "reportMask": "EF",
        "length": 36, "lengthOffset": 6, "lengthWidth": 1, "lengthCloses": true,
        "deviceType": "4B", "uniqueId": "867995030082104", "uniqueIdKind": "packedImei",
        "id": 0, "serialNumber": "0028", "sendTimeLocal": "2019-04-24T02:09:24", "count": "18BB",
        "crc16": "4CD1", "crc16Recomputed": "4CD1" } },
    { "name": "57-hex-ack-traccar-gb100-36b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": [],
      "hex": "2b41434b017f244501010108676231303000000000ffff07e1070b03112d054dfe030d0a",
      "expect": { "header": "+ACK", "messageType": 1, "commandName": "AT+GTSRI", "reportMask": "7F",
        "length": 36, "lengthCloses": true, "deviceType": "45",
        "uniqueIdKind": "asciiDeviceName", "deviceName": "gb100",
        "serialNumber": "FFFF", "sendTimeLocal": "2017-07-11T03:17:45", "count": "054D", "crc16Recomputed": "FE03",
        "trap": "T37 - BOTH this frame (mask 7F) and case 56 (mask EF) have +ACK mask bit 6 SET, yet one carries an ASCII name and the other a packed IMEI. The +RSP bit-6 rule does NOT hold for +ACK." } },
    { "name": "58-hex-hbd-vendor-32b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B484244EF204B03060319564F5F0300520A0407E3041A082D010455D37B0D0A",
      "expect": { "header": "+HBD", "reportMask": "EF", "length": 32, "lengthOffset": 5, "lengthWidth": 1, "lengthCloses": true,
        "deviceType": "4B", "protocolVersion": "0306", "firmwareVersion": "0319",
        "uniqueId": "867995030082104", "sendTimeLocal": "2019-04-26T08:45:01", "count": "0455",
        "crc16": "D37B", "crc16Recomputed": "D37B",
        "anonymousVariant": "if the UID mask bit is 0 the identity field is ABSENT and the heartbeat identifies the device only by its TCP connection (trap T45)" } },
    { "name": "59-hex-ati-vendor-35b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2B415449234B03050318564F5F0300520A040000000007E30419030D18D3C574720D0A",
      "expect": { "header": "+ATI", "length": 35, "lengthOffset": 4, "lengthWidth": 1, "lengthCloses": true,
        "uniqueId": "867995030082104", "crc16Verified": true,
        "note": "+ATI is NOT in Traccar's BINARY_HEADERS - trap T26" } },
    { "name": "60-hex-lgn-undocumented-38b", "direction": "device->server", "confidence": "INFERRED", "assert": "mine", "redact": ["uniqueId"],
      "hex": "2b4c474e00ff0026fe110b07020106563454040d054905000007e4031911213905083abd0d0a",
      "expect": { "header": "+LGN", "length": 38, "lengthOffset": 6, "lengthWidth": 2, "lengthCloses": true,
        "crc16": "3ABD", "crc16Recomputed": "3ABD",
        "uniqueIdOffset": 15, "uniqueId": "865284041305735", "luhnValid": true,
        "sendTime": "2020-03-25T17:33:57", "count": "0508",
        "unknownOffsets": [8, 9, 10, 11, 12, 13, 14, 23, 24],
        "status": "UNSUPPORTED - documented in none of the eight vendor PDFs; log, store raw, do not ack (open question Q21)" } },
    { "name": "61-hex-inf-gb100-118b", "direction": "device->server", "confidence": "INFERRED", "assert": "mine", "redact": ["uniqueId", "iccid"],
      "hex": "2b494e4601fd7f0076676231303000000045010202090104020500004100054007e107150b061d0000003f010e02580000000000d0312a1013648935103226313921591f1200000000000302680003189c1ac3001b02680003189c1ac4000d02680003189c1ac5001207e107150b0d3704f658060d0a",
      "expect": { "header": "+INF", "messageType": 1, "reportMask": "01FD7F",
        "length": 118, "lengthOffset": 7, "lengthWidth": 2, "lengthCloses": true,
        "lengthAmbiguity": "GV300CAN 4.4 defines an INF Expansion Mask giving offset 9 and its own 145-byte example confirms it; this GB100 frame has no expansion mask and needs offset 7. BOTH verified numerically - trap T5",
        "fieldOrderDiffersFromRsp": true,
        "identityOffset": 9, "deviceName": "gb100", "deviceTypeOffset": 17, "deviceType": "45",
        "iccid": "8935103226313921591",
        "cellTowers": [ { "mcc": 616, "mccAlt": 268, "mnc": 3, "lac": "189C", "cid": "1AC3", "rxLevel": 27 },
                        { "mcc": 616, "mccAlt": 268, "mnc": 3, "lac": "189C", "cid": "1AC4", "rxLevel": 13 },
                        { "mcc": 616, "mccAlt": 268, "mnc": 3, "lac": "189C", "cid": "1AC5", "rxLevel": 18 } ],
        "mccNote": "0x0268 read as binary is 616, read as BCD is 268 - the same defect as in +RSP (trap T28)" } },
    { "name": "62-hex-rsp-gtlbc-100b", "direction": "device->server", "confidence": "INFERRED", "assert": "mine", "redact": ["uniqueId", "phoneNumber"],
      "hex": "2B5253500300FC1FFF0064450102020867623130302D446F642F442105007018217345005F010100000001100045073C4D4101DB86BD07E106130B2B0F0460000018770013000000030000000106020F2300002714301107E106130B2B1003424EFB0D0A",
      "expect": { "header": "+RSP", "messageType": 3, "typeName": "GTLBC", "reportMask": "00FC1FFF",
        "length": 100, "lengthCloses": true, "deviceName": "gb100-Dod/D",
        "phoneField": { "encoding": "length byte then BCD nibbles until an 0xF half-byte sentinel", "confidence": "INFERRED from R2 only" },
        "warning": "a variable-length field with a nibble terminator - the classic place to drift by one byte (trap T29)" } },
    { "name": "63-hex-rsp-compressed-type100-1422b", "direction": "device->server", "confidence": "INFERRED", "assert": "none", "redact": ["uniqueId"],
      "hex_prefix": "2b5253506400fc1fbf058e45010202095632540300034305...",
      "hex_full_source": "Gl200BinaryProtocolDecoderTest.java, the single 1422-byte binary() sample",
      "expect": {
        "header": "+RSP", "messageType": 100, "length": 1422, "lengthCloses": true,
        "layout": "u16 point count, then a bit-packed delta stream: 2-bit tag 1 = ABSOLUTE (3 bytes of {2-bit attr, 1-bit fix, 12-bit speed, 9-bit heading} + int32 lon + int32 lat + u32 epoch on the first point only); tag 2 = DELTA (5 bytes of {2-bit attr, 1-bit fix, 7-bit signed speed delta, 7-bit signed heading delta, 12-bit signed lon delta, 11-bit signed lat delta}) with time implicitly +1 second per record; any other tag = one skipped byte meaning invalid-or-same",
        "coordinateScale": 1e-6, "speedScale": 0.1,
        "status": "UNSUPPORTED",
        "reason": "No vendor documentation exists. GV300CAN 4.3 documents message ids 0-24 only and has no entry for 100. Traccar sets valid=true on every emitted point and never reads the 1-bit fix type, so the invalid-fix signal is discarded outright. A 1422-byte frame expands to hundreds of one-second positions with an implicit clock that drifts permanently if one tag byte is misread.",
        "action": "verify CRC, extract identity and count, ACK, store raw, emit NO positions"
      }
    }
  ]
}
```

### 8.5 `queclink-pro.json` — cases 64-69

```json
{
  "source_url": "https://qdc.queclinksz.com/protocols/gl601$A39To8VF2U/air/v10/html/frames/report.html",
  "also_from": [
    "https://qdc.queclinksz.com/protocols/gl601$A39To8VF2U/air/v10/html/frames/heartbeat.html",
    "https://qdc.queclinksz.com/protocols/gl601$A39To8VF2U/air/v10/html/dataids/Location/82.html",
    "https://www.traccar.org/forums/topic/gv500cna-gl200-binary-data-id-82-frames-received-but-not-decoded-to-position/"
  ],
  "retrieved_at": "2026-09-10",
  "crc": { "name": "CRC-8", "poly": "0x31", "init": "0xFF", "refin": false, "refout": false, "xorout": "0x00", "over": "bytes[0 : L-2] (Header through Count Number inclusive)" },
  "attribution": "Cases 64-66 are verbatim vendor examples from the GL601 @Track Protocol Pro V10 HTML documentation. Cases 67-69 come from a user's production capture of a Queclink GV500CNA posted on the traccar.org forum (no explicit licence - treat as a quoted excerpt); two of the three also appear in Traccar's Apache-2.0 test corpus after commit 35555d03. All CRC-8 values recomputed by me.",
  "cases": [
    { "name": "64-pro-crc8-test-vector", "direction": "n/a", "confidence": "VERIFIED", "assert": "source", "redact": [],
      "hex": "2B0123456789012345FE0106010201FF5DB38C80",
      "expect": { "crc8": "FE", "crc8Recomputed": "FE", "purpose": "the vendor's own CRC-8 vector, printed beside a C routine" } },
    { "name": "65-pro-report-78b-doc-example", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": [],
      "hex": "2B00004E000123456789012345000000 1B0000376 4F9AAF6000003000 20B4D79496F5464657669636551 0F0907 3C46FF01DB88575F179DA0017D550E0604BC8A00100002100010 0C13030123 4F 24",
      "hex_canonical": "2b00004e00012345678901234500000000 1b0000 3764f9aaf6 0000 03 00 020b 4d79496f5464657669636551 0f0907 3c46ff01db88575f179da0017d550e0604bc8a001000021000100c130301 234f24",
      "note": "78 bytes; spaces for reading only. The document prints this as its worked parsing example with a field-by-field walkthrough.",
      "expect": { "header": "2B", "realTime": true, "identifier": "00", "frameLength": 78, "lengthCloses": true,
        "multiPacket": false, "imei": "123456789012345", "imeiEncoding": "packedBcdLeadingNibbleDropped",
        "reservedLength": 0, "crc8": "4F", "crc8Recomputed": "4F", "tail": "24" } },
    { "name": "66-pro-heartbeat-24b-doc-example", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": [],
      "hex": "2B10180123456789012345800100 07005E362F5A10F21424",
      "hex_canonical": "2b101801234567890123458001000700 5e362f5a 10f2 14 24",
      "expect": { "header": "2B", "identifierByte": "10", "identifierNote": "NOT 00 - this is why Traccar's isBinary() misroutes heartbeats (trap T25)",
        "frameLength": 24, "lengthOffset": 2, "lengthWidth": 1, "lengthCloses": true,
        "imei": "123456789012345", "deviceType": "8001", "protocolVersion": "0007", "customVersion": "00",
        "generatedTimeEpoch": 1580654002, "count": "10F2", "crc8": "14", "crc8Recomputed": "14", "tail": "24" } },
    { "name": "67-pro-gv500cna-real-capture-a", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "hex": "2b000038000865134050947226820300030000216a3ed6f101895000521629fa8b28f402ac1a8e6a3ed6f100001600000010f505010ff824",
      "expect": { "header": "2B", "realTime": true, "frameLength": 56, "lengthCloses": true, "multiPacket": false,
        "imei": "865134050947226", "luhnValid": true, "deviceType": "8203", "deviceModel": "GV500CNA",
        "protocolVersion": "0003", "customVersion": "00", "reservedLength": 0,
        "records": [{ "recordLength": 33, "generatedTimeEpoch": 1782502  , "recordCountNumber": "0189", "recordId": "50", "recordName": "FixedReport", "eventCode": 0,
          "data": [{ "dataId": 82, "dataIdBytes": 1, "dataLength": 22, "name": "FullLocation",
            "fixByte": "29", "signalLevel": 2, "fixState": "0b10", "fixValid": true, "fixMode": "3D",
            "lon": -91.543308, "lat": 44.833422, "utcEpoch": 1782502, "speedKmh": 0.0, "hdop": 2.2, "azimuth": 0, "altitudeM": 434.1, "satellites": 5 }] }],
        "count": "010F", "crc8": "F8", "crc8Recomputed": "F8", "tail": "24",
        "epochNote": "0x6A3ED6F1 = 2026-06-26T19:45:53Z; the integer above is abbreviated - compute it from the bytes" } },
    { "name": "68-pro-gv500cna-real-capture-b", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "hex": "2b000038000865134050947226820300030000216a908d67247f5000521619fa8b85e702ab64326a908d670000050082000aa51da13d0424",
      "expect": { "frameLength": 56, "lengthCloses": true, "imei": "865134050947226",
        "records": [{ "recordId": "50", "data": [{ "dataId": 82, "fixValid": true, "lon": -91.519513, "lat": 44.786738,
          "utc": "2026-08-27T19:17:59Z", "speedKmh": 0.0, "hdop": 0.5, "azimuth": 130, "altitudeM": 272.5, "satellites": 29 }] }],
        "count": "A13D", "crc8": "04", "tail": "24" } },
    { "name": "69-pro-gv500cna-real-capture-c-forum-only", "direction": "device->server", "confidence": "VERIFIED", "assert": "mine", "redact": ["imei"],
      "hex": "2b000038000865134050947226820300030000216a3ed6d301885000521629fa8b28f402ac1a8e6a3ed6d300001600000010f505010ecb24",
      "expect": { "frameLength": 56, "lengthCloses": true, "imei": "865134050947226",
        "nearDuplicateOf": "67", "deltaSeconds": -30, "recordCountNumber": "0188",
        "count": "010E", "crc8": "CB", "tail": "24",
        "note": "exists only in the forum post, not in Traccar's corpus" } }
  ]
}
```

### 8.6 Cases still missing from the corpus

**Write these as `pending` fixtures with the expected shape and a skip marker, so they are visible rather than forgotten:** a Protocol Pro frame carrying a 2-byte Data ID (T27); a HEX frame with report-mask bit 24, 25 or 26 set (Q16); a clean `+ACC` frame (Q11); a `+BSP`/`+BVT`/`+BNF`/`+BRD` buffered HEX frame of any kind (Q22); a `+CAN`/`+DAT`/`+CRD` frame that is not truncated in the PDF text layer; a HEX frame whose speed or mileage fraction byte is non-zero (Q12); a UDP-transported frame of any kind (Q14); a GTVGF or GTVGL frame (Q17); a GTFSD fuel-sensor frame with a known-good decode (Q18).

---

## 9. Open questions

**38 things I could not settle.** Each has: the question · what would settle it · how much it matters if you guess wrong. Ordered by cost, not by topic. **Do not compress this list to look finished.**

### Blocking — get these wrong and customers see wrong numbers or lose data

**Q1 — Does `<Report Composition Mask>` REMOVE fields from the report or BLANK them?**
R1 GV300CAN p.21 says the mask controls *"whether to include"* the field, which reads as removal. But **every real capture in the harvest shows the fields present-and-empty**, never absent — `…,20171017153221,,,,,,9995.1,00465:53:49,,,87,110000,…` and `…,20250512214226,,,,,,0.0,,,100,210100,…`. Not one fixture anywhere shows a genuinely shortened field list.
**Settled by:** one capture from a device with `AT+GTCFG` Report Composition Mask **bit 3 (cell block) cleared**, compared field-by-field against the same device with the bit set. A ten-minute bench test.
**Cost of guessing:** it decides whether the ASCII decoder is index-based or mask-driven — i.e. the whole architecture. If it removes and you index blindly, every device with a non-default `AT+GTCFG` shifts by up to four fields, silently.

**Q2 — Does the device match the SACK against the Count Number or the Serial Number?**
I have taken GV300CAN pp.339-341 (*"uses the `<Count Number>` extracted from the received message"*) as authoritative. But GV500CG's retry rule says the device resends when *"the serial number of the SACK message does not match the last message sent"*, and the GTHBD rule says the terminal *"must check the serial number of the SACK message regardless of `<SACK Mode>`"*. The vendor uses the phrase "serial number" in exactly the two places that define the matching rule.
**Settled by:** a bench test — SACK with the count and observe no retransmission; SACK with a deliberately wrong value and observe the resend ladder. This also validates the byte-for-byte echo rule in one shot.
**Cost:** not data loss — **permanent 4× duplication of every report**, plus the wedge behaviour in T11.

**Q3 — Do ASCII @Track devices pipeline reports (send N+1 before the SACK for N) under SACK Mode 1?**
GV500CG says the terminal *"needs to wait for the SACK message … after successfully sending a message"*, which reads as strictly serial, but no document states an outstanding-message window.
**Settled by:** a packet capture of a real buffer flush with SACK Mode 1, or a vendor statement of the window size.
**Cost:** it determines whether a slow ack throttles a 10 000-message buffer flush to one message per RTT. At 200 ms that is 33 minutes; at the 20 s timeout it is **days**. It sizes your ack path's latency budget.

**Q4 — What does an ASCII @Track device do after exhausting its SACK resends?**
Protocol Pro says *"reconnect to backend server"*. GV500CG says only *"resend up to 4 times"* and stops there. GV300CAN, GV350M V4.03, GV200 V5.01, CV200 V2.21 and GL320M V3.03 say **nothing at all**. Whether the message is then buffered, dropped, or the connection torn down is unknown — and it is exactly the case where records go missing.
**Settled by:** a lab test — accept the TCP connection, never SACK, and observe whether the report reappears as `+BUFF` after reconnect.
**Cost:** it decides whether the Queclink ack can be used for at-least-once semantics at all. **My current reading: it cannot** — §3.3.6 lists three buffering triggers and a missing ack is not among them.

**Q5 — What are `<Ad-Blue Level>`'s units and encoding?**
GV300CAN p.321 says `0-100%`. GV350M V3.11 says `0-100L` in one report table and `0-100%` in another. The HEX table says only "2 bytes". Traccar strips one leading character, implying an `L`/`P` prefix no table documents — and a real capture carries `P100.00`.
**Settled by:** one live GV355CEU/GV350M capture with CAN Expansion Mask bit 0 set, read alongside the vehicle's dashboard AdBlue gauge.
**Cost:** AdBlue is compliance-relevant. An empty tank derates the engine. **Do not emit a number at all until this is settled.**

**Q6 — Do GTIGN/GTIGF really always report `<GNSS Accuracy> = 0` on some model families?**
GV300CAN and GV500CG both give the field Range/Format `0` for these two messages, and GV350M V4.03 annotates it *"0, Last known"*. Real GV310LAU captures (`6E0202`) show `1`.
**Settled by:** a per-model capture set.
**Cost:** if `0` is genuine for a whole model family, **every ignition event on those devices carries a stale position** and trip start/end coordinates must come from the nearest valid fix instead.

**Q7 — What does ERI mask bit 7 mean, and on which models?**
GV300CAN documents bits 0, 1, 2, 3, 4, 8 only. Traccar unconditionally decodes a bit-7 block of `(serial, type, temperature[, humidity])` records; GL320M treats bit 7 as `externalBattery`.
**Settled by:** the GV350M and GL320M protocol PDFs, or a live GTERI capture with bit 7 set.
**Cost:** a wrong bit-7 block consumes the wrong number of fields and shifts everything after it — the T3 failure mode with a different trigger.

**Q8 — HEX `<Altitude>` scaling, and the HEX `<Cell ID>` width on LTE.**
Altitude: 2 bytes, "Unit: meter", two's complement, but no vendor example ever prints an altitude value, and the ASCII form definitely carries one decimal. `0x0043` = 67 m or 6.7 m. Cell ID: an LTE ECI is 28 bits and cannot fit in 2 bytes, yet the ASCII form explicitly allows an 8-hex-char Cell ID.
**Settled by:** altitude — a HEX `+RSP` and the same device's ASCII `+RESP:GTFRI` captured minutes apart. Cell ID — one HEX capture from an LTE model (GV58LAU, GV310LAU) parked on a cell whose ECI exceeds 65535.
**Cost:** a 10× altitude error is customer-visible on any hill; a truncated ECI puts cell-fallback positions in a different city.

**Q9 — Which wins for ignition: the Device Status motion enum or Device Status bit 8 ("Ignition detection")?**
Two sources for the same boolean, and the document never states precedence. flespi's 2026-07-08 changelog is a fix for exactly that collision (*"the physical-input bit no longer overrides the motion-derived ignition state"*), so it is real in production.
**Settled by:** a vendor statement, or a capture from a device with virtual ignition enabled and the physical input floating.
**Cost:** the T16 failure — a fleet that never starts a trip, or one that starts trips while parked. **Meanwhile ignition must be a nullable tri-state, and `41`/`42`/`16`/`1A` must map to null, never false.**

**Q10 — The full HEX `+INF` field table, offset by offset.**
I established that the identity sits at offset 9 and Device Type at 17 on the GB100 shape — the reverse of `+RSP` — but I cannot cite a complete field list at byte granularity for either variant.
**Settled by:** reproducing GV300CAN V12.00 §4.4's table into the fixture set, plus a GB100-class `+INF` to confirm the two-mask-versus-one-mask split.
**Cost:** without it, `+INF` decodes a device name as a device type. Medium — `+INF` is diagnostic, not positional.

**Q11 — The exact on-wire byte count of the HEX `+ACC` frame.**
I computed **478 bytes** from the GV300CAN §4.12 field table (4+1+2+8+450+7+2+2+2). The doc's example is line-wrapped in the PDF text layer and I could not reassemble it to CRC-check.
**Settled by:** one clean `+ACC` capture, CRC-16 verified.
**Cost:** **`+ACC` carries no length field at all.** A wrong constant desynchronises the socket permanently. Until settled, **drop the connection on `+ACC`** — a reconnect costs one buffered flush; a desync costs the socket.

**Q12 — Is the HEX speed/mileage fraction byte tenths or hundredths?**
The vendor states 2 digits for 5-byte CAN totals but says only "integer + fraction" for speed and mileage. Every published sample has fraction `0x00`.
**Settled by:** one HEX `+RSP` with a non-zero speed or mileage fraction byte, captured alongside the same device's ASCII report.
**Cost:** overspeed alerts fire 2.7 km/h early or late on every device; up to 9.9 km of fabricated distance per report. **Interim rule: truncate to the integer** — wrong by <1 unit under either reading.

**Q13 — Protocol Pro multi-packet: may a record or a TLV straddle a fragment? Is Frame Number 0- or 1-based? Does each fragment carry its own valid CRC-8 and Count Number? Do you SACK each fragment or only the last?**
The vendor states only that reports over 1440 B are auto-split via the multi-packet flag.
**Settled by:** a capture of one split report — easiest to force with a Wi-Fi scan (Data 100) or a crash record (142-144), both of which exceed 1440 B.
**Cost:** if a TLV can straddle, each fragment parses "successfully" on its own — CRC-8 covers only that frame — and yields a truncated record with a garbage trailing TLV. **Wrong data that passes every integrity check you have.** Guessing the SACK granularity wrong triggers the 40 s / 3-resend / reconnect ladder on every oversized report.

**Q14 — Is SACK expected per-datagram in UDP mode, and what does the device do with an out-of-order SACK on UDP?**
GL200 V1.02 says only *"If `<Report mode>` is set as 4 (UDP mode), it is strongly recommended to enable SACK or heart beat mechanism"*. No document defines UDP-specific ack matching. **Every capture in this harvest is TCP.**
**Settled by:** a vendor statement, or a UDP capture with deliberately reordered acks.
**Cost:** UDP is a supported deployment mode. Getting it wrong produces the T11 duplication/wedge behaviour with no TCP-level ordering to hide behind.

**Q15 — An authoritative, per-model `+EVT` message-ID table.**
GV300CAN §4.5 and Traccar's constants disagree on five ids (VGN 50 vs 45, VGF 51 vs 46, RMD 32 vs 35, JDS 34 vs 33, UPC 35 vs 34). I proved by length arithmetic that Traccar's id 45 is correct for its device-type-`0x45` sample. **Both are right for their own model and no cross-model table is published anywhere.**
**Settled by:** per-model HEX sections from the PDFs for every model we sell.
**Cost:** each id triggers a type-specific insert of 1-7 bytes **before** the coordinates. A wrong id produces a coordinate that is wrong but plausible.

**Q16 — HEX report-mask bits 24 (RFID), 25 (CAN Data) and 26 (EIO100 IO) are set in no sample anywhere.**
The tail of the HEX position block is completely untested.
**Settled by:** a capture from a device with a non-default `AT+GTHRM` mask.
**Cost:** the trailing fields of every HEX position report are guesswork on any device that enables them.

**Q17 — GTVGF and GTVGL have no example frame anywhere.**
`GTVGN` exists in R2's corpus with an asserted `ignition = true`; its OFF counterpart and the location variant do not.
**Settled by:** a capture from a device with virtual ignition configured.
**Cost:** **virtual ignition is the common light-vehicle install** — no ignition wire. We would be shipping trip detection for that install on an inferred layout.

### Important — get these wrong and a feature is missing or a device is unsupported

**Q18 — Sixteen documented report types have no example frame in any source.**
`GTAIF` (marked *"does not support the HEX report"*), `GTBAR`, `GTBDR`, `GTUPD`/`GTUPC`/`GTEUC`/`GTCFU` in ASCII form, `GTPHD`/`GTEHD` (photo payloads), `GTFSD`/`GTEXP`/`GTUVN` (fuel sensor), `GTDMR`/`GTMOA` (driver monitoring / Mobileye ADAS), `GTTRD`/`GTTRL`/`GTTTR` (tachograph download/list/transfer), `GTGIR`/`GTGDA`/`GTQDA`, and the whole query-response family (`GTIOS GTBSC GTBTI GTBAU GTCML GTCSN GTCVN GTDAV GTRSS GTRSV GTATI GTUDT`) — collectively about a quarter of the message space.
**Settled by:** captures, one per feature we actually sell.
**Cost:** varies. `GTPHD`/`GTEHD` are the highest risk — long, chunked, arbitrary bytes, i.e. **the frames most likely to break framing**. The tachograph set confirms the roadmap conclusion "integrate, do not build" — we have nothing to test against. `GTFSD` matters because fuel is on the roadmap.

**Q19 — CAN Report Expansion Mask bits 23-31, and the further `reportMaskCan` (retarder usage, power mode, tachograph timestamp).**
These exist only in Traccar's source with **no vendor citation**; GV300CAN V12.00 and GV350M V3.11 both mark 23-31 Reserved.
**Settled by:** a GV355CEU / GV350M protocol document newer than 2024-07.
**Cost:** medium. If a truck sets those bits and we skip them, we lose fields; if we decode them wrong we shift the rest of the block.

**Q20 — Does a HEX-mode device expect an ASCII `+SACK:xxxx$` or a HEX SACK frame? And is the GT300 dialect's server reply `$`- or NUL-terminated?**
GV300CAN §4 defines seven HEX report categories but **never defines a HEX SACK**, and §3.5 defines the ASCII `+SACK` without saying it is format-independent. Traccar only ever emits ASCII. Nothing says what terminator the GT300 expects back.
**Settled by:** two bench tests, one afternoon. Set Protocol Format 1 with SACK enabled and observe whether an ASCII SACK stops the retransmission; on a GT300, send the SACK both ways.
**Cost:** a wrong ACK format does not lose data — it **wedges the hardware in a customer's vehicle** (T11). **Until settled, do not enable SACK on HEX or GT300 devices.**

**Q21 — The `+LGN` frame layout.**
Undocumented in all eight vendor PDFs. I verified Length at offset 6 (u16), the same CRC-16 over `[4:-4]`, and the IMEI (decimal-pair encoded) at offset 15. Offsets 8-14 (device type 1 vs 2 vs 3 bytes, protocol version, firmware version) are guesswork and bytes 23-24 are unidentified.
**Settled by:** the @Track PDF for GV58LAU / GV355CEU / GV30CEU (prefixes `802004` / `802005` / `80201E`), which Queclink has not published publicly, or a `qdc.queclinksz.com` HTML doc for one of those models.
**Cost:** low today (log and store raw), but if `+LGN` really is a login it is the frame that binds identity on those models.

**Q22 — Which HEX categories can be buffered, and what are their buffered headers?**
The rule "replace the 2nd byte with B" generates `+BAN`, `+BAT`, `+BBD`, `+BCK` for `+CAN`, `+DAT`, `+HBD`, `+ACK` — **none of which appear in any header set**. And there is **not a single example frame of `+BSP`, `+BVT`, `+BNF` or `+BRD` anywhere**, so a framer accepting them is accepting a header it has never seen.
**Settled by:** a vendor list, or a capture of a HEX device's buffer flush.
**Cost:** buffered HEX frames are either dropped (Traccar's behaviour, T24) or misframed.

**Q23 — Is `<Send Time>` local or UTC on any given model?**
GV300CAN V12.00 and GV500CG V3.02 both say "local time"; GT300 V4.02 says "UTC time converted from the terminal local time". Nothing on the wire distinguishes them.
**Settled by:** comparing `<Send Time>` against `<GNSS UTC Time>` on a device with a known non-zero `AT+GTTMA` offset.
**Cost:** low if you follow the rule (**use only `<GNSS UTC Time>`**), fatal if you do not — flespi shipped timezone-shift bugs as recently as 2026-06-24.

**Q24 — Does `+NACK` exist on the ASCII @Track family?**
`jaayesta/queclink-parser` matches `/^\+NACK[\s\S]+\$$/` and enumerates causes 0/1/2. **Zero occurrences of the string "NACK"** in GV300CAN V12.00, GV500CG V3.02, GL200 V1.02 or GT300 V4.02. It **is** documented for Protocol Pro.
**Settled by:** a capture, or a vendor statement.
**Cost:** low — handle defensively: log, do not crash, never treat it as a position.

**Q25 — The ASCII MCC/MNC/LAC/Cell ID radix, stated by a vendor.**
No vendor field table gives a base for any of the four. My rule ("MCC/MNC decimal-looking; LAC/CID hex") is derived from captures, and a LAC of `1877` is a valid cell under **both** readings.
**Settled by:** a vendor field table stating the base, or a device parked on a cell whose id is unambiguous in one radix only.
**Cost:** T6 — LBS positions in the wrong city about 15 % of the time.

**Q26 — GTOBD mask bits 16 and 19.**
Not documented in GV500 V1.06 (listed "Reserved") but present in real captures with masks `78FFFF`/`19FFFF`. Traccar names them `<OBD Protocol>` (single char 0-9/A) and an integer-km OBD odometer; the sample values (6, and 1286 / 53557) fit.
**Settled by:** a GV500 or GV500MAP protocol doc at V1.10 or later, or a vendor Setbox export of the OBD mask legend.
**Cost:** medium — the OBD odometer is a customer-visible number.

**Q27 — Does ERI mask bit 0 emit a block at all on GV350M?**
GV350M V3.11/V4.03 call bits 0 and 2 "reserved", yet Traccar has a GV350M-specific path where bit 0 emits a UART id plus a hex fuel value, and flespi shipped a fix for exactly that on 2026-07-28. Case 23 in §8.2 is a real GV350M frame with ERI mask `00000001`.
**Settled by:** the model's own current PDF.
**Cost:** field-count shift inside GTERI on a model we are likely to sell.

**Q28 — How do you resolve the HEX device-type width when the width itself determines where the model field is?**
GV300CAN: 1 byte. GV500CG: 3 bytes. Traccar hardcodes one byte and mis-parses every GV500CG HEX frame from that field onward. **Both vendor docs are correct for their own model.**
**Settled by:** nothing external — it is a genuine chicken-and-egg. The only workable resolution is length-closure: try each candidate width and accept the one where the frame consumes exactly `<Length>` bytes and ends on `0D 0A` with a valid CRC.
**Cost:** this single problem is why flespi abandoned HEX entirely.

**Q29 — The prefix→model map itself is contested between the three independent implementations.**
Traccar: `42` = GT501, `30` = GL300, `F1` = GV350M. qtripp: `42` = GMT200N, `30` = GL300N, `F1` = GV350MB, `802003` = GV58CEU. 404minds: `07` = GT500, `28` = GT500-family — neither of which is in Traccar's map at all. And qtripp keys layouts on the **full** version, giving GV65 `310603` and `310905` different GTERI field lists.
**Settled by:** a vendor model-code list, which I did not find published.
**Cost:** **a 2-character model prefix is NOT sufficient to select a field map.** Build the dictionary as JSON with a `source_url` per entry and treat disagreements as explicit.

### Worth knowing — lower cost, still real

**Q30 — Framing safety of ASCII `GTDAT`/`GTBDR` with `<Data Format>` = 0.** *"There are maximum 1200 ASCII characters … If `<Data Format>` is 0, it will be raw data from Bluetooth"* — raw peripheral bytes could contain `,` or `$`. No vendor statement says the field is escaped or restricted. **Settled by:** a device with Data Format 0 configured. **Cost:** T35; mitigate by provisioning Data Format non-raw.

**Q31 — HEX `<Engine Coolant Temperature>` encoding.** The vendor's HEX example yields `0x005A` = 90 where the parallel ASCII example shows 55. Plain signed °C vs J1939 SPN 110 raw (°C + 40) is undecidable from the doc. **Settled by:** a simultaneous ASCII+HEX capture, or an OBD scan tool reading during capture. **Cost:** a 40 °C error on a coolant alarm.

**Q32 — HEX `<Fuel Consumption>` 3-byte layout.** The sample is `FE 00 00` where the ASCII example is empty, suggesting byte 0 is a unit/validity selector with `FE` = unavailable. The doc gives only "3 bytes, 0-9999 L/100km | L/H". **Settled by:** a HEX capture from a vehicle actually reporting consumption. **Cost:** do not emit; low.

**Q33 — The `+RSP` type-3 (GTLBC) phone insert.** Traccar reads a length byte then consumes BCD nibbles until an `0xF` sentinel; GV300CAN §4.3 lists GTLBC as id 3 but the phone field is not in the shared table, and the GB100 capture does not close cleanly under the shared layout. **Settled by:** the GB100 or GL300 `+RSP` GTLBC table. **Cost:** one-byte drift on a rarely-used message.

**Q34 — GV500 V1.06's GTOBD example contradicts its own mask.** Mask `1fff` (13 bits) but 16 masked fields present. The mask table and the field order both imply the payload is right and the mask is a typo for `FFFF`. **Settled by:** any real GTOBD capture with a mask below `FFFF`. **Cost:** low — real captures always carry all 16 low fields.

**Q35 — There is no CV200 or CV100LG protocol PDF in the harvest.** Traccar's corpus has several `BD`- and `DF`-prefix frames (GTIGN, GTFRI, GTRTL, GTIGL, GTHBM, GTSOS) whose field counts do not match the GV300CAN tables. Their layouts here are marked **INFERRED**. **Settled by:** the CV200 V2.21+ PDF (which exists — the trap list quotes it — but which I could not obtain in full). **Cost:** high if we sell dashcams; the CV200 GTIGN in the corpus has two extra leading fields and a second trailing timestamp that nothing else has.

**Q36 — Buffer depth is firmware-dependent.** GV300 firmware release notes record the day it was *raised* to 10 000, so older firmware buffers less. **Settled by:** per-firmware release notes. **Cost:** low — it changes how much backlog to expect, not correctness.

**Q37 — The Bluetooth accessory `type` and `model` enums.** Observed: type 6 = Beacon Multi-Functional Sensor, models 2, 4 and 5. The full enum is not in any document I read. **Settled by:** the `AT+GTBAS` section of a current PDF. **Cost:** low — the append mask still tells you which sub-fields are present.

**Q38 — The compressed `+RSP` type 100 bit layout has no vendor source whatsoever.** GV300CAN §4.3 documents message ids 0-24 only. Everything in §P43 is read from Traccar's implementation. **Settled by:** a vendor document that mentions message type 100. **Cost:** it is a 1422-byte frame expanding to hundreds of one-second positions with a 1-bit fix flag nobody reads and an implicit clock. **Treat as unsupported.**

---

## 10. Verdict

### Is this implementable today, without guessing?

**Partly — and the honest answer is a three-way split, not a yes or a no.**

| Scope | Implementable today without guessing? |
|---|---|
| **Format A (ASCII), for a named list of models we have captures for**, decoding position, ignition, mileage, hour meter, battery, external power, device status, 1-Wire temperature, digital fuel sensor, Bluetooth accessories, CAN and OBD | **YES** — with the mandatory guards below. This is ~90 % of deployed Queclink hardware. |
| **Format A for an unknown model or firmware** | **NO — and the correct behaviour is to refuse.** Emit `UnknownModel`, store the raw sentence, ack it, alert. Do not best-effort parse. |
| **Format C (Protocol Pro)** | **YES for Data 81/82 and the six Vehicle IDs**, which is everything the current catalogues actually define. **NO for the 2-byte-Data-ID path** until a fixture exists (T27/Q13). |
| **Format B (HEX)** | **NO. Do not build it.** Reconfigure the device to ASCII with `AT+GTSRI <Protocol Format> = 0`. Implement only enough of B to **frame and discard safely** so a misconfigured device cannot desync the socket. flespi — 104 models in production — made the same call. |
| **`+ACC`, `+LGN`, `+RSP` type 100, GTPHD/GTEHD** | **NO.** Frame-and-drop, or drop the connection in `+ACC`'s case. |

### The non-negotiable guards

These are not nice-to-haves; without them the "YES" rows become "NO":

1. **Model resolution is a pure function of `<Protocol Version>`**, never of an operator-typed name. Unknown prefix ⇒ undecodable record + metric + alert (T17).
2. **No silent fallback decoder, ever.** An unrecognised layout returns a typed `UndecodableRecord`; the ingest persists the raw frame. Metric `codec_fallback_total` alerts on it (T4).
3. **A decode failure never reaches the socket.** Poison record ⇒ dead-letter path, connection stays open, ack reflects only what was persisted (T41, hard rule 4).
4. **`accuracy === 0` ⇒ `fix_valid = false`**, as a sibling guard to `isNullIsland` — Queclink never emits null island, so ADR-039's check catches none of this (T2).
5. **Ignition is a nullable tri-state.** `41`/`42`/`16`/`1A` map to null, never false (T16, Q9).
6. **Ack after persistence, byte-for-byte, exactly once, and only for a recognised sentence with a 4-hex-character count** (rules R-ACK-1 to R-ACK-6).
7. **Dedupe on `(imei, message_type, count, send_time)`**, never on count alone (T12).
8. **Order by GNSS UTC within a device shard; treat `<Send Time>` as a transport artefact** (§2.9).
9. **Every emitted field carries a unit and a `source_url` in the dictionary JSON**, the way the AVL dictionaries already do (T21).
10. **Length-closure + CRC is the oracle for every binary frame.** Consume exactly `<Length>` bytes, land on the tail, verify the checksum, or reject (T5, T29).

### The riskiest byte

> **The two ASCII characters immediately after `<Cell ID>` — the slot that is `<Position Append Mask>` on GV500CG-class firmware, `<GNSS Trigger Type>` on GV300CAN, a literal `"00"` Reserved in the generic-location table, and a per-position odometer (`25.2`) on GL300-class firmware.**

Why this byte and not one of the more spectacular candidates:

- It is **hexadecimal and is parsed as decimal** by the most-copied implementation, so masks containing `A`-`F` throw and masks in `10`-`99` decode to the wrong number. flespi shipped fixes for this on **2026-09-01 and 2026-09-02** — four and three working days before this document — across nine model families, after having already fixed it in 2023, twice in 2026, and again in June and July.
- Its **bit map is rank-1 against rank-1**: GV500CG says bit 0 = satellites in use / bit 1 = GNSS trigger type; CV200 V2.21 p.20 says bit 0 = satellites in **view** / bit 2 = satellites **used**, with no bit 1. Both are vendor documents. The VERIFIED label in §3.0b sits on the reading that is wrong for at least one shipping family.
- Consuming one appended field too few or too many **shifts everything after it**: Mileage reads the Hour Meter string, Backup Battery reads Device Status, ignition reads a percentage. **Every one of those lands as a plausible number, not an exception.**
- And that is the whole point. A framing desync announces itself — the socket stalls, CRCs fail, someone gets paged. **A one-field shift produces a wrong odometer on a customer invoice and nobody notices for a month.**

The runner-up, and the one that will bite hardest if we ever ship Protocol Pro fleet-safety features, is the **high bit of a Protocol Pro Data ID** (T27): a 1-byte reader turns `80 8C` (harsh braking) into a 140-byte length, destroys that record and every record behind it in the frame, **and the frame still passes CRC-8**. No published example exercises it.

**Bottom line: build the ASCII decoder, model-gated and fallback-free, with the ten guards above. Frame-and-discard the HEX variant. Ship Protocol Pro Data 81/82 only. Book the ten-minute bench tests behind Q1, Q2 and Q20 before the first customer device goes live — between them they settle the decoder architecture, the duplication behaviour, and whether we can turn SACK on at all.**
