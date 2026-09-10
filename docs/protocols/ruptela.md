# Ruptela — implementation-ready protocol specification

**Status of this document.** Every byte offset, width, scaling and enum below carries a source tag.
The labels are load-bearing and stay in the final text — an implementer must be able to see, at a
glance, which line is proven and which line is a guess:

- **VERIFIED** — re-derived from raw bytes locally (CRC recomputed over the reassembled frame, field
  walk consumes the frame with **zero** slack bytes before the CRC), *and* at least one rank-1 vendor
  document or an asserted third-party test agrees.
- **INFERRED** — consistent with the bytes and with one source, nothing independent confirms it.
  Implement it, gate it, log it, do not trust it.
- **UNKNOWN** — nobody public knows. Every one is listed in §9 with what would settle it and what it
  costs to be wrong.

**Source ranks** (used throughout): rank 1 = vendor document; rank 2 = Traccar decoder/test corpus
(Apache-2.0); rank 3 = flespi published parameter catalogue; rank 4 = other open-source
implementations (DIMO Go server, `dimitrievski/ruptela`, `wkusaa/ruptela-nodejs`); rank 5 = issue
trackers and forum captures; rank 6 = blogs (never load-bearing).

### The one structural warning that must be read before anything else

The rank-1 spine of this document is **Ruptela device protocol v1.113, R&D department, 2022-05-20**,
read through an HTML re-extraction at `https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html`.
The vendor PDF itself is not publicly indexed. **That mirror is verifiably lossy in exactly the
columns that carry numbers.** Two confirmed examples:

- §1.3, verbatim from the mirror: *"all GPS related fields which can be positive or negative will
  have value. Fields which can only be positive will have value."* — the numeric **Value** column is
  gone.
- §1.2.3 (priority): the enum names survive, the values do not.
- §1.6 (record summary): the altitude row reads *"Altitude | 2 Bytes | Altitude value multiplied by
  10"* — with **no type column**, which is precisely the disputed fact (§9 Q1).

The CRC-reconstruction technique that produces most of the VERIFIED labels here is strong but narrow:
**it proves layout, never values.** A table whose multiplier column was dropped still reconstructs to
a valid CRC, because the CRC is computed over the example bytes, not over the table. So: every byte
**offset** in this document is rank-1 solid. Every **scaling factor, enum value and error sentinel**
that is cited only to the mirror is rank-1-in-name-only, and is labelled accordingly. Offsets fail
loudly. Scalings ship as plausible wrong numbers.

Getting the real PDF (Ruptela support ticket, or one of the Scribd copies: v1.40 doc/842963148,
v1.67 doc/435177303, v1.82 doc/709469841, v1.84 doc/674484776, v1.103 doc/618052186) and re-verifying
every multiplier in §5–§6 against it is the single highest-value follow-up in this document.

---

## 1. What speaks this protocol

### 1.1 The vendor and the shape of the line

Ruptela (Vilnius, Lithuania). Unlike GT06 this is **one vendor, one protocol document, one CRC**.
There are no OEM dialects, no re-badges with mutated framing, and no per-model envelope differences.
What varies across the line is *which IO parameters a model can emit* and *which optional commands
its firmware implements* — never the frame.

There are exactly **two record encodings**, selected by a device configuration switch, not
negotiated on the wire:

| Config | SMS `gsminfo` field `P` | Record command | IO ID width | Max IO ID |
|---|---|---|---|---|
| "standard protocol" | `P: 0` | **1** (`0x01`) | 1 byte | 255 |
| "extended protocol" / "protocol v1.1" | `P: 1` | **68** (`0x44`) | 2 bytes big-endian | 65535 |

VERIFIED (rank 1, SMS Command List rev 2.21): *"GPRS protocol version. It can have the following
values: 0 – standard protocol, 1 – extended protocol."*
VERIFIED (rank 1, v1.113 §1.6 / §2.5): *"Parameters that require the use of the v1.1 protocol start
from ID no. 256."* Confirmed empirically: max IO/event ID across the 7 classic captures I decoded is
216; the extended captures reach 1150.

### 1.2 Models, by generation

**Device-type codes are on the wire** — the identification packet (command 15) carries a 4-byte ASCII
type string. VERIFIED (rank 1, v1.113 §3.2.14 device-type table; two of the codes independently
confirmed by decoding Traccar's real capture frames).

| Gen | Type code | Model | Evidence |
|---|---|---|---|
| 5th | `Tc05` | HCV5 | rank 1 type table |
| 5th | `Lc05` | LCV5 | rank 1 |
| 5th | `Pr05` | Pro5 | rank 1 |
| 5th | `Tl05` | HCV5 Lite / Pro5 Lite | rank 1 |
| 5th | `We05` | Trace5-LTM (Rev.A) / Trace5-2G / Trace5-LTE | rank 1 |
| 5th | `Wp05` | Trace5-LTM | rank 1 |
| 5th | `Us05` | Trace5NA | rank 1 |
| 5th | `Ws05` | Trace5GL | rank 1 |
| 4th | `Tc04` | FM-Tco4 HCV | rank 1 (vendor's own ident example) |
| 4th | `Lc04` | FM-Tco4 LCV | rank 1 |
| 4th | `Pr04` | FM-Pro4 | rank 1; real captures in traccar#2460, #1855 |
| 4th | `Ec04` | FM-Eco4 | rank 1; forum capture (`Ec0400.03.33.06`) |
| 4th | `Es04` | FM-Eco4 S / FM-Eco4 T | **VERIFIED by decode** — Traccar capture `Es04 / 00.03.68.04` |
| 4th | `Rs04` | FM-Eco4 RS T | rank 1 |
| 4th | `OBD1` | FM-Plug4 (OBD dongle) | **VERIFIED by decode** — Traccar capture `OBD1 / 00.01.08.00` |
| 4th (sub) | — | FM-Eco4 Light, FM-Eco4 Light 3G | real captures: traccar#5152, #3561. Type code not observed. |
| 3rd | — | FM-Eco3, FM-Pro3, FM-Tco3 (TCO), FM-Tco3 (OBD) | v1.67-era doc + FM-x3 config manual |

Additional model names appear as the **~24 per-model Yes/No columns of the vendor's `FMIO list.xlsx`**
(see §5.1), which is the authoritative statement of which IO IDs a model can produce:
`Plug5 · HCV5 Lite/Pro5 Lite · Pro5 · HCV5 · LCV5 · Trace5-LTM(-NA) · Trace5-LTE/LTM(Rev.A)/2G ·
Basic · ECO4 UBI · Eco4 · Eco4 S · Eco4 T · Eco4 RS T · Pro4 · Tco4 HCV · Tco4 LCV · Plug4 ·
Pro4 BT · Tco4 HCV BT · Tco4 LCV BT · Eco3 · Pro3 · Tco3 TCO · Tco3 OBD`.
flespi lists **32 Ruptela devices** and **523 parameters** on its protocol page (rank 3).

**Coverage assessment.** The frame, the CRC, the two record encodings, identification, heartbeat,
DTC and the ACK contract are the same on every device in the table above. That is ~100 % of the line
by envelope. The parts that are *not* uniform are (a) the IO dictionary per model, and (b) the
optional command families (tachograph, files/camera, beacons, accident reconstruction, Garmin FMI,
weighting, FLS) which only some models implement.

### 1.3 Firmware / protocol-version ranges — what is absent on older firmware

VERIFIED (rank 1, v1.113 change log, cross-checked against the v1.67 / v1.82 / v1.103 mirrors, which
are missing exactly the features the change log says were added later):

| Protocol version | Date | What appears |
|---|---|---|
| ≤ v1.67 | 2017-06-15 | **No heartbeat 16/116. No dynamic ident 18/115. No files 37/137. No beacons 38/138.** Still carries FM-Pro3-only commands 21/121 and 120. |
| v1.70 | 2017-12-19 | Heartbeat 16/116 added |
| v1.75 | 2018-06-21 | *"Added: Description of negative acknowledgement packet for Commands 1/100 and 68/100"* — **NACK behaviour on pre-2018 firmware is undefined** |
| v1.78 | 2018-10-29 | Dynamic identification 18/115 added |
| v1.82 | 2019-03-08 | has 18/115, no accident 35/135 |
| ~v1.95 | — | Accident reconstruction 35/135 appears |
| ~v1.100 | ~2020 | The *"and breaks the open link"* clause appears under 15/115 |
| v1.103 | 2021-05-10 | no beacons 38/138 yet |
| v1.104 | — | Beacon data over GPRS 38/138 added |
| v1.113 | 2022-05-20 | current mirrored version; this document |

**Consequence for us.** Do not send a heartbeat ACK (116) as a liveness probe assumption; a device on
2017-era firmware will never send command 16 and its link will just idle. Do not depend on NACK to
throttle a device on pre-v1.75 firmware — its behaviour on ACK byte 0 is not documented and not
observed anywhere.

### 1.4 What is *not* this protocol

- **TrustTrack REST API** (`way-platform/trusttrack-go`) is Ruptela's *platform* API, not the device
  protocol. Different transport, different auth, different data model. Do not confuse them.
- **`DOC_Tacho read detailed protocol.xls`** — the detailed tachograph read flow is marked
  **confidential** in v1.113 §3.2.10. What §3 documents about commands 10/11/12/110/111 is a
  skeleton; the driver-card state machine is not public.
- **Ruptela Lua scripting / Manual CAN** rule sets — IO 1201–1220 carry 8 raw bytes each whose
  meaning lives in the device's configuration, not on the wire (§6.5).

---

## 2. Transport and session

### 2.1 The frame, both directions

**VERIFIED (rank 1 §3.1/§3.1.1 + re-derived).** I decoded 17 vendor examples and 16 Traccar capture
frames; the layout below consumed every one of them exactly, and every CRC recomputed to the printed
value.

**Device → server:**

| Off | Field | Width | Endian | Notes |
|---|---|---|---|---|
| 0 | Packet length `plen` | 2 | BE | counts **IMEI + command + payload**. Excludes itself. Excludes the CRC. |
| 2 | IMEI | 8 | BE | plain unsigned 64-bit **decimal** value, not BCD, not ASCII |
| 10 | Command ID | 1 | — | see §3.1 |
| 11 | Payload | 0 … 1011 | — | may be **zero** bytes (heartbeat) |
| 2+`plen` | CRC16 | 2 | BE | over bytes `[2 … 2+plen)` |

**Server → device:** identical **minus the IMEI field**.

| Off | Field | Width | Endian |
|---|---|---|---|
| 0 | Packet length `plen` | 2 | BE | counts **command + payload** only |
| 2 | Command ID | 1 | — |
| 3 | Payload | 0 … 1019 | — |
| 2+`plen` | CRC16 | 2 | BE |

`total_bytes = 2 + plen + 2 = plen + 4`.

| Bound | Value | Evidence |
|---|---|---|
| Min device→server frame | **13 B** (`plen = 9`, heartbeat, empty payload) | VERIFIED — vendor §3.2.15 example `0009 000310F561749007 10 BD93`, CRC recomputed |
| Min server→device frame | **5 B** (`plen = 1`, empty payload) | VERIFIED — vendor §3.2.19 `0001 82 A71A` and §3.2.4 `0001 67 17B9`, both CRCs recomputed |
| Max frame | **1024 B exactly** (`plen = 1020`) | VERIFIED — Traccar's cmd-37 JPEG capture is exactly 1024 B; the vendor DDD fragment example is exactly 1024 B; Traccar's `MAX_FRAME_LENGTH = 1024` |

**Framer.** Netty equivalent, from Traccar `RuptelaProtocol.java` (rank 2):
`LengthFieldBasedFrameDecoder(1024, offset=0, lengthFieldLength=2, lengthAdjustment=2, initialBytesToStrip=0)`.

**Spec self-contradiction (rank 1 vs rank 1).** §3.1 annotates device→server payload as `[1-1011]`
and server→device as `[1-1018]`, while §3.2.5 says `[1-1019]` — and the same document's own heartbeat,
command 103 and command 130 examples all carry **zero** payload bytes. Trust the examples. The range
annotations in §3.1 are wrong.

### 2.2 CRC — named, with parameters

**VERIFIED (rank 1 §3.1.5 C source + independently reimplemented).** The vendor ships a C listing
with `usPoly = 0x8408 //reversed 0x1021` and `usCRC = 0`.

**CRC-16/KERMIT** (aliases: CRC-CCITT Kermit, CRC-16/CCITT "true", CRC-16/BLUETOOTH, CRC-16/V-41-LSB).

| Parameter | Value |
|---|---|
| Width | 16 |
| Polynomial (normal form) | `0x1021` |
| Polynomial **as coded** | `0x8408` (bit-reversed `0x1021`) |
| Init | `0x0000` |
| RefIn / RefOut | true / true |
| XorOut | `0x0000` |
| Check (`"123456789"`) | `0x2189` |
| Coverage | the frame **excluding** the 2 length bytes and **excluding** the 2 CRC bytes |
| On-wire byte order | **big-endian** |

The vendor's own note: *"Format is big endian. That is why bytes 0 and 1 are 'switched'."* Kermit is
conventionally emitted **little**-endian; Ruptela emits it **big**-endian. Get this backwards and your
CRC is byte-swapped, not wrong-valued — which means it passes nothing and fails silently in a way that
looks like a corrupt link rather than a code bug.

I reimplemented it and reproduced, independently, every constant published anywhere in the corpus:
`13BC · 0235 · CB25 · AFA3 · 862D · BD93 · 9074 · C4A4 · 8179 · D04D · C995 · 6035 · 17B9 · A71A ·
1E08 · 46E2 · DA26 · 8B10 · 39CC · 9799 · E7EC · 0947 · 4B58 · B66B · 75DB · F5B3 · 5590 · BD80 ·
A897 · 470E · A416 · 65D7 · 87D4 · 6048 · 71C1 · C922 · FBB9 · D578 · 9F91 · FA25 · C112 · 753C ·
B0FA · FB0E · C89D · 85DF · D247 · 337D · 54FE · 1821 · 78D9 · 94CE · 9032 · 9B9C · E462 · 927A ·
1763 · 8AEB · 3D00 · 0EB0 · E00A · 8C91 · 092B · AD9E · B5DA · 4DC3 · E815 · 084D · 0706 · 9D3F ·
2DB3 · 630F · 28A0 · 3C2E · C9EE · 1681 · 41CB · 4AA0 · FC58 · AC80 · 341C · 2A / 75 (CRC8)`.

**A second, different CRC exists.** VERIFIED (rank 1 §3.1.6 + decoded): the **RS232 transparent
channel IO record framing** (§3.2.13.1) uses **CRC-8**, polynomial `0xE0` (reversed `0x07`), init
`0x00`, reflected — i.e. **CRC-8/ROHC** — computed over the record data only, excluding the length
byte. I verified both CRC8 values (`0x75`, `0x2A`) in the vendor's two-record example.
CONTRADICTION (rank 1 vs rank 4): `wkusaa/ruptela-nodejs` computes this with the npm `crc` package's
`crc8()` = **CRC-8/SMBUS** (poly `0x07`, *not* reflected), which produces a different value and does
not verify against the vendor's own example. The vendor wins.
**CRC-8 is never used on GPRS frames.** Only inside RS232 tunnelled record blobs.

### 2.3 Session lifecycle (TCP)

```
device opens TCP
  → [command 15 (0x0F) fixed ident, or command 18 (0x12) dynamic ident]   ← if enabled
  → server MUST reply command 115                                          ← HARD GATE, see §7.6
  → device sends command 1 or 68:  recordsLeft(1) | count(1) | records…
  → server replies command 100 with ACK=1     ⇒ DEVICE ERASES THOSE RECORDS FROM FLASH
  → if recordsLeft was 1, device immediately sends the next packet (stop-and-wait)
  → … until recordsLeft = 0
  → idle: command 16 heartbeat every configured timeout → server replies 116
```

VERIFIED (rank 1 §3.2): *"Communication between FM device and server always is initiated by FM
device."* The server never opens a connection. Server-initiated commands (102, 103, 104, 105, 106,
108, 110, 114, 117, 130, 131, 133, 134, 137) ride the device's already-open link.

**Links ≫ GPRS sessions.** VERIFIED (rank 1, SMS Command List rev 2.21, the vendor's own `info`
example output): `GPRS 0:O 64, C 0, E 248; LK:O 575, E 1, TMO 126` — 64 GPRS sessions against **575
opened links** and **126 server-response timeouts**. The device opens a **new TCP connection per
sending session**; heartbeats are what keep a link alive between them. Size your connection table for
churn, not for a steady socket per device.

### 2.4 Identification is authorization, not addressing

Every device→server frame already carries the IMEI at offset 2. The identification packet exists to
let the server *authorize* the device and to report firmware/coefficients.

VERIFIED (rank 1 §3.2.14): *"The device does not start sending other data until ACK … is received
from the server (command 115) and breaks the open link. Firmware (command 104) and configuration
(command 102) commands still work even if no ACK is received. All other commands from the server are
discarded if the identification packet is not acknowledged."*

CONTRADICTION (rank 1 vs rank 1, same document): §3.2.17 — the dynamic-identification twin — omits
the *"and breaks the open link"* clause entirely, and v1.82 omits it in both places. **INFERRED:**
assume both idents break the link when unacknowledged, because assuming otherwise means your server
holds a socket the device has already abandoned. (§9 Q6.)

**Command 15 (`0x0F`) payload is exactly 37 bytes.** VERIFIED — vendor field table §3.2.14,
reconstructed to the printed CRC `0xDA26`, *and* decoded independently from two real Traccar captures.

| Off | Field | Width | Type |
|---|---|---|---|
| 0 | Device type | 4 | ASCII (§1.2 table) |
| 4 | Firmware version | 11 | ASCII, e.g. `00.03.68.04` |
| 15 | IMSI | 8 | u64 |
| 23 | GSM operator | 4 | u32, currently registered network (MCC·100 + MNC, same encoding as IO 150) |
| 27 | Distance coefficient | 4 | u32 |
| 31 | Time coefficient | 4 | u32 |
| 35 | Angle coefficient | 2 | u16 |

Decoded live: `Es04 / 00.03.68.04 / IMSI 214074206785173 / op 33403 / dist 1000 / time 60 / angle 60`
and `OBD1 / 00.01.08.00 / op 24603 / dist 500 / time 60 / angle 20`.

> **Note for our device registry.** Traccar throws this entire payload away — it records neither
> device type nor firmware version. That is exactly the data a multi-tenant registry wants; capture it.

**Command 18 (`0x12`) dynamic identification** replaces 15 when enabled.
VERIFIED (rank 1 §3.2.17; the mirror's printed example is corrupted — missing the version byte — but I
reconstructed `00120003124D0AC0BB1C 12 01 02 0101 00 06 02 0441 8B10` and the printed CRC `0x8B10`
matches exactly, which proves the layout):

```
version(1) | paramCount(1) | { paramId(1) | length(1) | value(length) } × paramCount
```

**Parse using the on-wire `length`, never a table of expected lengths.** In the vendor's own example
parameter 1 (Device type, nominally 4 ASCII bytes) is sent with length **1**. And DIMO's field map
already carries parameter **21 (ICCID, 22 B ASCII)** which does not exist in v1.113's list — the
parameter set grows with firmware.

| ID | Meaning | Nominal width / type |
|---|---|---|
| 1 | Device type | 4, String |
| 2 | Firmware version | 11, String |
| 3 | IMSI | 8, unsigned |
| 4 | GSM operator | 4, unsigned |
| 5 | Distance coefficient | 4, unsigned |
| 6 | Time coefficient | 4, unsigned |
| 7 | Angle coefficient | 2, unsigned |
| 8 | OCSP status | 1, unsigned |
| 9 | Bootloader version | 2, unsigned |
| 10 | Hardware version | 2, unsigned |
| 11 | Configuration tag | 0–32, String |
| 15 | Last configuration change | 4, unsigned, UNIX ts — **5th gen only** |
| 21 | ICCID | 22, ASCII — **rank 4 only** (DIMO), absent from v1.113 |
| 255 | Error: payload would exceed 1011 bytes | 0 |

### 2.5 Server → device frames you must be able to emit

Every CRC below recomputed locally. VERIFIED unless marked.

| Purpose | Bytes |
|---|---|
| **Records ACK** (answers **both** cmd 1 and cmd 68) | `0002 64 01 13BC` |
| **Records NACK** | `0002 64 00 0235` — **INFERRED**: layout is rank-1, the hex is *derived*, never captured (§9 Q8) |
| Identification ACK (answers **both** cmd 15 and cmd 18) | `0002 73 01 CB25` |
| Identification **reject + lockout**, delay in minutes | `0003 73 02 B4 AFA3` (= 180 min) |
| Heartbeat ACK | `0002 74 01 862D` |
| DTC ACK / NACK / "send me DTCs" | `0002 6D 01 C4A4` / `0002 6D 00 D52D` / ACK byte 2 |
| Smart-card ACK / NACK / rejected | `0002 6B 01 9074` / `0002 6B 00 81FD` / `0002 6B 02 A2EF` |
| Tacho DDD ACK **+ 2 B packet index** | `0004 6F 01 FFFF 8179` — **the index is a variable, see §7.25** |
| Transparent-channel ACK | `000C 72 01 0000 6162633132330D0A A897` (port 1, optional echo payload) |
| Accident ACK | `0002 87 01 D04D` |
| Beacon ACK | `0002 8A 01 6035` |
| SD-log ACK (subcommand 1) | `0002 86 01 C995` |
| Set-IO command | `0009 75 000000AF 00000064 39CC` (IO 175 := 100) |
| Version request | `0001 67 17B9` |
| Garmin status request | `0001 82 A71A` |
| Set connection parameters (fire-and-forget) | `0015 69 "192.168.0.1,9015,TCP" 1763` |
| Set odometer (fire-and-forget) | `0005 6A 12345678 8AEB` |

**The exception that owns the most data.** `0002 64 01 13BC` answers **command 68 as well as command
1**. The reply command is **100**, not 168. See §7.1 — this is the single most expensive
generalisation error available in this protocol.

### 2.6 The ACK contract, stated as rules

These are the rules. Violate any one and you either destroy customer data or wedge a device.

> **R1. The records ACK is a single boolean byte.** `0x01` = ACK, `0x00` = NACK. There is **no count,
> no sequence number, no timestamp** in it. VERIFIED (rank 1 §3.2.1/§3.2.2).

> **R2. ACK=1 means DELETE.** VERIFIED (rank 1 §3.2.1): *"When positive acknowledgement (ACK) is
> received, the device deletes all sent records from the memory."* The word is **all**, not *n*.
> After you send `0002 64 01 13BC`, your copy is the only copy.

> **R3. There is no partial ACK.** A 1009-byte flush carries up to 37 classic records. If record 14 is
> undecodable, the other 36 are at stake with it. You accept the whole packet or none of it. Our
> CLAUDE.md hard rule 4 ("ACK the count actually persisted") **has no Ruptela expression** and must be
> re-derived for a boolean — see §7.2.

> **R4. Never ACK before the records are durably persisted.** On Teltonika a premature ACK costs you a
> re-send. Here it costs you the data. Traccar writes the ACK inside `decode()` and returns positions
> for downstream persistence — ACK-before-persist. `nenadvasic/gps-tracking-server` writes
> `0002640113bc` *even when the parse returned an error*. Both are wrong on this protocol.

> **R5. Never ACK a frame whose CRC failed.** Traccar never checks the CRC at all and ACKs
> unconditionally. On a protocol where ACK means delete, that turns any link corruption into silent
> permanent loss.

> **R6. NACK (`0x00`) costs up to an hour of silence.** VERIFIED (rank 1 §3.2.1): the resend backoff
> ladder is **1 → 5 → 10 → 15 → 30 → 60 minutes**, capped at 60. It resets **only** on: an ACK; a
> device restart; a connection opened by `connect` / `econnect` / `switchip` SMS or GPRS command 105;
> or a change to IP1 / Port1 / IP2 / Port2. A 30-second database blip that NACKs converts into up to
> an hour of silence from every device that happened to be mid-flush, simultaneously, with no decay.
> See §7.26.

> **R7. NACK behaviour is undefined before protocol v1.75 (2018-06-21).** The change log entry is
> *"Added: Description of negative acknowledgement packet for Commands 1/100 and 68/100."*

> **R8. Identification uses ACK byte `0x02` + a delay byte to reject, not `0x00`.** VERIFIED (rank 1
> §3.2.14): *"If the tracking device is unauthorized, the server sends a NACK response with command
> 115. The tracking device then breaks the link with the server and does not make any further
> connection attempts until the delay time has passed."* Delay is 1 byte, **minutes**. Value `0` is
> undefined for command 115 (§9 Q7). **Not applicable to FM-Eco4 and FM-Plug4** — those models ignore
> it. This is the frame our multi-tenant ingest wants for an unknown or suspended IMEI; Traccar
> implements nothing of the sort.

> **R9. Command 17/117 (set IO) inverts the ACK convention.** VERIFIED (rank 1 §3.2.16): `0` = **IO
> value was changed (success)**, `1` = failed to change, `2` = not supported. Every other Ruptela ACK
> uses 1 = success. Do not write a shared "ack byte" helper.

> **R10. Commands 105 and 106 have no acknowledgement at all.** VERIFIED (rank 1 §3.2.27/§3.2.28):
> *"Tracking device does not send a response."* These are the only fire-and-forget server commands;
> your command queue cannot confirm delivery for them.

> **R11. No ACK at all ⇒ "server response timeout", counted as `TMO` / `lktmo`.** Records are
> retained and re-sent, so an absent ACK produces **duplicates, not loss** — provided the flash does
> not wrap first. The numeric value of the timeout is **UNKNOWN** (§9 Q5).

### 2.7 Buffered / offline flush

**`recordsLeft` is a flag, not a count.** VERIFIED for commands 1, 68 and 34 (rank 1 + every capture):
`0` = flash empty, `1` = more waiting.
UNCERTAIN for command 35/135, where the vendor's decimal example row reads `35 3 19 0 20`, which would
put **19** in that position (§9 Q9). Costless mitigation: write `left !== 0`, never `left === 1`, and
log a warning if it is ever > 1.

**The loop is stop-and-wait.** One packet → one ACK → next packet. Made explicit for SD-log 34/134:
*"Server should use command 134 (0x86) with subcommand 1 (0x01) for log records response
(acknowledge). After that FM device will send next log records pack…"* An empty packet
(`recordsLeft=0, count=0`) signals nothing left. Whether any firmware ever *pipelines* two record
packets without waiting is **UNKNOWN** (§9 Q4).

**Per-packet cap:** 1009 payload bytes after `recordsLeft` and `count`, so ≤ **37** classic records
(27 B minimum each) or ≤ **34** extended records (29 B minimum each). Observed in the wild: 30
(vendor example), 30 (Bangkok Eco4-Light capture), 29 (Eco4-Light 3G capture, exactly 1019 payload
bytes), 10, 8, 6, 5, 4, 3, 2, 1.

**Flash is a ring buffer.** *"About 5000 records can be stored and after this, device will start
overwriting oldest records"* — rank 1 but **3rd generation only** (FM-x3 config manual). 4th/5th-gen
capacity is unpublished; marketing says "up to 2 days" (§9 Q10). The `delrecords` SMS wipes internal
flash — that is the practitioner's escape hatch for a poison packet, and it is device-side, not
server-side.

**Two real buffered-flush artefacts, both from the same capture** (traccar#5152, FM-Eco4 Light 3G,
frame begins `03fb 0003137ca79f856d 01 01 1d 386d438b…`, `recordsLeft = 1`, 29 records):

1. **RTC-default timestamps.** The first six records carry `ts = 0x386D438B = 946684811 =
   2000-01-01T00:00:11Z`, then the packet jumps to 2023-07-30. A device that buffered before it ever
   got time sync emits year-2000 records **in the same packet, under the same single ACK**, as
   today's. See §7.23.
2. **No-fix sentinels, not zeros.** `lon = lat = 0x80000000`, `alt = 0x8000`, `angle = 0xFFFF`,
   `sat = 0xFF`, `speed = 0xFFFF`, `hdop = 0xFF`. See §7.3.

### 2.8 UDP

VERIFIED (rank 1 §4.1.20, `getapn` SMS reply reports `TCP/UDP: 0 – TCP, 1 – UDP`; configuration
parameter `100` selects it, `setcfg 100 0` = TCP). Ruptela's own TrustTrack platform runs **TCP :9015
and UDP :7001** on 92.62.134.34 (rank 1, help centre). Same frame, same CRC, same ACK.
Reliability statement (rank 1, FM-x3 manual): *"In case of UDP, if data is lost during transfer to
server, the device will repeat the same message in next GPRS session, until transfer is successful."*
So the ACK still governs deletion under UDP; you inherit reordering and duplication on top.

CONTRADICTION: Traccar registers Ruptela **TCP-only** (`new TrackerServer(config, getName(), false)`),
flespi says flatly *"Use TCP protocol (not UDP)"*, and forum reports say UDP mode gets rejected. Both
are true — the device speaks UDP and no third-party aggregator implements it.
**Recommendation: ship TCP. Treat UDP as opt-in later, if ever.**

### 2.9 TLS

VERIFIED (rank 1). Per-server SSL is configurable: the `ssl status` SMS returns `server1,server2`
states (`0` disabled, `1` enabled, `2`–`8` OCSP results). Certificates and the private key load via
firmware commands `|FU_WRITE_S1*`, `|FU_WRITE_S2*`, `|FU_WRITE_PK*`. The dynamic-ident packet reports
OCSP status as parameter 8. flespi (rank 3): *"TLS/plain configuration between device and flespi
channel should be synced or device will be unable to connect."* ⇒ **TLS and plain need separate
listener ports.** flespi has run Ruptela over TLS since 2021-09-15.

### 2.10 Dual-server — three behaviours, all traps

VERIFIED (rank 1, help centre + HCV5 manual + flespi):

- **Two servers configured, "Two servers" OFF:** automatic failover to server 2 when server 1 is
  unreachable. *"Returning to the primary requires sending an SMS reset command."* Failover is
  **sticky**.
- **"Two servers" / "Copy all data" ON:** *"If turned on, a copy of all data will be sent to the
  backup server even if the main server is reachable. **If the main server is unreachable, no data
  will be sent to any server.**"*
- **As the secondary (IP2) you have no command channel:** *"When configured as a secondary server,
  flespi will receive data but all commands will be ignored by the device."*

And the part that decides whether we can honestly sell a fleet:

> VERIFIED (rank 1, help centre, verbatim): *"IP1 is the primary server, it sends acknowledgment
> (ACK) packets when it receives records. After the ACK packet is received, the record is considered
> as successfully transmitted to the server and it is deleted from the device memory."* ·
> *"If it does not receive ACK from IP 2, the data packet sending will not be repeated to IP 2."* ·
> *"If the connection to the IP1 server is not established, the device does not connect to the IP2
> server as well."* · *"Only records are sent to the server with IP2. Other data packets, such as
> Transparent Channel, Tachograph, SD card, and Garmin will not be sent to the second server."*

See §7.22. **As IP2 you get at-most-once delivery with unrecoverable, unlogged gaps, and you go dark
whenever someone else's server does.**

### 2.11 Decoder rules (MUST)

1. **Frame from the stream.** Read 2 B length, require `2 + plen + 2` bytes, never assume one TCP read
   is one frame. Traccar uses a length framer; DIMO loops on its inbound buffer; the
   `dimitrievski/ruptela` README's `conn.on('data')` example is the classic broken pattern.
2. **Bound the length in BOTH directions.** Reject `plen > 1020`. Also reject `plen < 9` for
   device→server (IMEI 8 + command 1 is structurally the minimum) and `plen < 1` for server→device.
   The material this document is built on states only the upper bound — that is a hole (§7.27).
3. **A bogus length desyncs the stream permanently.** There is no sync word to resync on. On CRC
   failure, or on a length/body mismatch, **close the connection**. Do not attempt byte-wise resync,
   and do **not** ACK.
4. **Verify the CRC before ACKing** (R5). **Persist before ACKing** (R4).
5. **Bounds-check before every record read**, not after. `count` is u8 (max 255) but only 1009 payload
   bytes exist, so `count = 255` against a short body over-reads *by construction*. Validating
   alignment only at the end invites reading 255 records first — an unbounded read on the hot path,
   reachable from any unauthenticated TCP connection before identification.
6. **Then also assert the post-condition:** after reading exactly `count` records the cursor must land
   exactly on the CRC. Do not blindly trust `count`.
7. **`recordsLeft` is 0/1 for commands 1/68/34** — but write `!== 0` (§2.7). **Command 38/138 reverses
   the field order**: `count` comes *before* `recordsLeft`, and its count is a *session total*
   "including those that were received with this message", not a per-packet count.
8. **IMEI formatting must be chosen once and applied everywhere.** Traccar uses
   `String.format("%015d", …)`; the vendor prints raw decimals (`12207001062170` — 14 digits;
   `13226005504143` — 14 digits). Same wire bytes, two different registry keys. Neither is wrong;
   picking inconsistently is. **The IMEI field is a 64-bit integer, not a 15-digit string** — one
   real capture in §8 carries a 14-digit value.
9. **Be lenient about content, strict about framing.** The recurring lesson across every
   implementation's history: a strict parser that closes the connection on a surprise IO ID is worse
   than a lenient one that warns and continues, because on this protocol a closed connection is a
   device that stops reporting and a buffer that starts overwriting itself.

---

## 3. Packet catalogue

### 3.1 Command map

VERIFIED (rank 1 §3.2.29 command table, cross-checked against every worked example in the document).

| Device→server | Hex | Name | Server ACK | Hex |
|---|---|---|---|---|
| **1** | `0x01` | Records (classic / standard protocol) | **100** | `0x64` |
| **68** | `0x44` | Records (extended protocol) | **100** | `0x64` |
| 2 | `0x02` | Configuration response | 102 | `0x66` |
| 3 | `0x03` | Device version response | 103 | `0x67` |
| 4 | `0x04` | Firmware update response | 104 | `0x68` |
| 5 | `0x05` | Smart-card data (DDD fragment) | 107 | `0x6B` |
| 6 | `0x06` | Smart-card size (2 B size) | 107 | `0x6B` |
| 7 | `0x07` | SMS-over-GPRS response (ASCII) | 108 | `0x6C` |
| 9 | `0x09` | DTC records | 109 | `0x6D` |
| 10 | `0x0A` | Tachograph transaction | 110 | `0x6E` |
| 11 | `0x0B` | Tachograph DDD data fragment | 111 | `0x6F` |
| 12 | `0x0C` | Tachograph file info | **111** | `0x6F` |
| 14 | `0x0E` | Transparent channel (RS232/RS485) | 114 | `0x72` |
| 15 | `0x0F` | Identification (fixed) | 115 | `0x73` |
| 16 | `0x10` | Heartbeat | 116 | `0x74` |
| 17 | `0x11` | Set-IO acknowledgement | 117 | `0x75` |
| 18 | `0x12` | Identification (dynamic) | **115** | `0x73` |
| 19 | `0x13` | Smart-card size, 2nd gen (4 B size) | **107** | `0x6B` |
| 30 | `0x1E` | Garmin status | 130 | `0x82` |
| 31 | `0x1F` | Garmin FMI data passthrough | 131 | `0x83` |
| 32 | `0x20` | Weighting-system data | 132 | `0x84` |
| 33 | `0x21` | FLS channel response | 133 | `0x85` |
| 34 | `0x22` | SD-card log | 134 | `0x86` |
| 35 | `0x23` | Accident reconstruction | 135 | `0x87` |
| 37 | `0x25` | Files (camera / fatigue sensor) | 137 | `0x89` |
| 38 | `0x26` | Beacon data over GPRS | 138 | `0x8A` |
| — | — | *(server-only)* Set connection parameters | 105 | `0x69` |
| — | — | *(server-only)* Set odometer | 106 | `0x6A` |

**`ack = command + 100` is FALSE** for commands **1, 68, 12, 18, 19**. Every other pair follows the
rule, which is exactly what makes the exception invisible until you derive it. §7.1.

**One naming collision to keep straight:** command id **68** (device extended records) is byte `0x44`;
command id **104** (server firmware update) is byte `0x68`. The number 68 appears in this protocol as
both a decimal command id and a hex byte, in opposite directions.

### 3.2 Records packet — commands 1 (`0x01`) and 68 (`0x44`)

```
plen(2) | IMEI(8) | cmd(1) | recordsLeft(1) | numRecords(1) | record × numRecords | CRC16(2)
```

`numRecords` may legitimately be **0** (empty packet, used to signal "nothing left" in the SD-log
flow). The **only** wire discriminator between the two encodings is the command byte.

#### 3.2.1 Classic record header — command 1 — exactly 23 bytes

VERIFIED. Decoded the vendor's 30-record 825-byte example byte-exactly, consuming 823/823 payload
bytes with CRC `0x46E2` valid; and 7 further real captures.

| Off | W | Type | Field | Scale / units |
|---|---|---|---|---|
| 0 | 4 | u32 | Timestamp | **UNIX seconds, UTC** (rank 1 §1.2.1) |
| 4 | 1 | u8 | Timestamp extension | §3.3 — counter *and*, in classic, a merge descriptor |
| 5 | 1 | u8 | Priority | `0` = low, `1` = high. Values observed: 0 and 1 only. **The vendor's value column was stripped by the mirror** (§9 Q11). |
| 6 | 4 | **i32** | **Longitude** | ÷ 1e7 degrees |
| 10 | 4 | **i32** | **Latitude** | ÷ 1e7 degrees |
| 14 | 2 | **i16** *(disputed)* | Altitude | ÷ 10 metres — **§7.5, §9 Q1** |
| 16 | 2 | u16 | Angle | ÷ 100 degrees, 0 = North, clockwise |
| 18 | 1 | u8 | Satellites | count |
| 19 | 2 | u16 | Speed | **km/h**, no scaling |
| 21 | 1 | u8 | HDOP | ÷ 10. **`0xFE` (254) is a flag, not a value** — §3.4 |
| 22 | 1 | **u8** | Event ID | the **IO ID** that triggered this record; `0` = none, `252` = SD-log record |

**Longitude precedes latitude.** VERIFIED twice over: the vendor's own example decodes to
lon 42.6654266 / lat 18.3451283 with altitude 2028.6 m — the Asir highlands near Abha, Saudi Arabia,
~2000 m. Reversed, it lands in the sea. Independently, DIMO's golden pair decodes to lon 25.221485 /
lat 54.7411983 = Ruptela HQ, Vilnius.

#### 3.2.2 Extended record header — command 68 — exactly 25 bytes

Identical to the classic header **plus** a `recordExtension` byte inserted at offset 5, and the event
ID widened to u16. VERIFIED on four real cmd-0x44 frames (Traccar `0x0146`, `0x01A4`, `0x033D`; DIMO's
491-byte capture) plus DIMO's published expected decode.

| Off | W | Type | Field |
|---|---|---|---|
| 0 | 4 | u32 | Timestamp (UNIX s, UTC) |
| 4 | 1 | u8 | Timestamp extension |
| **5** | **1** | **u8** | **Record extension** — merge descriptor, §3.3 |
| 6 | 1 | u8 | Priority |
| 7 | 4 | i32 | Longitude ÷1e7 |
| 11 | 4 | i32 | Latitude ÷1e7 |
| 15 | 2 | i16 *(disputed)* | Altitude ÷10 m |
| 17 | 2 | u16 | Angle ÷100° |
| 19 | 1 | u8 | Satellites |
| 20 | 2 | u16 | Speed km/h |
| 22 | 1 | u8 | HDOP ÷10 |
| **23** | **2** | **u16** | **Event ID** |

#### 3.2.3 Record body — four fixed groups, always in this order

```
count1(u8)  [ ID | value(1 byte)  ] × count1
count2(u8)  [ ID | value(2 bytes) ] × count2
count4(u8)  [ ID | value(4 bytes) ] × count4
count8(u8)  [ ID | value(8 bytes) ] × count8
```

VERIFIED on 10 frames. **All four group headers are always present**, in that order; any count may be
`0`. A record with all four counts zero is legal — the minimum body is **4 bytes** — and a real
5-record capture in §8 has exactly that in every record.

| Property | Classic (cmd 1) | Extended (cmd 68) |
|---|---|---|
| IO ID width | **1 byte** | **2 bytes, big-endian** |
| Reachable IO IDs | 0 – 255 | 0 – 65535 |
| Header size | 23 B | 25 B |
| Min record | 27 B | 29 B |
| Max record (1009-byte packet) | 126 B | 101 B *(the vendor's stated body max)* |

VERIFIED (rank 1 §2.3): *"For extended record protocol IO ID numbers are 2 bytes long (big endian)."*

**Value endianness is big-endian, always.** **Values are unsigned by default**; signedness is a
per-ID **exception list**, not derivable from the wire (§5.3). There is no type or sign bit anywhere
in the record.

**The group header decides the width, always.** If a documented 2-byte parameter turns up in the
4-byte group, read **4 bytes** and flag it — do not read 2 and desync the rest of the record. §7.11.

### 3.3 Split records — TWO different merge encodings

This protocol splits one physical moment across several records when the configured IO set does not
fit one record's body. It does it **two different ways** depending on the record encoding, and only
one of them is implemented by anybody.

#### 3.3.1 Extended (command 68) — `recordExtension` byte, BCD nibbles — VERIFIED

| Nibble | Meaning |
|---|---|
| high | **total − 1** (`0`–`7` ⇒ 1–8 parts) |
| low | **0-based index** of this part |

`0x00` = standalone record. Rank 1 §2.4 states it in BCD terms (*"0x74 ⇒ 5th record of 8"*).
Verified on real captures carrying `0x20,0x21,0x22` (3 parts), `0x30,0x31,0x32,0x33` (4 parts), and
`0x10,0x11` (2 parts, inside an RS232 tunnel).

**The merge key is `(timestamp, timestampExtension)` — NOT adjacency.** VERIFIED by the decisive
capture: an 8-record frame carrying **two independent 4-part groups at the same UNIX second**,
distinguished only by `tsExt` 0 and 1. And by the adversarial capture (traccar#1855, FM-Pro4) where
the parts arrive **out of order and interleaved**: `(08:09:45,0,0x11) (08:09:45,0,0x10)
(08:09:57,1,0x11) (08:09:57,0,0x10) (08:09:57,0,0x11) (08:09:57,1,0x10) …`.

The parts carry a **byte-identical header** (ts, tsExt, priority, lon, lat, alt, angle, sat, speed,
hdop, event) — so merging is the **union of the IO maps under part 0's header**.

**A merge group can span two TCP frames** when a device drains a large buffer (traccar#5190). Merge
state must be per-device and must survive packet boundaries. §7.10.

#### 3.3.2 Classic (command 1) — `timestampExtension` read as DECIMAL — spec-only

**INFERRED / UNTESTED.** Rank 1 §1.5, stable verbatim across v1.67 (2017), v1.82, v1.103 and v1.113:
read the `tsExt` byte as a **decimal number `abc`**.

| Digit | Meaning |
|---|---|
| `a` (hundreds) | `0` = plain counter, `1` = **this is a merge fragment** |
| `b` (tens) | **total parts − 1** (max 10 parts) |
| `c` (units) | 0-based index |

The vendor's worked example: `0x84 = 132` ⇒ merge, 4 parts total, this is part 3.
Values `0`–`99` are the plain intra-second counter.

**No open implementation implements this.** Traccar reads and discards the byte for `MSG_RECORDS`.
Every classic capture in this corpus has `tsExt` = 0 or a small counter; **not one exercises the
decimal encoding**. This is a real, undetected data-loss path on older Eco4/Tco4 firmware and it is
exactly the symptom behind the Traccar forum thread *"Ruptela splits data"*, where the reporter had to
work around it with `processing.copyAttributes`. §7.9, §9 Q12.

**CONTRADICTION, vendor against itself (rank 1 vs rank 1).** §1.2.2 says the tsExt byte is *"an extra
byte to separate records with same time stamp. If some records have same time stamp when time stamp
extension will increase starting with zero."* §1.5 says it is a 3-decimal-digit merge descriptor.
These cannot both be true of the same value: under §1.5, `132` means "merge, 4 fragments, this is
#3"; under §1.2.2 it means "the 133rd record in this second". They reconcile **only** if `0`–`99` is
the counter and `100`–`199` is the merge descriptor — which is self-consistent, since the digit ranges
are `a ∈ {0,1}`, `b ∈ 0..9`, `c ∈ 0..9`. Implement that reading; log loudly on any tsExt ≥ 100 so the
first real occurrence surfaces.

Under command 68 the ambiguity disappears entirely: merging moved to the dedicated
`recordExtension` byte, and `tsExt` is only ever the counter.

#### 3.3.3 The timestamp extension is a COUNTER, not milliseconds

**CONTRADICTION (rank 1 vs rank 4).** Vendor §1.6/§2.5: *"Virtual milliseconds, enables to identify
multiple records in one second. If three records are collected in one second first record will have
time extension 00, second 01, third 02."* DIMO takes the word "milliseconds" literally:
`timestampWithMs := timestamp.Add(time.Duration(record.Header.TimestampExtension) * time.Millisecond)`
(`ruptela/cloudevent.go`). flespi keeps the real second and exposes a separate sequence key.

**Trust the vendor's own worked example: it is an ordinal counter.** The word doing the work in that
sentence is *"virtual"*. DIMO's reading manufactures sub-second precision that was never measured — a
record 400 ms later is stamped +1 ms. Ordering survives either reading; the timestamp does not.
VERIFIED in DIMO's own golden capture: three records at `2022-09-21T10:33:42Z` with tsExt 0, 1, 2.

**And it is not a reliable tiebreaker anyway.** §7.8 — real firmware emits two records with identical
`ts` AND identical `tsExt` and different payloads.

### 3.4 No fix — TWO representations, both traps

**Mode A — default.** VERIFIED (rank 1 §1.2.10, verbatim): *"If the FM device at the time when the
record was generated did not have valid coordinates … then parameters Longitude, Latitude, Altitude,
Angle values would be last valid fix. HDOP, Satellites and Speed would be cleared to 0."*

Directly visible in the vendor's own 30-record example: records 0–11 repeat one position with
`sat=0, speed=0, hdop=0`, then record 12 has `sat=4, speed=2, hdop=3.4`. **28 of the 30 records are
stale.**

**Mode B — "data collection without GPS fix" enabled.** Signed fields → type MIN, unsigned → all-ones.
VERIFIED **by decode only** (see the warning at the top of this document: the vendor sentence in §1.3
that names these values has had its numeric column stripped by the mirror):

| Field | Sentinel | As a naive decode |
|---|---|---|
| Longitude | `0x80000000` | −214.7483648 |
| Latitude | `0x80000000` | −214.7483648 |
| Altitude | `0x8000` | 3276.8 m *(unsigned)* / −3276.8 m *(signed)* |
| Angle | `0xFFFF` | 655.35° |
| Satellites | `0xFF` | 255 |
| Speed | `0xFFFF` | 65535 km/h |
| HDOP | `0xFF` | 25.5 |

Source: one real FM-Eco4 Light 3G capture, 29 records, every one carrying the full sentinel block
(traccar#5152). **One device, one firmware, one configuration checkbox.** That is the entire
evidentiary basis, and it is the weakest load-bearing claim in this document (§10).

The sentinel pattern is nevertheless *structurally* self-consistent — signed fields take MIN,
unsigned take MAX, exactly matching §1.3's split into *"fields which can be positive or negative"* and
*"fields which can only be positive"* — and that structure is itself the strongest evidence that
**longitude, latitude and altitude are signed** and **angle, satellites, speed and HDOP are unsigned**.

> **Ruptela never sends 0/0 for "no fix."** ADR-039's `isNullIsland` is necessary but **not
> sufficient** here. And `satellites > 0` catches Mode A correctly (sat is cleared to 0) but is
> **completely defeated** by Mode B (sat = 255). Do not replace rule 6 — extend it. §7.3, §7.4.

**HDOP = `0xFE` (254) is an accuracy FLAG hiding in a scalar field.** VERIFIED (rank 1 §1.2.10 note):
*"In cases when GSM tracking functionality is enabled in the FM device, the HDOP value of received
records will always be 0xFE (254 in decimal), because the coordinates are approximate."* The position
is **GSM/LBS-derived, not GNSS**. Traccar silently turns it into `hdop 25.4` on a position it marks
valid, which feeds cell-tower fixes into trip distance. **No capture in this corpus contains it** —
this path is untested (§9 Q13).

### 3.5 DTC packet — command 9 (`0x09`)

```
plen(2) | IMEI(8) | 09 | count(1) | dtcRecord × count | CRC16(2)
```

Each DTC record is exactly **19 bytes**. VERIFIED byte-for-byte against both the vendor's §3.2.9
worked example and Traccar's test vector — they are the *same payload*, and my decode reproduces the
vendor's stated expected values exactly.

| Off | W | Field | Values |
|---|---|---|---|
| 0 | 1 | Source | `0xFF` = OBD · `0x01` = J1939 · `0x02` = J1708 |
| 1 | 4 | Timestamp | UNIX seconds |
| 5 | 4 | **Longitude** | i32 ÷1e7 — **lon before lat, same as the record header** |
| 9 | 4 | **Latitude** | i32 ÷1e7 |
| 13 | 1 | Status | `1` = current · `2` = history |
| 14 | 5 | Code | **ASCII for OBD** (`"P0010"`) · **raw hex** for J1939/J1708 |

Decoded: `1318891308 (2011-10-17T22:41:48Z) / 13.1467505 E / 43.7551290 N / current / "P0010"` and
`… / history / "P0011"`.

**The J1939/J1708 5-byte encoding is UNKNOWN** (§9 Q14). The spec says only *"For J1939 and J1708 data
sources diagnostic trouble code is in HEX format"* and gives no field breakdown. A J1939 DM1 DTC is
normally **4** bytes (19-bit SPN, 5-bit FMI, 1-bit CM, 7-bit OC) — the fifth byte is unexplained.
Every public sample is OBD.

Server ACK: `0002 6D 01 C4A4`. ACK byte `2` on command 109 means **"send me your DTCs"** (a request),
not an error.

### 3.6 Every other device→server payload

All CRC-verified against the vendor's own examples unless marked. VERIFIED = my field-by-field
reconstruction reproduced the printed CRC (a 16-bit match over 20–1020 bytes proves the byte sequence).

| Cmd | Payload layout | Status |
|---|---|---|
| `0x0F` (15) ident | `type(4 ASCII) fw(11 ASCII) IMSI(8) operator(4) distCoef(4) timeCoef(4) angleCoef(2)` = **37 B** | VERIFIED ×3 |
| `0x12` (18) dyn ident | `version(1) count(1) { id(1) len(1) value(len) } × count` | VERIFIED |
| `0x10` (16) heartbeat | **empty** (`plen = 9`) | VERIFIED |
| `0x11` (17) set-IO ack | `ack(1)`: **0 = changed (success)**, 1 = failed, 2 = unsupported | VERIFIED |
| `0x03` (3) version | ASCII CSV `"<bootloader>,<firmware>,<hardware>,<gsmLevel 0-31>,<voltageOk 0|1>"`, e.g. `"542C,00.03.09.10,668,22,1"` | VERIFIED |
| `0x02` (2) config | ASCII, CR-LF terminated, e.g. `"@cfg_sts#10\r\n"` | VERIFIED (control messages only) |
| `0x04` (4) firmware | ASCII, CR-LF terminated, e.g. `"*FU_OK|\r\n"` | VERIFIED (control strings only) |
| `0x07` (7) SMS-over-GPRS | free ASCII, the textual reply to an SMS command, e.g. `"DIN1=1,DIN2=0,…,AIN2=26"` | VERIFIED |
| `0x0E` (14) transparent | `portId(1) reserved(2) timestamp(4) data[1-1004]`. Port `0` = A, `1` = B, `2` = C (4th gen). Device *"does not start sending other tunnel channel data until ACK is received from server (command 114)"* | VERIFIED |
| `0x0A` (10) tacho | `status(4, signed) subId(1) packetStatus(1) reserved(2) subIdPayload`. For subId 3 the payload is an **ISO-7816 APDU** (`00 A4 02 0C 02 00 02` = SELECT FILE). Status: `0` OK, `-1` bad value, `-2` bad parameter, `-3` timeout, `-4` negative answer, `-5` busy, `-6` driver card in flash, `-7` bad SubID, `-8` internal error | VERIFIED |
| `0x0B` (11) DDD data | `packetIndex(2) fragment[1-1009]` | VERIFIED (one full 1024-byte frame) |
| `0x0C` (12) tacho info | `storage(1: 1=internal flash, 2=SD) size(4) readTimestamp(4) periodStart(4) periodEnd(4) packetIndex(2) payloadCRC16(2)` = **30 B**. `packetIndex = 0xFFFF` requests a fresh download from the beginning | VERIFIED — the reconstruction proves `plen` is 30, not the `0x000B` the mangled table shows |
| `0x06` (6) card size | `size(2) timestamp(4)` | VERIFIED — **the vendor's own example prints a wrong `plen`** (§7.28) |
| `0x13` (19) card size, 2nd gen | `size(4) timestamp(4)` | VERIFIED (self-consistent) |
| `0x05` (5) smart-card data | *"Raw data segment of DDD file"* — 512-byte payloads | **GAP** — no complete frame exists anywhere (§9 Q15) |
| `0x22` (34) SD log | **`subcommand(1) recordsLeft(1) numRecords(1) records[]`** — an extra byte *before* recordsLeft. `0x40` = classic-protocol records, `0x80` = extended. **Every SD-log record carries event ID 252** | VERIFIED (control subcommands only; no capture of actual log records — §9 Q16) |
| `0x23` (35) accident | announcement (data version `0x02`, 29 B): `accHz(2) accBefore(1) accAfter(1) gyroHz(2) gyroBefore(1) gyroAfter(1) gnssHz(1) gnssBefore(1) gnssAfter(1)` + 9 × i16 calibration matrix. Data (version `0x03`): `recordsLeft(1) type(1) count(1)` then — type `0` accel / `1` gyro: `id(2) x(i16) y(i16) z(i16)`; type `2` GNSS: `id(2) **lat**(i32) **lon**(i32) ts(4) speed(2)` | **PARTIAL** — layouts only, no reconstructable frame (§9 Q17) |
| `0x25` (37) files | `subcommand(1) source(1) …`; the *Transfer* reply is `name(8 ASCII, space-padded) totalPackets(2) currentPacket(2) data`. Subcommands: `0` Quantity, `1` Name, `2` Transfer, `3` Delete by name, `4` Delete by timestamp range. Sources: `0` Camera A folder on SD, `1` Camera B folder on SD, `2` PortA camera memory, `3` PortB camera memory, `4` Fatigue-sensor folder on SD, `5` Fatigue-sensor memory (FM-Eco4 RS T only) | VERIFIED (one real 1024-byte JPEG chunk + all control frames) |
| `0x26` (38) beacons | **`numRecords(1) recordsLeft(1)`** *(reversed vs 1/68)* then ≤ 4 records of `ts(4) lon(4) lat(4) msgType(1) nBeacons(1)` + ≤ 6 × `rssi(1) type(1) data(37) flag(1)`. **RSSI dBm = value − 256** (e.g. 181 ⇒ −75 dBm). Type `1` iBeacon, `2` Eddystone, `3` MAC-only. Flag `0x00` none, `0x44` = C (cargo), `0x54` = T (wireless trailer ID). `numRecords` is a **session total** "including those that were received with this message" | **PARTIAL** — the vendor prints `-` for both the records and the CRC; my reassembly of the 54-byte record comes out one byte long with nothing to check it against (§9 Q18) |
| `0x20` (32) weighting | `timestamp(4) longitude(4) latitude(4) gpsFix(1) port(1)` = **14 B**, then an ASCII string, e.g. `"0000000300:0000000700:GLASS\r"` | VERIFIED framing (CRC matched my reassembly) — but the example is **semantically corrupt**: it decodes to latitude 97.44°. Trust the field table, not the example. |
| `0x21` (33) FLS | `answerToSubId(1) portX(1) flsPackage` | **UNRESOLVED command byte** — see below |
| `0x1E` (30) Garmin status | `status(1)`: `1` = not responding, `2` = responding, `3` = responding + unicode protocol — **and NO IMEI field** (see below) | VERIFIED (CRC over an IMEI-less frame matches) |
| `0x1F` (31) Garmin FMI | raw Garmin FMI message, DLE-framed (`0x10 … 0x10 0x03`) — needs byte-stuffing awareness if tunnelled | VERIFIED |

**Two documentation defects in this table that matter:**

1. **Command 30 (Garmin status) has no IMEI field.** The vendor's table is
   `Packet length(2) | Command ID(1) | Status(1) | CRC16(2)` with example `0002 1E 01 1E08` — and I
   confirmed CRC16 over the two bytes `1E 01` really is `0x1E08`, so the vendor computed it over an
   **IMEI-less** frame. Identical in v1.67, v1.82 and v1.113. Every *other* device→server packet
   carries the IMEI at offset 2. Either a five-year-old doc error or a genuine quirk. **Safe rule:
   reject as IMEI-bearing any device→server frame whose `plen < 9`** — which also closes the
   under-length hole in §2.11 rule 2.
2. **Command 33 (FLS) open-response command byte is unresolved.** The field table says command
   `33 (0x21)`, and the SubCmdID-2 example indeed uses `0x21`. But the SubCmdID-1 example prints
   `0x11` in the command position — and I computed the CRC both ways: with `0x11` the CRC is `DD6A`
   (matches the doc), with `0x21` it is `A1CB` (does not). **The doc's CRC was computed over its own
   typo.** Trust the field table and the SubCmdID-2 example: the real command is `0x21` = 33. Do not
   use the SubCmdID-1 response as a fixture.

### 3.7 Server→device payloads

| Cmd | Payload |
|---|---|
| 100 `0x64` | `ack(1)` — `0` NACK, `1` ACK |
| 102 `0x66` | ASCII configuration, CR-LF terminated, e.g. `"#cfg_start@\r\n"` |
| 103 `0x67` | *(empty)* — version request |
| 104 `0x68` | ASCII firmware control, e.g. `"|FU_STRT*\r\n"`, or a binary chunk |
| 105 `0x69` | ASCII `"<ip>,<port>,<TCP|UDP>"`. **No response.** Applies **once**, on the next connection. |
| 106 `0x6A` | `odometer(4)`. **No response.** *"Next generated record will have new odometer value."* |
| 107 `0x6B` | `ack(1)` — `0` NACK, `1` ACK, `2` card data rejected |
| 108 `0x6C` | *(SMS-over-GPRS ack)* |
| 109 `0x6D` | `ack(1)` — `0` NACK, `1` ACK, `2` = request DTCs |
| 110 `0x6E` | `subCommandId(1) reserved(2) subIdPayload` — tacho read is initiated by the server with SubID `2`, after which *"FM device takes control of communication and server needs only to respond correctly"* |
| 111 `0x6F` | `ack(1) packetIndex(2)` — `1` = positive, `2` = **data rejected and the device deletes everything from its memory** |
| 114 `0x72` | `ack(1) portId(1) reserved(2) [optional payload]` — the optional payload is written straight out of the RS232 port |
| 115 `0x73` | `ack(1) [delay(1) if ack==2]` — `1` = ACK, `2` = reject + lockout minutes |
| 116 `0x74` | `ack(1)` |
| 117 `0x75` | `ioId(4) ioValue(4)` — **both 4 bytes**. Settable IDs: `65` virtual odometer, `175` ECO absolute idling time, `114` CANBUS distance (overwritten by a valid CAN message), `577`–`580` DIN1-4 hours accumulated |
| 130 `0x82` | *(empty)* — Garmin status request |
| 131 `0x83` | raw Garmin FMI message |
| 132 `0x84` | `ack(1)` |
| 133 `0x85` | `subCmdId(1) portX(1) [flsPackage]` — subcommand `1` open RFLS channel, `2` send data, `3` close. Port `0`=A, `1`=B, `2`=C |
| 134 `0x86` | `subcommand(1) …` — `0` request log (`+ startTs(4) endTs(4) reserved(2)`), `1` ACK, `2` stop sending, `0x10` erase SD card, `0x20` enable/disable logging (`+ enable(1) ts(4)`) |
| 135 `0x87` | `ack(1)` |
| 137 `0x89` | `subcommand(1) sourceId(1) …` — `0` Quantity (`+ tsStart(4) tsEnd(4)`), `1` Name, `2` Transfer (`+ name(8 ASCII) packetNo(2)`), `3` Delete by name, `4` Delete by ts range |
| 138 `0x8A` | `ack(1)` |

---

## 4. Worked examples — decoded byte by byte

Every frame below was decoded by a decoder I wrote from this document's tables, and every one
consumed the frame with **zero slack bytes** before the CRC, with the CRC recomputing to the value on
the wire. The provenance of each frame is stated.

### 4.1 The records ACK (server → device, 6 bytes)

Source: rank 1 §3.2.1/§3.2.2, and hardcoded identically in Traccar, DIMO and `dimitrievski/ruptela`.

```
00 02   64   01   13 BC
└─┬─┘   └┬┘  └┬┘  └─┬─┘
  │      │    │     └── CRC-16/KERMIT over [64 01] = 0x13BC          (I recomputed it)
  │      │    └──────── ACK = 1  ⇒ THE DEVICE ERASES THE SENT RECORDS
  │      └───────────── command 100 (0x64) — answers cmd 1 AND cmd 68
  └──────────────────── plen = 2  (command + payload; excludes itself and the CRC)
```

Total 6 bytes = `plen + 4`. The NACK is the same frame with `01` → `00` and CRC `0235`
(**INFERRED** — derived, never captured).

### 4.2 Heartbeat (device → server, 13 bytes — the minimum device frame)

Source: rank 1 §3.2.15.

```
00 09   00 03 10 F5 61 74 90 07   10   BD 93
└─┬─┘   └───────────┬──────────┘  └┬┘  └─┬─┘
  │                 │              │     └── CRC over [IMEI ‖ 10] = 0xBD93
  │                 │              └──────── command 16 (0x10), payload is EMPTY
  │                 └─────────────────────── IMEI 863071018192903 (u64 BE)
  └───────────────────────────────────────── plen = 9 = 8 (IMEI) + 1 (cmd) + 0 (payload)
```

This frame is the proof that the spec's own *"Payload Data … [1-1011]"* annotation is wrong: the
payload is zero bytes. Answer with `0002 74 01 862D`.

### 4.3 Identification, command 15 (device → server, 50 bytes)

Source: rank 2, `RuptelaProtocolDecoderTest.java` — a real FM-Eco4 S/T capture.
Frame: `002e000316d53d58d6020f4573303430302e30332e36382e30340000c2b3090d0e950000827b000003e80000003c003c1681`

| Bytes | Field | Value |
|---|---|---|
| `002E` | plen | 46 = 8 + 1 + 37 |
| `000316D53D58D602` | IMEI | 869530043209218 |
| `0F` | command | 15 — identification |
| `45 73 30 34` | device type (4 ASCII) | **`"Es04"`** = FM-Eco4 S / FM-Eco4 T |
| `30 30 2E 30 33 2E 36 38 2E 30 34` | firmware (11 ASCII) | **`"00.03.68.04"`** |
| `0000C2B3090D0E95` | IMSI (u64) | 214074206785173 |
| `0000827B` | GSM operator (u32) | 33403 |
| `000003E8` | distance coefficient | 1000 |
| `0000003C` | time coefficient | 60 |
| `003C` | angle coefficient | 60 |
| `1681` | CRC | matches |

Payload is exactly 37 bytes; the cursor lands exactly on the CRC. Answer `0002 73 01 CB25`.
**Capture the type and firmware strings** — this is the only place the device tells you what it is.

### 4.4 Classic records, command 1 — a single well-formed record

Source: rank 2, real FM-something capture, Dubai.
Frame: `00560003116e7438a7a50100015565cbb9000020fd21300f113f4600005f000600090d090805011b13cf00020003001c012029ad00041d31dd1e0ebd160000c50000047200000000d0000000004100016a2a960000a5a300c9ee`

**Envelope**

| Bytes | Field | Value |
|---|---|---|
| `0056` | plen | 86 (actual body 86 ✓) |
| `0003116E7438A7A5` | IMEI | 863591024076709 |
| `01` | command | 1 — classic records |
| `00` | recordsLeft | 0 — flash is empty |
| `01` | numRecords | 1 |

**Record header (23 B)**

| Bytes | Field | Raw | Decoded |
|---|---|---|---|
| `5565CBB9` | timestamp | 1432734649 | 2015-05-27T13:50:49Z |
| `00` | tsExt | 0 | first record this second |
| `00` | priority | 0 | low |
| `20FD2130` | longitude | 553460016 | **55.3460016 E** |
| `0F113F46` | latitude | 252788550 | **25.2788550 N** (Dubai) |
| `0000` | altitude | 0 | **0.0 m — a legitimate zero, NOT a sentinel** |
| `5F00` | angle | 24320 | 243.20° |
| `06` | satellites | 6 | valid fix |
| `0009` | speed | 9 | 9 km/h |
| `0D` | HDOP | 13 | 1.3 |
| `09` | event ID | 9 | "Course record" — a virtual/header-only IO (§5.4) |

**Body — four groups**

```
08                                 count1 = 8 one-byte values
   05 01   1B 13   CF 00   02 00   03 00   1C 01   20 29   AD 00
   │  │    │  │    │  │                    │  │    │  │
   │  │    │  │    │  └── IO 207 CAN fuel level = 0
   │  │    │  └────────── IO 27  GSM signal = 19 (CSQ index, NOT dBm)
   │  └───────────────── IO 5   ignition (DIN4) = 1
   │                            IO 28 current profile = 1
   │                            IO 32 PCB temperature = 0x29 = 41  ← SEE §7.20
   │                            IO 173 = 0
04                                 count2 = 4 two-byte values
   1D 31DD   1E 0EBD   16 0000   C5 0000
   │  │      │  │      │         │
   │  │      │  │      │         └── IO 197 CAN engine speed = 0
   │  │      │  │      └──────────── IO 22  AIN1 = 0 mV
   │  │      │  └─────────────────── IO 30  battery voltage = 3773 mV = 3.773 V
   │  └────────────────────────────  IO 29  power supply = 12765 mV = 12.765 V
04                                 count4 = 4 four-byte values
   72 00000000   D0 00000000   41 00016A2A   96 0000A5A3
   │             │             │             └── IO 150 GSM operator = 42403 ⇒ MCC 424 / MNC 03 (UAE, du)
   │             │             └──────────────── IO 65  virtual odometer = 92714 METRES = 92.7 km
   │             └────────────────────────────── IO 208 CAN engine total fuel used = 0
   └──────────────────────────────────────────── IO 114 CAN HR total vehicle distance = 0
00                                 count8 = 0
C9EE                               CRC — matches
```

Cursor lands exactly on the CRC. **Note `IO 32 = 41`** — that is simultaneously a completely plausible
PCB temperature for Dubai in late May *and* one of the two values the FMIO workbook lists as this
parameter's error sentinel. Nothing on the wire distinguishes them. §7.20.

### 4.5 Extended records, command 68 — the golden pair

Source: rank 4 with a **published, machine-checked expected decode** — DIMO's
`sample_data/sample_input` + `sample_output`, MIT licensed. My decode reproduces their published
output field for field.

Frame head: `01EB 00030EA2BC939936 44 00 06 …`, `plen = 491`, IMEI **860517041412406**, command 68,
recordsLeft 0, **6 records**, CRC `B5DA` ✓.

**Record 1 header (25 B)**

| Bytes | Field | Raw | Decoded |
|---|---|---|---|
| `632AE87E` | timestamp | 1663756414 | 2022-09-21T10:33:34Z |
| `00` | tsExt | 0 | |
| `00` | **recordExtension** | 0 | **standalone — not a merge fragment** |
| `00` | priority | 0 | low |
| `0F087E42` | longitude | 252214850 | **25.2214850 E** |
| `20A0D80F` | latitude | 547411983 | **54.7411983 N** — Ruptela HQ, Vilnius |
| `09AD` | altitude | 2477 | 247.7 m |
| `7738` | angle | 30520 | 305.20° |
| `08` | satellites | 8 | |
| `0000` | speed | 0 | |
| `0A` | HDOP | 10 | 1.0 |
| `0007` | event ID (**u16**) | 7 | "Time record" — a periodic record |

**Record 1 body — note the 2-byte IO IDs**

```
0A   0005 00 · 0199 00 · 019F 01 · 001B FF · 01A2 00 · 00AD 00 · 001C 01 · 02F7 01 · 02FA FF · 0006 00
     └ 10 one-byte values, IO ids 5, 409, 415, 27, 418, 173, 28, 759, 762, 6
       IO 27 = 0xFF = 255 ⇒ GSM signal UNKNOWN (any value > 31 is an error code) — §7.19
02   001E 0006 · 001D 2EA6
     └ IO 30 battery = 6 mV(?)   IO 29 power supply = 11942 mV = 11.942 V
02   0096 00000000 · 020D 00000011
     └ IO 150 operator = 0        IO 525 = 17
00   (no 8-byte values)
```

IO IDs 409, 415, 418, 525, 759, 762 are **all ≥ 256** — unreachable over command 1. This is what the
extended protocol buys you.

Records 2–6 of the same frame carry tsExt `0, 0, 1, 2, 0` and event IDs 763, 150, 762, 763, 418 —
i.e. **three records inside the single second `10:33:42Z`, distinguished only by tsExt 0/1/2**,
which is the direct proof that tsExt is an ordinal counter and not milliseconds (§3.3.3).

### 4.6 The no-fix sentinel, byte by byte — and the duplicate-key collision

Source: rank 5 + rank 2 — a real **FM-Eco4 Light 3G** capture posted in traccar#5152 and later added
to Traccar's corpus. `plen = 0x03FB = 1019` (the maximum practical flush), CRC `AD9E` ✓, **29
records**, `recordsLeft = 1`.

```
03FB  0003137CA79F856D  01  01  1D  …
                            │   └── 29 records
                            └────── recordsLeft = 1 → more still buffered
```

**Record 0:**

```
386D438B  00  00  80000000  80000000  8000  FFFF  FF  FFFF  FF  07  02 2021 1BFF  01 1D30C5  00 00
    │     │   │      │          │       │     │    │    │    │   │
    │     │   │      │          │       │     │    │    │    │   └── event 7 (periodic)
    │     │   │      │          │       │     │    │    │    └────── HDOP  = 0xFF  SENTINEL
    │     │   │      │          │       │     │    │    └─────────── speed = 0xFFFF SENTINEL
    │     │   │      │          │       │     │    └──────────────── sats  = 0xFF  SENTINEL (NOT 0!)
    │     │   │      │          │       │     └───────────────────── angle = 0xFFFF SENTINEL
    │     │   │      │          │       └─────────────────────────── alt   = 0x8000 SENTINEL
    │     │   │      │          └─────────────────────────────────── lat   = 0x80000000 SENTINEL
    │     │   │      └────────────────────────────────────────────── lon   = 0x80000000 SENTINEL
    │     │   └───────────────────────────────────────────────────── priority 0
    │     └───────────────────────────────────────────────────────── tsExt 0
    └─────────────────────────────────────────────────────────────── ts = 946684811
                                                                        = 2000-01-01T00:00:11Z
                                                                        (RTC power-on default)
  body: 02 → IO 32 = 0x21 = 33 °C ; IO 27 = 0xFF = 255 (unknown)
        01 → IO 29 = 0x30C5 = 12485 mV = 12.485 V
        00 00
```

**Record 1 — the collision:**

```
386D438B  00  00  80000000 80000000 8000 FFFF FF FFFF FF  07  02 201F 1BFF  01 1D30C3  00 00
    │     │
    │     └── tsExt = 0  ← IDENTICAL to record 0
    └──────── ts = 946684811 ← IDENTICAL to record 0
  body: IO 32 = 0x1F = 31 °C  (record 0 said 33)
        IO 29 = 0x30C3 = 12483 mV (record 0 said 12485)
```

Two records, **same timestamp, same timestamp extension, same priority, same event, same IO IDs,
different IO values.** They are two genuinely independent samples. Any key of
`(device, timestamp)` or `(device, timestamp, tsExt)` silently drops one of them. And because
`tsExt = 0`, the classic decimal merge rule (§3.3.2) says *"not a merge"* — so merging is not the
answer either. §7.8.

Records 0–5 of this packet are at the year-2000 RTC epoch; records 6–28 jump to
`0x64C692CB … 0x64C6959A` = 2023-07-30T16:41:47Z … 16:53:46Z. **One packet, two epochs, one ACK.**
§7.23.

### 4.7 DTC, command 9 — the vendor's correctly-framed example

Source: rank 1 §3.2.9. (Traccar's copy of this exact payload has a **wrong length field** — §7.29.)

```
0030  00000B1A29F64B1A  09  02
 │            │         │   └── 2 DTC records
 │            │         └────── command 9
 │            └──────────────── IMEI 12207001062170  (14 digits — NOT 15!)
 └───────────────────────────── plen 48 = 8 + 1 + 1 + 2×19

DTC 1: FF  4E9CAF2C  07D608F1  1A1480BA  01  50 30 30 31 30
       │       │         │         │      │  └── ASCII "P0010"
       │       │         │         │      └───── status 1 = CURRENT
       │       │         │         └──────────── lat 437551290 → 43.7551290 N
       │       │         └────────────────────── lon 131467505 → 13.1467505 E
       │       └──────────────────────────────── ts 1318891308 → 2011-10-17T22:41:48Z
       └──────────────────────────────────────── source 0xFF = OBD

DTC 2: FF  4E9CAF2C  07D608F1  1A1480BA  02  50 30 30 31 31    → history, "P0011"

8C91   CRC ✓
```

Answer `0002 6D 01 C4A4`.

### 4.8 The extended-merge group, and why adjacency is not enough

Source: rank 2, `plen = 0x033D = 829`, IMEI 868324023580306 (FM-Pro4), command 68, **8 records**,
CRC `084D` ✓.

All eight records share the timestamp `0x58068F3B = 2016-10-18T21:08:11Z`. Their
`(tsExt, recordExtension)` pairs, in wire order:

```
(0, 0x30) (0, 0x31) (0, 0x32) (0, 0x33)   ← group A: 4 parts, priority 1, sat 12, event 5
(1, 0x30) (1, 0x31) (1, 0x32) (1, 0x33)   ← group B: 4 parts, priority 0, sat 13, event 7
```

**8 wire records ⇒ 2 stored positions.** A merger keyed on timestamp alone collapses two distinct
fixes into one. A merger that skips merging altogether stores 8 rows for 2 moments.

And the adversarial case, from a real FM-Pro4 capture (traccar#1855, `plen = 0x03C6 = 966`, CRC
`9D3F` ✓, 10 records, `recordsLeft = 1`) — the parts arrive **out of order and interleaved**:

```
(08:09:45, tsExt 0, 0x11)   ← part 2 of 2 arrives FIRST
(08:09:45, tsExt 0, 0x10)   ← part 1
(08:09:57, tsExt 1, 0x11)
(08:09:57, tsExt 0, 0x10)
(08:09:57, tsExt 0, 0x11)
(08:09:57, tsExt 1, 0x10)
(08:10:01, tsExt 0, 0x10)
(08:10:01, tsExt 0, 0x11)
(08:10:01, tsExt 1, 0x10)
(08:10:01, tsExt 1, 0x11)
```

Traccar's merger is adjacency-based (`positions.remove(positions.size() - 1)` when the low nibble is
non-zero). On **this real frame** it merges the `tsExt=1` part into the `tsExt=0` record and vice
versa — IO data from two different fixes lands on one position. §7.10.

### 4.9 Records tunnelled over RS232 — the other CRC

Source: rank 1 §3.2.13.1. Inside a transparent-channel payload, records are framed
`length(1) | recordData(length) | CRC8(1)`, repeated.

```
7B  5B8FB244 00 10 00 0F08DF75 20A0C52E 091F 7E04 0D 0000 0A 0007 …  75
│       │    │  │                                                     └── CRC-8/ROHC over the 123
│       │    │  └── recordExtension 0x10 = part 1 of 2                     record bytes  ✓
│       │    └───── tsExt 0
│       └────────── 2018-09-05T10:39:00Z, lon 25.2239733, lat 54.7407150 (Vilnius),
│                   alt 233.5 m, angle 322.60°, sat 13, speed 0, HDOP 1.0, event 7
└────────────────── record length 0x7B = 123
53  … (second record, recordExtension 0x11 = part 2 of 2) …  2A   ← CRC8 ✓
```

Both records are **extended-protocol records (25-byte header, 2-byte IO IDs)** carried inside a
classic-looking tunnel, and both CRC-8 values verify with poly `0xE0` reflected, init 0.

---

## 5. Parameter / IO dictionary

### 5.1 Where the authoritative dictionary lives — and why you cannot have it

**The protocol specification deliberately contains no IO dictionary.** VERIFIED (rank 1, v1.113 §1.6,
verbatim): *"The full list of IO parameters is available at the documentation website in the
'FMIODATA+size+description' file. Parameters that require the use of the v1.1 protocol start from ID
no. 256."*

The canonical file is **`FMIO list.xlsx`**, linked from Ruptela's own public help-centre article
(`https://my.ruptela.com/en/articles/9447397-io-parameter-names`) at
`https://doc.ruptela.com/resources/Storage/FMIO%20List/FMIO%20list.xlsx` — **HTTP 404 as of
2026-09-09**, verified by curl. The older path
(`…/Storage/tracking-devices-publication/FMIO%20List/FMIO%20list.xlsx`, posted on the Traccar forum)
is also 404. Everything under `doc.ruptela.com/api-proxy/` is login-gated. `FMIOData size
description.xlsx` on the old Confluence redirects to a login.

**Get it via a Ruptela support ticket.** `https://github.com/jrafaelca/ruptela-fmio` converts the
workbook straight to JSON (its code path is `SheetNames.find(name => name === 'IO Parameters')`).

**Sheet schema — VERIFIED** from screenshots of the real workbook posted by a Ruptela-adjacent user on
the Traccar forum (`https://iili.io/J1YwHEG.png`, `https://iili.io/J1YVwH7.png`); the sheet name is
independently confirmed by the converter's source.

| Column | Meaning |
|---|---|
| `IO ID` | 1 … 5011 |
| `Name` | canonical name (Configurator / Device Center wording) |
| `Size, B` | 1 / 2 / 4 / 8, **or the literal `Header`** |
| `Type` | `Unsigned int.` / `Signed int.` / `String` / `Header` |
| `Min. Value`, `Max. Value` | e.g. `-40` / `90` |
| **`Multiplier; offset`** | e.g. `-`, `0.4`, `5, -160635`, `Depends on counter` |
| `Units` | `mV`, `°C`, `ml`, `km`, `%`, … — **the WIRE unit** |
| **`Error values`** | e.g. `65535`, `41, 85`, `255 and 100` |
| `IO Explanation and Notes` | enum decoding **+ the FMS SPN number** |
| `Averaging`, `Event On Change` | per-parameter configuration flags |
| ~24 model columns | Yes/No per model (§1.2) |

**The `Multiplier; offset`, `Units` and `Error values` columns are the three you cannot get anywhere
else, and they are exactly the three that decide whether a number ships plausible-but-wrong.**

**Best public substitutes, in order:**

| Source | Coverage | Rank | Caveat |
|---|---|---|---|
| Ruptela **FM Manual v4.0 §5.5 "APPENDIX – IO LIST"** (`gps-vehicle.com/download/ruptela/Ruptela_FM_Manual_v4.0.pdf`) | **name-keyed** (not ID-keyed) with multipliers, offsets and worked examples | 1 | no IDs; 3rd/4th-gen vintage |
| FM-Eco3/Pro3/Tco3 configuration manual v1.2, Appendix A | second independent copy of the same table | 1 | 3rd gen |
| Ruptela Help Center "IO parameter names" | IO ID ↔ Configurator / LCM / TrustTrack2 naming | 1 | partial |
| **flespi** `https://flespi.com/protocols/ruptela` | 514 rows ⇒ **673 distinct IO IDs** (199 below 256, 474 at/above), names, units, command-ID mapping | 3 | **units are flespi's NORMALISED OUTPUT units, not wire units** — §7.18 |
| **DIMO** `ruptela/io_types.go` | ~240 typed IDs up to 5011: signed / string / bitmap / header / hex / timestamp classes | 4 | no multipliers |
| `dimitrievski/ruptela` `lib/record.js` line 80 | 62-entry **signed-ID exception list** | 4 | 2022 vintage |
| Traccar `RuptelaProtocolDecoder.java` | ~40 scaled IDs | 2 | several are wrong — §7 |

Traccar's maintainer **refused** to import the FMIO list on the grounds that *"the IO list is not
applicable to all devices"* — which is true, and is exactly why the per-model Yes/No columns matter.

### 5.2 Wire rules for IO values

| Rule | Value | Evidence |
|---|---|---|
| Body layout | four groups, widths 1/2/4/8, always all four present, always in that order | VERIFIED §3.2.3 |
| ID width | **1 B** in command 1, **2 B big-endian** in command 68 | VERIFIED, rank 1 §2.3 |
| Value endianness | big-endian, always | VERIFIED, all samples |
| Default type | **unsigned**; signedness is an exception list | rank 1 FMIO `Type` column |
| **The group header decides the width** | a documented 2-byte parameter found in the 4-byte group **is 4 bytes** | flespi shipped exactly this validation in 2026-02 — §7.11 |
| IDs ≥ 256 | reachable **only** over command 68. The device refuses to enable them otherwise: *"Configure group: VAG17, Error: old I/O protocol is used"* | VERIFIED, rank 1 §1.6, §4.1.51 |
| **IO slot budget** | **max 80 IO elements per profile**: *"If a LCV group contains more than 80 IO elements, it will not be enabled"* | VERIFIED, rank 1 §4.1.51 |
| Duplicate IDs in one group | **real devices do it.** A genuine FM-Pro4 capture carries IO `0x1B` (27) **twice in the same 1-byte group with the same value**. A parser that stores IO elements in a map silently collapses them; a parser that asserts uniqueness rejects a frame a real device sends. §7.30 | rank 5, own decode |
| Reserved IDs | devices emit IDs the spec marks reserved (**7, 8, 9**) as body parameters. flespi crashed on it (`close_code=5`) until 2026-02-15. §7.11 | rank 3 |

### 5.3 Signedness — an exception list, and the most-repeated defect in the protocol

There is **no sign bit on the wire**. Two independent implementations publish near-identical signed-ID
sets; use their union until you have the FMIO `Type` column:

`6, 26, 32, 33, 49, 50, 51, 56–64, 75, 76, 78, 79, 80, 96*, 97*, 101, 144–149, 184–187, 212, 229–234,
419, 509–514, 520, 584–587, 594, 600–604, 611–613`

`*` — **96 and 97 are in that list and should not be.** They are OBD temperatures and carry the
`A − 40 °C` offset instead. See §5.5 and §7.21.

**Traccar's own history is the cautionary tale.** Commit `5c1a5208` "Fix Ruptela unsigned parameters"
(2024-01-31) flipped IO **39, 65, 94, 95, 98, 100, 645** from signed to unsigned. Anything Traccar
decoded before that date, on a 4-byte field past 2 147 483 647, was silently negative — an odometer
that jumps backwards by 4295 km. flespi went the other way on temperatures: it parsed IO 6
(device temperature) and IO 32 (PCB temperature) as **unsigned** until 2026-01-27, and IDs 600–604
(BT temperature sensors) until 2022-04-12. A reefer at −18 °C read 238 °C, and cold-chain alarms never
fired on the one condition they exist for. §7.19.

**Also from Traccar's history:** commit `3cf07ef491` replaced `* 0.001` with `/ 1000.0` for IO 29/30
and `* 0.1` with `/ 10.0` for temperatures, because binary floating-point multiplication by 0.001 does
not round-trip. Use division.

### 5.4 Virtual / header-only IDs — never in the body

VERIFIED (rank 1 FMIO rows, `Size = Header`, `Type = Header`; observed as event IDs in real captures):

| ID | Name | Where it appears |
|---|---|---|
| 7 | Time record | **Event ID field only** |
| 8 | Distance record | Event ID field only |
| 9 | Course record | Event ID field only |
| 1177 | Virtual button | Event ID field only |
| 252 | *(SD-log marker)* | Event ID of **every** SD-card log record (rank 1 §3.2.24.1) |

The event ID field carries **the IO ID that generated the record**, `0` = none. So event `7` means
"periodic time trigger", event `8` means "distance trigger", event `173` means "IO 173 changed".
But **devices also emit 7/8/9 as body parameters** despite the `Header` type (§5.2) — tolerate them.

### 5.5 Scalings I proved against real frames

Every row below was decoded from a real capture and cross-checked against a second independent
quantity in the same record. **VERIFIED by decode.**

| ID | Name | W | Wire encoding | Proof |
|---|---|---|---|---|
| 29 | Power supply voltage | 2 | **mV**, error 65535 | `0x33D6` = 13270 → 13.270 V |
| 30 | Battery voltage | 2 | **mV**, error 65535, expected band 3300–4300 | `0x1038` = 4152 → 4.152 V, inside the stated band |
| 32 | PCB temperature | 1 | **signed °C**, no offset, range −40…80, errors `41` and `85` | `0x21`…`0x26` → 33–38 °C. **But see §7.20** |
| 6 | Modem / device temperature | 1 | **signed °C**, −40…90 | 0, 4, 9, 32 °C |
| 20 / 21 / 22 / 23 | **AIN3 / AIN4 / AIN1 / AIN2** | 2 | **mV**, error 65535 | FMIO rows verbatim — **the IDs are NOT in AIN order** |
| 18 / 19 | Fuel counter 1 / 2 | 2 | **ml** | FMIO |
| 27 | GSM/UMTS signal level | 1 | **0…31 CSQ index**, NOT dBm | observed `0x00, 0x0C, 0x13, 0x16, 0x18, 0x1F, 0x63, 0xFF` |
| 28 | Current profile | 1 | 1…4 (0 legal on 3rd gen) | |
| 34 | iButton driver ID | 8 | **raw 8-byte 1-Wire ROM**, not a number | `01D042F31D000030`, family `0x01` = DS1990A |
| 49 / 50 / 51 | Accelerometer X / Y / Z | 1 | **signed × 0.05 g** | `F4,FD,F2` → (−0.60, −0.15, −0.70) g, ‖a‖ = **0.934 g**; `F3,FB,F3` → ‖a‖ = **0.953 g** — gravity on a stationary vehicle |
| **65** | Virtual odometer | 4 | **METRES** — see §7.18 | same record: io65 = `0x007746CB` = 7 816 907 m = 7816.9 km vs io114 (5 m/bit) = 7993.0 km — 2.2 % apart. As km it would be 7.8 **million** km. Also measured two deltas: 125 units over 27 s at 16–19 km/h (≈131 m) and 15 units over 22 s at 0–5 km/h (≈15 m) |
| 78 / 79 / 80, 74 | 1-Wire temperature sensor 0…3 | 2 | **signed × 0.1 °C**, range −55.0…125.0, **errors 2001 (1-wire short), 2002 (CRC), 2003 (no sensor), 2004 (abnormal)** | vendor appendix — §7.17 |
| 92 | CAN HR engine total fuel used | 4 | **0.001 L/bit** | 508.44 L — agrees with io208 to 0.8 % |
| 94 | OBD engine RPM | 2 | **× 0.25 rpm** (OBD PID 0C) | `0x1B18` × 0.25 = **1734** = io920 (`0x06C6`) **exactly**, same record |
| 95 | OBD vehicle speed | 1 | km/h | 60, vs io921 = 61 and header speed 61 |
| **96** | OBD engine coolant temperature | 1 | **A − 40 °C** (OBD PID 05) | `0x76` → **78 °C** (vs 118 °C if read signed). §7.21 |
| **97** | OBD ambient air temperature | 1 | **A − 40 °C** (OBD PID 46) | `0x3C` → **20 °C** in Casablanca in December (vs 60 °C signed, above the world record) |
| 98 | OBD fuel level | 1 | **× 100/255 %** (OBD PID 2F) | `0x20` → 12.5 % |
| 99 | OBD fuel type | 1 | OBD-II PID 51 enum; `4` = Diesel | `0x04` |
| 100 | Engine fuel rate | 2 | **× 0.05 L/h** | `0x0046` → 3.5 L/h |
| 107 | Run time since engine start | 2 | **seconds** | `0x066A` = 1642 s |
| 114 | CAN HR total vehicle distance | 4 | **5 m/bit** | 7 993 000 m |
| 116 | CAN fuel rate | 2 | 0.05 L/h per bit | `0x55` → 4.25 L/h |
| **150** | GSM operator | 4 | **MCC × 100 + MNC** | 24602 & 24601 with Vilnius coords, 42403 Dubai, 62002 Accra, 60402 Casablanca, 22610 Oradea — **six for six** |
| 163 / 164 | TCO total / trip distance | 4 | **5 m/bit** | vendor: `10000 = 50000 m` |
| 165 / 213 | TCO / CAN tachograph (wheel-based) speed | 2 | **1/256 km/h per bit** | vendor: `15360 = 60 km/h` |
| 166 / 197 | TCO / CAN engine speed | 2 | **0.125 rpm/bit** | `0x2F80` → 1520 rpm; vendor: `8000 = 1000 rpm` |
| 170 | Battery current | 2 | **mA**, "should not exceed 250 mA" | vendor appendix — §7.20 |
| 176 | GPS speed | 1 | km/h | `0x3D` = 61 = header speed |
| 204 | CAN service distance | 2 | **5 km/bit, offset −160 635 km** | vendor: `32327 = 1000 km`; **negative ⇒ service overdue** |
| 205 | CAN fuel level (litres) | 2 | L | vendor |
| 206 | CAN accelerator pedal position 1 | 1 | **0.4 %/bit** | `0x47` → 28.4 % moving, `0x00` stationary |
| **207** | CAN fuel level 1 | 1 | **0.4 %/bit** (J1939 SPN 96) | `0xB1` → 70.8 %. **`0xFF` is NOT 102 % — §7.16** |
| 208 | CAN engine total fuel used | 4 | **0.5 L/bit** | 504.5 L |
| 89 / 927 | CAN ambient air temperature | 2 | **0.03125 °C/bit, offset −273** | vendor: `9376 = 20 °C` |
| 115 | CAN engine coolant temperature | 1 | **1 °C/bit, offset −40** | vendor: `128 = 88 °C` |
| 41, 52–55 | CAN axle weight | 2 | **0.5 kg/bit** | vendor: `20000 = 10000 kg` |
| 90 | CAN instantaneous fuel economy | 2 | **1/512 km/L per bit** | vendor: `2560 = 5 km/L` |
| — | CAN engine hours | 4 | **0.05 h/bit** | vendor: `200000 = 10000 h` |
| 645 / 922 | CAN total vehicle mileage | 4 | **km**, integer | both `0x00005A67` = 23143 in the same record |
| 66–69, 81–87, 211 | Digital fuel sensors A/B/C | 2 | **0…1023 normalised**, 1023 = full; **`0xFFFF` = sensor absent** | vendor appendix; observed `67 = FFFF`, `211 = FFFF` |
| 45–48 | DIN1–4 hour counters | 4 | **hours** (flespi previously stored the raw seconds — a 3600× slip) | rank 3 changelog 2024-03-26 |
| 577–580 | DIN1–4 hours cumulated | 4 | settable via command 117 | rank 1 |
| 175 | ECO absolute idling time | 4 | seconds; settable via command 117 | rank 1 |

### 5.6 Multi-part values — wide fields split across consecutive IDs

VERIFIED (rank 1 §4.1: *"For multi-part IO elements, first IO ID should be requested"*) and confirmed
by decode. Concatenate **ascending by ID**; ASCII fields are **NUL-padded on the right**.

| IDs | Field | Total | Notes |
|---|---|---|---|
| **104, 105, 106** | **OBD / vehicle VIN** | 3 × 8 = 24 B ASCII | **VERIFIED by decode:** `555531444A463030` + `3537303637383230` + `3500000000000000` = `"UU1DJF00"` + `"57067820"` + `"5"` = **`UU1DJF00570678205`**, a valid 17-char Dacia/Renault VIN |
| **123, 124, 125** | **CAN vehicle ID** | 24 B ASCII | **a DIFFERENT identifier** — §7.15 |
| **152, 153, 154** | **Tachograph vehicle ID** | 24 B ASCII | **a THIRD identifier** — §7.15 |
| 126 + 127 | CAN driver card, driver 1 | 16 B ASCII | |
| 128 + 129 | CAN driver card, driver 2 | 16 B ASCII | |
| **155 + 156** | Tachograph FMS driver 1 ID | 2 × 8 B | §7.14 |
| **157 + 158** | Tachograph FMS driver 2 ID | 2 × 8 B | **Traccar decodes only driver 1** — §7.14 |
| 167 + 168 | Tachograph vehicle registration number | 16 B | |
| 760 + 761 | Driver / tag ID pair | 2 × 8 B | Traccar renders this **without zero-padding** — §7.14 |

### 5.7 Error sentinels — the column you cannot download

**These are documented per-parameter values, not "unknown by convention."** The FMIO `Error values`
column is the only authority and it is exactly the column that is 404. What is known:

| Sentinel | Parameters | Status |
|---|---|---|
| `65535` (2 B) | 29, 30, 20, 21, 22, 23 and most mV/analog parameters | rank 1 (screenshot) |
| `41` **and** `85` | **32** (PCB temperature) | rank 1 (screenshot) — **collides with a plausible reading, §7.20** |
| `255` **and** `100` | **27** (GSM signal) — while `Max. Value` is 31 | rank 1 (screenshot). The Gen-3/4 appendix instead says `99 = not known or detectable` (the 3GPP TS 27.007 `AT+CSQ` convention). Real captures show 99 **and** 255. **Safe rule: anything > 31 is unknown** |
| `2001, 2002, 2003, 2004` | **78, 79, 80, 74** (1-Wire temperature) | rank 1 — **decode as +200.1 … +200.4 °C if you do not range-check** |
| `0xFFFF` | 66–69, 81–87, 211 (digital fuel sensors) = sensor absent | rank 1 |
| `0xFFFFFFFFFFFFFFFF` | **34** (iButton) = no fob present | rank 1 (screenshot) |
| **`0xFE` / `0xFF`** | **every one-byte J1939 SPN** (206, 207, 481, 530, …): `0xFE` = error, `0xFF` = not available. **This is SAE J1939-71, not Ruptela — it is public and decisive.** Range-check every `0.4 %/bit` parameter at ≤ 250 before scaling | SAE J1939-71 — §7.16 |
| all-zero | IO 126/127/128/129 CAN driver cards on a vehicle with no card inserted — Traccar happily produces a 16-NUL driver ID from it. **Treat all-zero as absent** | own decode |

---

## 6. Vehicle data — CAN / FMS / J1939 / OBD / tachograph

### 6.1 How it arrives

Vehicle data arrives **as ordinary IO parameters inside ordinary records**. There is no separate CAN
packet type, no separate stream, no PGN framing on the wire. The device decodes the vehicle bus
itself and emits pre-decoded parameters. Two exceptions:

- **DTCs** get their own packet (command 9, §3.5).
- **Manual/Custom CAN** (IO 1201–1220) carries **8 raw bytes each with no semantics on the wire**
  (§6.5).

**Mode selector.** VERIFIED (rank 1 §4.1.6, SMS `caninfo`):

```
CAN enable:  0 = disabled
             1 = FMS standard mode
             2 = LCV mode
             3 = OBD mode
             4 = Tachograph mode
```

**LCV manufacturer groups** (rank 1 §4.1.51, `setlcv <group>,<subgroup>,<can1|can2>,<active|silent>,<channel>`):
`1 VAG · 2 Mercedes · 3 Citroen · 4 Ford · 5 Fiat · 6 Opel · 7 Renault · 8 Toyota · 9 FMS Tractor`.
CAN1 and CAN2 both exist on HCV/Pro-class hardware; Port C carries J1708.
Enabling an LCV group **requires the extended protocol** and is subject to the 80-IO budget:
*"Configured group: Tractor2, Error: Not enough I/O slots"* / *"Configure group: VAG17, Error: old I/O
protocol is used"*.

### 6.2 THE structural hazard: three parallel dictionaries for the same truck

**The same physical quantity is emitted under several IO IDs with different encodings, sometimes in
the same record.** This is the single most dangerous property of the Ruptela data model, and it is
not a bug — it is the design.

| Quantity | FMS / J1939 raw | OBD-II PID raw | Pre-scaled "vehicle" block | Tachograph (TCO) |
|---|---|---|---|---|
| Engine RPM | **197** (0.125 rpm/bit) | **94** (× 0.25) | **920** (rpm, ×1) | **166** (0.125) |
| Speed | **210** wheel-based (1/256) | **95** (km/h) | **921** (km/h) | **165 / 213** (1/256) |
| Odometer | **114** (5 m/bit) | — | **645 / 922** (km) | **163** (5 m/bit) |
| Fuel level | **207** (0.4 %/bit), 481, 530 | **98** (× 100/255) | **923** (%) | — |
| Fuel volume | **205** (L) | — | **642 / 924** (L) | — |
| Fuel used | **208** (0.5 L/bit), **92** (0.001 L/bit) | — | **754**, 408 | — |
| Coolant temperature | **115** (offset −40) | **96** (offset −40) | **926** (°C) | — |
| Ambient temperature | **89 / 927** (0.03125, offset −273) | **97** (offset −40) | — | — |
| Throttle / pedal | **206** (0.4 %/bit) | **103** (%) | **928** (%) | — |
| **Device** odometer | — | — | **65** (metres) | — |

**Source arbitration is documented and it does NOT fail over.** VERIFIED (rank 1, help centre "TCO,
TCO_CAN and CAN parameter source priorities"): parameter groups are **TCO** (K-Line ▸ Tacho Read ▸
FMS), **TCO_CAN** (Tacho Read ▸ FMS), **CAN** (FMS only) — and verbatim: *"Ruptela devices do not
fall back to another source automatically. If the active source fails, you must disable it in the
configuration so the next-priority source takes over."*

> **Consequence for our data model.** A silent source failure shows up as a parameter that simply
> **stops arriving** — never as a switch to a second ID. So "no fuel data for 3 days" is a real
> operational signal, and a system that quietly falls back to a different ID for the same concept
> will hide it. Model each ID as its own series; resolve to a canonical quantity at the *read* layer,
> with the source recorded.

**And never assume two IDs for the same quantity agree.** In one real record, io65 (device odometer,
metres) and io114 (CAN HR distance, 5 m/bit) differ by **2.2 %** — 7816.9 km vs 7993.0 km. Both are
correct; they measure different things.

### 6.3 ID-block map

INFERRED from flespi's 673-ID catalogue + DIMO's typed list + the FMIO screenshots. Use as a routing
map, not as a dictionary.

| Block | Content |
|---|---|
| 2–9 | Digital inputs / device (2 DIN1, 3 DIN2, 4 DIN3, **5 Ignition/DIN4**, 6 modem temperature, **7/8/9 header-only**) |
| 10–17, 31–44 | FMS core + tachograph status. **Each carries its FMS SPN in the FMIO notes:** 10 → SPN 2805, 11 → SPN 2804, 12 → FMS `0x00FDD1`, 13 → SPN 1611, 14 → SPN 1617, 15 → SPN 1615, 16 → SPN 1618, 17 → SPN 1616, 35 → SPN 598, 36 → SPN 597, 37 → SPN 595 |
| 18–33 | Analog inputs, counters, device state |
| 45–48, 577–580 | DIN hour counters (h) and cumulated hours |
| 49–51, 584–586, 611–613, 755–757 | Accelerometer families |
| 56–87, 211–212 | Digital fuel sensors + 1-Wire temperature sensors |
| **89–107** | **OBD-II PID block** |
| 114–129 | FMS high-resolution counters + CAN vehicle/driver IDs |
| 130–142, 540–557, 743–751, 876–885, 1186 | Segment / ECO counters and bitmaps |
| **152–168, 531–532, 853–889, 1146–1147** | **Tachograph** — EU 561/2006 driving/rest timers |
| 184–192, 658–715 | Refrigerator / iQFreeze |
| 201–219 | FMS extras (201 = CAN AdBlue level, 204 = service distance, 206/207 pedal & fuel level, 208 total fuel) |
| **292–351** | **FMS tell-tale indicator states**, one byte each; 352–354 tell-tale bitmaps |
| 355–362, 400–401 | Brake / retarder / suspension |
| **420–480** | **Mobileye ADAS** |
| 481–538 | LCV-decoded body: doors 518, windows 523/931, central lock 538 |
| 561–570, 614–616, 740–742, 823–825 | Trailer |
| **920–968, 1152, 1187–1188** | **Pre-scaled "vehicle" block** + TPMS (bar) |
| **1201–1220** | **Custom / Manual CAN 1…20 — 8 raw bytes each, no semantics** |
| 5011 | EPE accuracy (hex) |

### 6.4 Tachograph

- **Parameters** live in the IO blocks above (152–168, 853–889, …) and are ordinary record values.
- **The driver-card file (.DDD) transfer** is its own command family: device 12 announces the file
  (`storage, size, readTs, periodStart, periodEnd, packetIndex, payloadCRC16`), server answers 111
  with the index, device streams command 11 fragments (`packetIndex(2) + up to 1009 bytes`), server
  acknowledges each with `0004 6F 01 <index> <crc>`, and the last fragment is a short frame.
- **Server-initiated read** uses command 110 SubID 2, after which *"FM device takes control of
  communication and server needs only to respond correctly"*.
- **The detailed read flow is CONFIDENTIAL** (`DOC_Tacho read detailed protocol.xls`, rank 1 §3.2.10).
  What is public is a skeleton.

**Field behaviour that will bite before the protocol does** (all rank 3, flespi changelog — these are
production reports, not theory):

| Symptom | Note |
|---|---|
| HCV5 Lite takes **12–15 minutes** for a driver-card download | a 10-minute server session window produces a download loop and files stored under the wrong type |
| Some devices **ignore the configured download interval** and re-download every 20–30 minutes | |
| A card-data announcement with **no active upload session used to make devices reset and reconnect in a loop** | the fix was to answer with a card-reject. **Your reply can reboot the tracker.** |
| Devices reconnect mid-upload and try to continue a transfer the new socket knows nothing about | a partial upload cannot be resumed — answer with a negative ACK so the device discards and restarts |
| Devices keep sending tacho data **after** the server rejected the process | |
| Devices send short, non-conformant command replies missing trailing fields | |

**TCO_CAN duration units are MINUTES, not seconds.** §7.12 — four fields, 60× wrong if you assume
seconds.

### 6.5 Custom / Manual CAN (IO 1201–1220)

Eight raw bytes each, twenty slots. **UNKNOWN** whether they carry any self-describing header, or
whether the bytes are meaningless without the matching Configurator / Lua rule set held on the device
(§9 Q19). flespi stores them **both** as numbers and as hex strings (`manual.can.hex.1` …
`manual.can.hex.20`) precisely because 8-byte values do not survive JSON's 53-bit number limit —
§7.7. Store them as opaque bytes and let the fleet operator's configuration give them meaning.

### 6.6 Bit-packed parameters nobody has unpacked

**UNKNOWN.** flespi enumerates the sub-fields by name but publishes **no bit positions**, and no open
decoder unpacks any of them:

- **151** — geofence ID + group + entered/left + overspeed + validity + DIN/AIN event, all multiplexed
  into one integer. Every open decoder stores it as one opaque number.
- **352, 353, 354** — tell-tale status groups
- **561, 562** — trailer status
- **740–742, 870–885** — ECO and tachograph bitmaps
- **1153** — unknown bitmap

Store them raw, expose them raw, and do not invent a decode. §9 Q20.

---

## 7. THE TRAP LIST

Every entry is a decoding bug that has **already shipped** in at least one real implementation, or a
device behaviour that has already destroyed real data. Format: **symptom → cause → evidence (with
URL) → the test that catches it.** Nothing here is compressed; if it reads long, it is because each
one cost somebody a fleet.

### 7.1 The records ACK is command 100 for BOTH command 1 and command 68 — it is NOT `100 + command`

**Symptom.** The device never deletes its records. It re-sends the identical packet forever, the ACK
cursor never advances, and its flash fills and starts overwriting the **oldest unsent** data. The
customer sees a device that is permanently "online", a live position that never advances past the
first frame, and a permanent hole in yesterday's history that no re-poll can recover.

**Cause.** Every *other* pair really is `100 + id` (9 → 109, 15 → 115, 16 → 116, 37 → 137), and
Traccar's own encoder implements exactly that rule (`buf.writeByte(100 + type)` in
`RuptelaProtocolEncoder.encodeContent`) — correctly, for DTC/ident/heartbeat/files. But **for records
Traccar bypasses its own encoder** and writes the literal bytes `0002640113bc`. Anyone who reads the
encoder and generalises the rule sends `0x65` (101) for command 1 and `0xA8` (168) for command 68. The
device silently ignores an unrecognised reply. There is no NACK and no error.

**Evidence.**
- Traccar hardcodes the exception for both `MSG_RECORDS` and `MSG_EXTENDED_RECORDS`:
  `https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocolDecoder.java`
- Traccar's encoder uses `100 + type`:
  `https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/RuptelaProtocolEncoder.java`
- DIMO tabulates all three ACK frames explicitly (`CmdAckRecords = 0x64`, `CmdAckIdentification =
  0x73`, `CmdAckHeartbeat = 0x74`):
  `https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/ruptela/constants.go`
- Confirmed live on the wire in a user log: `[65B835C7: 5046 > …] HEX: 0002640113bc` —
  `https://github.com/traccar/traccar/issues/1855`
- I recomputed all four CRCs: `6401 → 0x13BC`, `7301 → 0xCB25`, `7401 → 0x862D`, `6D01 → 0xC4A4`.

**Test.** A table test asserting the **exact ACK bytes per inbound command**:
`0x01 → 0002640113bc` · `0x44 → 0002640113bc` · `0x09 → 00026d01c4a4` · `0x0F → 00027301cb25` ·
`0x12 → 00027301cb25` · `0x10 → 00027401862d`. **Assert the literal hex, never a computed `100 + id`
— the test must fail if anyone "simplifies" it into the rule.**

### 7.2 The ACK is one boolean byte. There is no partial ACK, and our hard rule 4 has no expression here

**Symptom.** Whichever way you resolve it, silently: ACK-on-any-failure loses a customer's records
**permanently** (the device deletes them); ACK-never wedges the device in an eternal resend that
eventually overwrites its own oldest buffered data. Both look like healthy traffic in metrics.

**Cause.** Vendor semantics: *"When positive acknowledgement (ACK) is received, the device deletes
**all** sent records from the memory."* All, not *n*. A 1019-byte flush carries up to 37 records; one
undecodable IO group in record 14 puts the other 36 at stake. Our ingest solved the analogous
Teltonika case by counting sanity-rejects toward the ACK and routing them to a durable `rejects`
stream (`apps/ingest/src/persist.ts`, comment: *"under-ACKing a record we took responsibility for
would wedge the device in an eternal resend loop"*) — but that reasoning is written against a
**4-byte count** ACK and **must be re-derived for a boolean**.

**Evidence.**
- Vendor §3.2.1 — `https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html`
- DIMO's reference server demonstrates the wrong resolution in production code: in `handlePacket`,
  `ParsedPacketToCloudEventsJSON` failure only **logs** an error, then
  `ackData = ruptela.AckPackets[ruptela.CmdAckRecords]` executes **unconditionally** — the device is
  told "stored" for a packet that produced nothing:
  `https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/sample_server/main.go`
- Traccar took the opposite route and got burned. Commit `630a32e817`, 2023-09-30: *"Answer with a
  negative ack on exceptions - this creates a retry delay so that the device does not burn thorough
  the data"* — `https://github.com/traccar/traccar/commit/630a32e817`. **Reverted four days later** by
  `0867ac8efb` "Ruptela: remove exception handling" —
  `https://github.com/traccar/traccar/commit/0867ac8efb`. Two commits, two opposite answers, one week.
  Nobody is confident here.
- `nenadvasic/gps-tracking-server` writes `0002640113bc` even when the parse returned an error:
  `https://github.com/nenadvasic/gps-tracking-server`

**Test.** Feed a frame of *N* records where record *k* is undecodable. Assert (a) the socket receives
exactly `0002640113bc` **once**; (b) the *N−1* good records reach the stream; (c) record *k* reaches
the durable `rejects` stream **with a reason**; (d) **no code path can emit a zero ACK for a
CRC-valid frame**. Then re-feed the identical frame and assert idempotency at the DB layer rather
than a second ACK dance. Separately: because the ACK asserts "the entire packet persisted", the *N*
XADDs behind one packet must succeed **as a unit** — Redis XADD is per-entry, so this needs an
explicit pipeline/atomicity decision that CLAUDE.md hard rule 4 does not cover.

### 7.3 A no-fix record reports satellites = 255, not 0. Our rule-6 test returns `fix_valid = TRUE`

**Symptom.** Every record from a device parked in a basement is written as a **valid fix** at latitude
−214.7483648, longitude −214.7483648, 3276.8 m altitude, 655.35° heading, 65535 km/h, HDOP 25.5 — or,
because `apps/ingest/src/persist.ts` rejects `|lat| > 90`, the **entire packet vanishes** into the
`rejects` stream as reason `coords`. Customer-visible: the device is online, the map is empty, and its
ignition / voltage / GSM history — which is all still real — is gone. Support sees only `coords`.

**Cause.** PROJECT_PLAN §3.4 and our hard rule 6 were written against Teltonika, where no fix means
`satellites == 0`. Ruptela's Mode-B sentinel sets every GPS field to its type's extreme: `INT32_MIN`
for signed, all-ones for unsigned. **255 is not 0**, and −214.75 / −214.75 is not 0/0, so both of our
guards miss it. Note also `0x8000 = 32768` read unsigned is exactly one above `positions.altitude
smallint` max (32767) — the same 22003-overflow seam that already cost us a whole batch.

**Evidence.** A real FM-Eco4 Light 3G capture, decoded end to end: 29 records, every one
`lon = lat = 0x80000000`, `alt = 0x8000`, `angle = 0xFFFF`, `sat = 0xFF`, `speed = 0xFFFF`,
`hdop = 0xFF` — `https://github.com/traccar/traccar/issues/5152`. Traccar crashed on it:
*"error - Longitude out of range - IllegalArgumentException (Position:249 < RuptelaProtocolDecoder:175)"*.
**Ruptela's own decoding utility**, pasted into that thread by maintainer *jinzo*, prints these as
measurements: *"Longitude: -214.7483648 / Altitude: 3276 / Angle: 65535 / Satellites: 255 / Speed:
65535 / HDOP: 25.5"*. flespi needed until 2026-02-21 to model it, and needed **three** states —
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/140`.

**Test.** A golden fixture built from the #5152 frame. Assert for all 29 records: `fix_valid === false`;
`lat`/`lon` are **NULL** (not −214.75, not 0/0); altitude / speed / course / satellites are NULL rather
than clamped; the IO map (io32 device temperature, io27 GSM, io29 external voltage) is **fully
preserved**; the frame is ACKed **once**; and **zero** records land in `rejects`. Add a negative test
asserting `satellites > 0` **alone** never decides fix validity for this family. Add lat/lon range
validation to `normalize.ts` (which today passes `lat: p.lat, lon: p.lon` straight through) **and** a
CHECK constraint on `positions` (`001_positions.sql` declares `lat double precision NOT NULL` with no
range check).

### 7.4 There are TWO no-fix encodings, and Mode A is the quiet one

**Symptom.** Mode A is the dangerous one: coordinates that look perfectly plausible, are **stale by
hours**, and carry `satellites = 0`, `speed = 0`, `hdop = 0`. If any consumer treats "has coordinates"
as "has a fix", the vehicle appears **parked at the last place it saw sky** while it is actually
driving — trips end early, geofence exits never fire, the odometer stalls. And because Mode A zeroes
**speed**, any idle/stop detector that reads the speed column rather than `fix_valid` manufactures a
stop at **every tunnel, underpass and parking garage**.

**Cause.** Rank 1 §1.2.10 defines Mode A (*"parameters Longitude, Latitude, Altitude, Angle values
would be last valid fix. HDOP, Satellites and Speed would be cleared to 0"*); §1.3 defines Mode B for
when *"data collection without GPS fix is enabled"*. **Both ship. The selector is a device
configuration checkbox** — named in the Configurator as "Send data without GPS fix" plus "Collect data
without time".

**Important correction to a claim you will read elsewhere:** it is often said that a Teltonika-style
rule "mis-classifies both modes." That is **half wrong, and the wrong half is the dangerous half.**
Mode A clears satellites to 0, so our `sats > 0` rule classifies it **correctly**. Only Mode B defeats
it. **Do not replace rule 6 — extend it.** A replacement that keys on the sentinel alone loses the
Mode-A protection that currently works.

**Evidence.**
- Rank 1 §1.2.10 / §1.3 — `https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html`
- The vendor's own 30-record example is a live Mode-A demonstration: records 0–11 repeat one position
  with `sat=0, hdop=0`, record 12 has `sat=4, hdop=3.4`.
- flespi shipped a **three-state** parameter because two states could not express it:
  *"position.valid … true — valid GPS fix; false — no GPS fix (coordinates are stale last-known
  position); absent (no position parameters) — GPS fix unknown, sentinel no-fix detected"* —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/140`
- Traccar collapses both into the last known location: on sentinel detection it does
  `buf.skipBytes(8); getLastLocation(position, null)` —
  `https://github.com/traccar/traccar/commit/230f629c3d` — **manufacturing a Mode-A-looking position
  out of a Mode-B record.**
- Ruptela's own product people warn against the setting: *"there is a big fat warning beside 'Send
  Data without GPS' that this should not be used on Ruptela service"* —
  `https://github.com/traccar/traccar/issues/5152`

**Test.** Two fixtures through the same mapper: (1) the #5152 sentinel frame → `fix_valid = false`,
coordinates **NULL**; (2) a hand-built Mode-A record with real coordinates and `sat=0, speed=0,
hdop=0` → `fix_valid = false` and coordinates **PRESERVED**, but excluded from trip distance, geofence
state, overspeed and map trails per hard rule 6. **Assert the two produce different rows** — a decoder
that maps both to the same shape fails. Plus: assert that a run of Mode-A `speed=0` records does not
create a stop event.

### 7.5 Altitude signedness is unresolved — and NEITHER reading covers the physical range

**Symptom.** Read unsigned: a van in a Dutch polder at −7 m reports **+6553.6 m**, and every no-fix
record reports 3276.8 m. Read signed: sub-sea-level altitudes are right but the no-fix sentinel becomes
−3276.8 m. And whichever you choose, **a populated region gets a wrong altitude, plausibly:**

| Reading | Cannot represent | Real places |
|---|---|---|
| **signed i16 ÷10** | above **+3276.7 m** | La Paz 3640 m, El Alto 4150 m, Lhasa 3656 m, Andean mining haul routes — **Ruptela's LatAm market** |
| **unsigned u16 ÷10** | below **0 m** | Rotterdam, Schiphol −4 m, Baku −28 m, the Dead Sea −430 m — **Ruptela's European market** |

**Cause.** Rank 1 §1.3 splits GPS fields into *"fields which can be positive or negative"* (sentinel
`INT_MIN`) and *"fields which can only be positive"* (sentinel all-ones), and altitude's sentinel is
`0x8000 = INT16_MIN` — which places it in the **signed** group. But two implementations, **including
the vendor's own parsing tool**, read it unsigned.

**Evidence.**
- Traccar: `position.setAltitude(buf.readUnsignedShort() / 10.0)` —
  `https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocolDecoder.java`
- DIMO: `AltitudeDm int16 // altitude * 10 (decimeters)` —
  `https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/ruptela/types.go`
- **Ruptela's own decoding utility** prints `Altitude: 3276` for the `0x8000` records (i.e. unsigned)
  — `https://github.com/traccar/traccar/issues/5152`
- I checked all 309 records in the accessible corpus: **maximum raw altitude is 2205 (220.5 m)**, and
  the only value ≥ `0x8000` is the sentinel itself. **Nothing in any public capture discriminates.**

**A tiebreaker you will see used, which is invalid for us:** "the wrong choice overflows our smallint
column." It does not. `normalize.ts` runs altitude through `smallintOrNull` against
`SMALLINT_MIN/MAX`, so an out-of-range value becomes NULL, not a 22003 that poisons the batch — and
altitude is stored in **metres**, where `0x8000` reads 3276.8 either way and fits. The overflow does
not discriminate and must not be used as evidence.

**Test.** Do **not** guess. Insert the equivalent of a `TODO(VERIFY-WIKI)` marker and surface it.
Meanwhile write a bounds test feeding raw altitude `0x0000`, `0x7FFF`, `0x8000`, `0xFFFF` through
normalize and asserting (a) none can reach the INSERT out of smallint range, and (b) `0x8000` **in a
sentinel record** yields **NULL** altitude — not 3276.8 and not −3276.8. Ship `u16` with an explicit
disambiguation rule for raw ≥ `0x8000`, never a silent cast. §9 Q1 says what would settle it.

### 7.6 An unanswered identification = "device online, zero data", forever

**Symptom.** The single worst failure mode in the protocol: the device shows **ONLINE with a healthy
TCP session and produces zero positions, indefinitely.** Every health check passes. The customer is
told their tracker is working.

**Cause.** The device blocks all data until the identification is acknowledged with command 115.
Rank 1 §3.2.14: *"The device does not start sending other data until ACK … is received from the
server (command 115)."* Traccar shipped **no handler for type 15 until 2022-05-19**; before that it
fell through to `decodeCommandResponse` and returned `null` — no reply at all.

**Evidence.** Diagnosed on the Traccar forum for an FM-Eco4 Light+ 3G: *"Your Hex data is a command 15
(Identification packet) from the device, the device is waiting for a command 115 from the server
(ACK)."* The frame the user pasted, repeated identically forever:
`002e000315285d54972d0f4563303430302e30332e33332e303600012fd11758092c000518e2000003e80000001e001ee67f`
(`0x0f` = command 15, then ASCII `Ec0400.03.33.06`). The user's workaround was to turn the feature
off: *"when you make the configuration of your eco4 do this: Use 'Identification String': disable."*
`https://www.traccar.org/forums/topic/ruptela-fm-eco4-light-3g-is-displayed-online-but-does-not-show-the-location/`
Traccar's fix: `https://github.com/traccar/traccar/commit/68a1b67be1`. Traccar's own corpus keeps two
identification frames as `verifyNull` cases.

**Test.** Session test: open a socket, send the ident frame, assert the server writes **exactly**
`00027301cb25` before any record frame is sent, and assert the session is **not** torn down. Plus a
**monitoring** test, which is the one that actually saves you: a device whose session has been
established for > N minutes with **zero record frames** must raise an alert. **"Connected" is not
"reporting."**

### 7.7 8-byte IO values exceed JavaScript's 53-bit safe integer

**Symptom.** Two different drivers collapse onto the same driver ID, or one driver's ID changes its
last digits between records. Tachograph and driver-attribution reports assign trips to the wrong
person — and the error is stable enough to look like real data. The **throwing** variant is worse: the
decoder dies mid-record, the frame is never ACKed, and the device resends it **forever**.

**Cause.** `Number` holds 53 bits. A 4-byte IO value is fine; an 8-byte one is not.
`Buffer.readUIntBE(offset, 8)` is not merely lossy — Node **caps it at 6 bytes and throws**. The
8-byte group is common on exactly the identity fields: driver IDs 155–158, iButton 34, CAN vehicle ID
123–125, driver/tag pair 760–761, Manual CAN 1201–1220.

**Evidence.**
- flespi hit it twice and documented both. 2023-03-17: *"They had been stored as numbers, but these
  IDs (155 to 158) are sent as 8 byte integers. However, json limits numbers to 53 bits, so when the
  values exceeded the 53 bits, they have been stored truncated. Now these values are stored as
  strings, so no data is lost"* — `https://forum.flespi.com/d/82-changelog-ruptela-protocol/56`
- 2025-01-20, the same trap on Manual CAN: *"As the values are taken from 8 byte fields, and JSON is
  limited with 53 bits, the values are duplicated in text HEX represented parameters manual.can.hex.1
  to manual.can.hex.20"* — `https://forum.flespi.com/d/82-changelog-ruptela-protocol/80`
- The Node crash form is an **open issue** on the main JS implementation: *"RangeError
  [ERR_OUT_OF_RANGE]: The value of 'byteLength' is out of range. It must be >= 1 and <= 6. Received
  8"* — `https://github.com/dimitrievski/ruptela/issues/5`
- A real value to test with, from Traccar's corpus (IO id `0x0022` = 34, 8-byte group):
  `01d042f31d000030` = **130 678 001 124 769 840**, which is **14.5 × `Number.MAX_SAFE_INTEGER`**.

**Test.** Property test over the 8-byte group: for 1000 random 64-bit values, assert round-trip
through the decoder is **exact**. Assert the decoder's IO value type is `bigint | Buffer` and **never**
`number` (our Teltonika codec already does this in `packages/codec/src/types.ts`). Add a lint/grep gate
banning `readUIntBE(_, 8)`, recombined `readUInt32BE` pairs multiplied together, and `Number(` applied
to an 8-byte read. Golden case: IO 34 = `01d042f31d000030` must survive to storage **byte-identical**.

### 7.8 Real firmware emits two records with identical timestamp AND identical timestamp extension

**Symptom.** Half the IO data for a moment disappears — and *which* half depends on insertion order. A
fuel or odometer widget reading "latest position" returns null intermittently. Trip distance and CAN
reports are computed from a record set that is missing rows nobody logged.

**Cause.** Rank 1 §1.2.2 promises the extension increments for records sharing a second (*"If some
records have same time stamp when time stamp extension will increase starting with zero"*). **Firmware
does not honour it.** And since `tsExt = 0`, the classic decimal merge rule says "not a merge" —
merging is not the answer either. These are two genuinely independent samples of the same second.

**Evidence.** Verified by decode in the real #5152 capture: records 0 and 1 both carry
`ts = 946684811`, `tsExt = 0`, `priority = 0`, `event = 7`, the same GPS sentinel, the **same IO IDs**
`{32, 27, 29}` — and **different values** (`io32 = 33 / 31`, `io29 = 12485 / 12483`).
`https://github.com/traccar/traccar/issues/5152`
flespi built its message key on the assumption that tsExt disambiguates — *"added system parameter
timestamp.key … Integer part of its value is a message timestamp, and the fractional part is a
Timestamp extension value"* (`https://forum.flespi.com/d/82-changelog-ruptela-protocol/48`) — which
means **flespi's own key collides on exactly these two records and drops one.** Independently, an
FM-Pro4 user reported two DB rows per transmission with *"same fixtime, devicetime, lat, lng, speed,
altitude, course"* differing only in attributes — `https://github.com/traccar/traccar/issues/2460`.

**Our exposure is conditional and architectural.** Our PK is `(device_id, fix_time, rec_hash)` with
`rec_hash = xxhash64(p.raw)`. **If the Ruptela codec sets `raw` to the exact per-record byte slice,
both rows survive.** If it re-serializes, normalizes, or hashes a decoded struct, the two collapse and
`ON CONFLICT DO NOTHING` silently discards one — and hard rule 1 *mandates* that ON CONFLICT clause,
so the loss path is architectural, not accidental.

**Test.** Golden fixture from the #5152 frame asserting **exactly 29 rows** reach `positions`, and
specifically that **both** `ts = 946684811` records survive with **distinct `rec_hash`** and distinct
io29 values. Add a regression guard: a unit test that fails if the positions PK or any dedup key is
narrowed to exclude `rec_hash`, and a contract test asserting `raw` is the **verbatim wire slice** for
the record.

### 7.9 Classic-protocol split records: one moment becomes several rows, and nobody implements the merge

**Symptom.** Doubled position count on every report. Two map dots at the same coordinates. Distance
columns show the real delta on one row and 0.0 on its twin. "Latest position" shows only whichever
half arrived last, so **half the CAN / fuel / odometer attributes are missing from the panel at any
moment**.

**Cause.** A classic record's IO section is capacity-bounded (126 B). When the configured IO set does
not fit, the device emits continuation records at the same timestamp with the GPS block **duplicated**
and the IO set **divided**. The merge descriptor is the 3-decimal-digit reading of `tsExt` (§3.3.2) —
and **no open implementation implements it**. Traccar reads and discards the byte for `MSG_RECORDS`.

**Evidence.**
- Reported with a full DB dump of the twin rows — first row carries io114/io203/io208 and distance
  190.59, second carries io65/io29/io139 and distance 0.0:
  `https://github.com/traccar/traccar/issues/2460`. The reporter **proved the cause by
  reconfiguring**: *"i have reduced the io data from configuration of the device, and got now one
  record."* Anton Tananaev's position: *"if it's split into two, it means that device does it. It's
  not a server issue."*
- A second user hit it on FM-ECO4 and Pro4 and worked around it by whitelisting every IO for attribute
  copying: *"processing.copyAttributes.enable > true, processing.copyAttributes >
  ignition,io206,io39,io207,….. I had to manually call all io on previous message"* —
  `https://www.traccar.org/forums/topic/ruptela-splits-data/`
- flespi treats it as a merge to be implemented: *"fixed merging of records based on time extension
  for Command 1 Records"* (2021-05-31) —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/30`
- Rank 1 §1.5, identical wording in v1.67 (2017), v1.82, v1.103, v1.113 —
  `https://pdfcoffee.com/ruptela-protocol-v167pdf-4-pdf-free.html`

**Test.** Build a cmd-1 fixture with two records sharing timestamp + GPS block and **disjoint IO
sets**. Assert the stored rows are **two** (rule: never invent a merge in the raw store) but that the
**read path** — latest-position, CAN/fuel repositories, trip engine — sees **ONE merged IO view** for
that timestamp. Assert distance is counted **once**, not twice. Add a `tsExt ≥ 100` fixture exercising
the decimal merge descriptor and a loud log line, because no capture in the world currently has one.

### 7.10 Extended merge: adjacency is wrong, groups span TCP frames, and skipping the merge inflates every table

**Symptom, three ways.**
1. *Skip the merge entirely:* the positions table inflates **3–4×** for exactly the CAN/FMS/tacho
   trucks that carry the most IO and pay the most. Distance is unaffected (the coordinates are
   identical), which is precisely why it is quiet: no odometer drift, no alarm, just four rows per
   instant feeding stop/idle detection and any per-record billing counter. **Our schema will not catch
   it** — fragments with different IO payloads hash differently and all four persist cleanly.
2. *Merge by adjacency:* on a real out-of-order frame, IO data from two different fixes lands on one
   position.
3. *Group straddles a TCP frame boundary:* a phantom position appears at yesterday's coordinates
   carrying today's CAN payload, and the record it should have merged into is left incomplete.

**Cause.** The `recordExtension` byte says *"I am fragment 2 of 4"* but **not which group**. The only
group identity is `(timestamp, timestampExtension)`.

**Evidence.**
- The decisive frame: an 8-record cmd-68 capture with `recExt 0x30,0x31,0x32,0x33` **twice**,
  distinguished only by `tsExt` 0 and 1 — two independent 4-fragment logical records in the same
  second: `https://github.com/traccar/traccar/issues/2460`
- The adversarial frame: a real FM-Pro4 capture where parts arrive **out of order and interleaved**
  (`(08:09:45,0,0x11) (08:09:45,0,0x10) (08:09:57,1,0x11) (08:09:57,0,0x10) …`) —
  `https://github.com/traccar/traccar/issues/1855`. Traccar's merger is `positions.removeLast()`, so
  on **this** frame it merges the `tsExt=1` part into the `tsExt=0` record and vice versa.
- Traccar crashed on the spanning case in the field and patched it **without fixing it**: commit
  `60e9026a96` "Fix a bug with extended records spanning multiple messages" replaces
  `positions.remove(positions.size() - 1)` with `if (positions.size() == 0) { getLastLocation(position,
  null); } else { … }` — `https://github.com/traccar/traccar/commit/60e9026a96`. The fallback
  **fabricates a position at the last known location** rather than rejoining the group, and the
  non-empty-but-wrong case is still unhandled in current master.
- `https://github.com/traccar/traccar/issues/5190` — merge groups split across two TCP messages.

**Test.** (a) Assertion fixture from the 8-record `033d…` frame: **8 wire records must produce exactly
2 stored positions.** (b) Split that frame across two TCP segments at a boundary **inside** a merge
group, feed both, assert the same 2 merged positions come out as when it arrives whole. (c) Hostile
case: packet A ends mid-group, packet B begins with a **complete unrelated record** followed by the
continuation — assert the continuation does **not** merge into the unrelated record. (d) Feed the
out-of-order FM-Pro4 frame and assert grouping is by `(ts, tsExt)`, ordered by the low nibble, never
by arrival adjacency. Merge state must be **per-device and durable across frames**.

### 7.11 Devices send reserved IO IDs, and send documented IDs in the WRONG byte-size group

**Symptom.** The wrong-size case is catastrophic and silent: **every IO after the offending one is
read at the wrong offset**, so the record yields plausible-looking garbage — an odometer that jumps, a
fuel level that swings, a driver ID that is a slice of two other fields. The reserved-ID case **drops
the connection**, which means the device resends that frame forever.

**Cause.** Firmware emits parameters the published dictionary does not describe, and occasionally
places a documented parameter in a group whose width contradicts the dictionary. A decoder must be
**group-authoritative** (the 1/2/4/8-byte section header decides the width, always) and must tolerate
unknown IDs by consuming exactly the group width and preserving the value.

**Evidence.** flespi fixed both in one release, 2026-02-15: *"Fixed close_code=5 crash when device
sends reserved IO IDs 7, 8, or 9 as IO parameters — now generates a warning and continues parsing.
Added IO byte-size group validation: when a documented IO parameter appears in a wrong-size IO
section, a warning is generated with details (expected vs actual byte size) and the value is skipped.
Unknown IO IDs are still accepted without validation."* —
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/138`. Note **`close_code=5`** — the crash
terminated the device connection.

**Test.** Fixture with (a) IO ID 7 in the 1-byte group, (b) a known 2-byte parameter placed in the
4-byte group. Assert: the record parses; the walker's consumed byte count **exactly** equals the group
arithmetic; subsequent IOs decode correctly; unknown/reserved IDs are preserved as `io_<id>` (never
dropped); the mis-sized value is **flagged rather than scaled by its dictionary multiplier**; and the
connection **survives**. This mirrors our existing `undecodable-records.spec.ts` reasoning — a content
fault must not become an eternal resend.

### 7.12 TCO_CAN tachograph duration fields are in MINUTES, not seconds — four of them

**Symptom.** Drivers'-hours numbers **60× too small**. "Remaining driving time: 4 h 30 m" renders as
"4 minutes". In a tachograph product this is not a display bug — it is a **compliance-grade defect**
that will either spam drivers with false rest alarms or, inverted, fail to warn them before they break
the law.

**Cause.** The FMS/TCO_CAN duration encodings are minute-based; a decoder that assumes seconds (the
natural default for every other duration in this protocol) divides reality by 60.

**Evidence.** flespi, 2026-07-10: *"Fixed unit conversion (minutes to seconds) for TCO_CAN tachograph
durations (total driving time, current activity duration, continuous driving time, break time) on
ruptela tachograph devices. **These four values were previously reported 60x too small.**"* —
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/155`
Related unit slips from the same source: IDs 45–48 *"are now stored in hours (previously stored raw
value in seconds)"* (2024-03-26, `https://forum.flespi.com/d/82-changelog-ruptela-protocol/67`) and
*"Fixed can.engine.run.time (OBD time since engine start) which was incorrectly divided by 3600"*
(2026-06-03, `https://forum.flespi.com/d/82-changelog-ruptela-protocol/150`).

**Test.** A units assertion **per duration IO** in the dictionary JSON: every duration field carries an
explicit `units` key and a multiplier, and a test asserts no duration IO has units `s` unless the
source row says so. Plus a physical sanity test: for a tachograph fixture, continuous driving time
must fall in **0–270 min** and total daily driving in **0–600 min** after conversion — a value 60× off
falls outside both.

### 7.13 IO 871/872: day and month are SWAPPED relative to the vendor's own documentation

**Symptom.** Rest-period end dates are wrong for every day of the month above 12 — and **below 13 they
silently look plausible** (5 March reads as 3 May). The far-future variant is worse: it **drops the
device's connection**, so the tracker stops reporting entirely until it reconnects.

**Cause.** Vendor documentation errata, confirmed only by field observation. **There is no offline
oracle for this — the spec is wrong and the device is right.**

**Evidence.** flespi, 2026-05-11, stated as a documentation contradiction: *"Note: IO 871/872 (end of
last daily rest) packed datetime has day and month bytes swapped compared to the manufacturer
documentation."* — `https://forum.flespi.com/d/82-changelog-ruptela-protocol/147`
And 2026-08-25, the connection-killing variant on the same field: *"Fixed parsing of the tachograph
End of Last Daily Rest Period field (TCO_CAN, IO 871/872) for HCV5 Lite devices: a far-future date in
this field (beyond the representable timestamp range) is now skipped instead of dropping the
connection, so affected devices stay connected and continue reporting."* —
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/160`

**Test.** Fixture with IO 871 encoding a day > 12 (e.g. day 25) — assert it decodes as **day 25**, not
month 25 / rejected. Fixture with an out-of-range packed date — assert the field is **dropped with a
warning**, the record still stores, and **the connection is not closed**. Add a source comment citing
the flespi post, because **the vendor doc is the wrong oracle here** and a future reader will
"correct" it back.

### 7.14 Driver identity: PAIRS of 8-byte IOs, TWO drivers, and three separate representation bugs

**Symptom.** The **co-driver is never identified** on crew-operated vehicles — exactly the HCV5 / Tco4
use case. And for the IDs that *are* decoded, the same physical card reads as a **different ID** when
either half has leading zero bytes, so driver lookup intermittently fails and the trip is filed under
"unknown driver".

**Cause.** Three defects in one area.
- **(a)** flespi documents `155+156` = driver 1 and `157+158` = driver 2; Traccar's
  `decodeDriver(position, io155, io156)` handles only the first pair — there is no 157/158 call.
- **(b)** Traccar renders the 760/761 pair with `Long.toHexString(part1) + Long.toHexString(part2)`,
  which **does not zero-pad** — `0x00000000000000AB` becomes `"ab"`, not `"00000000000000ab"`, so the
  concatenated ID changes length **and** value.
- **(c)** Traccar reads 155/156 as **ASCII** (`Unpooled.copyLong(...).toString(US_ASCII)`) while flespi
  reads them as **64-bit numbers** — same wire bytes, two different registry keys.

**Evidence.**
- flespi's pairing and the second driver: *"driver IDs are reported spited for 2 IDs, so we've
  remastered the parsing to combine driver.id together into parameters tacho.fms.driver.id.1 (IDs
  155, 156) and tacho.fms.driver.id.2 (IDs 157, 158)"* —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/57`
- flespi maps 760/761 to driver.id too: `https://forum.flespi.com/d/82-changelog-ruptela-protocol/93`
- Traccar's code for all three points:
  `https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocolDecoder.java`
- Traccar has attempted "Support Ruptela driver id" **three separate times** — 2019 (`ab4f951c53`),
  2023 (`262f8df772`), 2024 (`b107736f3f`). Three attempts is itself the signal.
- All-zero pairs are real: a genuine capture carries IO 126/127/128/129 all zero, from which Traccar
  produces a 16-NUL "driver ID".

**Test.** Fixture with all four IOs 155–158 present and **distinct** — assert **two** driver IDs come
out, not one. Fixture where one half of a pair is `0x00000000000000AB` — assert the rendered ID is
**16 hex characters**. Property test: for random 16-byte IDs, render → parse round-trips exactly.
Assert an all-zero pair yields **absent**, not a NUL-string ID. Assert the same fob read via IO 34 and
via 760/761 normalises to **one** identity.

### 7.15 IO triplets 104–106, 123–125 and 152–154 are THREE different identifiers, not three ways of sending one VIN

**Symptom.** A vehicle's VIN **changes depending on which IO groups happened to be in the record**.
Fleet records show the tachograph's registered vehicle ID in the VIN column for some trips and the CAN
VIN for others — a mismatch that surfaces as failed warranty/telematics lookups and duplicate vehicle
entries.

**Cause.** Each is a 3 × 8-byte ASCII field, but they come from **different buses and mean different
things**: OBD VIN (104–106) vs CAN vehicle ID (123–125) vs tachograph vehicle ID (152–154). Mapping
all three to "VIN" means **the last one parsed overwrites the others**.

**Evidence.** flespi got it wrong, corrected it, then corrected the correction.
- 2020-02-28: *"Parsing of IO IDs 104 - 106, 123 - 125, 152 - 154 for vehicle.vin corrected. Contact
  us if you note some misparsing for vehicle.vin parameter."* —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/11`
- 2023-03-20, the real diagnosis: *"IDs 123, 124 and 125 together form field Can Vehicle ID, which we
  stored as vehicle.vin incorrectly parsed, which is not correct, so the new combined parameter will
  be named can.vehicle.id. IDs 152, 153 and 154 together form field Tacho Vehicle ID, which was also
  stored as vehicle.vin, it will be stored as tacho.vehicle.id"* —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/57`

**Test.** Fixture carrying **all three triplets with three distinct ASCII strings**. Assert three
distinct output keys (`vin`, `can.vehicle.id`, `tacho.vehicle.id`); assert none overwrites another
**regardless of IO ordering within the record**; and assert the 24-byte concatenation order explicitly
(a reversed triplet is the same length and reads as garbage, not as an error). Golden case: the real
VIN decode `"UU1DJF00" + "57067820" + "5"` → `UU1DJF00570678205` must be reproduced, with the trailing
NULs stripped.

### 7.16 Fuel level has TWO different scalings, and a not-available sentinel that reads as 102 %

**Symptom, part 1 (cross-applied scaling).** A full tank reads **98 %** and never reaches 100 %, so a
"tank filled" refuel-detection trigger never fires and the fuel-theft report loses every legitimate
fill event. In the other direction the value exceeds 100 % and is either clamped (looks fine, is
wrong) or rejected.

**Symptom, part 2 (the sentinel).** Every vehicle **without** a CAN fuel sender reports **102 % fuel**,
permanently. A fuel-level graph pinned at 102 % is customer-visible and customer-trusted.

**Cause.** IO **207** is J1939-derived (SPN 96, **0.4 %/bit**); IO **98** is OBD PID 2F
(**× 100/255**). They differ by only 2 %, which is inside the noise of a float sensor and therefore
invisible to eyeballing. And **SAE J1939-71 defines 0–250 as the valid range for a one-byte SPN, with
251–255 reserved for error/not-available** — so `0xFF` means "no fuel sensor on this bus", not "tank
overfull". Traccar applies the multiplier with **no guard at all**:
`case 207 -> position.set(Position.KEY_FUEL_LEVEL, readValue(buf, length, false) * 0.4)`.

**Evidence.**
- flespi shipped `can.fuel.level` **without** the multiplier for roughly 18 months, then: *"parsing of
  can.fuel.level is corrected according to the protocol documentation: multiplier 0.4 is applied to
  calculate the fuel level percentage"* (2021-03-16) —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/19`
- Traccar carries both scalings distinctly (`case 98 -> … * 100 / 255.0`, `case 207 -> … * 0.4`),
  which corroborates the split:
  `https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocolDecoder.java`
- Traccar also mislabelled IO 98 as `fuelRate` for years before renaming it:
  `https://github.com/traccar/traccar/commit/29d50ef59b`
- **The sentinel is in the corpus**: the Portugal cmd-1 capture (IMEI 869153042601309,
  ts 1624050225, 39.31434 / −8.92426) carries `io207 = 0xFF`. Under the documented scaling that is
  `255 × 0.4 = 102 %`.
- SAE J1939-71 SPN 96 — public and decisive.

**Test.** Assert IO 207 raw **250 → 100.0 %**; raw **254 → flagged ERROR**; raw **255 → flagged
NOT-AVAILABLE**, never 102 %. Assert IO 98 raw 255 → 100.0 %. Schema test: **the two IOs cannot share
a multiplier** in the dictionary JSON — any IO whose name matches `/fuel.*level/` must carry an
explicit multiplier **and** a `source_url`. Extend the ≤ 250 range check to every `0.4 %/bit`
parameter (206, 207, 481, 530, …).

### 7.17 1-Wire temperature error codes decode as +200 °C

**Symptom.** A temperature sensor that is shorted, has a CRC fault, is absent, or is reading abnormally
reports **+200.1, +200.2, +200.3 or +200.4 °C** — inside no plausible physical range, but numerically
a perfectly valid decode that will populate a chart, trigger a high-temperature alarm, and skew any
average.

**Cause.** IO 78/79/80 (and 74) are `signed × 0.1 °C` over the range −55.0…125.0 °C, with error codes
**2001** (1-Wire short), **2002** (CRC error), **2003** (no sensors), **2004** (abnormal value)
occupying the same numeric space. **Nothing on the wire distinguishes them** — you must range-check.

**Evidence.** Rank 1, Ruptela FM Manual v4.0 §5.5 "APPENDIX – IO LIST" —
`https://www.gps-vehicle.com/download/ruptela/Ruptela_FM_Manual_v4.0.pdf` — and the second independent
copy in the FM-Eco3/Pro3/Tco3 configuration manual Appendix A.

**Test.** Fixture with io78 = 2003 → assert the output is **NULL/absent with reason "no sensor"**, not
200.3 °C. Fixture with io78 = `0xFF38` (−20.0 °C) → assert −20.0. Dictionary invariant: every
temperature IO must declare a valid range and its error-value set, and a test asserts no value outside
the range can reach storage as a measurement.

### 7.18 flespi's units are its OUTPUT units, not the wire units — IO 65 is metres, not km

**Symptom.** Take flespi's units table literally and **every odometer is inflated 1000×**: a 7816.9 km
vehicle reports 7 816 907 km. Same class of error on analog inputs (mV read as volts → 1000× low),
GSM signal (a CSQ index rendered as dBm), and tachograph distance (5 m/bit rendered as km).

**Cause.** flespi's "Units" column describes **what flespi emits after its own scaling**, not what the
device puts on the wire. It is a perfectly honest column for flespi's API and a booby-trap for a
decoder author.

**Evidence.**
- flespi: `vehicle.mileage | number | km | Total calculated mileage` —
  `https://flespi.com/protocols/ruptela`
- Vendor appendix: `Virtual odometer | 4 | 0-4294967295 | m` —
  `https://www.gps-vehicle.com/download/ruptela/Ruptela_FM_Manual_v4.0.pdf`
- **I measured it.** In one record io65 = 7 816 907 alongside io114 = 7 993 000 m (5 m/bit): 2.2 %
  apart. As km, io65 would be 7.8 **million** km. Two further deltas: 125 units over 27 s at
  16–19 km/h (≈131 m of travel) and 15 units over 22 s at 0–5 km/h (≈15 m).
- Same trap on `ain | volts` (wire is mV per FMIO), `gsm.signal.dbm | dbm` (wire is a 0–31 CSQ index),
  and `tacho.vehicle.mileage | km` for ID 163 (wire is 5 m/bit).
- flespi's table even contradicts **itself**: it lists both `ain | 20…21;22;23` and
  `counter.fuel.value | 18…19;20…21`, while FMIO says 18/19 = fuel counters (ml) and 20/21 = AIN3/AIN4
  (mV).

**Test.** Dictionary invariant: **every IO entry must carry a `wire_units` field and a `source_url`,
and no entry may cite flespi as the source of a unit.** Golden case: io65 = `0x007746CB` must decode to
**7 816 907 m**, and any code path emitting km must divide, with the division visible in the test.
Also assert AIN index order **20 = AIN3, 21 = AIN4, 22 = AIN1, 23 = AIN2** — flespi's ascending-ID
collapse silently renumbers the physical inputs; FMIO and Traccar both agree with the vendor.

### 7.19 Signed vs unsigned — the single most repeated Ruptela defect, and it always ships as a plausible number

**Symptom.** A device at −5 °C reports **251 °C**. A reefer at −18 °C reports **238 °C** (1-byte) or
**6553.5 °C** (2-byte) — so **cold-chain temperature alarms never fire on the one condition they exist
for**. A 4-byte odometer past 2³¹ goes negative, so total distance **jumps backwards by 4295 km** and
every distance-billed invoice for that period is wrong.

**Cause.** The IO groups carry **no type information**. Width comes from the group; signedness comes
**only** from the dictionary — the dictionary you cannot download (§5.1). Every implementation has
guessed at least once, **in both directions**.

**Evidence.**
- Traccar flipped **seven** parameters from signed to unsigned in one commit — IO 39, 65, 94, 95, 98,
  100, 645: `https://github.com/traccar/traccar/commit/5c1a5208` (2024-01-31). Anything Traccar
  decoded before that date on a 4-byte field past 2³¹ was silently negative.
- flespi went the other way on temperatures: *"signed integer parsing for the following parameters
  that were incorrectly parsed as unsigned: 1-byte temperatures: device.temperature (IO 6),
  pcb.temperature (IO 32)"* (2026-01-27) —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/133`
- And earlier: *"parsing of negative values of IO_IDs 600 BT Temperature Sensor 0 - 604 BT Temperature
  Sensor 4 is fixed"* (2022-04-12) — `https://forum.flespi.com/d/82-changelog-ruptela-protocol/42`
- Floating-point form of the same class: Traccar replaced `* 0.001` with `/ 1000.0` and `* 0.1` with
  `/ 10.0` because binary multiplication by 0.001 does not round-trip —
  `https://github.com/traccar/traccar/commit/3cf07ef491`

**Test.** A **dictionary invariant test**: every IO entry must declare `type` (Signed | Unsigned) with
a `source_url`, and any entry lacking one **fails the build** — the same gate our Teltonika
`dictionaries.spec.ts` applies. Boundary fixtures per width: 1-byte `0xFF`, 2-byte `0xFFFF`, 4-byte
`0xFFFFFFFF` → assert the value the dictionary implies. Assert a signed 1-byte temperature of `0xFB`
decodes to **−5**, and that decimal scaling uses **division**: 12345 scaled by 1/1000 must equal
**exactly** 12.345.

### 7.20 Error sentinels that collide with plausible readings — and measurements discarded into booleans

**Symptom, part 1.** `IO 32 = 41` is simultaneously a completely plausible PCB temperature and one of
the two values the FMIO workbook lists as this parameter's **error sentinel**. Suppress it and you
discard a real reading; trust it and you alarm on a broken sensor. `IO 27 = 99` is the 3GPP "not
detectable" code and also a number that a naive percentage renderer shows as a healthy 99 % signal
bar that **never drops**.

**Symptom, part 2.** `IO 170` (battery current, mA) is mapped by Traccar to a **boolean**
`KEY_CHARGE` — a milliamp measurement discarded into a yes/no.

**Cause, part 1.** The FMIO `Error values` column is the only authority, it is 404, and the only
readable copy is a **low-resolution forum screenshot**. An error sentinel sitting **inside** the stated
valid range (−40…80 °C) is itself suspicious enough to suggest a misread cell.

**Evidence.**
- FMIO screenshot: IO 32 `Errors: 41, 85`; IO 27 `Errors: 255 and 100` while `Max. Value` is 31 —
  `https://iili.io/J1YwHEG.png`, posted in
  `https://www.traccar.org/forums/topic/contribution-to-ruptela-parameter-name-list/`
- **The collision is in this corpus:** the Dubai frame (IMEI 863591024076709, ts 1432734649) carries
  `io32 = 41`, on a device that read 29 and 30 °C in the same city a month earlier. In Dubai in late
  May, 41 °C is entirely plausible. *(§4.4 shows the bytes.)*
- Gen-3/Gen-4 vendor appendix for IO 27: *"0-31 … 99 = not known or detectable"* — the AT+CSQ
  convention. The only real captures show 99 **and** 255.
- Traccar: `case 170 -> position.set(Position.KEY_CHARGE, readValue(...) > 0)` against the vendor
  appendix *"Battery current | 2 | 0-65535 | mA | Should not exceed 250mA"*.

**Test.** For IO 32: assert 41 and 85 are **flagged as suspected sentinels — alerting suppressed, the
reading retained** (discarding a real 41 °C is also wrong). For IO 27: assert **anything > 31 is
"unknown"**, never a percentage and never dBm. For IO 170: assert the stored value is a **number in
mA**, and that no boolean charge flag is derived from it without an explicit documented rule. General
guard: any IO with an error-value set must carry a `source_url` for that set, and the test must fail if
a sentinel is asserted with no citation.

### 7.21 OBD IDs 96 and 97 need the `A − 40 °C` offset, and the two open implementations both get it wrong

**Symptom.** A permanent **false over-temperature alarm on every healthy OBD vehicle** (118 °C coolant
instead of 78 °C), and an ambient-air reading that never drops (60 °C instead of 20 °C) — a value above
the highest air temperature ever reliably recorded on Earth (56.7 °C).

**Cause.** SAE J1979 PID 05 (engine coolant) and PID 46 (ambient air) both encode as `A − 40 °C`. Both
open implementations mark 96 and 97 as **signed with no offset**, so "follow the implementations"
ships the wrong number.

**Evidence.**
- DIMO: `96: IOTypeSigned, // OBD engine coolant temperature` and
  `97: IOTypeSigned, // OBD ambient air temperature` —
  `https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/ruptela/io_types.go`
- `dimitrievski/ruptela` `lib/record.js` line 80 lists 96 and 97 in `ioIdSignedIntegers` —
  `https://github.com/dimitrievski/ruptela/blob/master/lib/record.js`
- **The physics closes it.** From a real frame decoded in Casablanca on 2024-12-03: `io97 = 60` →
  20 °C with the offset (right for the place and season) vs 60 °C signed (impossible); `io96 = 118` →
  78 °C (a normally running engine) vs 118 °C (an overheating alarm).
- The vendor documents the **−40 offset explicitly for the CAN twin, IO 115**:
  *"CAN engine coolant temperature | 1 | 0-255 | 1°C / Bit gain, -40°C offset | 128 = 88 °C"* —
  `https://www.gps-vehicle.com/download/ruptela/Ruptela_FM_Manual_v4.0.pdf`
- SAE J1979 PID 05 / PID 46 are public and decisive.

**Verdict: apply `A − 40`. Treat this as VERIFIED, not open.** The FMIO `Min. Value` cell would confirm
it (0 implies offset, −40 implies signed-normalised) but is not needed to act.

**Test.** Fixture with io96 = `0x76` → assert **78 °C**; io97 = `0x3C` → assert **20 °C**. Add a
physical-plausibility test: ambient air outside −60…+60 °C fails the fixture. Add a comment citing
J1979 next to the offset, because two open implementations disagree and a future reader will
"correct" it.

### 7.22 As the SECOND server (IP2), your ACK is decorative

**Symptom.** Silent, permanent, unrecoverable holes in history that no re-poll or backfill can fix,
**with no error anywhere**. And if the primary server is down, the device does not connect to you at
all — so your platform goes dark for reasons entirely outside your infrastructure, while every
dashboard you own says the network is fine.

**Cause.** Vendor design. Only IP1's ACK controls memory deletion; IP2 is a fire-and-forget mirror, and
the IP2 link is **gated on the IP1 link being up**.

**Evidence.** Ruptela's own help centre, verbatim —
`https://my.ruptela.com/en/articles/9447243-two-servers-configuration-and-operation-logic`:
- *"IP1 is the primary server, it sends acknowledgment (ACK) packets when it receives records. After
  the ACK packet is received, the record is considered as successfully transmitted to the server and
  it is deleted from the device memory."*
- *"If it does not receive ACK from IP 2, the data packet sending will not be repeated to IP 2."*
- *"If the connection to the IP1 server is not established, the device does not connect to the IP2
  server as well."*
- *"If the connection to the IP1 server is established, but the IP2 server is unavailable after an ACK
  packet from IP1 is received, the data will be deleted from the device memory. This may result in
  data loss in the IP2 server."*
- *"Only records are sent to the server with IP2. Other data packets, such as Transparent Channel,
  Tachograph, SD card, and Garmin will not be sent to the second server."*

And flespi: *"When configured as a secondary server, flespi will receive data but all commands will be
ignored by the device."*

**Test.** **This is not a codec test — it is an onboarding gate.** During device provisioning, read
back the configuration and **assert our host is IP1, not IP2**; refuse to mark the device "live"
otherwise, and surface it to the operator in words: *"this tracker is sending to us as a backup
server; history will have gaps we cannot recover."* Add a monitoring test: a device in IP2 mode shows
record gaps correlated with the primary's downtime, so **alert on gap patterns, not on connection
state.**

### 7.23 A single buffered flush mixes the year-2000 RTC epoch with real GNSS time

**Symptom.** Six records at `2000-01-01T00:00:11Z` arrive **in the same packet, under the same ACK**,
as twenty-three from today. They anchor "first position", they create a TimescaleDB chunk **26 years
outside the retention window**, and any trip or distance computation spanning them produces a 26-year
trip. If ingest's `minTsMs` rejects them instead, the customer loses the ignition / voltage evidence of
the vehicle's power-on event — which is often exactly what an incident investigation needs.

**Cause.** The device timestamps records from its internal counter when it has **no GNSS fix and no
network time**. The vendor exposes this as a configuration option ("Collect data without time"), so it
is **intended behaviour, not a fault**. Our `isClockSkewed` guard tests
`fixTime > serverTime + MAX_CLOCK_SKEW_MS` — **the past direction is unguarded**, and `normalize.ts`
documents that the row is deliberately still written.

**Evidence.** Verified by decoding the real FM-Eco4 Light 3G capture: 29 records, `recordsLeft = 1`,
of which **6 are stamped 946684811–946684991** (2000-01-01T00:00:11Z … 00:03:11Z) and **23 are stamped
1690735307–1690736026** (2023-07-30T16:41:47Z … 16:53:46Z).
`https://github.com/traccar/traccar/issues/5152`. 946684800 is exactly the 2000-01-01T00:00:00Z epoch.
The configurator setting is named in a deployment recipe: *"Offline tracking - Send data without GPS
fix - Collect data without time = ON"* — `https://gps-trace.com/en/blog/ruptela`.
**The forward tail is the other half:** our own `normalize.ts` records that a single record from a
device whose RTC ran ahead froze the map marker, suppressed offline detection, and pushed every
subsequent real record into the late path. **Guard both directions.**

**Test.** Fixture from the #5152 frame. Assert the six year-2000 records are recognised as
**clock-invalid** (not merely "old"), that they do **not** become the device's first position, do
**not** start or extend a trip, and do **not** create a chunk outside retention — **while their IO
payload is still retrievable**. Extend `isClockSkewed` with a **backward bound** and unit-test
946684811 against it.

### 7.24 iButton / RFID (IO 34) byte order: Traccar emits the wire order, flespi emits it reversed

**Symptom.** Drivers registered from one system's IDs **never match** reads from the other. On
migration from an incumbent platform, **every driver fob in the fleet stops matching on day one**, and
the trips are all filed as unidentified.

**Cause.** There is **no published statement of endianness** for this field. Each implementation chose.
We have already been bitten by exactly this class on Teltonika —
`packages/codec/__tests__/ibutton-byteorder.spec.ts` exists because of it.

**Evidence.**
- flespi changed its mind and documented the change: *"remastered parsing of ibutton.code parameter
  [Ruptela's IO ID 34]. Now parameter value is stored in HEX format with reversed bytes order."*
  (2021-04-21) — `https://forum.flespi.com/d/82-changelog-ruptela-protocol/27`
- Traccar does **not** reverse:
  `case 34 -> position.set(Position.KEY_DRIVER_UNIQUE_ID, ByteBufUtil.hexDump(buf.readSlice(length)))`
  and its own test asserts the wire order: `verifyAttribute(…, KEY_DRIVER_UNIQUE_ID,
  "01d042f31d000030")` —
  `https://raw.githubusercontent.com/traccar/traccar/master/src/test/java/org/traccar/protocol/RuptelaProtocolDecoderTest.java`
- Reversed, the same fob is `30000d1df342d001`.
- The family byte is the tiebreaker in practice: `0x01` is the DS1990A family code and belongs at the
  **start** of a 1-Wire ROM. `01d042f31d000030` therefore reads as a plausible wire-order ROM.

**Test.** Golden fixture pinning IO 34 = `01d042f31d000030` with an **explicit, commented decision on
which order we emit and a citation for it**. A second test asserts the ID is stable across record and
packet types (the same fob read via IO 34 and via 760/761 must normalise to one identity). Because
this is a **migration hazard**, also test that the reversed form is at least **recognised and
reported**, never silently mismatched.

### 7.25 The tacho DDD ACK contains a VARIABLE, not a constant

**Symptom.** A DDD tachograph download either **stalls at fragment 1** or **re-requests the same
fragment forever** — a paid feature failing silently, on a device that otherwise looks perfectly
healthy.

**Cause.** `0004 6F 01 FFFF 8179` appears in every summary of this protocol as a ready-to-paste
constant with a valid CRC beside it. But command `0x0B` (DDD data) carries `packetIndex(2)` in its
payload, so the 2-byte field in the 111 reply is near-certainly an **echo or advance of the received
fragment index**, and `0xFFFF` is the *vendor example's placeholder* meaning "start from the
beginning". Five index-carrying ACKs are documented and all CRC-verify: `…FFFF 8179`, `…0000 71C1`,
`…0001 6048`, `…006D C922`, `…006E FBB9` — **five different CRCs, because the CRC covers the index.**

The **same copy-paste hazard, more mildly**, applies to the heartbeat row `0009 <IMEI> 10 BD93`: the
CRC covers the IMEI, so a fixed CRC beside a placeholder IMEI is valid for **one device only**.

**Evidence.** Rank 1 §3.2.11/§3.2.12 —
`https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html`. And the corpus gap is total: **no capture
of a middle fragment or of the short last fragment exists anywhere** (§9 Q21), so nothing would catch
a hardcoded index.

**Test.** Do not hardcode. Assert the 111 reply's index field equals the index of the fragment just
received, byte for byte, and that the CRC is **computed**, not looked up. Until a real three-fragment
DDD capture exists, **do not ship tachograph download at all** — a stalled download that never errors
is worse than an unsupported feature.

### 7.26 NACK is not free: one bad minute becomes an hour of silence, fleet-wide

**Symptom.** A 30-second database blip that NACKs converts into **up to an hour of silence from every
device that happened to be mid-flush, simultaneously, with no decay** — and then a reconnect storm
when the ladder expires.

**Cause.** The backoff ladder is **1 → 5 → 10 → 15 → 30 → 60 minutes**, capped at 60, and it resets
**only** on an ACK, a device restart, a `connect`/`econnect`/`switchip` SMS, GPRS command 105, or an
IP/port change (§2.6 R6). Presented as "the safe choice" with no cost attached, an implementer will
wire NACK to any persistence exception.

**Evidence.** Rank 1 §3.2.1 — `https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html`. Traccar
tried wiring NACK to exceptions *"so that the device does not burn thorough the data"* and reverted it
four days later (§7.2) — the revert is the cost showing up.

**Unknown and load-bearing:** nothing says whether the device **holds or closes the TCP link** after a
NACK, or whether the ladder is **per-packet or per-connection** — both change your reconnect-storm math
(§9 Q22).

**Test.** A soak test: NACK every packet from 200 simulated devices for 60 s, then ACK, and assert the
observed reconnect distribution matches the documented ladder rather than a thundering herd. Product
rule: **NACK only for "I could not durably store this", never for "I could not parse this"** — a parse
failure is permanent and NACKing it produces an eternal, un-self-healing loop (the poison is content,
not transport: the same frame fails identically on every retry).

### 7.27 There is no MINIMUM length check anywhere, and `count` is an unbounded read

**Symptom.** A corrupt or hostile `0000 <crc>` passes the framer as a 4-byte frame; the decoder then
reads an 8-byte IMEI **past the end of the buffer**. Traccar throws `IndexOutOfBounds` and kills the
channel; a Node decoder either throws `RangeError` or silently reads adjacent memory. And `count = 255`
against a short body **over-reads by construction**.

**Cause.** Every published summary of this protocol states only the **upper** bound (`plen ≤ 1020`).
For device→server `plen < 9` is structurally impossible (IMEI 8 + command 1) — with the single
documented exception of **command 30 (Garmin status), which has no IMEI field at all** and whose
vendor example `0002 1E 01 1E08` I confirmed has its CRC computed over an IMEI-less frame (§3.6).
That exception is *also* the clean rule: **reject as IMEI-bearing any device→server frame whose
`plen < 9`, and handle command 30 as the documented special case.**

The post-condition "the cursor must land exactly on the CRC" is correct but is a **post**-condition —
which invites a decoder that reads all 255 records first and validates afterwards. In our ingest that
is an **unbounded read on the hot path**, CLAUDE.md's exact "unbounded buffers" failure class,
reachable from any unauthenticated TCP connection **before identification**.

**Evidence.** Traccar's framer and decoder —
`https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocol.java`
and `…/RuptelaProtocolDecoder.java`. `dimitrievski/ruptela` explicitly throws *"Packet Length is not
valid"* but only against the upper bound.

**Test.** Add `9 ≤ plen ≤ 1020` for device→server and `1 ≤ plen ≤ 1020` for server→device.
**Bounds-check remaining bytes before every record read**, not after. Simulator scenarios:
`plen = 0`, `plen = 1`, `plen = 8`, `plen = 1021`, `count = 255` with a short body, and a frame
truncated mid-record. Assert each closes the connection cleanly with a logged reason and **without
allocating**.

### 7.28 The VENDOR's own examples carry wrong length fields

**Symptom.** You build a fixture from the vendor document, your length framer refuses it, and you
conclude your framer is wrong.

**Cause.** Some length fields in the specification are **hand-typed** and were never regenerated when
the example bytes changed. The CRC, being computed, is right; the length, being typed, is not.

**Evidence, three confirmed cases.**
- **Command 6 (smart-card size), §3.2.7:** the vendor prints `plen = 0x000B = 11`, but the actual body
  is **15 bytes** (8 IMEI + 1 cmd + 2 size + 4 timestamp), and the printed CRC `0xF5B3` is correct
  over the real 15-byte body. Correct frame:
  `000F 000315A07F44865A 06 5428 4E9CAF2C F5B3`. The 2nd-generation twin (command 19) **is**
  self-consistent: `0011 000315A07F44865A 13 00005428 4E9CAF2C 5590`.
- **Command 12 (tacho info), §3.2.12:** the mangled table shows `0x000B`; my reconstruction proves
  `plen` is **30**, and the printed CRC `0x87D4` confirms it.
- **Command 32 (weighting), §3.2.21:** the frame is CRC-consistent but **semantically corrupt** — it
  decodes to latitude 97.44°. The **field table**, not the example, is the authority there.
- **Command 31 prose vs hex:** the prose says *"command 31 (0x83)"* but the example hex carries `0x1F`
  (= 31 decimal) and `0x83` = 131 is the server command. **The hex is right; the prose is a typo.**
- **Command 33 §3.2.22:** the SubCmdID-1 device response prints `0x11` where the field table says
  `0x21` — and the doc's printed CRC `DD6A` matches the **typo**, not the table (§3.6).

All sources: `https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html`.

**Test.** For each vendor example you adopt: **recompute both the length and the CRC**, and store the
repaired frame in the fixture with a note recording what was repaired and why. Never store a
length-broken frame as a **framing** fixture.

### 7.29 Traccar's own corpus carries two hand-edited frames with impossible lengths

**Symptom.** You adopt Traccar's test corpus wholesale, two frames fail your length framer, and you
**loosen the framer to accommodate them** — reintroducing exactly the permanent stream desync that
strict framing exists to prevent.

**Cause.** Contributor-edited fixtures. Both CRCs are correct over the true content; only the length
field is wrong.

**Evidence.** Running all 16 Traccar frames: **CRC is 16/16 correct, but LENGTH is 14/16.**
- Command 7 (SETIO response): `0011000315A07F440B1D07…341C` is 40 bytes with `plen = 17` (a conformant
  frame would be 21). Its header `0011 000315A07F44…` is **reused from the vendor's unrelated
  command-19 example** — a copy-paste tell.
- Command 9 (DTC): `000B00000B1A29F64B1A09…8C91` is 52 bytes with `plen = 11` (would be 15). It is
  **byte-identical to the vendor's example except the length**, and the vendor prints `0x0030 = 48` in
  **all four** spec versions.

`https://raw.githubusercontent.com/traccar/traccar/master/src/test/java/org/traccar/protocol/RuptelaProtocolDecoderTest.java`

**Verdict.** These are hand-edited fixtures, not device behaviour. **Trust the length field for
framing** — but still assert it against the body and drop the connection on mismatch (§9 Q23 says what
would settle whether any firmware really miscomputes `plen`).

**Test.** Keep both frames **only as payload-layout fixtures fed directly to the record parser**, never
as framing fixtures, and store the repaired variants (`plen = 0x0024`, CRC `0x0C36` for command 7;
`plen = 0x0030` for the DTC frame) alongside, clearly labelled.

### 7.30 A real device sends the SAME IO ID twice in the SAME size group

**Symptom.** A parser that stores IO elements in a map **silently collapses** them. A parser that
asserts uniqueness **rejects a frame a real device sends** — and since a rejected frame is never
ACKed, that device now resends it forever.

**Cause.** Unknown firmware behaviour; observed, not documented.

**Evidence.** A genuine FM-Pro4 capture (IMEI 865733028586048, ts `0x57064C22` =
2016-04-07T12:01:38Z, `plen = 0x005E = 94`, CRC `0x2DB3` ✓, parses with zero trailing bytes). Its
1-byte group is `05=00 1B=1A 02=00 03=00 04=00 AD=00 8F=00 58=00 1B=1A 86=00 87=00 88=00 82=00` —
**IO `0x1B` (27) appears twice, with the same value.**
`https://github.com/traccar/traccar/issues/1855`

**Test.** Feed that frame. Assert it parses, the connection survives, the record is ACKed, and the
duplicate is handled by an explicit documented policy (last-wins, first-wins, or a list) — with the
policy asserted, not implicit in a `Map`.

### 7.31 Per-segment event COUNTERS are decoded as permanent alarms — and a fluid level as harsh driving

**Symptom.** The customer's alarm feed fills with harsh-braking and harsh-acceleration events **that
never happened**. Worse, when the trigger is a *level* rather than an event, the alarm is
**continuous** — a truck with AdBlue in the tank raises a permanent harsh-acceleration alarm. Drivers
get disciplined on fabricated data and the fleet stops trusting the alarm feed entirely.

**Cause.** IO 134 and 136 are **counts of braking / acceleration events during the last segment**.
`if (value > 0) addAlarm(...)` turns a per-segment statistic into an incident. Historically Traccar
also fired alarms **unconditionally** on IO 198–201 regardless of value — and **IO 201 is CAN AdBlue
level**.

**Evidence.**
- Current Traccar: `case 134 -> { if (readValue(buf, length, false) > 0) {
  position.addAlarm(Position.ALARM_BRAKING); } }`, same for 136 —
  `https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocolDecoder.java`
- flespi names the same IDs *"segment.braking.events — The number of braking events during the last
  segment"* and `segment.acceleration.events` — `https://flespi.com/protocols/ruptela`
- The unconditional-alarm era is visible in its fix: `cfe72dc8cd` "Fix harsh driving decoding" wraps
  IO 198/199/200/201 in `if (readValue(...) > 0)` —
  `https://github.com/traccar/traccar/commit/cfe72dc8cd` (2021-06-19). Before it,
  `case 201: position.set(KEY_ALARM, ALARM_ACCELERATION)` fired on **every record carrying the id**.
- flespi identifies 201: *"Fixed IO 201 value registration, it's now registered as can.adblue.level"*
  — `https://forum.flespi.com/d/82-changelog-ruptela-protocol/85`

**Test.** Fixture with `io134 = 3` and `io136 = 0`: assert **zero alarm events** are emitted and that
both land as **numeric counters** in attributes. Fixture with `io201 = 40` (AdBlue 40 %): assert **no
acceleration alarm**. General guard: a test enumerating **every IO that produces an alarm** and
asserting each has a `source_url` proving it is an **event flag**, not a level and not a counter.

### 7.32 Media / photo fragment reassembly has no index check and no upper bound

**Symptom.** A retransmitted or out-of-order fragment is appended a second time, producing a corrupt
JPEG that no viewer opens — the customer requests a crash photo and gets a broken image. A device that
starts a transfer and never finishes it grows a server-side buffer **without limit**; on a shared
decoder that is a slow memory leak, and it is **reachable from anything that can speak the protocol**.

**Cause.** The reassembly path appends `readableBytes() - 2` on every subtype-2 packet, keyed on
nothing. It trusts `current` / `total` only to decide whether to request the next fragment, never to
**validate placement**.

**Evidence.**
- Traccar's current code: `getMediaBuffer().writeBytes(buf, buf.readableBytes() - 2); if (current <
  total - 1) { … request current+1 … }` with **no check that `current` is the expected index** —
  `https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocolDecoder.java`
- Traccar has fixed this area repeatedly: "Fix photo decoding" added a missing `return position;` so
  assembled photos were written to disk but never surfaced —
  `https://github.com/traccar/traccar/commit/e01ee80282` (2019-12-11); "Harden media buffers (fix
  #5920)" replaced the raw per-decoder `ByteBuf photo` field with a managed media-buffer API —
  `https://github.com/traccar/traccar/commit/7c00b1c837` (2026-06-21).
- The referenced report describes the class precisely: *"The buffer size for photo assembly is read
  directly from untrusted protocol input with no upper-bound validation … entries are only removed
  when a photo transfer completes … resulting in a permanent memory leak"* —
  `https://github.com/traccar/traccar/issues/5920`
- flespi's parallel experience: *"fix in automatic image download mechanism for fatigue sensor: now
  image is requested if device not in 'downloading image' state"* —
  `https://forum.flespi.com/d/82-changelog-ruptela-protocol/37`

**Test.** Feed fragments `0, 1, 1, 2` of a 4-fragment image; assert the assembled bytes equal the
`0,1,2,3` assembly and that the **duplicate is discarded, not appended**. Feed a transfer that stops
after fragment 0 and assert the buffer is **released on session close and on a timeout**. Assert a
**hard cap** on total assembled size, and that exceeding it **aborts the transfer rather than
allocating**.

### 7.33 The server's reply can reboot the tracker

**Symptom.** A device enters a **reset-and-reconnect loop**. From the outside it looks like a hardware
or SIM fault; it is your reply.

**Cause.** A tachograph card-data announcement arriving with **no active upload session** used to make
devices reset and reconnect in a loop until the server learned to answer with a **card-reject** instead.
Related behaviours in the same family: trackers reconnect mid-file-upload and try to continue a
transfer the new socket knows nothing about (a partial upload cannot be resumed — the correct answer is
a negative ACK so the device discards and restarts); devices keep sending tacho data after the server
has rejected the process; devices send short non-conformant command replies missing trailing fields.

**Evidence.** flespi changelog:
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/156` (announcement with no session → reset
loop → answer with card-reject),
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/159` (mid-upload reconnect → negative ACK),
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/102` (tacho data after rejection),
`https://forum.flespi.com/d/82-changelog-ruptela-protocol/151` (short non-conformant replies).

**Test.** Session test: send a tacho announcement with no prior session and assert the server replies
with a **reject**, not silence and not an ACK. Assert every optional-command handler has a defined
answer for the "I have no state for this" case, and that **"no answer" is never one of them**. Add the
general guard from §2.11 rule 9: warn and continue, never close, on content surprises.

### 7.34 Traccar never acknowledges command 18 — and CLAUDE.md points you at Traccar

**Symptom.** A device with **dynamic identification** enabled connects, sends its ident, receives
nothing, and goes **permanently mute** while the TCP connection stays open. It presents as *"device
online, no location"* — and it looks like a network or SIM problem for as long as you let it.

**Cause.** `MSG_IDENTIFICATION = 15` is the only identification constant Traccar defines. Type 18 falls
through to `decodeCommandResponse`, whose switch ends in `default -> null`, so **Traccar never writes
an ACK for a dynamic-identification packet.** This matters specifically because CLAUDE.md's "when
stuck" section directs you to Traccar as the oracle.

**Evidence.**
- Traccar's decoder:
  `https://raw.githubusercontent.com/traccar/traccar/master/src/main/java/org/traccar/protocol/RuptelaProtocolDecoder.java`
- DIMO **does** map both to the same ACK:
  `AckCmdAckIdentification = {00 02 73 01 CB 25}` —
  `https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/ruptela/constants.go`
- Vendor §3.2.17 assigns command 18 the reply command **115**, the same as command 15 —
  `https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html`

**Test.** Simulator scenario that sends a command-18 dynamic-identification frame and asserts the
server replies `00027301cb25` **within the link timeout**, then proceeds to send records. Pair it with
the §7.6 monitoring test — the two failures present identically to the customer.

---

## 8. Test vectors

Shape follows `packages/codec/__fixtures__/wiki/codec8.hex.json`. Split into **five files by
licence**, because the licences are genuinely different and one of them forbids redistribution.

| Proposed file | Licence | Redistributable? |
|---|---|---|
| `ruptela-traccar.hex.json` | Apache-2.0 (Traccar) | **Yes**, with attribution |
| `ruptela-dimo.hex.json` | MIT (DIMO), MIT (`dimitrievski/ruptela`) | **Yes**, with the MIT notice |
| `ruptela-issues.hex.json` | user captures inside public GitHub issues — **no licence grant** | Quote with attribution as evidence; do **not** relicense |
| `ruptela-vendor.hex.json` | Ruptela device protocol v1.113 — **no licence grant** | **NO.** Use to verify our own decoder; never ship the PDF, never paste its prose into the repo. The *hex* is a fact about a wire format and was re-derived and CRC-verified here. |
| `ruptela-server.hex.json` | server-to-device frames; layouts rank 1, bytes re-derived and CRC-verified | Yes (our own computation) |

**Every `hex` below was decoded locally: length asserted against the body, CRC-16/KERMIT recomputed,
and the record walk required to land exactly on the CRC.** Where a frame fails one of those checks it
is marked and quarantined.

### 8.1 `ruptela-traccar.hex.json` — Apache-2.0

```json
{
  "source_url": "https://github.com/traccar/traccar/blob/master/src/test/java/org/traccar/protocol/RuptelaProtocolDecoderTest.java",
  "snapshot_url": "https://raw.githubusercontent.com/traccar/traccar/master/src/test/java/org/traccar/protocol/RuptelaProtocolDecoderTest.java",
  "retrieved_at": "2026-09-09",
  "licence": "Apache-2.0 (Traccar). Reusable with attribution.",
  "attribution": "Hex verbatim from Traccar's RuptelaProtocolDecoderTest.java. Expected values are MY decode unless a line says SOURCE STATES; every frame's length and CRC-16/KERMIT re-verified locally.",
  "cases": [
    {
      "name": "cmd68-extended-3record-merge-set-with-ibutton-and-vin",
      "direction": "device->server",
      "hex": "01460003115c885fa8c6440003674f43df002000fb7291ce13fc9230040e400618003d0500080f00ce0001990100823d008600008700008800000201000300000400019500019601001b1e00ad0000b03d01a201070083000000890000008b00030016009d0017009f001d33d6001e1038020041000a6b3f00960000ebf201002201d042f31d000030674f43df002100fb7291ce13fc9230040e400618003d0500080803a000005f3c00607600613c00622000630400650000670009023000000399003d039c0009039806c6005e1b180064004600660000006b066a0282000901039a00005a67030068555531444a46303000693537303637383230006a3500000000000000674f43df002200fb7291ce13fc9230040e400618003d0500080302d2ff047cff047eff04019700f60198000302d3ffff03b6000002028500005a6702f2000068a800092b",
      "expect": {
        "kind": "records",
        "plen": 326, "plenOk": true, "crc": "092B", "crcOk": true, "trailingBytes": 0,
        "imei": "863514052765894", "command": 68, "recordsLeft": 0, "recordCount": 3,
        "mergeGroups": 1,
        "records": [
          { "tsMs": 1733247967000, "tsExt": 0, "recExt": "0x20", "part": "1 of 3", "priority": 0,
            "lat": 33.53196, "lon": -7.637765, "altitude": 103.8, "angle": 163.90,
            "satellites": 24, "speed": 61, "hdop": 0.5, "eventIoId": 8,
            "ioCounts": [15, 7, 2, 1],
            "io": { "34": "01d042f31d000030", "65": 683327, "150": 60402 } },
          { "tsMs": 1733247967000, "tsExt": 0, "recExt": "0x21", "part": "2 of 3",
            "ioCounts": [8, 9, 1, 3],
            "io": { "104": "UU1DJF00", "105": "57067820", "106": "5",
                    "94": 6936, "920": 1734, "116": 70 } },
          { "tsMs": 1733247967000, "tsExt": 0, "recExt": "0x22", "part": "3 of 3",
            "ioCounts": [3, 4, 2, 0],
            "io": { "645": 23143, "754": 26792 } }
        ],
        "derived": {
          "vin": "UU1DJF00570678205",
          "driverUniqueId": "01d042f31d000030",
          "note_rpm": "io94 (0x1b18) x0.25 = 1734 EXACTLY equals io920 (0x06c6) in the same frame",
          "note_gsmOperator": "io150 = 0x0000EBF2 = 60402 => MCC 604 / MNC 02 (Morocco) — matches Casablanca coordinates",
          "note_obd_temps": "io96 = 0x76 -> 78 C with A-40 (NOT 118 C signed); io97 = 0x3C -> 20 C with A-40 (NOT 60 C signed)"
        },
        "ack": "0002640113bc",
        "storedPositions": 1
      },
      "traps": ["7.1", "7.7", "7.10", "7.15", "7.21", "7.24"]
    },

    {
      "name": "cmd01-29records-ALL-INVALID-GPS-sentinel-and-year2000-rtc",
      "direction": "device->server",
      "hex": "03fb0003137ca79f856d01011d386d438b000080000000800000008000ffffffffffff070220211bff011d30c50000386d438b000080000000800000008000ffffffffffff0702201f1bff011d30c30000386d43a9000180000000800000008000ffffffffffffad0320211b16ad01011d30950000386d43c7000080000000800000008000ffffffffffff070220211b00011d30a60000386d4403000080000000800000008000ffffffffffff070220221b00011d30ae0000386d443f000080000000800000008000ffffffffffff070220231b00011d30ae000064c692cb000080000000800000008000ffffffffffff070220231b18011d3091000064c69306000080000000800000008000ffffffffffff070220231b14011d30a7000064c69322000180000000800000008000ffffffffffffad0320241b14ad00011d30a3000064c69342000080000000800000008000ffffffffffff070220241b13011d30ad000064c6934a000180000000800000008000ffffffffffffad0320241b10ad01011d30c3000064c6937e000080000000800000008000ffffffffffff070220241b12011d3092000064c6938b000180000000800000008000ffffffffffffad0320241b12ad00011d30bd000064c69395000180000000800000008000ffffffffffffad0320241b10ad01011d30a6000064c693ba000080000000800000008000ffffffffffff070220251b17011d30a2000064c693d4000180000000800000008000ffffffffffffad0320251b17ad00011d30cc000064c693f6000080000000800000008000ffffffffffff070220251b15011d3090000064c69404000180000000800000008000ffffffffffffad0320251b16ad01011d30a9000064c69432000080000000800000008000ffffffffffff070220261b14011d30be000064c6946d000180000000800000008000ffffffffffffad0320261b15ad00011d30b1000064c6946e000080000000800000008000ffffffffffff070220261b15011d3096000064c694aa000080000000800000008000ffffffffffff070220261b15011d30a8000064c694b2000180000000800000008000ffffffffffffad0320261b15ad01011d30a5000064c694e6000080000000800000008000ffffffffffff070220261b17011d309a000064c694f5000180000000800000008000ffffffffffffad0320261b17ad00011d309c000064c694f6000180000000800000008000ffffffffffffad0320261b17ad01011d3099000064c69522000080000000800000008000ffffffffffff070220261b14011d3094000064c6955e000080000000800000008000ffffffffffff070220261b15011d30b2000064c6959a000080000000800000008000ffffffffffff070220261b14011d30970000ad9e",
      "expect": {
        "kind": "records",
        "plen": 1019, "plenOk": true, "crc": "AD9E", "crcOk": true, "trailingBytes": 0,
        "imei": "865851039253869", "command": 1, "recordsLeft": 1, "recordCount": 29,
        "everyRecord": {
          "rawLon": "0x80000000", "rawLat": "0x80000000", "rawAlt": "0x8000",
          "rawAngle": "0xFFFF", "rawSat": "0xFF", "rawSpeed": "0xFFFF", "rawHdop": "0xFF",
          "fixValid": false, "lat": null, "lon": null,
          "altitude": null, "speed": null, "course": null, "satellites": null
        },
        "records": [
          { "index": 0, "tsMs": 946684811000, "tsExt": 0, "priority": 0, "eventIoId": 7,
            "clockValid": false, "io": { "32": 33, "27": 255, "29": 12485 } },
          { "index": 1, "tsMs": 946684811000, "tsExt": 0, "priority": 0, "eventIoId": 7,
            "clockValid": false, "io": { "32": 31, "27": 255, "29": 12483 },
            "note": "IDENTICAL (ts, tsExt) to record 0 with DIFFERENT payload — see trap 7.8" },
          { "index": 5, "tsMs": 946684991000, "clockValid": false },
          { "index": 6, "tsMs": 1690735307000, "clockValid": true },
          { "index": 28, "tsMs": 1690736026000, "clockValid": true, "eventIoId": 7 }
        ],
        "assertions": [
          "exactly 29 rows reach positions",
          "records 0 and 1 have DISTINCT rec_hash and both survive",
          "zero records land in the rejects stream",
          "the frame is ACKed exactly once with 0002640113bc",
          "io27=255 renders as GSM UNKNOWN, never 255% and never dBm",
          "the six year-2000 records do not become firstPosition, do not start or extend a trip"
        ]
      },
      "traps": ["7.3", "7.4", "7.5", "7.8", "7.20", "7.23"]
    },

    {
      "name": "cmd01-single-record-segment-counters-and-empty-can-driver-cards",
      "direction": "device->server",
      "hex": "00800003167d765c155d01000160cd0a310000faae43f7176ee45702332b0c12000006070d05007300cfff260082008600870088000f00d7021100d801c900061d0000c500001e0e988300008900008b000002d0000c9bca720c889a0b047e00000000000000007f0000000000000000800000000000000000810000000000000000a341",
      "expect": {
        "kind": "records",
        "plen": 128, "plenOk": true, "crc": "A341", "crcOk": true, "trailingBytes": 0,
        "imei": "869153042601309", "command": 1, "recordsLeft": 0, "recordCount": 1,
        "records": [{
          "tsMs": 1624050225000, "tsExt": 0, "priority": 0,
          "lat": 39.3143383, "lon": -8.9242633, "altitude": 56.3, "angle": 110.2,
          "satellites": 18, "speed": 0, "hdop": 0.6, "eventIoId": 7,
          "ioCounts": [13, 6, 2, 4],
          "io": { "5": 0, "115": 0, "207": 255, "38": 0, "130": 0, "134": 0, "135": 0, "136": 0,
                  "15": 0, "215": 2, "17": 0, "216": 1, "201": 0,
                  "29": 0, "197": 0, "30": 3736, "131": 0, "137": 0, "139": 0,
                  "208": 826314, "114": 210182155,
                  "126": "0000000000000000", "127": "0000000000000000",
                  "128": "0000000000000000", "129": "0000000000000000" }
        }],
        "assertions": [
          "io207 = 0xFF must be J1939 NOT-AVAILABLE, never 102 percent (trap 7.16)",
          "io134 = 0 and io136 = 0 must emit ZERO alarms; even non-zero must not (trap 7.31)",
          "io201 = 0 is AdBlue level, not an acceleration alarm (trap 7.31)",
          "io126+io127 all-zero must yield NO driver id, not a 16-NUL string (trap 7.14)"
        ]
      },
      "traps": ["7.14", "7.16", "7.31"]
    },

    {
      "name": "cmd0F-identification-FM-Eco4-S-T",
      "direction": "device->server",
      "hex": "002e000316d53d58d6020f4573303430302e30332e36382e30340000c2b3090d0e950000827b000003e80000003c003c1681",
      "expect": {
        "kind": "identification", "plen": 46, "plenOk": true, "crc": "1681", "crcOk": true,
        "imei": "869530043209218", "command": 15, "payloadBytes": 37,
        "deviceType": "Es04", "deviceModel": "FM-Eco4 S / FM-Eco4 T",
        "firmware": "00.03.68.04", "imsi": "214074206785173", "gsmOperator": 33403,
        "distanceCoefficient": 1000, "timeCoefficient": 60, "angleCoefficient": 60,
        "ack": "00027301cb25",
        "assertions": [
          "the server MUST write 00027301cb25 or the device sends nothing, forever (trap 7.6)",
          "deviceType and firmware MUST be persisted to the device registry — Traccar discards them"
        ]
      },
      "traps": ["7.6"]
    },

    {
      "name": "cmd0F-identification-FM-Plug4-OBD1",
      "direction": "device->server",
      "hex": "002e000315bc70d3e2ff0f4f42443130302e30312e30382e30300000c2b30ea77e430000601b000001f40000003c00144aa0",
      "expect": {
        "kind": "identification", "plen": 46, "plenOk": true, "crc": "4AA0", "crcOk": true,
        "imei": "868324021101311", "command": 15,
        "deviceType": "OBD1", "deviceModel": "FM-Plug4", "firmware": "00.01.08.00",
        "imsi": "214074229542467", "gsmOperator": 24603,
        "gsmOperatorDecoded": "MCC 246 / MNC 03 (Lithuania, Bite)",
        "distanceCoefficient": 500, "timeCoefficient": 60, "angleCoefficient": 20,
        "ack": "00027301cb25"
      },
      "traps": ["7.6"]
    },

    {
      "name": "cmd44-extended-4record-merge-set-FM-Pro4",
      "direction": "device->server",
      "hex": "01a4000315bc70f9b69244000458068f4a0030000d11398a1c0c19fd056524040b000c0a00090c0005010031f40032fd0033f200ce47002400002500001c010199000195010196010086000900aa0000001e0ff000d3ffff0043ffff01930000019200000194000002220000022300000200300000000200af000e872401008e000000000000000058068f4a0031000d11398a1c0c19fd056524040b000c0a00090400870000880000a90000820010008b0002021e0000021f0000021d0000021c0000022400000225000000890000008505f00220000002210000008300000084000002260000022700000228000003008a00000000008d00000000008c000000000058068f4a0032000d11398a1c0c19fd056524040b000c0a000905019f01005800001b1f00ad0000cfb10b02290000022a0000022b0000022c0000022d00000012000000130000001d367400c52f8000740055023e0502060097000000000096000058520041007746cb00d0000003f1005c0007c21b0072001864880058068f4a0033000d11398a1c0c19fd056524040b000c0a000900000001008e0000000000000000e815",
      "expect": {
        "kind": "records",
        "plen": 420, "plenOk": true, "crc": "E815", "crcOk": true, "trailingBytes": 0,
        "imei": "868324023580306", "command": 68, "recordsLeft": 0, "recordCount": 4,
        "mergeGroups": 1,
        "sharedHeader": {
          "tsMs": 1476825146000, "tsExt": 0, "priority": 0,
          "lat": 47.0555133, "lon": 21.9232650, "altitude": 138.1, "angle": 92.2,
          "satellites": 11, "speed": 12, "hdop": 1.0, "eventIoId": 9
        },
        "recordExtensions": ["0x30", "0x31", "0x32", "0x33"],
        "ioCountsPerRecord": [[12,9,2,1],[4,16,3,0],[5,11,6,0],[0,0,0,1]],
        "mergedIo": { "30": 4080, "29": 13940, "197": 12160, "65": 7816907, "208": 1009,
                      "92": 508443, "114": 1598600, "175": 951588, "142": 0 },
        "derived": {
          "batteryV": 4.080, "externalV": 13.940, "rpm": 1520,
          "odometerMetres": 7816907, "odometerKmFromIo114": 7993.0,
          "note": "io65 (m) = 7816.9 km vs io114 (5 m/bit) = 7993.0 km — 2.2 percent apart, both correct"
        },
        "storedPositions": 1,
        "assertions": ["4 wire records MUST produce exactly 1 stored position"]
      },
      "traps": ["7.10", "7.18"]
    },

    {
      "name": "cmd44-TWO-merge-groups-same-second-distinguished-only-by-tsExt",
      "direction": "device->server",
      "hex": "033d000315bc70f9b69244000858068f3b0030010d11354e1c0c17a5055d54560c00000900050c0005010031f30032fb0033f300ce00002400002500001c010199000195010196010086000900aa0000001e0ff300d3ffff0043ffff01930000019200000194000002220000022300000200300000000000af000e872401008e000000000000000058068f3b0031010d11354e1c0c17a5055d54560c00000900050400870000880000a90000820010008b0000021e0000021f0000021d0000021c0000022400000225000000890000008500000220000002210000008300000084000002260000022700000228000003008a00000000008d00000000008c000000000058068f3b0032010d11354e1c0c17a5055d54560c000009000505019f01005800001b1f00ad0000cfac0b02290000022a0000022b0000022c0000022d00000012000000130000001d31b100c5000000740000023e0502060097000000000096000058520041007746be00d0000003f1005c0007c2150072001864880058068f3b0033010d11354e1c0c17a5055d54560c000009000500000001008e000000000000000058068f3b0130000d11354e1c0c17a5055d54560d00000900070c0005010031f30032fb0033f300ce00002400002500001c010199000195010196010086000900aa0000001e0ff300d3ffff0043ffff01930000019200000194000002220000022300000200300000000000af000e872401008e000000000000000058068f3b0131000d11354e1c0c17a5055d54560d00000900070400870000880000a90000820010008b0000021e0000021f0000021d0000021c0000022400000225000000890000008500000220000002210000008300000084000002260000022700000228000003008a00000000008d00000000008c000000000058068f3b0132000d11354e1c0c17a5055d54560d000009000705019f01005800001b1f00ad0000cfac0b02290000022a0000022b0000022c0000022d00000012000000130000001d31ae00c5000000740000023e0502060097000000000096000058520041007746be00d0000003f1005c0007c2150072001864880058068f3b0133000d11354e1c0c17a5055d54560d000009000700000001008e0000000000000000084d",
      "expect": {
        "kind": "records",
        "plen": 829, "plenOk": true, "crc": "084D", "crcOk": true, "trailingBytes": 0,
        "imei": "868324023580306", "command": 68, "recordsLeft": 0, "recordCount": 8,
        "mergeGroups": 2,
        "groups": [
          { "tsMs": 1476825131000, "tsExt": 0, "recordExtensions": ["0x30","0x31","0x32","0x33"],
            "priority": 1, "satellites": 12, "eventIoId": 5 },
          { "tsMs": 1476825131000, "tsExt": 1, "recordExtensions": ["0x30","0x31","0x32","0x33"],
            "priority": 0, "satellites": 13, "eventIoId": 7 }
        ],
        "sharedGeometry": { "lat": 47.0554533, "lon": 21.9231566, "altitude": 137.3,
                            "angle": 215.9, "speed": 0, "hdop": 0.9 },
        "storedPositions": 2,
        "assertions": [
          "THE merge-key vector: 8 wire records MUST produce exactly 2 stored positions",
          "a merger keyed on timestamp alone collapses two distinct fixes into one — must fail this test",
          "split the frame across two TCP segments INSIDE a group and assert the same 2 positions"
        ]
      },
      "traps": ["7.10"]
    },

    {
      "name": "cmd01-single-record-analog-inputs-and-odometer-accra",
      "direction": "device->server",
      "hex": "0050000310f5615f419c0100015613d8ed0000fff5b37a035af37801e700000900000d07071b0c020003001c01202cad000500064302a81d33e61e100116317cd3ffff174ad60241000077fa960000f232003c2e",
      "expect": {
        "kind": "records", "plen": 80, "plenOk": true, "crc": "3C2E", "crcOk": true, "trailingBytes": 0,
        "imei": "863071016796572", "command": 1, "recordsLeft": 0, "recordCount": 1,
        "records": [{
          "tsMs": 1444141293000, "tsExt": 0, "priority": 0,
          "lat": 5.6292216, "lon": -0.0674950, "altitude": 48.7, "angle": 0.00,
          "satellites": 9, "speed": 0, "hdop": 1.3, "eventIoId": 7,
          "ioCounts": [7, 6, 2, 0],
          "io": { "27": 12, "2": 0, "3": 0, "28": 1, "32": 44, "173": 0, "5": 0,
                  "67": 680, "29": 13286, "30": 4097, "22": 12668, "211": 65535, "23": 19158,
                  "65": 30714, "150": 62002 }
        }],
        "assertions": [
          "io22 = AIN1 in mV (12668 mV), io23 = AIN2 — the IDs are NOT in AIN order (trap 7.18)",
          "io211 = 0xFFFF is a digital-fuel-sensor ABSENT sentinel, not 65535 units",
          "io150 = 62002 => MCC 620 / MNC 02 (Ghana) — matches Accra coordinates"
        ]
      },
      "traps": ["7.18"]
    },

    {
      "name": "cmd01-single-record-ZERO-ALTITUDE-legitimate-not-sentinel",
      "direction": "device->server",
      "hex": "00560003116e7438a7a50100015565cbb9000020fd21300f113f4600005f000600090d090805011b13cf00020003001c012029ad00041d31dd1e0ebd160000c50000047200000000d0000000004100016a2a960000a5a300c9ee",
      "expect": {
        "kind": "records", "plen": 86, "plenOk": true, "crc": "C9EE", "crcOk": true, "trailingBytes": 0,
        "imei": "863591024076709", "command": 1, "recordsLeft": 0, "recordCount": 1,
        "records": [{
          "tsMs": 1432734649000, "tsExt": 0, "priority": 0,
          "lat": 25.2788550, "lon": 55.3460016, "altitude": 0.0, "rawAltitude": "0x0000",
          "angle": 243.2, "satellites": 6, "speed": 9, "hdop": 1.3, "eventIoId": 9,
          "ioCounts": [8, 4, 4, 0],
          "io": { "5": 1, "27": 19, "207": 0, "2": 0, "3": 0, "28": 1, "32": 41, "173": 0,
                  "29": 12765, "30": 3773, "22": 0, "197": 0,
                  "114": 0, "208": 0, "65": 92714, "150": 42403 }
        }],
        "assertions": [
          "altitude raw 0x0000 must decode as 0.0 m — a legitimate zero, NOT a no-fix sentinel",
          "io32 = 41 collides with the FMIO error sentinel {41, 85} AND is plausible for Dubai in May — assert it is retained with alerting suppressed, never discarded (trap 7.20)",
          "io150 = 42403 => MCC 424 / MNC 03 (UAE, du)"
        ]
      },
      "traps": ["7.5", "7.20"]
    },

    {
      "name": "cmd01-two-records-one-frame-odometer-delta",
      "direction": "device->server",
      "hex": "00a10003116e7438a7a5010002553dddbe000020fddaff0f12289b007200000600000c070805011b18cf00020003001c01201dad01041d32d81e0d7d160000c50000047200000000d000000000410000b1ae960000a5a300553dddd4000020fdd96f0f122bfe005c16f80700050b090805011b18cf00020003001c01201ead01041d338a1e0d8d160000c50000047200000000d000000000410000b1bd960000a5a3001681",
      "expect": {
        "kind": "records", "plen": 161, "plenOk": true, "crc": "1681", "crcOk": true, "trailingBytes": 0,
        "imei": "863591024076709", "command": 1, "recordsLeft": 0, "recordCount": 2,
        "records": [
          { "tsMs": 1430117822000, "lat": 25.2848283, "lon": 55.3507583, "altitude": 11.4,
            "angle": 0.00, "satellites": 6, "speed": 0, "hdop": 1.2, "eventIoId": 7,
            "io": { "65": 45486 } },
          { "tsMs": 1430117844000, "lat": 25.2849150, "lon": 55.3507183, "altitude": 9.2,
            "angle": 58.8, "satellites": 7, "speed": 5, "hdop": 1.1, "eventIoId": 9,
            "io": { "65": 45501 } }
        ],
        "derived": { "odometerDeltaMetres": 15, "elapsedSeconds": 22,
                     "note": "15 m in 22 s at 0-5 km/h — one of the two measurements proving io65 is METRES (trap 7.18)" }
      },
      "traps": ["7.18"]
    },

    {
      "name": "cmd01-two-records-FOURTEEN-DIGIT-IMEI",
      "direction": "device->server",
      "hex": "007900000b1a2a5585c30100024e9c036900000f101733208ff45e07b31b570a001009090605011b1a020003001c01ad01021d338e16000002960000601a41014bc16d004e9c038400000f104fdf20900d20075103b00a001308090605011b1a020003001c01ad01021d33b116000002960000601a41014bc1ea0028f9",
      "expect": {
        "kind": "records", "plen": 121, "plenOk": true, "crc": "28F9", "crcOk": true, "trailingBytes": 0,
        "imeiRaw": "0x00000B1A2A5585C3", "imeiDecimal": "12207007303107",
        "imeiDigits": 14,
        "imeiTraccarFormatted": "012207007303107",
        "command": 1, "recordsLeft": 0, "recordCount": 2,
        "records": [
          { "tsMs": 1318847337000, "lat": 54.6305118, "lon": 25.2712755, "altitude": 197.1,
            "angle": 69.99, "satellites": 10, "speed": 16, "hdop": 0.9, "eventIoId": 9,
            "io": { "65": 21742957, "150": 24602 } },
          { "tsMs": 1318847364000, "lat": 54.6311456, "lon": 25.2727263, "altitude": 187.3,
            "angle": 9.44, "satellites": 10, "speed": 19, "hdop": 0.8,
            "io": { "65": 21743082 } }
        ],
        "derived": { "odometerDeltaMetres": 125, "elapsedSeconds": 27,
                     "note": "125 m in 27 s at 16-19 km/h — the second io65-is-metres measurement" },
        "assertions": [
          "THE IMEI FIELD IS A 64-BIT INTEGER, NOT A 15-DIGIT STRING — pick one formatting and apply it to the registry lookup AND to stored records (decoder rule 8)"
        ]
      },
      "traps": ["7.18"]
    },

    {
      "name": "cmd01-five-records-ZERO-IO-ELEMENTS-degenerate-body",
      "direction": "device->server",
      "hex": "009200000c07a6bacd4701000552db5cc20000187b8b251ace478e087c044c0a000009070000000052db5cfe0000187b8ab01ace47190879044c0900000b070000000052db5d3a0000187b8b251ace474b089d044c09000009070000000052db5d760000187b8b9a1ace475c08cd044c08000009070000000052db5db20000187b8b141ace46e708b3044c08000009070000000041cb",
      "expect": {
        "kind": "records", "plen": 146, "plenOk": true, "crc": "41CB", "crcOk": true, "trailingBytes": 0,
        "imeiDecimal": "13227001564487", "command": 1, "recordsLeft": 0, "recordCount": 5,
        "everyRecord": { "ioCounts": [0, 0, 0, 0], "bodyBytes": 4, "recordBytes": 27 },
        "records": [
          { "tsMs": 1390107842000, "lat": 44.97262, "lon": 41.07497, "altitude": 216.9,
            "angle": 11.00, "satellites": 10, "speed": 0, "hdop": 0.9, "eventIoId": 7 },
          { "tsMs": 1390108082000, "altitude": 225.3, "satellites": 8, "eventIoId": 7 }
        ],
        "assertions": [
          "THE DEGENERATE-BODY FIXTURE: all four group counts are 0x00 in every record",
          "a parser that assumes at least one IO element breaks here",
          "60-second spacing, so this also exercises ordering"
        ]
      },
      "traps": []
    },

    {
      "name": "cmd07-sms-over-gprs-response-io-state-string",
      "direction": "device->server",
      "hex": "0044000313612d76c5cb0744494e313d312c44494e323d302c44494e333d302c44494e343d302c444f5554313d312c444f5554323d312c41494e313d31372c41494e323d3236ac80",
      "expect": {
        "kind": "text", "plen": 68, "plenOk": true, "crc": "AC80", "crcOk": true,
        "imei": "865733025646027", "command": 7,
        "text": "DIN1=1,DIN2=0,DIN3=0,DIN4=0,DOUT1=1,DOUT2=1,AIN1=17,AIN2=26",
        "note": "the textual reply to the SMS-over-GPRS command 'getio'. Well-formed — usable as a framing fixture."
      },
      "traps": []
    },

    {
      "name": "cmd25-files-subcommand2-JPEG-transfer-chunk-0-of-10-MAX-FRAME",
      "direction": "device->server",
      "hex": "03fc0003142b0c152acd2502003544444131464144000a0000ffd8ffe000104a46494600010100000100010000ffdb00c50006040506050406060506070706080a100a0a09090a140e0f0c1017141818171416161a1d251f1a1b231c1616202c20232627292a29191f2d302d283025282928010707070a080a130a0a13281a161a2828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828020707070a080a130a0a13281a161a2828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828ffc000110800f0014003012200021101031102ffc401a20000010501010101010100000000000000000102030405060708090a0b100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa0100030101010101010101010000000000000102030405060708090a0b1100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffdd00040000ffda000c03010002110311003f00e27534fde484fa66950079add40e153754d73892794f552e00a6da0c4b282794f947d2aa92b2b1d7887795fb9b5a4200eee7e957e6bdfb2b0f2cb6eff669cba4dee99656d25f5acb02dd209622e38753d08fc315177cf151562e337196e8e46f5352cb5d6603cd52ebeb8c1adcb4be82e07eedc67d0f06b8f071daa64618c8383508573ae991251891430f7a836cd07fa97de9fdc7fe86b0adf51b8830377989e8d5a96daa413603131bfa350061fc49d41adbc39e5edc34ee14f7c639af1b91f2719aef7e2c5d4bf6cb780b7ee7607500f19e735e7a06e3c9e2b4a4b4b88b51b2aaf14bbc1351226796a79e3815b81283c500d460d381a405988d7a6785ad8c3a241bc9f9f2e47d7ffad5e73a5db35dddc30a757603e83bd7aba011c6a8bc2a8000a89e8807b1551815a5636fba38ce3af359248cd7516298862ff7456713fc58",
      "expect": {
        "kind": "file-transfer",
        "plen": 1020, "plenOk": true, "crc": "FC58", "crcOk": true,
        "totalFrameBytes": 1024,
        "note": "EXACTLY the protocol's stated 1 kB maximum — the max-frame fixture",
        "imei": "866600048995021", "command": 37,
        "subcommand": 2, "subcommandName": "Transfer",
        "sourceId": 0, "sourceName": "Camera A folder on SD card",
        "fileName": "5DDA1FAD", "totalPackets": 10, "currentPacket": 0,
        "dataBytes": 997, "dataStartsWith": "FFD8FFE00010 4A464946 00 (JPEG SOI + JFIF)",
        "serverNext": "command 0x89 subcommand 0x02 requesting packet 1",
        "assertions": [
          "fragments 0,1,1,2 must assemble identically to 0,1,2,3 — the duplicate discarded, not appended (trap 7.32)",
          "an abandoned transfer must release its buffer on session close AND on timeout",
          "a hard cap on assembled size must abort, not allocate"
        ]
      },
      "traps": ["7.32"]
    }
  ]
}
```

### 8.2 `ruptela-dimo.hex.json` — MIT

The best golden material in the whole harvest: a real capture **plus a published, machine-checked
expected decode**, under a permissive licence.

```json
{
  "source_url": "https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/sample_data/sample_input",
  "expected_url": "https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/sample_data/sample_output",
  "retrieved_at": "2026-09-09",
  "licence": "MIT (Copyright (c) 2024 Ruptela Protocol Parser). Reusable with the MIT notice.",
  "attribution": "DIMO-Network/ruptela-protocol-server sample_data. The expected decode is DIMO's own published output, asserted byte-for-byte by their TestSampleInputDebugMatchesOutput. My independent decode reproduces it exactly.",
  "cases": [
    {
      "name": "cmd44-6records-two-merge-groups-GOLDEN-PAIR",
      "direction": "device->server",
      "hex": "01EB00030EA2BC939936440006632AE87E0000000F087E4220A0D80F09AD77380800000A00070A000500019900019F01001BFF01A20000AD00001C0102F70102FAFF00060002001E0006001D2EA602009600000000020D0000001100632AE8820000000F087E4220A0D80F09E277380A00000902FB0B000500019900019F01001BFF01A20000AD00001C0102F70102FAFF02FB0000060002001E0006001D2E9902009600000000020D0000001400632AE8860000000F087E4220A0D80F09E377380A00000B00960A000500019900019F01001B6301A20000AD00001C0102F70102FAFF00060402001E0006001D2E9C02009600006019020D0000001800632AE8860100000F087E4220A0D80F09E377380A00000B02FA0A000500019900019F01001B6301A20000AD00001C0102F70102FA0800060802001E0006001D2E9B02009600006019020D0000001800632AE8860200000F087E4220A0D80F09E377380A00000B02FB0B000500019900019F01001B6301A20000AD00001C0102F70102FA0802FB0500060902001E0006001D2E9B02009600006019020D0000001800632AE8890000000F087E4220A0D80F09E977380A00000A01A20A000500019900019F01001B6301A20100AD00001C0102F70102FA0800062002001E0005001D2EBB02009600006019020D0000001C00B5DA",
      "expect": {
        "kind": "records",
        "plen": 491, "plenOk": true, "crc": "B5DA", "crcOk": true, "trailingBytes": 0,
        "imei": "860517041412406", "command": 68, "recordsLeft": 0, "recordCount": 6,
        "records": [
          { "index": 0, "tsMs": 1663756414000, "tsExt": 0, "recExt": "0x00", "priority": 0,
            "lon": 25.221485, "lat": 54.7411983, "altitude": 247.7, "angle": 305.2,
            "satellites": 8, "speed": 0, "hdop": 1.0, "eventIoId": 7,
            "ioCounts": [10, 2, 2, 0],
            "io1byteIds": [5, 409, 415, 27, 418, 173, 28, 759, 762, 6],
            "io": { "30": 6, "29": 11942, "150": 0, "525": 17 } },
          { "index": 1, "tsExt": 0, "eventIoId": 763 },
          { "index": 2, "tsMs": 1663756422000, "tsExt": 0, "eventIoId": 150, "io": { "150": 24601 } },
          { "index": 3, "tsMs": 1663756422000, "tsExt": 1, "eventIoId": 762 },
          { "index": 4, "tsMs": 1663756422000, "tsExt": 2, "eventIoId": 763 },
          { "index": 5, "tsExt": 0, "eventIoId": 418 }
        ],
        "derived": {
          "note_tsExt": "records 2, 3 and 4 all sit inside the single second 2022-09-21T10:33:42Z with tsExt 0, 1, 2 — the direct proof that tsExt is an ORDINAL COUNTER and not milliseconds (trap: section 3.3.3)",
          "note_operator": "io150 = 0x6019 = 24601 => MCC 246 / MNC 01 (Lithuania, Telia) — matches Vilnius coordinates",
          "note_ids": "IO ids 409, 415, 418, 525, 759, 762, 763 are all >= 256, i.e. unreachable over command 1"
        },
        "ack": "0002640113bc"
      },
      "traps": ["7.1"]
    },

    {
      "name": "cmd44-single-record-with-published-field-by-field-expectation",
      "direction": "device->server",
      "source_note": "dimitrievski/ruptela test-index.js + README response object; the identical frame is reused in wkusaa/ruptela-nodejs. MIT (c) 2017 Filip Dimitrievski / (c) 2022 Eric Ng Boon Lee.",
      "hex": "0045000070473afaedd944000159fc5a40000000d3e542f6184a37820929465a0900000c00070100050005001d3a0c001e0ff0019300000192000000890000010041000004af004dc3",
      "expect": {
        "kind": "records",
        "plen": 69, "plenOk": true, "crc": "4DC3", "crcDecimal": 19907, "crcOk": true, "trailingBytes": 0,
        "imei": "123451234512345", "command": 68, "recordsLeft": 0, "recordCount": 1,
        "records": [{
          "tsMs": 1509710400000, "tsExt": 0, "recExt": 0, "priority": 0,
          "rawLongitude": -739949834, "rawLatitude": 407517058,
          "lon": -73.9949834, "lat": 40.7517058,
          "rawAltitude": 2345, "altitude": 234.5,
          "rawAngle": 18010, "angle": 180.10,
          "satellites": 9, "speed": 0, "rawHdop": 12, "hdop": 1.2, "eventIoId": 7,
          "ioCounts": [1, 5, 1, 0],
          "io": { "5": 0, "29": 14860, "30": 4080, "65": 1199, "137": 0, "402": 0, "403": 0 }
        }],
        "ack": "0002640113bc",
        "note": "compact fixture exercising all four group headers including two zero counts, and a NEGATIVE longitude"
      },
      "traps": []
    }
  ]
}
```

### 8.3 `ruptela-issues.hex.json` — user captures, NO licence grant

These are the adversarial ones. **Quote with attribution as evidence; do not relicense.** The expected
values are my own decode; the sources publish no expectations.

```json
{
  "licence": "NONE. User-posted captures inside public GitHub issues. Attribute to the issue; do not relicense.",
  "retrieved_at": "2026-09-09",
  "cases": [
    {
      "name": "cmd44-FM-Pro4-merge-parts-OUT-OF-ORDER-and-INTERLEAVED",
      "source_url": "https://github.com/traccar/traccar/issues/1855",
      "source_note": "posted by user bpali, 2016-04-07; device stated as Ruptela FM-Pro4",
      "direction": "device->server",
      "hex": "03c6000313612da3a24044010a570a0a490011000d0fc8551c10464805475bea0e000008000703008200005800001b18010083000004008d0000000000960000585200410000000c004d0000000000570a0a490010000d0fc8551c10464805475bea0e00000800070e000500001b18003101003208003311001c01000200000300000400008600008f0000870000880000a90006001d62b0001e00000193000001920000008b00000089000005002d00000000002e00000000002f0000000000300000000000af0000000000570a0a550111000d0fc8121c10466a05385bea0e000009003303008200005800001b18010083000004008d0000000000960000585200410000000c004d0000000000570a0a550010000d0fc8231c10466a05395bea0e00000900330e000500001b18003101003208003310001c01000200000300000400008600008f0000870000880000a90006001d622b001e00000193000001920000008b00000089000005002d00000000002e00000000002f0000000000300000000000af0000000000570a0a550011000d0fc8231c10466a05395bea0e000009003303008200005800001b18010083000004008d0000000000960000585200410000000c004d0000000000570a0a550110000d0fc8231c10466a05395bea0e00000900330e000500001b18003101003208003311001c01000200000300000400008600008f0000870000880000a90006001d617f001e00000193000001920000008b00000089000005002d00000000002e00000000002f0000000000300000000000af0000000000570a0a590010000d0fc8021c10467a05355bea0e00000900330e000500001b18003101003208003310001c01000200000300000400008600008f0000870000880000a90006001d6194001e00000193000001920000008b00000089000005002d00000000002e00000000002f0000000000300000000000af0000000000570a0a590011000d0fc8021c10467a05355bea0e000009003303008200005800001b18010083000004008d0000000000960000585200410000000c004d0000000000570a0a590110000d0fc8021c10467a05355bea0e00000900330e000500001b18003101003208003311001c01000200000300000400008600008f0000870000880000a90006001d6194001e00000193000001920000008b00000089000005002d00000000002e00000000002f0000000000300000000000af0000000000570a0a590111000d0fc8021c10467a05355bea0e000009003303008200005800001b18010083000004008d0000000000960000585200410000000c004d00000000009d3f",
      "expect": {
        "kind": "records",
        "plen": 966, "plenOk": true, "crc": "9D3F", "crcOk": true, "trailingBytes": 0,
        "imei": "865733028586048", "command": 68, "recordsLeft": 1, "recordCount": 10,
        "wireOrder": [
          { "tsMs": 1460275785000, "tsExt": 0, "recExt": "0x11" },
          { "tsMs": 1460275785000, "tsExt": 0, "recExt": "0x10" },
          { "tsMs": 1460275797000, "tsExt": 1, "recExt": "0x11" },
          { "tsMs": 1460275797000, "tsExt": 0, "recExt": "0x10" },
          { "tsMs": 1460275797000, "tsExt": 0, "recExt": "0x11" },
          { "tsMs": 1460275797000, "tsExt": 1, "recExt": "0x10" },
          { "tsMs": 1460275801000, "tsExt": 0, "recExt": "0x10" },
          { "tsMs": 1460275801000, "tsExt": 0, "recExt": "0x11" },
          { "tsMs": 1460275801000, "tsExt": 1, "recExt": "0x10" },
          { "tsMs": 1460275801000, "tsExt": 1, "recExt": "0x11" }
        ],
        "record0": { "lon": 21.9138133, "lat": 47.0828616, "altitude": 135.1, "angle": 235.3,
                     "satellites": 14, "speed": 0, "hdop": 0.8, "eventIoId": 7 },
        "mergeGroups": 5, "storedPositions": 5,
        "assertions": [
          "THE ADVERSARIAL MERGE VECTOR. Every group is 2 records (hi nibble 1 = total-1).",
          "Traccar's adjacency merger (positions.removeLast()) merges the tsExt=1 part into the tsExt=0 record and vice versa on THIS frame.",
          "grouping MUST be by (timestamp, tsExt), ordered by the low nibble, never by arrival adjacency"
        ]
      },
      "traps": ["7.10"]
    },

    {
      "name": "cmd01-FM-Pro4-DUPLICATE-IO-ID-IN-ONE-GROUP",
      "source_url": "https://github.com/traccar/traccar/issues/1855",
      "direction": "device->server",
      "hex": "005e000313612da3a24001000157064c2200000d0fc7291c10484d051a50fa0f000006070d05001b1a020003000400ad008f0058001b1a8600870088008200051d65a78b0000890000830000160019039600005852410000000caf00000000002db3",
      "expect": {
        "kind": "records", "plen": 94, "plenOk": true, "crc": "2DB3", "crcOk": true, "trailingBytes": 0,
        "imei": "865733028586048", "command": 1, "recordsLeft": 0, "recordCount": 1,
        "records": [{
          "tsMs": 1460030498000, "tsExt": 0, "priority": 0,
          "lon": 21.9137833, "lat": 47.0829133, "altitude": 130.6, "angle": 207.3,
          "satellites": 15, "speed": 0, "hdop": 0.6, "eventIoId": 7,
          "ioCounts": [13, 5, 3, 0],
          "io1byteGroupInWireOrder": [
            ["05", "00"], ["1b", "1a"], ["02", "00"], ["03", "00"], ["04", "00"],
            ["ad", "00"], ["8f", "00"], ["58", "00"], ["1b", "1a"], ["86", "00"],
            ["87", "00"], ["88", "00"], ["82", "00"]
          ],
          "io": { "29": 26023, "139": 0, "137": 0, "131": 0, "22": 25,
                  "150": 22610, "65": 12, "175": 0 }
        }],
        "assertions": [
          "IO id 0x1B (27) APPEARS TWICE in the same 1-byte group with the same value",
          "the record MUST parse, the connection MUST survive, and the duplicate policy must be explicit (trap 7.30)"
        ]
      },
      "traps": ["7.30"]
    },

    {
      "name": "cmd01-Eco4-Light-30-records-no-io-bangkok-recordsLeft-1",
      "source_url": "https://github.com/traccar/traccar/issues/3561",
      "source_note": "posted by user s0mprasong, 2017-10-02; device stated as Ruptela Eco4 Light",
      "direction": "device->server",
      "hex": "03350003136e3745bbb101011e59cfbb8e00003bf12df3083fcca30000000004000018070000000059cfbbca00003bf12c20083fd132000080520700000f070000000059cfbc0600003bf12b9b083fd121000080b60800000f070000000059cfbc4200003bf129b8083fd196000080480800000f070000000059cfbc7e00003bf12a0b083fd121000068d80900000a070000000059cfbcba00003bf12aa1083fd11000007dc80900000a070000000059cfbcf600003bf12a90083fd0de00007dc80a00000a070000000059cfbd3200003bf12af4083fd0ef00007a940a00000f070000000059cfbd6e00003bf127d4083fd174000077d80a00010a070000000059cfbdaa00003bf1289c083fd1640006758a0b00000a070000000059cfbde600003bf12781083fd1210006722e0a00000a070000000059cfbe2200003bf12760083fd19600027e4a0a00000a070000000059cfbe5e00003bf1270c083fd304000f79180c000009070000000059cfbe9a00003bf1273e083fd2f4001179180b000008070000000059cfbed600003bf12760083fd23c001479180900000a070000000059cfbf1200003bf12770083fd174000f22a60c000008070000000059cfbf4e00003bf12828083fd0ce000a22a60b000008070000000059cfbf8a00003bf1285a083fd0ac000b22a60e000007070000000059cfbfc600003bf1288c083fd0ce001043940d000008070000000059cfc00300003bf12975083fcff5001449e80a000008070000000059cfc03e00003bf12986083fcf70002975080b000008070000000059cfc07a00003bf12975083fcf3e002c6c480b000008070000000059cfc0b600003bf12932083fcfc300426c480b000008070000000059cfc0f200003bf12943083fcff500436c480d000008070000000059cfc12e00003bf12986083fd0590047404c0b00000a070000000059cfc16a00003bf129a7083fd07a004f27ce0c000007070000000059cfc1a600003bf129a7083fd07a004f27ce0c000008070000000059cfc1e200003bf12996083fd027004327ce0c000008070000000059cfc21f00003bf12996083fcfe400463b560d000007070000000059cfc25a00003bf128df083fd059005a3bce0b00000b0700000000630f",
      "expect": {
        "kind": "records", "plen": 821, "plenOk": true, "crc": "630F", "crcOk": true, "trailingBytes": 0,
        "imei": "865789024779185", "command": 1, "recordsLeft": 1, "recordCount": 30,
        "everyRecord": { "ioCounts": [0, 0, 0, 0], "altitude": 0.0 },
        "timeRange": ["2017-09-30T15:43:10Z", "2017-09-30T16:11:22Z"],
        "spacingSeconds": 60,
        "geometry": { "lonApprox": 100.56612, "latApprox": 13.83989, "place": "Bangkok" },
        "satellitesRange": [4, 14], "hdopRange": [0.7, 2.4], "speed": 0,
        "assertions": [
          "THE CONTINUATION FIXTURE: recordsLeft = 1 must trigger the stop-and-wait drain loop after the ACK",
          "write `left !== 0`, never `left === 1` (decoder rule 7)",
          "30 records with zero IO — combines the large-batch and degenerate-body cases"
        ]
      },
      "traps": []
    },

    {
      "name": "cmd44-Pro4-4record-merge-with-rpm-and-canbus",
      "source_url": "https://github.com/traccar/traccar/issues/2460",
      "source_note": "posted by user bpali, 2016-10-19, one of 17 consecutive frames; Ruptela Pro4 in extended mode",
      "direction": "device->server",
      "hex": "01a4000315bc70f9b69244000458068f470030000d1135e41c0c1924057312520c00090a00090c0005010031f20032fe0033f200ce0a002400002500001c010199000195010196010086000900aa0000001e0ff600d3ffff0043ffff01930000019200000194000002220000022300000200300000000900af000e872401008e000000000000000058068f470031000d1135e41c0c1924057312520c00090a00090400870000880000a90000820010008b0009021e0000021f0000021d0000021c00000224000002250000008900000085044e0220000002210000008300000084000002260000022700000228000003008a00000000008d00000000008c000000000058068f470032000d1135e41c0c1924057312520c00090a000905019f01005800001b1f00ad0000cfac0b02290000022a0000022b0000022c0000022d00000012000000130000001d372d00c520a000740022023e0502060097000000000096000058520041007746c400d0000003f1005c0007c2190072001864880058068f470033000d1135e41c0c1924057312520c00090a000900000001008e00000000000000000706",
      "expect": {
        "kind": "records", "plen": 420, "plenOk": true, "crc": "0706", "crcOk": true, "trailingBytes": 0,
        "imei": "868324023580306", "command": 68, "recordsLeft": 0, "recordCount": 4,
        "mergeGroups": 1, "recordExtensions": ["0x30", "0x31", "0x32", "0x33"],
        "sharedHeader": { "tsMs": 1476825143000, "tsExt": 0,
          "lon": 21.9231716, "lat": 47.0554916, "altitude": 139.5, "angle": 46.9,
          "satellites": 12, "speed": 9, "hdop": 1.0, "eventIoId": 9 },
        "mergedIo": { "29": 14125, "30": 4086, "197": 8352, "116": 34,
                      "65": 7816900, "150": 22610, "92": 508441, "114": 1598600,
                      "175": 951588, "208": 1009, "142": 0 },
        "derived": { "externalV": 14.125, "rpm": 1044, "canFuelRateLph": 1.70 },
        "storedPositions": 1
      },
      "traps": ["7.10"]
    }
  ]
}
```

### 8.4 `ruptela-vendor.hex.json` — VENDOR, NOT REDISTRIBUTABLE

> **Licence note, read before using.** These frames come from *Ruptela device protocol v1.113*, a
> vendor document with **no licence grant**. Use them to verify **our own** decoder. **Do not ship the
> PDF, do not paste the document's prose into the repo, and do not present these as our test corpus to
> third parties.** The hex itself is a statement of fact about a wire format, was reassembled from the
> document's (badly extracted) field columns, and was **independently CRC-verified here** — the CRC
> matching over 20–1024 bytes is what proves the reassembly, not the mirror.

```json
{
  "source_url": "https://pdfcoffee.com/ruptela-protocol-v1113-pdf-free.html",
  "source_document": "Ruptela device protocol v1.113, R&D department, 2022-05-20",
  "retrieved_at": "2026-09-09",
  "licence": "NONE — vendor document. Verify against, do not redistribute.",
  "cases": [
    {
      "name": "cmd01-30records-STALE-FIX-MODE-A-satellites-zero",
      "direction": "device->server",
      "section": "3.2.1",
      "hex": "033500000C076B5C208F01011E5268CEF20000196E3A3A0AEF3E934F3E2D780000000007000000005268CEFD0000196E3A3A0AEF3E934F3E2D780000000007000000005268CF080000196E3A3A0AEF3E934F3E2D780000000007000000005268CF130000196E3A3A0AEF3E934F3E2D780000000007000000005268CF1E0000196E3A3A0AEF3E934F3E2D780000000007000000005268CF290000196E3A3A0AEF3E934F3E2D780000000007000000005268CF340000196E3A3A0AEF3E934F3E2D780000000007000000005268CF3F0000196E3A3A0AEF3E934F3E2D780000000007000000005268CF4A0000196E3A3A0AEF3E934F3E2D780000000007000000005268CF550000196E3A3A0AEF3E934F3E2D780000000007000000005268CF600000196E3A3A0AEF3E934F3E2D780000000007000000005268CF6B0000196E3A3A0AEF3E934F3E2D780000000007000000005268CF730000196E36630AEF42CE4F6D0BF40400022208000000005268CF7E0000196E36B60AEF42BE4F6D0BF40000000007000000005268CF890000196E36B60AEF42BE4F6D0BF40000000007000000005268CF940000196E36B60AEF42BE4F6D0BF40000000007000000005268CF9F0000196E36B60AEF42BE4F6D0BF40000000007000000005268CFAA0000196E36B60AEF42BE4F6D0BF40000000007000000005268CFB50000196E36B60AEF42BE4F6D0BF40000000007000000005268CFC00000196E36B60AEF42BE4F6D0BF40000000007000000005268CFCB0000196E36B60AEF42BE4F6D0BF40000000007000000005268CFD60000196E36B60AEF42BE4F6D0BF40000000007000000005268CFD70000196E3C710AEF5EFF4F690BF40400011708000000005268CFE20000196E3B980AEF601A4F690BF40000000007000000005268CFED0000196E3B980AEF601A4F690BF40000000007000000005268CFF80000196E3B980AEF601A4F690BF40000000007000000005268D0030000196E3B980AEF601A4F690BF40000000007000000005268D00E0000196E3B980AEF601A4F690BF40000000007000000005268D0190000196E3B980AEF601A4F690BF40000000007000000005268D0240000196E3B980AEF601A4F690BF400000000070000000046E2",
      "expect": {
        "kind": "records",
        "sourceStates": "plen 0x0335 = 821; IMEI 0x00000C076B5C208F = 13226005504143; command 0x01; records left 0x01; number of records 0x1E = 30; CRC16 0x46E2 = 18146",
        "plen": 821, "plenOk": true, "crc": "46E2", "crcOk": true, "trailingBytes": 0,
        "imeiDecimal": "13226005504143", "command": 1, "recordsLeft": 1, "recordCount": 30,
        "timeRange": ["2013-10-24T07:40:34Z", "2013-10-24T07:53:24Z"],
        "geometry": { "lonApprox": 42.66543, "latApprox": 18.34513, "altitudeRange": [2028, 2033],
                      "place": "Asir highlands, Saudi Arabia (~2000 m) — the reverse lon/lat assignment lands in the sea" },
        "everyRecord": { "ioCounts": [0, 0, 0, 0] },
        "modeAStaleFix": {
          "recordsWithSatellitesZero": 28,
          "genuineFixes": [
            { "index": 12, "tsMs": 1382600563000, "satellites": 4, "speed": 2, "hdop": 3.4, "eventIoId": 8 },
            { "index": 23, "tsMs": 1382600663000, "satellites": 4, "eventIoId": 8 }
          ],
          "note": "the vendor's own section 1.2.10 rule made visible: coordinates/altitude/angle REPEAT the last valid fix while satellites, speed and HDOP are cleared to 0"
        },
        "assertions": [
          "THE MODE-A FIXTURE. Traccar marks ALL 30 valid because lon/lat are not INT32_MIN.",
          "our hard rule 6 (satellites == 0 => fix_valid = false) is the CORRECT behaviour and this frame is the proof",
          "coordinates must be PRESERVED (unlike Mode B) but excluded from trip distance, geofence state, overspeed and map trails",
          "a run of Mode-A speed=0 records must NOT create a stop event"
        ]
      },
      "traps": ["7.4"]
    },

    {
      "name": "cmd09-dtc-two-codes-CORRECTLY-FRAMED",
      "direction": "device->server",
      "section": "3.2.9",
      "hex": "003000000B1A29F64B1A0902FF4E9CAF2C07D608F11A1480BA015030303130FF4E9CAF2C07D608F11A1480BA0250303031318C91",
      "expect": {
        "kind": "dtc",
        "sourceStates": "plen 0x0030 = 48; IMEI 12207001062170; command 9; 2 DTCs; CRC16 0x8C91. DTC 1: time 1318891308, lon 13.1467505, lat 43.7551290, status current, code P0010. DTC 2: same time and position, status history, code P0011.",
        "plen": 48, "plenOk": true, "crc": "8C91", "crcOk": true, "trailingBytes": 0,
        "imeiDecimal": "12207001062170", "command": 9, "count": 2,
        "dtcs": [
          { "source": "0xFF", "sourceName": "OBD", "tsMs": 1318891308000,
            "lon": 13.1467505, "lat": 43.7551290, "status": 1, "statusName": "current", "code": "P0010" },
          { "source": "0xFF", "sourceName": "OBD", "tsMs": 1318891308000,
            "lon": 13.1467505, "lat": 43.7551290, "status": 2, "statusName": "history", "code": "P0011" }
        ],
        "ack": "00026d01c4a4",
        "note": "the correctly-framed twin of Traccar's copy, which carries plen 0x000B for the same 48 bytes of content (trap 7.29)"
      },
      "traps": ["7.29"]
    },

    {
      "name": "cmd0F-identification-FM-Tco4-HCV",
      "direction": "device->server",
      "section": "3.2.14",
      "hex": "002E0003124D0AC0BB1C0F5463303430302E30332E30392E31300000DFC1388631180000601A000003E80000000A003CDA26",
      "expect": {
        "kind": "identification",
        "sourceStates": "plen 46; IMEI 864547032316700; command 15; payload 37 bytes; CRC16 0xDA26",
        "plen": 46, "plenOk": true, "crc": "DA26", "crcOk": true,
        "imei": "864547032316700", "command": 15,
        "deviceType": "Tc04", "deviceModel": "FM-Tco4 HCV", "firmware": "00.03.09.10",
        "imsi": "246020970000664", "gsmOperator": 24602,
        "distanceCoefficient": 1000, "timeCoefficient": 10, "angleCoefficient": 60,
        "ack": "00027301cb25"
      },
      "traps": ["7.6"]
    },

    {
      "name": "cmd12-dynamic-identification",
      "direction": "device->server",
      "section": "3.2.17",
      "hex": "00120003124D0AC0BB1C120102010100060204418B10",
      "expect": {
        "kind": "dynamic-identification",
        "sourceStates": "plen 0x0012 = 18; IMEI 864547032316700; command 0x12 = 18; version 1; 2 parameters; param 1 (Device type) length 1 value 0; param 6 (Time coefficient) length 2 value 0x0441 = 1089; CRC16 0x8B10",
        "plen": 18, "plenOk": true, "crc": "8B10", "crcOk": true,
        "imei": "864547032316700", "command": 18, "version": 1, "paramCount": 2,
        "params": [
          { "id": 1, "name": "device_type", "wireLength": 1, "nominalLength": 4, "value": 0 },
          { "id": 6, "name": "time_coefficient", "wireLength": 2, "nominalLength": 4, "value": 1089 }
        ],
        "ack": "00027301cb25",
        "assertions": [
          "PARSE BY THE ON-WIRE LENGTH, NEVER A TABLE: param 1 is nominally 4 ASCII bytes and is sent with length 1",
          "the ACK is 115 — the SAME as command 15. Traccar never sends it (trap 7.34)"
        ],
        "note": "the mirror's printed example is missing the version byte; the hex above is my reconstruction, and the vendor's printed CRC 0x8B10 matches it exactly. DIMO's TestParseDynamicIdentification uses the same payload."
      },
      "traps": ["7.34"]
    },

    {
      "name": "cmd16-heartbeat-MINIMUM-DEVICE-FRAME",
      "direction": "device->server",
      "section": "3.2.15",
      "hex": "0009000310F56174900710BD93",
      "expect": {
        "kind": "heartbeat",
        "sourceStates": "plen 0x0009 = 9; IMEI 0x000310F561749007 = 863071018192903; command 0x10 = 16; CRC16 0xBD93",
        "plen": 9, "plenOk": true, "crc": "BD93", "crcOk": true,
        "totalFrameBytes": 13, "payloadBytes": 0,
        "imei": "863071018192903", "command": 16,
        "ack": "00027401862d",
        "note": "the minimum-size device frame, and the disproof of the spec's own 'payload [1-1011]' annotation"
      },
      "traps": []
    },

    {
      "name": "cmd06-smart-card-size-VENDOR-EXAMPLE-HAS-WRONG-LENGTH",
      "direction": "device->server",
      "section": "3.2.7",
      "hex": "000B000315A07F44865A0654284E9CAF2CF5B3",
      "repairedHex": "000F000315A07F44865A0654284E9CAF2CF5B3",
      "expect": {
        "kind": "smart-card-size",
        "sourceStates": "plen 0x000B = 11; IMEI 868204004279898; command 6; size 0x5428 = 21544; timestamp 0x4E9CAF2C = 1318891308; CRC16 0xF5B3",
        "plenDeclared": 11, "plenActual": 15, "plenOk": false,
        "crc": "F5B3", "crcOk": true,
        "defect": "THE VENDOR'S OWN EXAMPLE PRINTS A WRONG LENGTH. The CRC is correct over the real 15-byte body; only the length field is wrong. Use repairedHex.",
        "imei": "868204004279898", "command": 6, "size": 21544, "tsMs": 1318891308000,
        "ack": "00026b019074",
        "note": "the 2nd-generation twin (command 19) IS self-consistent: 0011 000315A07F44865A 13 00005428 4E9CAF2C 5590 — 4-byte size instead of 2"
      },
      "traps": ["7.28"]
    },

    {
      "name": "rs232-io-records-CRC8-two-extended-records-in-a-tunnel",
      "direction": "device->server",
      "section": "3.2.13.1",
      "hex": "7B5B8FB2440010000F08DF7520A0C52E091F7E040D00000A00070A000500001B1B000200000300001C0100201C00AD0000730000CF0000820007001D3BB5001E0FEC0016000E0017000C0074000000C5000000D200000600410000045300960000601A005C000018060072000000D000CB0000000000D00000000C0075535B8FB2440011000F08DF7520A0C52E091F7E040D00000A0007040086000087000088000024000900830000008400000085000000890000008B0000020F000002100000019300000192000001008A00000000002A",
      "expect": {
        "kind": "rs232-io-records",
        "sourceStates": "record length (1 B), record data, CRC8 (1 B); this example contains two records",
        "framing": "length(1) | recordData(length) | CRC8(1), repeated",
        "crcAlgorithm": "CRC-8/ROHC — polynomial 0xE0 (reversed 0x07), init 0x00, reflected, over the record data only, EXCLUDING the length byte",
        "records": [
          { "length": 123, "crc8": "0x75", "crc8Ok": true, "recordType": "extended (25-byte header, 2-byte IO ids)",
            "tsMs": 1536143940000, "tsExt": 0, "recExt": "0x10", "part": "1 of 2", "priority": 0,
            "lon": 25.2239733, "lat": 54.7407150, "altitude": 233.5, "angle": 322.60,
            "satellites": 13, "speed": 0, "hdop": 1.0, "eventIoId": 7 },
          { "length": 83, "crc8": "0x2A", "crc8Ok": true, "recExt": "0x11", "part": "2 of 2" }
        ],
        "assertions": [
          "this is the ONLY place CRC-8 appears; GPRS frames never use it",
          "wkusaa/ruptela-nodejs computes it as CRC-8/SMBUS (poly 0x07, not reflected) and does NOT verify against this example — the vendor wins"
        ]
      },
      "traps": []
    },

    {
      "name": "cmd0B-tachograph-DDD-fragment-FULL-1024-BYTE-FRAME",
      "direction": "device->server",
      "section": "3.2.11",
      "hex": "03FC000315A07F440B1D0B00012020202020202020202020202020202020002020202020202020202020202020202020202020202020202020202020202020202020021553565420303620203030313620303030FFFFFFFF5139D511000000005139D5890000001501414243313233202020202020205139D3FE000008200002CD22D302D422D502D922DBA000030215535654203036202030303136203030305139D3810115000000000215535654203036202030303136203030305139D3FE0115000000000215535654203036202030303136203030305139D58801150000000000005A7CD46454F96FFD17185048208D996974A02AE71782B64DF19925DAE60402F648D2F9AE456D9409BE733A3D695A16DE44D6B9FEDE9AB7FCD87BAC382D28594E7394E0544109DBF57ADF57586EBF4AD9209BB33CEC61F75C8247498049ED6320A84525926A1FEFAB9237CC81EC1978167FDEBFF9CAD05419BE5F6587F37D56A776025147AA7F0000080004014D75737465726672617520343320202020202020202020202020202020202020202020014B7269737461203433202020202020202020202020202020202020202020202020202001123331303030303030303631333030303063D5B7005147172800000000514717B100000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00014D75737465726672617520343320202020202020202020202020202020202020202020014B7269737461203433202020202020202020202020202020202020202020202020202001123331303030303030303631333030303063D5B700514718630000000051471904000002150141424331323320202020202020514717B000014D75737465726672617520343320202020202020202020202020202020202020202020014B7269737461203433202020202020202020202020202020202020202020202020202001123331303030303030303631333030303063D5B70051472A6F0000020051472B610000021501414243313233202020202020205147190300014D75737465726672617520343320202020202020202020202020202020202020202020014B7269737461203433202020202020202020202020202020202020202020202020202001123331303030303030303631333030303063D5B70051473D3C0000020051473EFB00000815014142433132332020202020202051472B600000142000032B232D03301B312333037D1B80238103CD1BCE03D123D5A000AB31A333AB80A381ABCEA3D1030112333130303030303030363133303030305147190301150000000201123331303030303030303631333030303051472B6001150000000201123331303030303030303631333030303051473EFA011500000008000005B52FB4AF695C30C082D578",
      "expect": {
        "kind": "tachograph-ddd-fragment",
        "sourceStates": "plen 0x03FC = 1020; IMEI 0x000315A07F440B1D = 868204004248349; command 0x0B = 11; packet index 0x0001; payload = a fragment of the .DDD file [1-1009 bytes]",
        "plen": 1020, "plenOk": true, "crc": "D578", "crcOk": true,
        "totalFrameBytes": 1024,
        "imei": "868204004248349", "command": 11, "packetIndex": 1, "fragmentBytes": 1007,
        "payloadRecognisable": "EU tachograph card data — ASCII 'SVT 06  0016 000', driver names 'Musterfrau 43' and 'Krista 43', card number '31000000061300 00', plus a digital-signature block",
        "serverAck": "00046F0100016048",
        "transferFlow": "device cmd 12 (index FFFF) -> server 6F/FFFF -> device 0B/0000 -> server 6F/0000 -> device 0B/0001 -> ... -> short last fragment -> server 6F/<last>",
        "assertions": [
          "THE ONLY COMPLETE TACHOGRAPH DATA FRAME THAT EXISTS PUBLICLY",
          "the 111 reply's index field is a VARIABLE, not part of a constant — 0004 6F 01 FFFF 8179 is the START-OVER case only (trap 7.25)"
        ]
      },
      "traps": ["7.25"]
    },

    {
      "name": "cmd0C-tachograph-file-info",
      "direction": "device->server",
      "section": "3.2.12",
      "hex": "001E000315A07F440B1D0C010001B3BA519F2FD35130B20B518CFB070000FFFF87D4",
      "expect": {
        "kind": "tachograph-info",
        "sourceStates": "plen 0x001E = 30; IMEI 868204004248349; command 0x0C = 12; storage type 0x01 (1 internal flash, 2 SD card); data size 0x0001B3BA = 111546; read timestamp 0x519F2FD3; period start 0x5130B20B; period end 0x518CFB07; data CRC16 0x0000; packet index 0xFFFF",
        "plen": 30, "plenOk": true, "crc": "87D4", "crcOk": true,
        "imei": "868204004248349", "command": 12,
        "storage": 1, "size": 111546, "packetIndex": "0xFFFF",
        "packetIndexMeaning": "0xFFFF = fresh download from the beginning; otherwise the last index minus 1",
        "serverAck": "00046F01FFFF8179",
        "otherVerifiedIndexAcks": ["00046F01000071C1", "00046F0100016048", "00046F01006DC922", "00046F01006EFBB9"],
        "ackByteMeaning": "1 = positive; 2 = data rejected AND THE DEVICE DELETES EVERYTHING FROM ITS MEMORY"
      },
      "traps": ["7.25"]
    },

    {
      "name": "cmd0E-transparent-channel-rs232-payload",
      "direction": "device->server",
      "section": "3.2.13",
      "hex": "00180003124D0AC0BB1C0E0100005A6098A56162633132330D0ABD80",
      "expect": {
        "kind": "transparent-channel",
        "sourceStates": "plen 0x0018 = 24; IMEI 864547032316700; command 0x0E = 14; port 0x01 (0 = A, 1 = B, 2 = C on 4th gen); reserved 0x0000; timestamp 0x5A6098A5 = 1516279973; data ASCII 'abc123\\r\\n'; CRC16 0xBD80",
        "plen": 24, "plenOk": true, "crc": "BD80", "crcOk": true,
        "imei": "864547032316700", "command": 14, "portId": 1, "tsMs": 1516279973000,
        "data": "abc123\\r\\n",
        "serverAck": "000C720100006162633132330D0AA897",
        "note": "the device does not send further tunnel data until command 114 is received; the ACK may carry an optional payload written straight out of the RS232 port"
      },
      "traps": []
    },

    {
      "name": "cmd0A-and-cmd110-tachograph-transaction",
      "direction": "server->device + device->server",
      "section": "3.2.10",
      "serverHex": "00206E00003B9A96C01031FE5D0064057B01023180900076015130B20B518CFB07A416",
      "deviceHex": "0018000315A07F440B1D0A000000000301000000A4020C02000265D7",
      "expect": {
        "kind": "tachograph-transaction",
        "serverStates": "plen 0x0020 = 32; command 0x6E = 110; subcommand 0x02; reserved 0x0000; then the SubID payload; CRC16 0xA416. Tacho read is initiated by the server with command 110 SubID 2, after which the device takes control of communication.",
        "serverCrcOk": true, "deviceCrcOk": true, "deviceCrc": "65D7",
        "devicePayload": { "status": 0, "commandPacket": 3, "reserved": 1, "subIdStatus": 0,
                           "subIdPayload": "00A4020C020002",
                           "subIdPayloadMeaning": "an ISO-7816 SELECT FILE APDU" },
        "statusValues": { "0": "OK", "-1": "bad value", "-2": "bad parameter", "-3": "timeout",
                          "-4": "negative answer", "-5": "busy", "-6": "driver card in flash",
                          "-7": "bad SubID", "-8": "internal error" },
        "note": "Traccar does not implement command 10/110 at all. "
      },
      "traps": ["7.33"]
    },

    {
      "name": "cmd20-weighting-system-EMBEDDED-POSITION-semantically-corrupt",
      "direction": "device->server",
      "section": "3.2.21",
      "hex": "003300000B1A2A3C833E205268CEF200196E3A3A0AEF3E0101303030303030303330303A303030303030303730303A474C4153530D9F91",
      "expect": {
        "kind": "weighting",
        "sourceStates": "plen 0x0033 = 51; IMEI 12207005664062; command 0x20 = 32; a 14-byte record-data block; then the ASCII string; CRC16 0x9F91",
        "plen": 51, "plenOk": true, "crc": "9F91", "crcOk": true,
        "imeiDecimal": "12207005664062", "command": 32,
        "recordData": { "tsMs": 1382600434000, "rawLongitude": 1680594, "rawLatitude": 973864254,
                        "gpsFix": 1, "port": 1 },
        "text": "0000000300:0000000700:GLASS\\r",
        "serverAck": "00028401FA25",
        "defect": "SEMANTICALLY CORRUPT: rawLatitude 973864254 decodes to 97.386 degrees, which is not a place. The frame is CRC-consistent, so the vendor's example itself is edited or mis-transcribed. TRUST THE FIELD TABLE, NOT THE EXAMPLE.",
        "fieldTable": "timestamp(4) longitude(4, x1e7) latitude(4, x1e7) gpsFix(1) port(1) = 14 B, then ASCII",
        "note": "the only Ruptela packet that embeds a position outside the normal record format"
      },
      "traps": ["7.28"]
    }
  ]
}
```

### 8.5 `ruptela-server.hex.json` — server-to-device frames

Layouts are rank 1; **every CRC below was recomputed locally** with the routine that reproduces every
published Ruptela constant. Frames marked `derived: true` were **constructed from the documented
layout and never observed on a wire** — treat them as INFERRED.

```json
{
  "source_document": "Ruptela device protocol v1.113 sections 3.2.1-3.2.28 (layouts). CRCs recomputed here.",
  "retrieved_at": "2026-09-09",
  "licence": "Layouts from a vendor document (no grant); the CRC values are our own computation.",
  "cases": [
    { "name": "records-ACK-cmd100", "direction": "server->device", "hex": "0002640113BC",
      "expect": { "plen": 2, "command": 100, "ack": 1, "crc": "13BC", "crcOk": true,
        "answers": ["command 1", "command 68"],
        "semantics": "ACK=1 makes the device DELETE all sent records from flash. Send only after CRC verification AND durable persistence.",
        "assertions": ["the SAME 6 bytes answer command 68 — the reply command is 100, NOT 168 (trap 7.1)"] } },

    { "name": "records-NACK-cmd100", "direction": "server->device", "hex": "000264000235",
      "derived": true,
      "expect": { "plen": 2, "command": 100, "ack": 0, "crc": "0235", "crcOk": true,
        "status": "INFERRED — the vendor documents ACK value 0 but prints no hex. Built from the layout; CRC computed, never observed.",
        "semantics": "records are retained and re-sent after a backoff ladder of 1, 5, 10, 15, 30 then 60 minutes, capped at 60. Reset only by an ACK, a device restart, an econnect/connect/switchip SMS, GPRS command 105, or a change to IP1/port1/IP2/port2.",
        "assertions": ["use ONLY for 'I could not durably store this', never for 'I could not parse this' (trap 7.26)"] } },

    { "name": "identification-ACK-cmd115", "direction": "server->device", "hex": "00027301CB25",
      "expect": { "plen": 2, "command": 115, "ack": 1, "crc": "CB25", "crcOk": true,
        "answers": ["command 15", "command 18"],
        "semantics": "the device sends NOTHING until this arrives. Firmware (104) and configuration (102) still work unacknowledged; every other server command is discarded." } },

    { "name": "identification-REJECT-with-lockout-cmd115", "direction": "server->device", "hex": "00037302B4AFA3",
      "expect": { "plen": 3, "command": 115, "ack": 2, "delayMinutes": 180, "crc": "AFA3", "crcOk": true,
        "semantics": "the device breaks the link and makes no further connection attempt until the delay expires.",
        "notApplicableTo": ["FM-Eco4", "FM-Plug4"],
        "assertions": ["THIS is the frame our multi-tenant ingest needs for an unknown or suspended IMEI. Traccar implements nothing of the sort.",
                       "ACK byte 0 is UNDEFINED for command 115 — do not send it (open question Q7)"] } },

    { "name": "heartbeat-ACK-cmd116", "direction": "server->device", "hex": "00027401862D",
      "expect": { "plen": 2, "command": 116, "ack": 1, "crc": "862D", "crcOk": true } },

    { "name": "dtc-ACK-cmd109", "direction": "server->device", "hex": "00026D01C4A4",
      "expect": { "plen": 2, "command": 109, "ack": 1, "crc": "C4A4", "crcOk": true,
        "ackValues": { "0": "NACK", "1": "ACK", "2": "request DTCs from the device" } } },
    { "name": "dtc-NACK-cmd109", "direction": "server->device", "hex": "00026D00D52D", "derived": true,
      "expect": { "plen": 2, "command": 109, "ack": 0, "crc": "D52D", "crcOk": true } },

    { "name": "smartcard-ACK-cmd107", "direction": "server->device", "hex": "00026B019074",
      "expect": { "plen": 2, "command": 107, "ack": 1, "crc": "9074", "crcOk": true,
        "ackValues": { "0": "NACK", "1": "ACK", "2": "card data rejected" },
        "answers": ["command 5", "command 6", "command 19"] } },
    { "name": "smartcard-NACK-cmd107", "direction": "server->device", "hex": "00026B0081FD", "derived": true,
      "expect": { "crc": "81FD", "crcOk": true } },
    { "name": "smartcard-REJECTED-cmd107", "direction": "server->device", "hex": "00026B02A2EF", "derived": true,
      "expect": { "crc": "A2EF", "crcOk": true } },

    { "name": "tacho-ACK-cmd111-start-over", "direction": "server->device", "hex": "00046F01FFFF8179",
      "expect": { "plen": 4, "command": 111, "ack": 1, "packetIndex": "0xFFFF", "crc": "8179", "crcOk": true,
        "warning": "THE INDEX IS A VARIABLE. 0xFFFF means 'start from the beginning'. Verified sibling frames with different indices and therefore different CRCs: 00046F01000071C1, 00046F0100016048, 00046F01006DC922, 00046F01006EFBB9 (trap 7.25)",
        "ackValues": { "1": "positive", "2": "data rejected AND the device deletes everything from its memory" } } },

    { "name": "accident-ACK-cmd135", "direction": "server->device", "hex": "00028701D04D",
      "expect": { "plen": 2, "command": 135, "ack": 1, "crc": "D04D", "crcOk": true } },

    { "name": "beacon-ACK-cmd138", "direction": "server->device", "hex": "00028A016035",
      "expect": { "plen": 2, "command": 138, "ack": 1, "crc": "6035", "crcOk": true } },

    { "name": "sdlog-ACK-cmd134-subcommand1", "direction": "server->device", "hex": "00028601C995",
      "expect": { "plen": 2, "command": 134, "subcommand": 1, "crc": "C995", "crcOk": true,
        "semantics": "after this the device sends the next log record pack (stop-and-wait)" } },
    { "name": "sdlog-STOP-cmd134-subcommand2", "direction": "server->device", "hex": "00028602FB0E",
      "expect": { "crc": "FB0E", "crcOk": true } },
    { "name": "sdlog-REQUEST-cmd134-subcommand0", "direction": "server->device", "hex": "000C8600553F44F2553F45A60000B0FA",
      "expect": { "plen": 12, "command": 134, "subcommand": 0,
        "startTs": 1430209778, "endTs": 1430209958, "reserved": 0, "crc": "B0FA", "crcOk": true,
        "deviceReply": "command 34 (0x22) with an EXTRA subcommand byte before recordsLeft: 0x40 = standard-protocol records, 0x80 = extended. EVERY SD log record carries event ID 252." } },
    { "name": "sdlog-ERASE-SD-cmd134-subcommand16", "direction": "server->device", "hex": "00028610C89D",
      "expect": { "crc": "C89D", "crcOk": true,
        "deviceReply": { "hex": "000B00000B1A29F64B1A22100185DF", "crc": "85DF", "crcOk": true,
                         "status": { "0": "erase error", "1": "erase completed" } } } },
    { "name": "sdlog-ENABLE-LOGGING-cmd134-subcommand32", "direction": "server->device", "hex": "0007862001553F44F2D247",
      "expect": { "crc": "D247", "crcOk": true,
        "deviceReply": { "hex": "000B00000B1A29F64B1A222001337D", "crc": "337D", "crcOk": true,
                         "status": { "0": "stopped", "1": "started", "2": "cannot start" } } } },

    { "name": "set-io-cmd117-and-device-ack-cmd17", "direction": "server->device",
      "hex": "000975000000AF0000006439CC",
      "expect": { "plen": 9, "command": 117, "ioId": 175, "ioValue": 100, "crc": "39CC", "crcOk": true,
        "note": "BOTH the IO ID and the value are 4 bytes",
        "settableIds": { "65": "virtual odometer", "175": "ECO absolute idling time",
                         "114": "CANBUS distance (overwritten by a valid CAN message)",
                         "577": "DIN1 hours accumulated", "578": "DIN2", "579": "DIN3", "580": "DIN4" },
        "deviceReply": { "hex": "000A000310F56139B98411009799", "plen": 10,
                         "imei": "863071014336900", "command": 17, "ack": 0, "crc": "9799", "crcOk": true,
                         "ACK_VALUES_ARE_INVERTED": { "0": "IO value was CHANGED (success)",
                                                      "1": "FM device failed to change IO value",
                                                      "2": "value change for this IO is not supported" },
                         "assertions": ["command 17 is the ONLY Ruptela ack where 0 means success — do not write a shared ack-byte helper (rule R9)"] } } },

    { "name": "version-request-cmd103-MINIMUM-SERVER-FRAME", "direction": "server->device", "hex": "00016717B9",
      "expect": { "plen": 1, "command": 103, "payloadBytes": 0, "totalFrameBytes": 5,
        "crc": "17B9", "crcOk": true,
        "deviceReply": { "hex": "00220003124D0AC0BB1C03353432432C30302E30332E30392E31302C3636382C32322C31E7EC",
                         "plen": 34, "imei": "864547032316700", "command": 3, "crc": "E7EC", "crcOk": true,
                         "text": "542C,00.03.09.10,668,22,1",
                         "fields": ["bootloader version", "firmware version", "hardware version",
                                    "GSM signal level (0 = no signal .. 31 = strong)",
                                    "voltage status (0 = too low, 1 = OK)"],
                         "note": "Traccar decodes this only as a free-text 'result' attribute — parse the CSV" } } },

    { "name": "configuration-cmd102-and-device-response-cmd2", "direction": "server->device",
      "hex": "000E66236366675F7374617274400D0A0947",
      "expect": { "plen": 14, "command": 102, "text": "#cfg_start@\\r\\n", "crc": "0947", "crcOk": true,
        "deviceReply": { "hex": "00160003124D0AC0BB1C02406366675F7374732331300D0A4B58",
                         "plen": 22, "command": 2, "text": "@cfg_sts#10\\r\\n", "crc": "4B58", "crcOk": true },
        "note": "CR-LF terminated. Configuration PAYLOADS (as opposed to these control messages) are LITTLE-endian inside a big-endian frame — the vendor writes 'Packet length (1st packet) = 0xE601 (LE) = 0x01E6 (Endian conversion) = 486 Bytes'." } },

    { "name": "firmware-update-cmd104-and-device-response-cmd4", "direction": "server->device",
      "hex": "000C687C46555F535452542A0D0AB66B",
      "expect": { "plen": 12, "command": 104, "text": "|FU_STRT*\\r\\n", "crc": "B66B", "crcOk": true,
        "deviceReply": { "hex": "00120003124D0AC0BB1C042A46555F4F4B7C0D0A75DB",
                         "plen": 18, "command": 4, "text": "*FU_OK|\\r\\n", "crc": "75DB", "crcOk": true },
        "COLLISION_WARNING": "command id 104 is byte 0x68; command id 68 (device extended records) is byte 0x44. The number 68 appears as both a decimal command number and a hex byte, in opposite directions.",
        "note": "certificates and the TLS private key load through this channel: |FU_WRITE_S1*, |FU_WRITE_S2*, |FU_WRITE_PK*" } },

    { "name": "garmin-status-request-cmd130-and-device-response-cmd30-NO-IMEI",
      "direction": "server->device", "hex": "000182A71A",
      "expect": { "plen": 1, "command": 130, "payloadBytes": 0, "crc": "A71A", "crcOk": true,
        "deviceReply": { "hex": "00021E011E08", "plen": 2, "command": 30, "status": 1,
                         "crc": "1E08", "crcOk": true,
                         "DEFECT": "THIS DEVICE-TO-SERVER FRAME HAS NO IMEI FIELD. I confirmed the CRC over the two bytes 1E 01 really is 0x1E08, so the vendor computed it over an IMEI-less frame. Identical in v1.67, v1.82 and v1.113.",
                         "statusValues": { "1": "Garmin is not responding (not connected)",
                                           "2": "Garmin is responding (connected)",
                                           "3": "Garmin is responding and supports the unicode protocol" },
                         "safeRule": "reject as IMEI-bearing any device-to-server frame whose plen < 9, and handle command 30 as the documented special case (trap 7.27)" } } },

    { "name": "garmin-fmi-passthrough-cmd31-and-cmd131", "direction": "both",
      "deviceHex": "003A00000B1A2A3C833E1F100602A100571003578B002500000B1A2A3C833E1F10A11641000602000035303030313100000000000000000000D91003C112",
      "serverHex": "001D8310A11640000600000035303030313100000000000000000000DC1003753C",
      "expect": { "deviceCrc": "C112", "deviceCrcOk": true, "serverCrc": "753C", "serverCrcOk": true,
        "imeiDecimal": "12207005664062",
        "semantics": "the FM device just forwards FMI messages between server and Garmin device",
        "payloadFormat": "Garmin's own DLE-framed protocol (0x10 ... 0x10 0x03) — needs byte-stuffing awareness if tunnelled",
        "DOC_TYPO": "the prose for the device direction says 'command 31 (0x83)' but the example hex carries 0x1F (= 31 decimal); 0x83 = 131 is the SERVER command. The hex is right; the prose is a typo." } },

    { "name": "files-cmd137-full-subcommand-family", "direction": "server->device",
      "hex": "000B8900005B3463805B3481E854FE",
      "expect": { "plen": 11, "command": 137, "subcommand": 0, "subcommandName": "Quantity",
        "sourceId": 0, "tsStart": 1530160000, "tsEnd": 1530167784, "crc": "54FE", "crcOk": true,
        "deviceReply": { "hex": "000D000314F82AF6BBB5250000000A1821", "quantity": 10, "crc": "1821", "crcOk": true },
        "subcommandIds": { "0": "Quantity", "1": "Name", "2": "Transfer",
                           "3": "Delete by name", "4": "Delete by timestamp range" },
        "sourceIds": { "0": "Camera A folder on SD", "1": "Camera B folder on SD",
                       "2": "PortA camera memory", "3": "PortB camera memory",
                       "4": "Fatigue sensor folder on SD", "5": "Fatigue sensor memory (FM-Eco4 RS T only)" },
        "siblingFrames": {
          "nameRequest": { "hex": "000B8901005B3463805B3481E878D9", "crcOk": true },
          "transferRequest": { "hex": "000D8902003542333436333830000094CE", "crcOk": true,
                               "fileName": "5B346380", "packetNumber": 0,
                               "note": "file names shorter than 8 characters are SPACE-padded on the right" },
          "deleteByName": { "hex": "000B89030035423334363338309032", "crcOk": true,
                            "reply": { "hex": "0014000314F82AF6BBB52503003542333436333830019B9C",
                                       "status": { "0": "Error", "1": "OK" }, "crcOk": true } },
          "deleteByRange": { "hex": "000B8904005B3463805B3481E8E462", "crcOk": true,
                             "reply": { "hex": "000C000314F82AF6BBB525040001927A", "crcOk": true } }
        } } },

    { "name": "set-connection-parameters-cmd105-FIRE-AND-FORGET", "direction": "server->device",
      "hex": "0015693139322E3136382E302E312C393031352C5443501763",
      "expect": { "plen": 21, "command": 105, "text": "192.168.0.1,9015,TCP", "crc": "1763", "crcOk": true,
        "NO_RESPONSE": true,
        "semantics": "the device does not answer. Next time — FOR ONE TIME ONLY — it connects using these parameters.",
        "assertions": ["one of only TWO server commands with no acknowledgement; our command queue cannot confirm delivery (rule R10)"] } },

    { "name": "set-odometer-cmd106-FIRE-AND-FORGET", "direction": "server->device",
      "hex": "00056A123456788AEB",
      "expect": { "plen": 5, "command": 106, "odometer": 305419896, "crc": "8AEB", "crcOk": true,
        "NO_RESPONSE": true,
        "semantics": "the next generated record carries the new odometer value" } },

    { "name": "fls-channel-open-and-close-cmd133", "direction": "server->device",
      "openHex": "00038501013D00", "closeHex": "00038503010EB0",
      "expect": { "command": 133, "openCrc": "3D00", "openCrcOk": true,
        "closeCrc": "0EB0", "closeCrcOk": true,
        "subCmdIds": { "1": "open RFLS channel", "2": "send data through the channel", "3": "close channel" },
        "portX": { "0": "PORTA", "1": "PORTB", "2": "PORTC" },
        "UNRESOLVED": "the device's open-RESPONSE command byte contradicts itself in the vendor doc: the field table says 33 (0x21) and the SubCmdID-2 example uses 0x21, but the SubCmdID-1 example prints 0x11 — and the doc's printed CRC DD6A matches the TYPO, not the table (I computed A1CB for the 0x21 reading). Trust the field table. Do NOT use the SubCmdID-1 response as a fixture." } }
  ]
}
```

### 8.6 DO NOT USE — quarantined vectors

These circulate as test material and are wrong. Each is listed with **why**, because someone will
otherwise re-adopt them.

```json
{
  "quarantine": [
    {
      "name": "cmd07-sms-response-setio-ok-MALFORMED-LENGTH",
      "source": "https://github.com/traccar/traccar/blob/master/src/test/java/org/traccar/protocol/RuptelaProtocolDecoderTest.java",
      "hex": "0011000315A07F440B1D07534554494F20636F6E66696775726174696F6E2064617461206F6B341C",
      "defect": "plen declared 0x0011 = 17; actual body 36 bytes (0x0024). The CRC 0x341C IS correct over the real body. A length-prefixed framer cuts this at 17 bytes.",
      "diagnosis": "hand-edited contributor fixture. Its header 0011 000315A07F44... is REUSED from the vendor's unrelated command-19 example — the copy-paste tell.",
      "text": "SETIO configuration data ok",
      "useInstead": "the vendor's correctly-framed twin: 00240003124D0AC0BB1C07534554494F20636F6E66696775726174696F6E2064617461206F6BC419",
      "repairedHex": "0024000315A07F440B1D07534554494F20636F6E66696775726174696F6E2064617461206F6B0C36",
      "allowedUse": "payload-layout fixture fed directly to the text handler. NEVER a framing fixture.",
      "traps": ["7.29"]
    },
    {
      "name": "cmd09-dtc-MALFORMED-LENGTH",
      "source": "https://github.com/traccar/traccar/blob/master/src/test/java/org/traccar/protocol/RuptelaProtocolDecoderTest.java",
      "hex": "000B00000B1A29F64B1A0902FF4E9CAF2C07D608F11A1480BA015030303130FF4E9CAF2C07D608F11A1480BA0250303031318C91",
      "defect": "plen declared 0x000B = 11; actual body 48 bytes. CRC 0x8C91 is correct over the real body.",
      "diagnosis": "byte-identical to the vendor's example EXCEPT the length; the vendor prints 0x0030 = 48 in ALL FOUR spec versions (v1.67, v1.82, v1.103, v1.113).",
      "useInstead": "ruptela-vendor.hex.json / cmd09-dtc-two-codes-CORRECTLY-FRAMED",
      "traps": ["7.29"]
    },
    {
      "name": "cmd44-DIMO-RealWorldComplexPayload-RECORD-COUNT-MISMATCH",
      "source": "https://github.com/DIMO-Network/ruptela-protocol-server/blob/main/ruptela/parser_test.go",
      "licence": "MIT",
      "hex": "03A000031190B0FC9B1644010768A04CEA0020001527CC341714DEE6295F68BA14000009019908001B1F000200000300001C0100AD0001A20100240000730005001D3255001E0E9C0016000000C500000074000003004100188F9C009600006FBB007202A9BE9003007B0000000000000000007C0000000000000000007D000000000000000068A04CEA0021001527CC341714DEE6295F68BA1400000901990C00CE00016A00020600020A00021A00005F040060FF0061FF0062000063000065000067000500CD000000D20000005E000000640000006600000200D000000006005C00000D200068A04CEA0022001527CC341714DEE6295F68BA1400000901990602D2FF047CFF047EFF01990000050004830006006B01C30282FFFF019709D70198000102D3FFFF03B600000202850001880A02F20001EB5F0300685756475A5A5A354E00695A4B573339393535006A350000000000000068A04CEA0120001527CC341714DEE6295F68BA14000009000508001B1F000200000300001C0100AD0001A20100240000730005001D3253001E0E9C0016000000C500000074000003004100188F9C009600006FBB007202A9BE9003007B0000000000000000007C0000000000000000007D000000000000000068A04CEA0121001527CC341714DEE6295F68BA1400000900050C00CE00016A00020600020A00021A00005F040060FF0061FF0062000063000065000067000500CD000000D20000005E000000640000006600000200D000000006005C00000D200068A04CEA0122001527CC341714DEE6295F68BA1400000900050602D2FF047CFF047EFF01990000050004830006006B01C30282FFFF019700000198000002D3FFFF03B600000202850001880A02F20001EB5F0300685756475A5A5A354E00695A4B573339393535006A3500000000000000FF766B0A0000000000000000FFFF776B0A0000000000000000FFFF786B0A0000000000000000FFFF796B0A0000000000000000FFFF7A6B0A0000000000000000FFFF7B6B0A0000000000000000FFFF7C6B0A0000000000000000FFFF7D6B0A0000000000000000FFFF7E6B0A0000000000000000FFFF7F6B0A0000000000000000FFFF806B0A0000000000000000FFFF816B0A0000000000000000FFFF826B0A0000000000000000FFFF836B0A0000000000000000FFFF846B0A0000000000000000FFFF856B0A0000000000000000FFFF866B0A0000000000000000FFFF876B0A0000000000000000FFFF886B0A0000000000000000FFFF896B0A0000000028A0",
      "sourceClaims": "a real Ruptela packet with multiple records that should be merged (test name RealWorldComplexPayload)",
      "defect": "framing is self-consistent (plen 0x03A0 = 928 == actual, CRC 0x28A0 matches) and the DECLARED RECORD COUNT IS 7 — but only SIX records parse. The remaining 255 bytes are an obvious arithmetic progression: 13-byte blocks FF FF <NN> 6B 0A 00*8 with NN counting 0x76, 0x77 ... 0x89. Since the length and CRC agree with those 255 bytes, they were appended and the length/CRC regenerated.",
      "whatIsGood": "the first six records ARE clean: two 3-record merge groups at ts 0x68A04CEA = 2025-08-16T21:29:14Z with tsExt 0 and 1, recExt 0x20/0x21/0x22 each, lon 35.6480279, lat 39.0176350, and a VIN in IO 104/105/106 = 'WVGZZZ5NZKW399555'.",
      "useInstead": "DIMO's sample_data/sample_input — internally perfect and published with an expected decode",
      "actualValue": "AN EXCELLENT NEGATIVE TEST: declared count > parseable records, trailing garbage, VALID CRC. Exactly the partial-parse + ACK-the-count-actually-persisted case."
    },
    {
      "name": "cmd38-beacon-record-PARTIAL-NOT-A-FRAME",
      "source": "Ruptela device protocol v1.113 section 3.2.26",
      "partialHex": "5FE31AA807D608F11A1480BA0101B503F5647C0365DD0201060C09502049442030303533303200000000000000000000000000000000",
      "defect": "THIS IS 54 BYTES OF BEACON RECORD, NOT A FRAME. The vendor prints '-' for both the records and the CRC in its command-38 example, so NO complete command-38 frame exists in the documentation. My reassembly comes out 38 bytes where 37 are required — one padding byte is wrong, and there is no CRC to check it against.",
      "layoutIsKnown": "ts(4) lon(4) lat(4) msgType(1) nBeacons(1) then per beacon: rssi(1) type(1) data(37) flag(1)",
      "statedValues": { "timestamp": 1608719016, "longitude": 13.1467505, "latitude": 43.7551290,
                        "messageType": 1, "beaconCount": 1,
                        "rssi": "181 -> dBm = 181 - 256 = -75",
                        "beaconType": { "1": "iBeacon", "2": "Eddystone", "3": "MAC only" },
                        "flag": { "0": "none", "68": "C (cargo)", "84": "T (wireless trailer ID)" } },
      "verdict": "TREAT AS A GAP. BLE beacon ingest for Ruptela would be flying blind."
    }
  ]
}
```

### 8.7 What the corpus does NOT contain

Listed because a fixture suite that looks complete but has these holes is more dangerous than one that
admits them.

| Missing | Why it matters |
|---|---|
| **A record with a NEGATIVE altitude** | zero of the 309 decoded records has altitude ≥ `0x8000` in a *valid-fix* record. This is exactly the capture that would settle §9 Q1. |
| **A record with HDOP = `0xFE`** | the GSM/LBS-approximated-position marker is completely untested. Traccar turns it into hdop 25.4 on a position it marks valid, feeding cell-tower fixes into trip distance. |
| **Any classic (cmd 1) record with `tsExt` ≥ 100** | the decimal merge encoding (§3.3.2) is rank-1 spec text stable across four versions, and **not one capture exercises it**. Undetected data-loss path on older Eco4/Tco4 firmware. |
| **A DTC from J1939 (source `0x01`) or J1708 (`0x02`)** | the 5-byte hex encoding is undocumented. Only the OBD case exists, and it exists exactly **once** — the same payload appears in both the vendor doc and Traccar's test. |
| **Any capture from a 5th-generation device** | every real capture is 4th gen or older (Eco4 Light, Eco4 Light 3G, Eco4 S/T, FM-Pro4, FM-Tco4, FM-Plug4). Gen-5 type codes are documented; no frame from one exists — and Traccar's maintainer warns the IO mapping is not the same across generations. |
| **Command 5/107 smart-card DDD fragments** | the vendor prints only *"Raw data segment of DDD file"* as a placeholder, no CRC. |
| **Command 33/133 FLS "send data"** | the payload is the literal word `PAYLOAD` in the vendor examples, and the SubCmdID-1 response has the command-byte contradiction. |
| **Command 34/134 SD-log frames carrying actual records** | only the control subcommands have complete frames. Nothing exercises the "every SD log record has event ID 252" rule. |
| **Command 35/135 accident reconstruction, either direction** | field tables only, columns unreconstructable, no frame and no CRC. Only the server ACK `0002 87 01 D04D` exists. |
| **Command 37/137 subcommand 1 (Name) response** | column-mangled 768-byte frame; I could not reconstruct it to a CRC-verifiable state. |
| **Command 11/111 tacho fragments other than index `0x0001`** | no middle fragment, no short last fragment. The vendor's flow shows a final frame of length `0x0237` but prints only its first bytes. |
| **Command 17/117 ack values 1 and 2** | only the success value 0 is documented with hex. |
| **Any Ruptela frame over UDP** | zero evidence of how framing and ACK behave on a datagram transport. |
| **A capture from a deliberately NACKing server** | the backoff ladder has never been observed, only documented; and whether the link is torn down after a NACK is unknown. |
---

## 9. Open questions

Every one is genuinely **UNKNOWN** — not "I did not look". Each carries **what would settle it** and
**how much it matters**, because an implementer working alone at night needs to know which of these to
stop and resolve and which to ship around.

**Impact scale:** BLOCKING (do not ship the affected feature) · HIGH (ships wrong data that looks
right) · MEDIUM (ships wrong data that looks wrong, or degrades a feature) · LOW (cosmetic or
theoretical).

---

**Q1 — Is altitude a signed or unsigned 16-bit value? And how does either reading cover the world?**
The vendor's §1.3 signed/unsigned split puts altitude in the signed group (its no-fix sentinel is
`0x8000` = `INT16_MIN`), but Traccar, **and Ruptela's own decoding utility**, read it unsigned. And
neither reading covers the physical range: signed caps at +3276.7 m (below La Paz, El Alto, Lhasa),
unsigned caps at 0 m (above Rotterdam, Schiphol, Baku, the Dead Sea). All 309 decoded records have a
maximum raw altitude of 2205, and the only value ≥ `0x8000` is the sentinel.
**What would settle it:** the FMIO row for **IO 419 "GPS altitude"** — both DIMO's `io_types.go` and
`dimitrievski/ruptela` already list 419 in their signed-exception sets, which implies the vendor types
the IO form of altitude as `Signed int.`; if its `Min. Value` is negative and its `Units` are metres
rather than decimetres, that would also explain how the vendor covers terrain above 3277 m (a separate
parameter, not the header field). Failing that: any capture from **above 3277 m or below sea level**,
or the Advanced Configurator's altitude display range.
**Matters:** HIGH. Wrong either way for a populated region, and wrong *plausibly* (−3276 m or
+6547 m both survive a smallint column and a NULL guard). Until settled: read `u16`, treat raw
≥ `0x8000` as needing an explicit disambiguation rule, never a silent cast.

**Q2 — The complete authoritative IO dictionary (`FMIO list.xlsx`).**
This is the single largest gap in the document. The only source giving `ID → name → size → type →
multiplier/offset → units → error values → per-model support` returns **HTTP 404**, the link is still
published in Ruptela's own help-centre article, and everything under `doc.ruptela.com/api-proxy/` is
login-gated. Best substitutes today: flespi's 673 IDs (names, **not** wire units), DIMO's ~240 typed
IDs (types, **no** multipliers), `dimitrievski/ruptela`'s 62-entry signed list, the two name-keyed
vendor appendices (multipliers, **no** IDs), and two low-resolution forum screenshots.
**What would settle it:** a Ruptela support ticket. Then run `jrafaelca/ruptela-fmio` over it.
**Matters:** BLOCKING for any CAN/FMS/tachograph feature; HIGH for everything else. CLAUDE.md hard
rule 8 demands a citation for every ID, width and scaling — **we cannot satisfy that rule for Ruptela
today.** Every dictionary entry we ship without it is a `TODO(VERIFY-WIKI)` in spirit.

**Q3 — What does `plen` mean when the device transmits a logical object larger than 1024 bytes?**
Firmware images, DDD tachograph files and JPEGs are all fragmented, and every observed frame is ≤ 1024
bytes — but the server→device command-137 schematic shows `0400` = 1024 as a *length*, which would
make the total 1028.
**What would settle it:** a real capture of a picture transfer, or the confidential
`DOC_Tacho read detailed protocol.xls`.
**Matters:** MEDIUM. Only affects the file/firmware/tacho families; a `plen > 1020` reject is the safe
default and will surface the case loudly if it exists.

**Q4 — Does any firmware ever pipeline two record packets without waiting for the first ACK?**
Everything documented is stop-and-wait, and every open implementation assumes it — but nothing in the
spec *forbids* pipelining, and DIMO's server loops over multiple frames per read.
**What would settle it:** a timestamped `tcpdump` of a large offline flush.
**Matters:** MEDIUM. If it happens and you ACK per-frame you are fine; if you assume strict alternation
and gate reads on your own ACK write, you deadlock.

**Q5 — What is the numeric value of the device's server-response timeout?**
Not published in any accessible source (v1.67/1.82/1.103/1.113, SMS Command List 2.21, HCV5 manual,
help centre). Only the **counter** is documented: `lktmo` / `TMO`, with the vendor's own
interpretation *"A big number of timeouts indicates that there might be a problem from the server side
(The device not receiving the ACK from the server)."* The vendor's `info` example shows `TMO 126`
against 575 opened links.
**What would settle it:** a packet capture against a deliberately silent server; or the Advanced
Configurator's connection-settings screen (a "Link timeout" field may exist); or a support ticket.
Field advice from a deployment recipe is 300–600 s with constant link on — **unverified**.
**Matters:** MEDIUM. Any ACK deadline we assume is a guess, which makes our own persistence-latency
budget a guess.

**Q6 — Does the device break the open link when identification is unacknowledged?**
§3.2.14 (v1.103, v1.113) says *"…until ACK … is received from the server (command 115) **and breaks the
open link**."* §3.2.17, the dynamic-identification twin **in the same document**, omits the clause.
v1.82 omits it in both places.
**What would settle it:** the real PDF at full fidelity, or a capture of an unacknowledged ident across
the link timeout.
**Matters:** MEDIUM. Assuming *no* link-break means your server holds a socket the device has already
abandoned — a slow FD leak that presents as "device online".

**Q7 — What does ACK byte `0` mean in a command-115 reply?**
The spec defines only `1` (ACK) and `2` (reject + delay) for command 115. Traccar and DIMO never send
`0`.
**What would settle it:** a firmware behaviour test, or vendor confirmation.
**Matters:** LOW, but easy to get wrong: do not reach for `0` as "reject" by analogy with command 100.
Use `2` + a delay byte.

**Q8 — The records NACK frame has never been captured.**
`000264000235` is **derived**: the layout is rank-1, the CRC is my computation, and nobody has observed
the bytes on a wire.
**What would settle it:** any capture of a server that NACKs.
**Matters:** LOW for the bytes (the CRC routine reproduces every other published constant), HIGH for
the *behaviour* it triggers — see Q22.

**Q9 — Is `records left` in command 35/135 the same 0/1 flag as in commands 1/68?**
The 35/135 example's decimal row reads `35 3 19 0 20`, which would put **19** in that position.
**What would settle it:** a real accident-reconstruction capture, or the vendor field table at full
fidelity.
**Matters:** MEDIUM, and **the mitigation is free**: write `left !== 0` everywhere, never `left === 1`,
and log a warning if it is ever > 1.

**Q10 — What is the record-buffer capacity of 4th- and 5th-generation devices?**
Only the 3rd-gen manual gives a number: *"About 5000 records … then start overwriting oldest records."*
Marketing claims "up to 2 days" for FM-Eco4+.
**What would settle it:** the per-model datasheet, or `info` / `getsd` output on a filled device.
**Matters:** HIGH for incident planning. It sets the deadline on how long a wedged device (§7.1, §7.2)
can go before it starts destroying its own oldest unsent data — i.e. how fast our alerting has to be.

**Q11 — What are the numeric values of the `priority` field?**
The vendor's table lists "High" and "Low" but the mirror stripped the Value column. Observed values in
real captures are only `0` and `1`; DIMO annotates `0 low, 1 high`. Whether a third value exists
(e.g. panic) is unknown.
**What would settle it:** the real PDF §1.2.3, or a capture from a device with a panic button
configured.
**Matters:** MEDIUM. If a panic priority exists and we treat it as "high", a duress alarm arrives as an
ordinary record.

**Q12 — Does the classic (command 1) decimal merge encoding actually occur in the field?**
Rank-1 spec text, stable across v1.67 (2017) through v1.113 (2022) — but **every** classic capture I
decoded has `tsExt` = 0 or a small counter, and **no** open implementation implements it.
**What would settle it:** a command-1 capture from a device configured with more IOs than fit in
126 bytes, or a vendor support answer.
**Matters:** HIGH for older Eco4/Tco4 fleets. It is the mechanism behind the field symptom "Ruptela
splits data", so it is real; what is unknown is how often. Implement the `0`–`99` counter /
`100`–`199` merge reconciliation and **log loudly on any `tsExt` ≥ 100** so the first real occurrence
surfaces from production traffic.

**Q13 — HDOP = `0xFE` (GSM/LBS-approximated position) is completely untested.**
Rank-1 documented; **no capture in this corpus contains it.**
**What would settle it:** a capture from a device with GSM tracking enabled indoors.
**Matters:** HIGH. Traccar turns it into `hdop 25.4` on a position it marks **valid**, which feeds
cell-tower fixes into trip distance and map trails. Implement the flag from the spec and write the
fixture by hand; do not wait for a capture.

**Q14 — What is the 5-byte J1939 / J1708 DTC encoding?**
The spec says only *"For J1939 and J1708 data sources diagnostic trouble code is in HEX format"* and
gives no field breakdown. A J1939 DM1 DTC is normally **4** bytes (19-bit SPN, 5-bit FMI, 1-bit CM,
7-bit OC) — the fifth byte is unexplained. Every public sample is OBD (source `0xFF`).
**What would settle it:** a capture with source `0x01` or `0x02`, or the DTC section of a newer spec
revision.
**Matters:** MEDIUM. Store the 5 bytes raw and hex-render them until settled; do not invent an SPN/FMI
decode.

**Q15 — Command 5/107 (smart-card DDD fragments) has no complete frame anywhere.**
The vendor prints only *"Raw data segment of DDD file"* as a placeholder, with 512-byte payloads and no
CRC.
**What would settle it:** a real driver-card download capture.
**Matters:** BLOCKING for that feature; irrelevant otherwise.

**Q16 — Command 34/134 SD-card log frames carrying actual records have never been captured.**
Only the control subcommands (`0x00`, `0x01`, `0x02`, `0x10`, `0x20`) have complete frames. In
particular **nothing exercises the documented rule that every SD-log record carries event ID 252.**
**What would settle it:** a capture of an SD-log replay.
**Matters:** MEDIUM. The record layout is the same as commands 1/68 apart from the leading subcommand
byte, so the risk is bounded — but the event-252 marker is how you distinguish replayed history from
live data, and getting it wrong would double-count trips.

**Q17 — Command 35/135 accident reconstruction: no reconstructable frame, and two sub-layouts are
guesses.**
The announcement's 29-byte total and its 9 × i16 calibration matrix are forced by arithmetic, but the
extracted column header reads `XX XY XZ YX YY ZZ YZ ZX ZY` — **almost certainly scrambled**. And the
gyroscope sub-record layout (type `0x01`) is **assumed identical to the accelerometer** because the
spec works an example only for accelerometer and GNSS.
**What would settle it:** the real PDF, or a device with a known calibration, or any real 0x23 capture
with type-`0x01` records.
**Matters:** MEDIUM. One thing here **is** solid and must be carried into code: the **GNSS sub-records
reverse the coordinate order to latitude-then-longitude**, the opposite of the record header —
confirmed because the vendor's own numbers resolve to Vilnius only under that order
(`0x20A0D3E4` = 547410916 → lat 54.7410916 precedes `0x0F08B6E6` = 252229350 → lon 25.2229350).

**Q18 — Command 38/138 beacon data: no complete frame exists.**
The vendor's example prints `-` for both the beacon records and the CRC. My reassembly of the 54-byte
record comes out **one byte long** with nothing to check it against — specifically the internal
structure of the 37-byte `data` field (raw BLE advertising payload vs a 6-byte MAC plus padding for
type `0x03`) is unresolved.
**What would settle it:** a real command-38 capture.
**Matters:** BLOCKING for BLE beacon / trailer / cargo-tag ingest. Note also that this command
**reverses the field order** relative to 1/68 (`count` before `recordsLeft`) and that its count is a
*session total*, so even the outer frame has a trap in it.

**Q19 — Do IO 1201–1220 ("Custom / Manual CAN 1…20") carry any self-describing header?**
Eight raw bytes each, twenty slots, no semantics on the wire. Unknown whether the bytes are meaningless
without the matching Configurator / Lua rule set held on the device.
**What would settle it:** the Lua Scripting / Manual CAN documentation on `my.ruptela.com` (gated).
**Matters:** MEDIUM. Store as opaque bytes (and as hex strings — §7.7) and let the fleet operator's
configuration give them meaning. Do not attempt a decode.

**Q20 — The bit layouts of the packed multiplex parameters.**
IO **151** (geofence ID + group + entered/left + overspeed + validity + DIN/AIN event), **352–354**
(tell-tale status groups), **561/562** (trailer status), **740–742** and **870–885** (ECO and tacho
bitmaps), **1153**. flespi enumerates the sub-fields **by name** but publishes **no bit positions**,
and no open decoder unpacks any of them.
**What would settle it:** the FMIO `IO Explanation and Notes` text for those rows.
**Matters:** MEDIUM–HIGH. IO 151 in particular is the geofence event channel; storing it as one opaque
integer means we cannot drive geofence state from the device's own decision and must recompute it
server-side. That is arguably the right architecture anyway (hard rule 6 requires our own validity
gate) — but it should be a choice, not an accident.

**Q21 — No tachograph DDD fragment other than index `0x0001` has ever been captured.**
No middle fragment, no short **last** fragment. The vendor's flow shows a final frame of length
`0x0237` but prints only its first bytes.
**What would settle it:** a real three-fragment DDD download capture.
**Matters:** BLOCKING for tachograph download, because it is what would catch a hardcoded ACK index
(§7.25). Do not ship the feature until this exists.

**Q22 — After a NACK, does the device hold or close the TCP link? Is the backoff ladder per-packet or
per-connection?**
Nothing in any source states either. Both change the reconnect-storm math directly.
**What would settle it:** a timestamped capture against a deliberately NACKing server, across at least
three ladder steps.
**Matters:** HIGH operationally. A 30-second outage can become an hour of fleet-wide silence (§7.26),
and whether the devices come back as a herd or a trickle is decided by exactly these two unknowns.

**Q23 — Does any real firmware miscompute `plen`, or are the two bad Traccar fixtures hand-edited?**
Both have correct CRCs over the true content and wrong length fields. I traced both to fixture editing
(one reuses an unrelated vendor example's header; the other is byte-identical to a vendor example whose
printed length is correct in all four spec versions) — but "I traced it" is inference, not proof.
**What would settle it:** a raw `tcpdump` from the same firmware.
**Matters:** MEDIUM. It decides whether the length field is trustworthy for framing. Current answer:
**trust it, assert it against the body, and drop the connection on mismatch.**

**Q24 — Is the identification packet sent on EVERY new TCP link, or only once per power cycle, or only
when enabled?**
The spec never says it is optional. DIMO caches it per-connection; Traccar happily decodes record
packets with **no preceding ident**; and field users disable the "Identification String" setting
entirely as a workaround.
**What would settle it:** a full-session capture from power-on across a reconnect, or the Configurator
screen that toggles "Dynamic identification string".
**Matters:** HIGH for a multi-tenant registry. If the ident is the only place device type and firmware
appear (it is) and it arrives once per power cycle, then our registry must persist it rather than
expect it per session — and our **authorization** must not depend on it arriving, since some devices
have it disabled.

**Q25 — What are the multipliers and offsets for the pre-scaled 920–928 "vehicle" block?**
Every observed value is already in engineering units (920 = 1734 rpm, 921 = 61 km/h, 922 = 23143 km,
924 = 9 L, 928 = 0 %), so **multiplier 1** is the working assumption.
**What would settle it:** the FMIO `Multiplier; offset` column for 920–928, or a frame where a 920-block
value **and** its FMS twin are both non-round.
**Matters:** MEDIUM. If any of them carries a hidden multiplier, the error is a clean 2× or 10× on a
number a fleet operator reads daily.

**Q26 — IDs 39, 101 and 519 all map to "engine load" somewhere; are they the same thing?**
flespi calls all three engine load; DIMO names **101** *"OBD actual engine percent torque"* and marks
it signed. If 101 is OBD PID 62, the rule is `A − 125`, meaning raw `0` = **−125 %**, not 0 %. Every
observed sample was 0 on an ECU that also reported 0 throttle while cruising, i.e. the vehicle simply
does not support the PID.
**What would settle it:** the FMIO rows for 39/101/519, or a capture with a non-zero value.
**Matters:** MEDIUM. A `−125 %` torque reading is obviously wrong; a `0 %` reading looks like a healthy
idle and hides the fact that the PID is unsupported.

**Q27 — Scaling for IO 754 (`can.fuel.consumed`) and IO 407 (fuel consumption per 100 km).**
754: `0x000068A8` = 26792 against an odometer of 23143 km gives 115 L/100 km at 1 L/bit or 58 L/100 km
at 0.5 L/bit — **neither matches** the same record's io407 = 24.6 L/100 km at 0.1 per bit. 407's
multiplier is not documented anywhere public; 0.1 L/100 km per bit is the only plausible reading.
**What would settle it:** the FMIO rows, or a two-sample delta over a known distance.
**Matters:** MEDIUM. Fuel-consumption numbers are directly customer-visible and directly disputed.

**Q28 — IO 27: what is the real error-value set, and does the 0–31 CSQ meaning still hold on gen-5?**
FMIO says errors `255 and 100` while `Max. Value` is 31; the Gen-3/Gen-4 vendor appendix says
`99 = not known or detectable` (the 3GPP TS 27.007 `AT+CSQ` convention); real captures show **both 99
and 255**. The presence of `100` in the error set hints that newer firmware may have switched to a
0–100 percentage.
**What would settle it:** the FMIO row at full resolution, or firmware release notes.
**Matters:** LOW–MEDIUM. **The safe rule is already known and costs nothing: anything > 31 is
unknown.** But if gen-5 really switched to a percentage, a 45 % signal would be silently mapped to a
CSQ index of 45 and rendered as an excellent signal.

**Q29 — IO 28 (current profile): is `0` legal?**
FMIO says `Min. Value 1, Max. Value 4`; the Gen-3 appendix says `0-4` with `0 = default profile`.
Generational drift.
**What would settle it:** the FMIO row, or a gen-3 capture.
**Matters:** LOW. Accept 0–4 and do not validate.

**Q30 — Model-by-model IO support.**
The FMIO workbook's ~24 Yes/No columns are the **only** authority for which IO IDs a given model can
produce. flespi's per-device pages are a coarse substitute.
**What would settle it:** Q2.
**Matters:** MEDIUM. Without it we cannot tell "this truck has no fuel sender" from "this model never
reports fuel", which is the difference between a support ticket and a product limitation.

**Q31 — The order of the nine i16 accelerometer calibration-matrix cells (command 35 announcement).**
See Q17. The extracted header `XX XY XZ YX YY ZZ YZ ZX ZY` is not a valid ordering of a 3×3 matrix.
**Matters:** LOW unless we ship accident reconstruction.

**Q32 — Is IO 34 (iButton) emitted most-significant-byte-first on the wire, and which order should we
canonicalise to?**
Not an unknown about the *bytes* — the bytes are known — but an unknown about **convention**: Traccar
emits wire order, flespi emits reversed, and there is no vendor statement. The DS1990A family byte
`0x01` appearing **first** in `01d042f31d000030` is weak evidence for wire order being the natural
ROM order.
**What would settle it:** a physical fob with a printed ID read through a Ruptela device.
**Matters:** HIGH at migration time only — but at migration time it is total: every driver fob in a
fleet stops matching on day one. Decide, document, and also *recognise* the reversed form (§7.24).

**Q33 — Which IMEI string formatting is canonical?**
Traccar zero-pads to 15 (`%015d`); the vendor prints raw decimals of 14 digits. **Neither is wrong;
picking inconsistently is.** This is a decision, not a discovery — it is listed here because it will
silently split a device registry if it is left implicit.
**Matters:** HIGH. Pick one, apply it to registry lookup **and** to stored records, and assert it in a
test using the 14-digit capture in §8.
---

## 10. Verdict

### 10.1 Is this implementable today without guessing?

**Yes for the core. No for the periphery. And the boundary between them is sharp enough to draw.**

**Implementable today, without guessing — ship it:**

| Capability | Why it is safe |
|---|---|
| Framing (`plen`, bounds, resync policy) | VERIFIED on 33 frames; layout errors fail loudly |
| CRC-16/KERMIT, and CRC-8/ROHC for RS232 records | named algorithm, parameters given, ~80 published constants reproduced independently |
| Identification 15 and 18, and the 115 ACK including the reject-with-lockout frame | VERIFIED on 4 frames; the reject frame is the one thing here Traccar does not have and our multi-tenancy needs |
| Heartbeat 16/116 | VERIFIED, trivially |
| Classic records (command 1), 23-byte header + four IO groups | VERIFIED byte-exactly on 10 frames, zero slack |
| Extended records (command 68), 25-byte header, 2-byte IO IDs | VERIFIED on 6 frames including a golden pair with a published expected decode |
| Extended merge by `(timestamp, tsExt)` + `recordExtension` nibbles | VERIFIED, with an adversarial out-of-order capture to test against |
| No-fix **Mode A** (stale coordinates, `sat=0`) | rank-1 text **and** a 30-record vendor demonstration |
| No-fix **Mode B** sentinel detection | one capture, but structurally self-consistent across six fields |
| The ACK contract (100 for both 1 and 68; boolean; delete-on-ACK; the backoff ladder) | rank 1, corroborated by three independent implementations |
| DTC (command 9) for OBD sources | VERIFIED byte-for-byte against the vendor's own stated expected values |
| ~45 IO scalings | each measured against a second independent quantity in the same record |

**NOT implementable today — do not ship, and say so in the product:**

| Capability | Blocker |
|---|---|
| **Tachograph .DDD download** | Q21 (no fragment other than index 1 has ever been seen) + Q15 + the confidential detailed flow. And §7.25: the ACK contains a variable that every summary presents as a constant. A stalled download that never errors is worse than an unsupported feature. |
| **BLE beacons / trailer / cargo tags** | Q18 — no complete frame exists, and my record reassembly is off by one byte with no CRC to check it |
| **Accident reconstruction** | Q17, Q31 — field tables only, one sub-layout assumed, calibration-matrix order scrambled |
| **Any complete CAN/FMS/tacho parameter product** | Q2 — the dictionary is 404. We can decode ~45 IDs with citations and ~670 by name only. **CLAUDE.md hard rule 8 cannot be satisfied for the rest.** |
| **UDP** | zero evidence of framing or ACK behaviour on a datagram transport |
| **5th-generation devices, with confidence** | not one capture from any of them exists |

**Two things must be settled before the first paying Ruptela device connects**, and neither is a
decoding question:

1. **Q33 / decoder rule 8 — the IMEI formatting convention.** A registry split by an implicit choice is
   unrecoverable later.
2. **§7.22 — the IP1/IP2 onboarding gate.** If we are provisioned as the *secondary* server, our ACK
   does nothing, the device never retries to us, and we go dark whenever the primary does. That must be
   read back at provisioning time and refused, in words the operator understands.

### 10.2 The riskiest byte in the protocol

**The satellites byte in a Mode-B no-fix record: `0xFF` at offset 18 (classic) / 19 (extended).**

Not the altitude field, though that one is genuinely unresolved (Q1) — altitude is wrong by a bounded
amount, in a column that already NULLs out-of-range values, and it does not decide whether a record
is real.

`sat = 0xFF` decides whether a record is real, and it defeats our guard **silently and completely**:

- `satellites > 0` → **255 > 0 is TRUE**.
- `isNullIsland(lat, lon)` → **−214.7483648 / −214.7483648 is not 0/0**, so FALSE.

So `normalize.ts` returns `fix_valid = TRUE`, and there is **no lat/lon range validation anywhere in
the write path** — `normalize.ts` runs `inRangeOrNull` over speed, course, altitude and satellites but
passes `lat: p.lat, lon: p.lon` straight through, and `packages/db/sql/001_positions.sql` declares
`lat double precision NOT NULL, lon double precision NOT NULL` with **no CHECK constraint**. The
result is 29 rows per packet at latitude −214.75 marked as valid fixes, flowing into trip distance,
geofence state and map trails — precisely the three things hard rule 6 exists to protect. Or, if the
`|lat| > 90` reject in `persist.ts` catches them first, the **entire packet** vanishes into `rejects`
as reason `coords`, taking the ignition/voltage/GSM evidence with it, and support sees one word.

**Three things make this byte worse than any other in the document:**

1. **Its authority is thinnest exactly where it matters most.** The vendor sentence that names these
   sentinel values (§1.3) has had its numeric column stripped by the mirror this whole document rests
   on — it literally reads *"will have value. Fields which can only be positive will have value."*
   Everything asserted about Mode B rests on **one FM-Eco4 Light 3G capture: one device, one firmware,
   one configuration checkbox.**
2. **CRC reconstruction — the technique behind most VERIFIED labels here — cannot check it.** CRCs
   prove layout. A dropped value column still reconstructs to a valid CRC. This document is strongest
   exactly where mistakes fail loudly (byte offsets) and weakest exactly where they fail silently
   (values).
3. **The obvious over-correction breaks the case that currently works.** It is widely said that a
   Teltonika-style rule "mis-classifies both no-fix modes." **It does not.** Mode A clears satellites
   to 0, so `sats > 0` handles Mode A correctly today. An implementer who believes the stronger claim
   and *replaces* rule 6 fixes Mode B and breaks Mode A — trading a loud failure for a quiet one.

**The rule, in full, is three parts and must be implemented as three parts:**

1. **Reject the Mode-B sentinel at the decoder**, before it ever reaches normalize — recognise the
   whole block (`lon`/`lat` = `0x80000000`, `alt` = `0x8000`, `angle`/`speed` = `0xFFFF`,
   `sat`/`hdop` = `0xFF`), emit `fix_valid = false` with `lat`/`lon`/`altitude`/`speed`/`course`/
   `satellites` **NULL**, and **keep the IO map**.
2. **Keep `sat > 0` for Mode A**, and preserve Mode A's coordinates while excluding them from trip
   distance, geofence state, overspeed and map trails — and make sure no stop/idle detector reads the
   zeroed **speed** column instead of `fix_valid`.
3. **Add lat/lon range validation to `normalize.ts` and a CHECK constraint to `positions`.** Neither
   exists today. This is defence in depth against the next vendor whose sentinel we have not seen.

And the fixture that pins all three is already in §8: the 29-record `03fb…ad9e` frame. It asserts
`fix_valid = false` ×29, NULL coordinates, a preserved IO map, **exactly 29 stored rows** (two of
which share `(ts, tsExt)`), **zero** rejects, **one** ACK, and two epochs in one packet. If a Ruptela
codec passes that single fixture honestly, it has survived six of the ten most expensive traps in this
document.
