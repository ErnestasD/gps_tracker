# Teltonika Codec 16 (0x10) — implementation-ready specification

**Status of this document.** Every factual claim below carries a label and a source.

| label | meaning |
|---|---|
| **VERIFIED** | Stated by a rank-1/2 source *and* confirmed by decoding real bytes, or computed and checked here. |
| **INFERRED** | Not stated by any source; derived from physics, byte accounting, or cross-field consistency. Could be wrong. |
| **UNKNOWN** | Nobody knows. Listed in §9 with what would settle it. |

Source ranks used throughout: **r1** vendor wiki / vendor PDF · **r2** Traccar (Apache-2.0, the only decoder with real Codec-16 test vectors) · **r3** flespi · **r4** independent open-source reimplementations · **r5** issue trackers, vendor support posts, device logs · **r6** marketing pages.

Everything numeric in this document that says "I decoded" was produced by a decoder written from the §3 byte map and run against the five known frames. The run output is reproduced in §4 and §8. **All CRCs, all timestamps, all coordinates and all IO values below were recomputed, not copied from any source.**

---

## 1. What speaks this protocol

### 1.1 The model statement

> "Codec16 is using for **FMB630/FM63XY** series devices… Note: Codec16 is supported from firmware – **00.03.xx and newer**. (FMB630/FM63XY)"
> — **VERIFIED r1**, https://wiki.teltonika-gps.com/view/Teltonika_Data_Sending_Protocols · repeated verbatim at https://wiki.teltonika-gps.com/view/Teltonika_AVL_Protocols

**This sentence has been deleted from the current https://wiki.teltonika-gps.com/view/Codec page** and survives there only in the Wayback snapshot of 2020-09-26. If you read only /view/Codec you will not learn which hardware this is for. (**VERIFIED r1 historical**, http://web.archive.org/cdx/search/cdx?url=wiki.teltonika-gps.com/view/Codec — 28 distinct revisions 2020-09-26 → 2026-05-27.)

### 1.2 Expanding "FM63XY"

**VERIFIED r1** (the vendor's own errata footnote): *"FM63XX – FMB630, FM6300, FM6320"* — https://wiki.teltonika-gps.com/view/FM6300_firmware_errata.

| model | Codec 16? | evidence |
|---|---|---|
| **FM6300** | yes | named in the vendor sentence; has a wiki page; parameter page transcludes the FMB630 template |
| **FM6320** | yes | named in the errata footnote; **the only model-attributed real Codec-16 capture in existence is an FM6320** (§8 V2) |
| **FMB630** | yes | named first in the vendor sentence; `FMB630_firmware_Errata` and `FMB630_Teltonika_Data_Sending_Parameters_ID` both **redirect** to the FM6300 pages — one firmware line, one dictionary |
| FMB631 | **UNKNOWN** | referenced in some renderings of the family name; `/view/FMB631` returns 404. Not confirmed. |
| FMB640 / FMB641 / FMC640 / FMM640 | **no** | *"In Data Protocol settings user can choose which protocol version (**Codec 8 or Codec 8 Extended**)"* — **VERIFIED r1**, https://wiki.teltonika-gps.com/view/FMB640_System_settings. A different product line with its own errata (which lists Codec **15**, not 16). |
| everything FMB1xx / FMC1xx / FMU / FMT / TAT | **no** | These use Codec 8 / 8E. Codec 16 solves the >255-AVL-id problem that 8E solves for them. |

> **Pin the model before writing code.** "FMB6xx" is ambiguous in the worst possible way: FMB630 → Codec 16; FMB640 → Codec 8/8E. Same nomenclature block, different protocol, different dictionary.

### 1.3 Why the codec exists

> "AVL IDs that are higher than 255 will can be used only in the **Codec16** protocol." — **VERIFIED r1**, /view/Teltonika_Data_Sending_Protocols

Codec 16 is the FM63XY-generation answer to the same problem Codec 8 Extended solves for the FMB families: a 1-byte AVL id ran out. **VERIFIED on the wire**: test vector V3 (§8) carries 32 IO elements whose ids are 256…287 — literally unrepresentable in Codec 8.

### 1.4 Is the codec selectable?

**VERIFIED r1 by absence.** `Template:FMB630_Device_Family_Parameter_list` contains exactly one occurrence of the string "Codec" — *"Empty Codec 12"*, a value of the Network Ping Mode parameter. There is **no Data Protocol / codec-selection parameter** on this family, unlike the 640s. `FM6300_Device_Family_Parameter_list` is literally `{{Template:FMB630_Device_Family_Parameter_list}}` (**VERIFIED r1**, https://wiki.teltonika-gps.com/index.php?title=FM6300_Device_Family_Parameter_list&action=raw).

**INFERRED (strong):** an FM63XY on firmware ≥ 00.03.xx sends Codec 16 for every AVL frame and never Codec 8. *Absence of a parameter is not a vendor statement* — see §9 Q11.

### 1.5 How much of the vendor line this covers

Small, and shrinking. Teltonika's catalogue is dominated by FMB/FMC/FMU families that speak Codec 8/8E. Codec 16 is **one frozen family, three model names, firmware line ended 2020-08-10 at 01.00.34** (**VERIFIED r1**, FM6300_firmware_errata; earliest listed release 00.00.49, 2016-09-01). There will be no further firmware fixes: **every defect in §7 that lives in the device is permanent and the server must absorb it.**

Corroborating negative result worth recording: **flespi — which runs 582,786 Teltonika devices — documents Codec 8 and Codec 12 only and never mentions Codec 16 or any FM63xx model** (**VERIFIED r3**, https://flespi.com/protocols/teltonika). A GitHub-wide issue search for `"codec 16" teltonika` returns 8 results, **none of them a decode-bug report**. Stack Overflow and Teltonika Crowd produce zero threads. This protocol is quiet not because it is simple but because almost nobody outside Traccar decodes it — which is exactly why the vendor's own worked examples have been wrong for a decade (§7).

---

## 2. Transport and session

**Headline: Codec 16 changes nothing at the transport layer.** Framing, handshake, CRC, ACK bytes and ACK semantics are byte-identical to Codec 8. The vendor says so directly:

> "Communication with server is the same as with Codec8 protocol, except in Codec16 protocol Codec ID is 0x10 and has generation type."
> — **VERIFIED r1**, https://wiki.teltonika-gps.com/view/Codec §Codec 16

Everything Codec-16-specific is inside the record (§3.4). Everything in this section is therefore reusable across codecs — but the *hardware* that speaks Codec 16 has an older parameter set and a frozen firmware, and that is where the transport hazards live.

### 2.1 Socket and configuration

**VERIFIED r1**, `Template:FMB630_Device_Family_Parameter_list`:

| parameter | id | values | default |
|---|---|---|---|
| Server 1/2 Protocol | x240 field 2 | `0 = TCP`, `1 = UDP` | 0 (TCP) |
| Server Response Timeout | — | 5 … 300 s | 5 |
| Records Sorting | 108 | `0 = from newest`, `1 = from oldest` | **0 (newest first)** |
| Active Data Link Timeout | 109 | 0 … 259200 s | 5 |
| Network Ping Timeout | 155 | 0 … 259200 s | 1 |
| Network Ping Mode | 156 | `0 disabled`, `1 = 0xFF`, `2 = Empty Codec 12` | 0 |
| Records saving/Sending | 157 | `0 After GNSS fix`, `1 Always`, `2 After time sync` | 0 |
| Preferred records saving destination | 101 | `0 internal memory`, `1 SD card` | — |
| Min Saved Records | — | 1 … 25 | 10 |
| Min Send Period | — | 0 … 9999999 s | 600 |

Both transports require an application-layer ACK: *"From the device side TCP and UDP both protocols require a confirmation from the server to the device sent packets"* (**VERIFIED r1**, Template:FMB_GPRS_settings).

**Note the parameter-id collision hazard:** parameter 109 (Active Data Link Timeout) and AVL element 109 (an FMS field, §5) are different namespaces. Configuration parameter ids and AVL element ids are unrelated.

### 2.2 TCP stream framing — the disambiguation order

Three different things arrive on one TCP socket. **You must test in this order** (**VERIFIED r2**, `TeltonikaFrameDecoder.java`; **VERIFIED r1** for each shape):

```
if (buf[0] == 0xFF)                        -> 1-byte keep-alive PING. Consume 1 byte. Reply NOTHING.
else if (be32(buf[0..3]) == 0x00000000)    -> AVL frame (codec 0x10) or command frame (codec 0x0C/0x0D/0x0E)
else                                       -> IMEI login: be16 length prefix + ASCII IMEI
```

The IMEI branch is identified by the fact that a login frame's first two bytes are a small length (0x000F = 15) and can never be `00 00`. Traccar frames on exactly this rule: *length > 0 ⇒ login, else need `dataLength + 12` bytes*, with `MESSAGE_MINIMUM_LENGTH = 12` and `MAX_FRAME_LENGTH_LARGE = 32 * 1024`.

### 2.3 The AVL frame

**VERIFIED r1** (/view/Codec §Codec 16 → AVL data packet) **and confirmed byte-exact on four real TCP frames** (dlen 95, 157, 159, 899 → wire 107, 169, 171, 911):

| off | width | field | notes |
|---|---|---|---|
| 0 | 4 | Preamble | must be `00 00 00 00` |
| 4 | 4 | Data Field Length | uint32 BE. Spans **Codec ID through Number of Data 2 inclusive** |
| 8 | 1 | Codec ID | `0x10` for Codec 16 |
| 9 | 1 | Number of Data 1 | uint8 record count ⇒ **max 255 records per frame** |
| 10 | dlen−3 | AVL Data | `NoD1` records, back to back, no separators, no padding |
| 8+dlen−1 | 1 | Number of Data 2 | must equal NoD1 |
| 8+dlen | 4 | CRC | 16-bit value right-aligned in a 32-bit field |

`total wire bytes = dataFieldLength + 12`. **VERIFIED** on 4/4 frames.

**Size bounds — the sources fight, and one is refuted by hex:**

| source | claim | verdict |
|---|---|---|
| /view/Teltonika_Data_Sending_Protocols §Codec 16 (r1, live) | FMB630/FM63XY: min record 45 B, **max record 255 B**; no packet cap stated | record floor is wrong, see below |
| /view/Codec §Codec 8 note (r1, live) | FMB640: max packet 512 B; *"for other devices … max AVL packet size 1280 bytes"* | **INFERRED borrowing** — this is a Codec-8 note, not a Codec-16 statement |
| Wayback 2026-01-12 of /view/Codec (r1) | *"for FMB630, FMB640 **and FM63XY** … Maximum AVL packet size is **512 bytes**"* | **REFUTED**: real FM6320 frame has dlen = 899 with a valid CRC |
| FM6300 errata 00.01.10 (r1) | *"AVL packet size depends of hardware. Now it fits to maximum modem packet size"* | the honest answer: it is not a protocol constant |

**Directive (INFERRED, mine).** Do not validate against 45, 255, 512 or 1280. The protocol's own arithmetic bound is `255 records × 255 B/record + 3 = 65 028 bytes`. Validate against the **declared** Data Field Length plus a generous engineering ceiling well above 65 028, and **never destroy the session on an oversize frame** — see §7 T-14.

**Structural minimum record is 32 bytes** (24 fixed + 2 event id + 1 gen type + 1 total + 4 group counts), **VERIFIED by construction**. The vendor's "45 bytes minimum" is a statement about a default *configuration*, not a parser bound — and the vendor's own UDP sample carries a 48-byte record. (Note the 2020 Wayback snapshot said "minimum AVL **packet** size is 45 bytes"; the word later changed to "record". Neither is a bound you can enforce.)

### 2.4 The 0xFF keep-alive ping

**VERIFIED r1**: *"the device sends a 0xFF byte to server to keep the link open. This functionality works only for Record and Backup Servers. Network Ping Timeout should be always lower than Open Link Timeout."* — Template:FMB_GPRS_settings. Enabled by parameter 156 = 1 (default 0 = off).

**VERIFIED r2** — Traccar's framer test carries the exact wire case, a ping glued to a login:
```
in:  FF 000F 313233343536373839303132333435
out: [FF] , [000F313233343536373839303132333435]
```
**VERIFIED r5** — confirmed on FMB920 hardware; the server needs to send **no** reply, and a server that echoed 0xFF as a pong did not disturb the device (https://github.com/alim-zanibekov/teltonika/issues/2).

Ping Mode `2` emits an "Empty Codec 12" frame instead of a bare byte. **Its exact wire bytes are UNKNOWN** (§9 Q1).

### 2.5 Login / handshake

**VERIFIED r1** (/view/Codec §Communication with server), identical for Codec 8/8E/16:

```
device -> server:  000F 333536333037303432343431303133      be16 length = 15, then ASCII "356307042441013"
server -> device:  01   accept
                   00   reject       "confirmation should be sent as binary packet. I.e. 1 byte"
```

TCP only. **UDP has no handshake** — the IMEI is carried in every datagram.

What a device does after receiving `00` — reconnect interval, retry cap, whether it fails over to the backup server — is **UNKNOWN** (§9 Q2).

### 2.6 CRC — named, with the vendor's own algorithm

**VERIFIED r1** — read directly off the vendor's algorithm flowchart image https://wiki.teltonika-gps.com/images/4/45/CRC16.png (linked from /view/Codec §CRC-16): `CRC = 0`; for each byte `CRC ^= byte`; then eight times `carry = CRC & 1; CRC >>= 1; if (carry) CRC ^= 0xA001`.

| property | value |
|---|---|
| name | **CRC-16/IBM**, a.k.a. **CRC-16/ARC** |
| polynomial | `0x8005`, applied reflected as `0xA001` |
| init | `0x0000` |
| refin / refout | **true / true** |
| xorout | `0x0000` |
| check("123456789") | **`0xBB3D`** — I computed it; matches the published CRC-16/ARC check value |
| span | **Codec ID … Number of Data 2** — exactly the Data Field Length region, `data[8 .. 8+dlen)` |
| field | 4 bytes; value right-aligned; **top 2 bytes `00 00` in 5/5 samples** |

**VERIFIED by recomputation on five frames:** wiki Codec-8 example `0xC7CF` ✅ · wiki Codec-16 example `0x5FB3` ✅ · wiki Codec-12 getinfo `0x4312` ✅ · Traccar 899-byte Codec-16 frame `0xEB85` ✅ · Traccar 159-byte Codec-16 frame `0x0D3B` ✅. One published frame **fails**: the vendor PDF's `…009D1002…` example declares `0x09A5` where the true CRC is `0xA6DE` (§7 T-19).

**UDP carries no CRC at all.** Over UDP your only integrity checks are the UDP checksum (optional in IPv4), `NoD1 == NoD2`, and exact byte accounting.

Whether the top two bytes of the 4-byte CRC field are *guaranteed* zero is **UNKNOWN** (§9 Q5). Comparing all 32 bits is stricter than any documented rule; it is a defensible house rule, but know that it is one.

### 2.7 ACK — bytes, and what the number MEANS to the device

**TCP ACK is four bytes, big-endian, the record count. Nothing else.**

```
device sends 2 records   ->   server writes  00 00 00 02
device sends 4 records   ->   server writes  00 00 00 04
device sends 1 record    ->   server writes  00 00 00 01
server rejects the frame ->   server writes  00 00 00 00
```
**VERIFIED r1** — the wiki's Codec-16 example literally prints *"Server acknowledges data reception (2 data elements): 00000002"*. **VERIFIED r2** — Traccar writes the same four bytes for **every** AVL codec; Codec 16 takes no special branch.

**UDP ACK is seven bytes:** `[be16 length = 5][be16 packet id][0x01][avl packet id][count]` → the vendor example `0005 CAFE 01 07 01`. See §3.6 and §7 T-22 for the packet-id disagreement.

#### The acknowledged value, stated as rules

**RULE A1 (VERIFIED r1).** The number means *"this many records of the packet you just sent were accepted."* Vendor, verbatim: *"After server receives packet and parses it, server must report to module number of data received as integer (four bytes). **If sent data number and reported by server doesn't match module resends sent data.**"*

**RULE A2 (VERIFIED r1).** A mismatch — **any** count that is not `NoD1` — causes the device to **resend the whole packet**, not the remainder. The vendor text says "resends sent data", full stop. There is no primary source anywhere for the popular belief that ACK N is a *cursor* that deletes the first N records. Our own `parse.ts` comment calls it "the acknowledged-record cursor"; **that comment is folklore** and `persist.ts`, which assumes whole-packet resend, is the one that is right.

**RULE A3 (VERIFIED r1).** No response at all within the Server Response Timeout (5 s default, 5…300 range): *"the device will close the link and according to device configuration **resend the same packet**."*

**RULE A4 (VERIFIED r5, vendor support 2025-07-22, https://community.teltonika.lt/t/fmc-packets-sending-behavior-and-server-response-requirements/14765).** Stop-and-wait, one packet in flight per connection: *"The device sends the next packet only after receiving a response from the server or after a timeout … The devices do not interleave packets and responses … Responses must be sent on the same TCP session and preferably within 3–5 seconds."*

**RULE A5 (VERIFIED r2 + r5).** **Never ACK a Codec 12 / 13 / 14 frame with four bytes.** Those codecs use no ACK at all, and four stray bytes land where the device expects the next command's zero preamble. Real symptom, reported against **FM6300** hardware: the device logs `[D.P.TCP]-> CODEC12 ERROR in state 0, ZEROES MISSING` and the command session breaks (https://github.com/traccar/traccar/pull/4561). Traccar's guard: `if (channel != null && codec != CODEC_12 && codec != CODEC_13) { … }`. FM63XX devices genuinely use Codec 12 on the same socket for Garmin / LCD / COM TCP Link Mode (parameters 120/121, values 161/177), so this is reachable in production.

**RULE A6 (VERIFIED r5, device-side debug log).** The device's ACK reader is **byte-exact and never resynchronises**. A server that wrote the handshake byte glued in front of the ACK produced this on the device:
```
DUMP DATA START: 01 00 00 00 15  DUMP DATA END
Server: 0, Record ACK received: 16777216, expected 21
```
`0x01000000 = 16777216`. One stray byte on the socket desynchronises **every subsequent ACK, permanently**. Corollary: write nothing to a device socket that is not an ACK, an IMEI reply, or a well-formed Codec-12 frame. (https://github.com/uro/teltonika-fm-parser/issues/10)

**RULE A7 (VERIFIED r1) — the rule that can make A1–A6 irrelevant.** Acknowledgement is conditional on a **device-side setting**: *"If ACK Type, TCP/IP is selected then Server Acknowledgement is not required. If ACK Type, AVL is selected then the Server must respond with the Acknowledgement."* (https://wiki.teltonika-gps.com/view/Help_with_Server_FAQ). On a TCP/IP-ACK device, records are deleted the instant the kernel accepts the bytes; a persist failure after that is **permanent loss with no retransmission**. **VERIFIED r1 that FM63XY is safe here**: `ACK Type` does **not** appear in the FMB630/FM6300 parameter list, so the AVL ACK is mandatory on Codec-16 hardware. It is listed because the same server code serves FMB/FMC devices where the knob exists and users do flip it.

**RULE A8 (VERIFIED r5).** The dominant real-world cause of a retransmit loop is not a wrong count — it is **an ACK the device never received**. Two independent server-side causes, both invisible from the parser:
1. Closing the TCP connection in the same breath as the write. *"add a sleep(1) between the fwrite and fclose was enough."*
2. Binding the listener to a specific local address instead of `0.0.0.0`. *"local address was good for receiving data, but 0.0.0.0 is good for receiving and sending too."*

**THE DIAGNOSTIC ORACLE** and the single most useful operational fact in this document: **Teltonika Configurator → Status → GSM info → "Last Server Response Time"**. If it reads `01.01.1970 01:00:00`, the device has **never** accepted an ACK from you, whatever your server logs say.

**RULE A9 (our contract, CLAUDE.md rule 4).** ACK the count actually persisted, only after `XADD` returns. This is *stricter* than Traccar, which reads `count` from the header and writes it back **before decoding anything** (`int count = buf.readUnsignedByte(); … response.writeInt(count);`) — which is precisely why a Traccar server silently loses records on a partial decode. **Do not copy Traccar here.** But see §7 T-15: combining A9 with A2 means a count *lower* than NoD1 buys a full retransmission, so ACKing a partial count for a **deterministic** decode failure is an infinite loop, not a retry.

### 2.8 Offline buffering and flush — the loss layer

**VERIFIED r1** (Template:FMB_GPRS_settings, verbatim): *"If the device had no connection (GSM or GPRS) due to bad coverage … Device continues to save records into internal memory, once GSM and GPRS are recovered device will start sending saved data to server. … if Oldest is configured — until newest data is seen on the server all of the oldest records have to be sent first. If Newest is configured — previous data and track won't be seen until newest data is sent first. **If high priority on I/O parameters or Features are configured device will send the generated records with High Priority first.**"*

Consequences a decoder author must design for:

1. **Timestamps arrive descending by default.** `Records Sorting` defaults to **newest-first** on this family. Never assume monotonic time per device; never derive trip order from arrival order. The vendor's own instruction: *"Records can be sorted by using timestamp as a record sorting method"* (Help_with_Server_FAQ).
2. **Priority 1/2 records jump the queue** regardless of sorting, so they interleave with a backlog flush.
3. **FMB630 internal memory = 1 MB flash** (**VERIFIED r1**, FMB630_and_FMB640_migration). At 224 B/record — the real observed size — that is a few thousand records. **Wedge a device in a resend loop and its oldest unsent records are overwritten: silent, permanent loss.** This is the concrete reason ACK-0-forever is worse than parking a frame.
4. *"After a reboot, it will send zero coordinates"* — **VERIFIED r1**, FMB640_System_settings. The vendor's own confirmation that 0/0 arrives from healthy hardware. Feeds ADR-039.
5. Backup-server failover triggers *"when main server response timeout has been reached **5 times in a row**"*; in Duplicate mode records are deleted *"only if both servers confirmed"*. A sudden burst of already-seen records is a dual-server artefact before it is an ACK failure.
6. Link lifetime: **Open Link Timeout** holds the socket after the last record; **Active Data Link Timeout** (param 109) is the FM63XX equivalent. Server-side idle-close is dangerous: *"For most of Teltonika devices they will not reconnect to the channel if connection is closed (by other side) and there is no pending record to deliver"* (**r3**, flespi) — a closed socket makes the device unreachable for Codec-12 commands until it next has data.
7. **Multiple live TCP sessions per IMEI are normal** (the device reconnects before the server notices a dead socket). Handover must not lose the in-flight batch.
8. The flush path itself has been reworked repeatedly in firmware — *"REC search from FLASH improved"* (00.02.13), *"Records sending from SD via UDP optimization"* (00.02.32), *"Record search algorithm optimization"* (00.00.49), *"Records saving, deleting improvements"* (00.02.77). Treat frame order as arbitrary.

---

## 3. Packet catalogue

Codec 16 defines exactly **two** wire shapes: a TCP AVL packet and a UDP AVL packet. It never carries commands — those are codecs 0x0C/0x0D/0x0E in a different frame on the same socket, and they are listed here only so a framer does not mistake them.

Endianness is **big-endian everywhere**, without exception. There is no length-prefixed or variable-length field anywhere in a Codec-16 record (§3.5).

### 3.1 Packet type 1 — TCP AVL packet (`device → server`)

| off | width | field | type | source |
|---|---|---|---|---|
| 0 | 4 | Preamble | must be `00000000` | **VERIFIED r1** /view/Codec §Codec 16 AVL data packet; confirmed 4/4 frames |
| 4 | 4 | Data Field Length | uint32 BE | same |
| 8 | 1 | Codec ID | `0x10` | same |
| 9 | 1 | Number of Data 1 | uint8 | same |
| 10 | … | AVL Data | NoD1 × record (§3.4) | same |
| 8+dlen−1 | 1 | Number of Data 2 | uint8, `== NoD1` | same |
| 8+dlen | 4 | CRC-16 | uint32 BE, high 16 bits zero | same; algorithm §2.6 |

### 3.2 Packet type 2 — UDP AVL packet (`device → server`)

| off | width | field | type | source |
|---|---|---|---|---|
| 0 | 2 | Length | uint16 BE = **total datagram bytes − 2** | **VERIFIED r1 + decoded**: checks out on the wiki Codec-8 (`0x003D` = 61 for 63 bytes) and Codec-8E (`0x005F` = 95 for 97 bytes) samples. The Codec-**16** sample's own length field is broken — §7 T-21 |
| 2 | 2 | Packet ID | uint16 BE, echoed in ACK | **VERIFIED r1** |
| 4 | 1 | "Not usable byte" | constant `0x01` observed | **VERIFIED r1** (name is the vendor's); Traccar calls it "packet type" and ignores it. Whether it is ever ≠ 0x01 is **UNKNOWN** (§9 Q6) |
| 5 | 1 | AVL Packet ID | uint8 0…255, echoed in ACK, **validated by the device** | **VERIFIED r1** |
| 6 | 2 | IMEI length | uint16 BE, *"always will be 0x000F"* | **VERIFIED r1** |
| 8 | n | IMEI | ASCII digits | **VERIFIED r1** |
| 8+n | 1 | Codec ID | `0x10` | **VERIFIED r1** |
| 9+n | 1 | Number of Data 1 | uint8 | **VERIFIED r1** |
| … | … | AVL records | **identical encoding to TCP** | **VERIFIED r1 + decoded** (48-byte record, §4.3) |
| … | 1 | Number of Data 2 | uint8 | **VERIFIED r1** |

**No preamble. No Data Field Length. No CRC.**

**Retry rule (VERIFIED r1):** *"module validates AVL Packet ID and Number of accepted AVL elements. If server response with valid AVL Packet ID is not received within configured timeout, module can retry sending."* Retries reuse the **same** AVL packet ID, so **the server must be idempotent** — dedupe on `(imei, tsMs)` including milliseconds, never on coordinates (§7 T-17).

### 3.3 Packet types 3–7 — everything else on the socket

These are **not** Codec 16. Listed so a framer classifies them and does not ACK them wrongly.

| # | shape | direction | rule |
|---|---|---|---|
| 3 | `FF` | device → server | 1-byte keep-alive ping. Consume, **reply nothing**, refresh idle timer. **VERIFIED r1+r2+r5**, §2.4 |
| 4 | `000F` + ASCII IMEI | device → server | Login. **VERIFIED r1**, §2.5 |
| 5 | `01` / `00` | server → device | Login accept / reject. **VERIFIED r1** |
| 6 | `00000002` (4 B) | server → device | TCP AVL ACK, §2.7 |
| 7 | preamble + dlen + codec `0x0C`/`0x0D`/`0x0E` + … + CRC | both | GPRS command / response. **NEVER ACK** (Rule A5). Codec 12 is required for FM63XX Garmin / LCD / COM TCP Link features, so it does occur |

### 3.4 The Codec-16 AVL record — the byte map

This is the only part of the protocol that differs from Codec 8. **VERIFIED r1** from the vendor's IO-element table, quoted verbatim from https://wiki.teltonika-gps.com/view/Codec §Codec 16 → IO Element:

> `Event IO ID | 2 bytes | Generation Type | 1 byte | N of Total IO | 1 byte | N1 of One Byte IO | 1 byte | 1'st IO ID | 2 bytes | 1'st IO Value | 1 byte | ... | N2 of Two Bytes | 1 byte | ... | N4 of Four Bytes | 1 byte | ... | N8 of Eight Bytes | 1 byte | ... | N8'IO ID | 2 bytes | N8'IO Value | 8 bytes`

The same table appears identically on /view/Teltonika_Data_Sending_Protocols, /view/Teltonika_AVL_Protocols, and in the 2013 vendor PDF *FMB630 Protocols V0.02*.

**Fixed head — 24 bytes. Identical to Codec 8/8E.** (**VERIFIED r1**, shared AVL Data / GPS Element tables; **VERIFIED by decode** on 10/10 records.)

| off | width | field | encoding | units / scaling | source |
|---|---|---|---|---|---|
| 0 | 8 | Timestamp | uint64 BE | **milliseconds** since 1970-01-01T00:00:00Z, no leap adjustment | **VERIFIED r1 + decode**: `0x0000016BDBC78330` = 1562760414000 = 2019-07-10T12:06:54Z, matching the wiki's own annotation "GMT: Wednesday, July 10, 2019 12:06:54 PM". ⚠ see §7 T-25 for pre-00.02.67 firmware |
| 8 | 1 | Priority | uint8 enum | `0` Low, `1` High, `2` Panic | **VERIFIED r1** (/view/Codec Priority table). No real Codec-16 frame with 1 or 2 exists anywhere — §9 Q7 |
| 9 | 4 | **Longitude** | int32 BE, two's complement | degrees × 1e7 | **VERIFIED by decode twice**: `-70.6496700` / `-33.4379166` = Santiago, Chile (V3); `+1.4924083` / `+47.7225616` = Loir-et-Cher, France (V2). **Longitude comes FIRST** |
| 13 | 4 | **Latitude** | int32 BE, two's complement | degrees × 1e7 | same |
| 17 | 2 | Altitude | int16 BE (**see below**) | metres above sea level | **VERIFIED r1** for the field; **signedness is UNKNOWN** — §9 Q3 |
| 19 | 2 | Angle | uint16 BE | degrees clockwise from north, 0…360 | **VERIFIED r1 + decode** (226, 227, 282, 185) |
| 21 | 1 | Satellites | uint8 | count | **VERIFIED r1 + decode** (0, 6, 11, 17) |
| 22 | 2 | Speed | uint16 BE | **km/h** | **VERIFIED r1**: *"Speed will be 0x0000 if GPS data is invalid."* |
| **24** | **2** | **Event IO ID** | uint16 BE | `0x0000` = not an eventual record | **VERIFIED r1** (Codec 8 uses **1** byte here); **VERIFIED by decode**: V2 carries `0x00FD` = 253 |
| **26** | **1** | **Generation Type** | uint8 enum 0…7 | §3.4.1 | **VERIFIED r1** (does not exist in Codec 8 or 8E) |
| **27** | **1** | **N of Total IO** | uint8 | `== N1+N2+N4+N8` | **VERIFIED r1 structure table + decode on 10/10 records**. ⚠ the wiki's *other* table says 2 bytes — §7 T-1 |
| 28 | 1 | N1 | uint8 | then N1 × (**2-byte id** + 1-byte value) | **VERIFIED r1 + decode** |
| … | 1 | N2 | uint8 | then N2 × (2-byte id + 2-byte value) | same |
| … | 1 | N4 | uint8 | then N4 × (2-byte id + 4-byte value) | same |
| … | 1 | N8 | uint8 | then N8 × (2-byte id + 8-byte value) | same |

**Structural minimum record = 32 bytes.** Observed record sizes across the whole known corpus: **46, 48, 77, 156, 224**.

**Three widths, not two.** Codec 16 uses **three different field widths** that a naive `{idSize, countSize}` descriptor will conflate:

| field | Codec 8 | Codec 8E | **Codec 16** |
|---|---|---|---|
| Event IO ID | 1 B | 2 B | **2 B** |
| N of Total IO | 1 B | 2 B | **1 B** |
| N1/N2/N4/N8 group counts | 1 B | 2 B | **1 B** |
| each IO element's id | 1 B | 2 B | **2 B** |
| generation type byte | absent | absent | **present, 1 B** |
| NX variable-length group | absent | present | **absent** |

**VERIFIED r2** — Traccar encodes exactly this with a variadic helper so each field names which codecs widen *it*:
```java
position.set(KEY_EVENT, readExtByte(buf, codec, CODEC_8_EXT, CODEC_16));   // event id: 2 B for 8E AND 16
if (codec == CODEC_16) { buf.readUnsignedByte(); }                         // generation type
int cnt = readExtByte(buf, codec, CODEC_8_EXT);                            // total: 1 B for 16
…
int n1 = readExtByte(buf, codec, CODEC_8_EXT);                             // group count: 1 B for 16
int id = readExtByte(buf, codec, CODEC_8_EXT, CODEC_16);                   // element id: 2 B for 16
```
(TeltonikaProtocolDecoder.java lines 380-387 and 473-518.)

**VERIFIED r4, four independent reimplementations agree**: Go `alim-zanibekov/teltonika` `decodeElementsCodec16` (u16 event, u8 gen, u8 total, u8 group counts, u16 ids) · Rust `nom-teltonika` (`read_count` = u8 for Codec8|Codec16, u16 for 8E; `read_id` = u16 for 8E|Codec16) · Elixir `teltonika_codec` (`<<event_io_id::16, generation_type::8, total_count::8, …>>`) · Go `danieljvsa/teltonika-go` (`ioFormat{idSize: 2, countSize: 1, genType: true}`).

#### 3.4.1 Generation Type (offset 26)

**VERIFIED r1** — identical table on /view/Codec, /view/Teltonika_Data_Sending_Protocols, /view/Teltonika_AVL_Protocols, the 2020 Wayback snapshot, and the 2013 FMB630 Protocols v0.02 PDF:

| value | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| meaning | On Exit | On Entrance | On Both | **Reserved** | Hysteresis | On Change | Eventual | Periodical |

**Semantics (INFERRED, strong):** it is the *configured trigger condition of the IO parameter that produced the record* — the same enum the Configurator exposes per-IO ("Event only on…"). The vendor's whole explanation is *"More information about it you can find **here**"* — and **"here" is plain text, not a link**, on both the live wiki and the 2020 snapshot. There is no deeper vendor documentation. That is the entire corpus.

**VERIFIED on the wire:** only `5` (On Change — both wiki samples) and `7` (Periodical — all three Traccar captures) have ever been observed. Values 0, 1, 2, 3, 4, 6 have **no sample of any kind** (§9 Q8).

**Generation type is NOT a proxy for "eventual vs periodic record."** V2 carries `Event IO ID = 253` (Green Driving Type — a genuine event) together with `gen = 7` (Periodical), in all four records. **Treat the two fields as orthogonal.** (**VERIFIED by decode**.)

Go and Rust both **hard-reject** gen > 7 and abort the whole packet. **Do not.** See §7 T-4.

### 3.5 Variable-length (NX) elements — VERIFIED ABSENT

> `Variable size IO elements | Codec8: Does not include | Codec8 Extended: Includes variable size elements | Codec16: Does not include`
> — **VERIFIED r1**, /view/Codec §Differences between Codec 8, Codec 8 Extended and Codec 16 (present identically in the 2020-09-26 snapshot)

**VERIFIED by byte accounting** on all 10 records across 5 frames: the cursor lands exactly on the Number-of-Data-2 byte with no NX group. Every implementation reads the X-byte group only when `codec == CODEC_8_EXT`.

**Consequence for strings.** Codec 8E carries VIN and driver IDs as variable-length ASCII (ids 256 / 325). **Codec 16 cannot.** Its substitute is fixed-width fragmentation — VIN across ids 233+234+235 (8+8+1 = 17 ASCII bytes), driver IDs across 195+196 and 197+198 (8+8 = 16 each), ICCID across 219/220/221. See §5.5 and §7 T-12.

**Hazard (VERIFIED r2):** Traccar reads an **extra 16-byte IO group for every codec** when `protocol.teltonika.extended=true` — a config flag, not a codec test. With that flag on and codec 16, it reads the NoD2 byte as a count and walks off the end of the record. There is no vendor basis for this in Codec 16. §7 T-24.

### 3.6 Server → device packets

| packet | bytes | source |
|---|---|---|
| Login accept | `01` | **VERIFIED r1** |
| Login reject | `00` | **VERIFIED r1** |
| TCP AVL ACK | `00 00 00 NN` (uint32 BE record count) | **VERIFIED r1 + r2** |
| UDP AVL ACK | `0005` + `<packet id echoed>` + `01` + `<avl packet id echoed>` + `<count>` | **VERIFIED r1**; the vendor example is `0005CAFE010701`. **Traccar hardcodes the packet id to `0000`** — §7 T-22 |

---

## 4. Worked examples — real frames, byte by byte

Every decode in this section was produced by running a decoder built from §3.4 against the published hex, and every CRC was recomputed.

### 4.1 The vendor's own TCP example (V1) — 107 bytes, 2 records

Source: **r1**, https://wiki.teltonika-gps.com/view/Codec §Codec 16 → Example. Also our existing fixture `packages/codec/__fixtures__/wiki/codec16.hex.json`.

```
00000000 0000005F 10 02
  0000016BDBC78330 00 00000000 00000000 0000 0000 00 0000   000B 05 04 02 0001 00 0003 00 02 000B 0027 0042 563A 00 00
  0000016BDBC78718 00 00000000 00000000 0000 0000 00 0000   000B 05 04 02 0001 00 0003 00 02 000B 0026 0042 563A 00 00
02 00005FB3
```

| off | bytes | field | value |
|---|---|---|---|
| 0 | `00000000` | preamble | ok |
| 4 | `0000005F` | Data Field Length | 95 → wire length 95+12 = **107** ✅ |
| 8 | `10` | Codec ID | 16 |
| 9 | `02` | Number of Data 1 | 2 |
| **record 0 — starts at offset 10, consumes 46 bytes** | | | |
| 10 | `0000016BDBC78330` | timestamp | 1562760414000 = **2019-07-10T12:06:54.000Z** |
| 18 | `00` | priority | **0 = Low.** ⚠ The wiki's own parse table says `01`. **The table is wrong; the hex byte is 00** — and the CRC validates over exactly these bytes, so 00 is what the device sent (§7 T-2) |
| 19 | `00000000` | longitude | 0.0000000 |
| 23 | `00000000` | latitude | 0.0000000 |
| 27 | `0000` | altitude | 0 m |
| 29 | `0000` | angle | 0° |
| 31 | `00` | satellites | **0 → no fix** |
| 32 | `0000` | speed | 0 km/h |
| 34 | `000B` | Event IO ID | **11** |
| 36 | `05` | Generation Type | **5 = On Change** |
| 37 | `04` | N of Total IO | 4 |
| 38 | `02` | N1 | 2 |
| 39 | `0001` `00` | id 1 = Digital Input 1 | 0 |
| 42 | `0003` `00` | id 3 = Digital Input 3 | 0 |
| 45 | `02` | N2 | 2 |
| 46 | `000B` `0027` | id 11 = **Analog Input 3** | 39 → **0.039 V** (×0.001). ⚠ the wiki labels this "ICCID1" — wrong family, §7 T-10 |
| 50 | `0042` `563A` | id 66 = External Voltage | 22074 → **22.074 V** (a 24 V vehicle) |
| 54 | `00` | N4 | 0 |
| 55 | `00` | N8 | 0 |
| **record 1 — offset 56, 46 bytes** | | | |
| 56 | `0000016BDBC78718` | timestamp | 1562760415000 = 2019-07-10T12:06:**55**.000Z (+1000 ms) |
| … | | | byte-identical to record 0 except id 11 = `0x0026` = 38 → 0.038 V |
| 102 | `02` | Number of Data 2 | 2 ✅ equals NoD1 |
| 103 | `00005FB3` | CRC | computed **0x5FB3** ✅ |

`4+4+1+1+46+46+1+4 = 107` ✅ · `N1+N2+N4+N8 = 2+2+0+0 = 4 = N` ✅ · **Correct server reply: `00000002`.**

**Both records are exact 0/0 with satellites = 0** ⇒ under ADR-039 these are `fix_valid = false` on **both** tests. The vendor documents this case explicitly: *"If record are without valid coordinates … Longitude, Latitude and Altitude values are last valid fix, and Angle, Satellites and Speed are 0."* (**VERIFIED r1**) — note that means a *no-fix* record can legitimately carry **non-zero** coordinates. Every Codec-16 no-fix sample we have is also 0/0, so the ADR-039 branch that matters most has no Codec-16 wire evidence behind it (§9 Q9).

### 4.2 A real FM6320 truck (V2) — 911 bytes, 4 records × 224 bytes

Source: **r2**, Traccar `TeltonikaProtocolDecoderTest.java`, added by commit `74a6ec5ff` **"Fix FM6320 decoding"** (Anton Tananaev, 2022-08-16). **This is the only model-attributed real Codec-16 capture in existence**, and every parameter conclusion in §5–§6 rests on it.

Frame: dlen `0x0383` = 899, NoD1 = NoD2 = 4, CRC declared `0x0000EB85`, computed **`0xEB85`** ✅. Each record is exactly 224 bytes = 28 (head+event+gen+total) + 1+22×3 + 1+9×4 + 1+15×6 + 1, and the fourth lands exactly on NoD2.

**Record 0, head (28 bytes):**
```
000001735ACE37F8  00  00E3B933  1C71E290  0069  00E2  11  0051  00FD  07  2E
```
| bytes | field | value |
|---|---|---|
| `000001735ACE37F8` | timestamp | 1594956331000 = **2020-07-17T03:25:31.000Z** |
| `00` | priority | 0 Low |
| `00E3B933` | longitude | 14 924 083 → **+1.4924083°** |
| `1C71E290` | latitude | 477 225 616 → **+47.7225616°** (Loir-et-Cher, France) |
| `0069` | altitude | **105 m** |
| `00E2` | angle | **226°** |
| `11` | satellites | **17** |
| `0051` | speed | **81 km/h** |
| `00FD` | Event IO ID | **253** = Green Driving Type |
| `07` | Generation Type | **7 = Periodical** (with a non-zero event id — see §3.4.1) |
| `2E` | N of Total IO | **46** |

**Groups: N1 = 22, N2 = 9, N4 = 15, N8 = 0. Sum = 46 = N ✅**

| group | id → value (record 0) |
|---|---|
| **N1 (1-byte)** | 1=1 · 22=3 · 71=3 · 240=1 · 21=4 · 178=0 · 200=0 · 239=1 · 144=0 · 79=0 · 81=1 · 82=1 · 83=0 · 85=0x38(56) · 110=0 · 111=0 · 122=3 · 125=0 · 127=0x56(86) · 137=0 · **253=2** · **254=0x1F(31)** |
| **N2 (2-byte)** | 67=0x26B0(9904) · 68=0 · 181=0x000B(11) · 182=0x0006(6) · 66=0x7029(**28713**) · 24=0x0054(**84**) · 70=0x015D(**349**) · 206=0x4EC1(20161) · 128=0x000F(15) |
| **N4 (4-byte)** | 241=20820 · 205=**7603371** · 216=**256909985** · 80=**84** · 84=0 · 86=**87400** · 87=96 · 88=**1056** · 104=**4371** · 109=`0x30333030` · 113=`0xFFFD8C85` · 135=**32** · 136=2 · 138=**87541** · 139=**47200** |

**The coherent picture** (use this as your acceptance oracle — if any one number comes out absurd, the layout or the dictionary selection is wrong, and the frame tells you which):

- GNSS speed 81 km/h · device Speed (24) 84 km/h · **CAN Wheel Based Speed (80) 84 km/h** — three independent speeds agreeing
- Cruise Control Active (81) = 1, which is exactly why **Accelerator Pedal Position (84) = 0 %** at Engine Current Load (85) = 56 % and Engine Speed (88) = **1056 rpm**
- Combined Weight (139) = **47 200 kg** — a loaded 40-tonne artic
- Fuel Rate (135) = **32 L/h** ⇒ 38 L/100 km at 84 km/h — right for that truck
- Engine Total Fuel Used (86) = 87 400 L and High-Res (138) = 87 541 L — **agree to 0.16 %, which is only true if neither is scaled**
- Total Odometer (216) = 256 909 985 m ÷ Engine Hours (104) = 4371 h ⇒ **58.8 km/h lifetime average**
- External Voltage (66) = 28 713 → **28.713 V**, a 24 V system charging
- PCB Temperature (70) = 349 → **34.9 °C** (×0.1, signed)
- Ambient (128) = 15 °C · Coolant (127) = 86 °C (see §5.4 — this one is INFERRED)
- Active GSM Operator (241) = **20820 = MCC 208 / MNC 20 = France**, matching the coordinates
- GNSS PDOP (181) = 11, HDOP (182) = 6 → **1.1 / 0.6 at ×0.1** — right for a 17-satellite fix. **The multiplier column for 181/182 is blank in the vendor table; ×0.1 is INFERRED from the documented max of 500 and from the satellite count.**

**Records 1–3, and the sharpest edge in the corpus:**

| rec | timestamp | lon / lat | 253 | **254** | 216 (odometer) | 66 |
|---|---|---|---|---|---|---|
| 0 | 03:25:31.000 | 1.4924083 / 47.7225616 | 2 | **31** | 256909985 | 28713 |
| 1 | 03:25:32.200 | 1.4921866 / 47.7224233 | 2 | **29** | 256910030 | 28703 |
| 2 | 03:25:33.000 | 1.4919616 / 47.7222850 | 2 | **35** | 256910055 | 28693 |
| 3 | 03:25:33.**050** | 1.4919616 / 47.7222850 (identical to rec 2) | **3** | **35** | 256910055 | 28693 |

**Records 2 and 3 are 50 ms apart, byte-identical in every GPS field, and differ in EXACTLY ONE byte: id 253 goes 2 → 3.** Id 254 is **35** in both. So the same raw 35 must be read as **0.35 g** (harsh braking) in record 2 and as **35° or 0.35 rad** (harsh cornering) in record 3 (§5.4, §7 T-11).

> ⚠ **Correction to a widely-circulated summary of this frame.** It is often written that records 2 and 3 carry `254 = 31`. They do not: 31 is record **0**. The per-record values are 31, 29, 35, 35 — I decoded them. A golden fixture written from the wrong number would be immutable under hard rule 9 and permanently wrong.

**Correct server reply: `00000004`.**

### 4.3 The vendor's UDP example (V6) — 74 bytes, 1 record, **and it is malformed**

Source: **r1**, /view/Codec §"Codec16 protocol sending over UDP". The wiki splits the hex across two `<code>` spans; concatenated it is 74 bytes.

```
015B CAFE 01 01 000F "352094085231592" 10 07
  0000015117E40FE8 00 00000000 00000000 0000 0000 00 0000  00EF 05 05 04 0001 00 0003 00 00B4 00 00EF 01 01 0042 111A 00 00
01
```

| off | bytes | field | wiki's own table says | the hex says |
|---|---|---|---|---|
| 0 | `015B` | Length | (not annotated) | **347** — but only 72 bytes follow. **Wrong.** |
| 2 | `CAFE` | Packet ID | CAFE | CAFE ✅ |
| 4 | `01` | Not usable byte | 01 | 01 ✅ |
| 5 | `01` | **AVL Packet ID** | **07** | **01** ❌ |
| 6 | `000F` | IMEI length | 000F | 15 ✅ |
| 8 | 15 B | IMEI | 352094085231592 | ✅ |
| 23 | `10` | Codec ID | 10 | 16 ✅ |
| 24 | `07` | **Number of Data 1** | **01** | **07** ❌ |
| 25 | 48 B | record | | decodes cleanly |
| 73 | `01` | Number of Data 2 | 01 | 1 |

**The two bytes at offsets 5 and 24 are transposed relative to the wiki's own table.** The table is right and the hex is wrong: the record count really is 1 (one 48-byte record; trailing NoD2 = 01), and the AVL packet id really is 7 (the wiki's ACK example on the same page is `0005CAFE01**07**01`).

Record decode (unaffected by the header bug):

| field | value |
|---|---|
| timestamp | 1447804801000 = **2015-11-18T00:00:01.000Z** |
| priority | 0 |
| lon / lat / alt / angle / sats / speed | 0 / 0 / 0 / 0 / **0** / 0 → invalid fix |
| Event IO ID | **239** (Ignition) |
| Generation Type | **5** (On Change) |
| N total | 5 → N1 = 4, N2 = 1, N4 = 0, N8 = 0 |
| N1 | id 1 = 0 · id 3 = 0 · id 180 (Digital Output 2) = 0 · **id 239 (Ignition) = 1** |
| N2 | id 66 (External Voltage) = `0x111A` = 4378 → **4.378 V** |
| record size | **48 bytes** — and `2+1+1+2+15+1+1+48+1 = 72` = the bytes actually delivered after the length field |

⚠ **A third table/hex disagreement in the same example:** the wiki's table prints the Ignition value as `00`; the wire says `01`. And it prints the N2 element's id as one byte (`42`) where the wire carries two (`0042`).

**Adjudication of a competing reading.** `danieljvsa/teltonika-go` documents this fixture as *"truncated — the page presents the packet truncated"* and only accepts it under `WithLenientUDPLength()`. **That diagnosis is wrong.** The frame is not truncated: Number of Data 2 is present as the final byte, the record consumes exactly 48 bytes, and the total is exactly 72 — which is precisely the `0x0048` an **independent encoder** emits for identical content (§8 V7). A truncation cannot explain a present, correct trailer. It is a two-byte transposition plus a wrong length field.

**Correct server reply to the repaired datagram: `0005CAFE010701`.**

### 4.4 A frame that fails CRC (V4) — and it is in Traccar's corpus

Source: the 2013 vendor PDF *FMB630 Protocols V0.02*, and **carried verbatim as a Traccar test vector**. dlen `0x9D` = 157, NoD1 = NoD2 = 2, two 77-byte records.

**Declared CRC `0x000009A5`. True CRC-16/IBM over Codec ID…NoD2 is `0xA6DE`.** I brute-forced every span start 0–19 × every plausible end × four CRC-16 variants (IBM, CCITT-FALSE, XMODEM, KERMIT) — **nothing yields 0x09A5**.

It decodes structurally perfectly, and it is the **only frame anywhere carrying an N8 (8-byte) element**:

| rec | timestamp | lon / lat | N1 (5) | N2 (2) | N4 (2) | **N8 (1)** |
|---|---|---|---|---|---|---|
| 0 | 2013-07-17T06:34:09.**140**Z | +25.2618832 / +54.6990336 (Vilnius) | 1,2,3,4, **288** all 0 | 24=0, 70=`0x0129`(297) | 199=0, 76=0 | **62 = `0x0000000000000000`** |
| 1 | 2017-03-29T10:11:27.000Z | +25.2558416 / +54.6670383 | identical | identical | identical | identical |

**INFERRED (strong): this frame is fabricated, not captured.** Three tells: (a) the CRC is wrong; (b) the two records are **3.7 years apart** while carrying byte-identical IO — an FM63XX with 1 MB of flash cannot buffer four years of records, and a real device does not emit two records four years apart with identical sensor readings; (c) record 0's timestamp and coordinates are identical to those in Traccar's **Codec 8** test frame `000000000000008c08010000013feb55ff74000f0ea850209a69…`. It looks hand-built from that Codec-8 frame, which also explains the stale CRC.

**Consequence for the evidence base.** Strip V4 and the record layout rests on **one** genuine device capture (V2, one FM6320, one firmware, 2020-07-17), plus V3 (real but model-unattributed), plus the wiki's two zero-fix examples, plus four independent reimplementations. The layout still holds — byte accounting closes on all of them. But the breadth is thinner than a five-frame count suggests, and **id 62 (Dallas Temperature ID 1) is the only N8 element ever seen, with value zero**, so the 8-byte group's id/value pairing is confirmed structurally and never with real data.

### 4.5 Ids above 255 on the wire (V3) — 171 bytes, 1 record of 156 bytes

Source: **r2**, Traccar test corpus. Model **UNKNOWN** (the commit that added it predates the Gradle conversion). dlen 159, NoD1 = NoD2 = 1, CRC declared `0x00000D3B`, computed **`0x0D3B`** ✅.

| field | value |
|---|---|
| timestamp | 1532637823000 = **2018-07-26T20:43:43.000Z** |
| priority | 0 |
| longitude | **−70.6496700** |
| latitude | **−33.4379166** (Santiago, Chile — **both axes negative**, good two's-complement coverage) |
| altitude | 571 m · angle 282° · satellites **6** · speed 0 km/h → **valid fix** (sats ≠ 0, not 0/0) |
| Event IO ID | `0x0000` — not an eventual record |
| Generation Type | 7 (Periodical) |
| N of Total IO | 32 |
| N1 (10) | ids **256, 261, 262, 269, 270, 271, 278, 279, 280, 287** — all `0x00` |
| N2 (19) | ids **257, 263–268, 272–277, 281–286** — all `0x0000` |
| N4 (3) | ids **258, 259, 260** — all `0x00000000` |
| N8 | 0 |

**Every id is ≥ 256** — exactly 256…287, thirty-two contiguous ids. This frame is the proof on the wire that the 2-byte id field is real: low-byte truncation would render this block as ids 0…31, i.e. Digital Input 1, GSM Signal, Data Mode, Speed — a customer would see a door sensor toggling that does not exist (§7 T-3).

**Every value is zero.** That proves the *width* assignment for those 32 ids and **nothing about their meaning** (§7 T-9).

---

## 5. Parameter / IO dictionary

### 5.1 The rule that governs everything in this section

**Codec-16 ids MUST be resolved through the FM6300/FMB630 table and NEVER through an FMB1xx table.** Teltonika reuses ids across families, and the collisions are all plausible-looking:

| id | **FM6300 / FMB630 (Codec 16)** | FMB1xx family | FM36 |
|---|---|---|---|
| 11 | **Analog Input 3**, 2 B, ×0.001 V | ICCID1, 8 B | — |
| 80 | **Wheel Based Speed**, 4 B km/h | Data Mode, 1 B | Working Mode |
| 84 | **Acceleration Pedal Position**, 4 B % | Fuel Level, 2 B ×0.1 | LVCAN Fuel Level |
| 88 | **Engine Speed**, 4 B rpm | Geofence zone 1, 1 B | — |
| 104 | **Engine Total Hours**, 4 B h | BLE Humidity #1 | LVCAN Total Mileage |
| 113 | **Service Distance**, 4 B **signed** km | Battery Level, 1 B % | — |
| 205 | **GSM Cell ID**, **4 B** | GSM Cell ID, **2 B** | — |

**VERIFIED r1**: https://wiki.teltonika-gps.com/view/FM6300_Teltonika_Data_Sending_Parameters_ID · https://wiki.teltonika-gps.com/view/FMB630_Teltonika_Data_Sending_Parameters_ID (byte-identical content; `FMB630_AVL_ID` redirects here, `FM6300_AVL_ID` 404s).

**An element's WIDTH comes from the group it sits in, not from the dictionary.** The dictionary supplies **name, signedness, multiplier, units and range** only. If the two disagree, the wire wins for width and the disagreement is a bug in your table (§7 T-6).

**Codec 16 caps at 255 IO elements per record** (1-byte N of Total IO), versus 65535 for Codec 8E.

### 5.2 Structure of the vendor table

**VERIFIED r1** — 265 elements, ids 1…395, in six groups. Reproduced below from our generated `packages/codec/dictionaries/fm6300.json` (`source_url` = the FM6300 wiki page, retrieved 2026-08-12). The **seen** column marks ids that actually appear in the five known Codec-16 frames.

Columns are the vendor's own: `B` = bytes, `type` = Signed/Unsigned, `min`/`max` = documented value range, `mult` = the multiplier column, `units` = the units column. **Where `mult` and `units` disagree, trust `mult` — §5.4 A2.** European decimal commas are the vendor's.

**Documented gaps in this table (ids the vendor page does not list at all):** 49, 52–55, **105–109**, **111–112**, 114–121, 126, 129–134, 140, 229–230, 244, **256–326**, 357, 363–389. Two of those gaps (109, 111) and the whole 256–287 run **appear in real captures**, so the table is demonstrably incomplete for the hardware it documents (§5.6).

#### Permanent I/O elements — 76 ids

| id | name | B | type | min | max | mult | units | seen |
|---|---|---|---|---|---|---|---|---|
| 1 | Digital Input 1 | 1 | Unsigned | 0 | 1 | - | - | Y |
| 2 | Digital Input 2 | 1 | Unsigned | 0 | 1 | - | - | Y |
| 3 | Digital Input 3 | 1 | Unsigned | 0 | 1 | - | - | Y |
| 4 | Digital Input 4 | 1 | Unsigned | 0 | 1 | - | - | Y |
| 5 | Dallas Temperature ID 5 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 6 | Dallas Temperature 5 | 2 | Signed | -550 | 1150 | 0,1 | °C |  |
| 7 | Dallas Temperature ID 5 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 8 | Dallas Temperature 5 | 2 | Signed | -550 | 1150 | 0,1 | °C |  |
| 9 | Analog Input 1 | 2 | Unsigned | 0 | 30000 | 0,001 | V |  |
| 10 | Analog Input 2 | 2 | Unsigned | 0 | 30000 | 0,001 | V |  |
| 11 | Analog Input 3 | 2 | Unsigned | 0 | 30000 | 0,001 | V | Y |
| 21 | GSM Signal | 1 | Unsigned | 0 | 5 | - | - | Y |
| 22 | Data Mode | 1 | Unsigned | 0 | 5 | - | - | Y |
| 24 | Speed | 2 | Unsigned | 0 | 350 | - | km/h | Y |
| 50 | Digital Output 3 | 1 | Unsigned | 0 | 1 | - | - |  |
| 51 | Digital Output 4 | 1 | Unsigned | 0 | 1 | - | - |  |
| 62 | Dallas Temperature ID 1 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - | Y |
| 63 | Dallas Temperature ID 2 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 64 | Dallas Temperature ID 3 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 65 | Dallas Temperature ID 4 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 66 | External Voltage | 2 | Unsigned | 0 | 30000 | 0,001 | mV | Y |
| 67 | Battery Voltage | 2 | Unsigned | 0 | 30000 | 0,001 | mV | Y |
| 68 | Battery Current | 2 | Unsigned | 0 | 2400 | - | mA | Y |
| 70 | PCB Temperature | 2 | Signed | -550 | 1150 | 0,1 | °C | Y |
| 71 | GNSS Status | 1 | Unsigned | 0 | 5 | - | - | Y |
| 72 | Dallas Temperature 1 | 2 | Signed | -550 | 1150 | 0,1 | °C |  |
| 73 | Dallas Temperature 2 | 2 | Signed | -550 | 1150 | 0,1 | °C |  |
| 74 | Dallas Temperature 3 | 2 | Signed | -550 | 1150 | 0,1 | °C |  |
| 75 | Dallas Temperature 4 | 2 | Signed | -550 | 1150 | 0,1 | °C |  |
| 76 | Fuel Counter | 4 | Unsigned | 0 | 4294967295 | - | - | Y |
| 78 | iButton | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 144 | SD Status | 1 | Unsigned | 0 | 1 | - | - | Y |
| 178 | Network Type | 1 | Unsigned | 0 | 1 | - | - | Y |
| 179 | Digital Output 1 | 1 | Unsigned | 0 | 1 | - | - |  |
| 180 | Digital Output 2 | 1 | Unsigned | 0 | 1 | - | - | Y |
| 181 | GNSS PDOP | 2 | Unsigned | 0 | 500 | - | - | Y |
| 182 | GNSS HDOP | 2 | Unsigned | 0 | 500 | - | - | Y |
| 199 | Trip Odometer | 4 | Unsigned | 0 | 4294967295 | - | m | Y |
| 200 | Sleep Mode | 1 | Unsigned | 0 | 1 | - | - | Y |
| 201 | LLS 1 Fuel Level | 2 | Signed | -4 | 32767 | - | kvants or ltr |  |
| 202 | LLS 1 Temperature | 1 | Signed | -128 | 127 | - | °C |  |
| 203 | LLS 2 Fuel Level | 2 | Signed | -4 | 32767 | - | kvants or ltr |  |
| 204 | LLS 2 Temperature | 1 | Signed | -128 | 127 | - | °C |  |
| 205 | GSM Cell ID | 4 | Unsigned | 0 | 4294967295 | - | - | Y |
| 206 | GSM Area Code | 2 | Unsigned | 0 | 65535 | - | - | Y |
| 207 | RFID | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 208 | Ultrasonic Software Status 1 | 1 | Unsigned | 0 | 255 | - | - |  |
| 209 | Ultrasonic Software Status 2 | 1 | Unsigned | 0 | 255 | - | - |  |
| 210 | LLS 3 Fuel Level | 2 | Signed | -4 | 32767 | - | kvants or ltr |  |
| 211 | LLS 3 Temperature | 1 | Signed | -128 | 127 | - | °C |  |
| 212 | LLS 4 Fuel Level | 2 | Signed | -4 | 32767 | - | kvants or ltr |  |
| 213 | LLS 4 Temperature | 1 | Signed | -128 | 127 | - | °C |  |
| 214 | LLS 5 Fuel Level | 2 | Signed | -4 | 32767 | - | kvants or ltr |  |
| 215 | LLS 5 Temperature | 1 | Signed | -128 | 127 | - | °C |  |
| 216 | Total Odometer | 4 | Unsigned | 0 | 4294967295 | - | m | Y |
| 217 | RFID COM2 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 218 | IMSI | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 219 | CCID Part1 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 220 | CCID Part2 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 221 | CCID Part3 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 224 | Ultrasonic Fuel Level 1 | 2 | Signed | -15 | 32767 | 0,1 | mm |  |
| 225 | Ultrasonic Fuel Level 2 | 2 | Signed | -15 | 32767 | 0,1 | mm |  |
| 236 | Axis X | 2 | Signed | -8000 | 8000 | - | mG |  |
| 237 | Axis Y | 2 | Signed | -8000 | 8000 | - | mG |  |
| 238 | Axis Z | 2 | Signed | -8000 | 8000 | - | mG |  |
| 239 | Ignition | 1 | Unsigned | 0 | 1 | - | - | Y |
| 240 | Movement | 1 | Unsigned | 0 | 1 | - | - | Y |
| 241 | Active GSM Operator | 4 | Unsigned | 0 | 4294967295 | - | - | Y |
| 245 | Analog Input 4 | 2 | Unsigned | 0 | 30000 | 0,001 | V |  |
| 250 | Trip | 1 | Unsigned | 0 | 1 | - | - |  |
| 390 | External Sensor Temperature 0 | 2 | Signed | -32768 | 32767 | - | °C |  |
| 391 | External Sensor Temperature 1 | 2 | Signed | -32768 | 32767 | - | °C |  |
| 392 | External Sensor Temperature 2 | 2 | Signed | -32768 | 32767 | - | °C |  |
| 393 | External Sensor Temperature 3 | 2 | Signed | -32768 | 32767 | - | °C |  |
| 394 | External Sensor Temperature 4 | 2 | Signed | -32768 | 32767 | - | °C |  |
| 395 | External Sensor Temperature 5 | 2 | Signed | -32768 | 32767 | - | °C |  |

#### CAN adapters elements — 41 ids

| id | name | B | type | min | max | mult | units | seen |
|---|---|---|---|---|---|---|---|---|
| 12 | Program Number | 4 | Unsigned | 0 | 999 | - | - |  |
| 13 | Module ID | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 14 | Engine Worktime | 4 | Unsigned | 0 | 16777215 | - | min |  |
| 15 | Engine Worktime (counted) | 4 | Unsigned | 0 | 16777215 | - | min |  |
| 16 | Total Mileage (counted) | 4 | Unsigned | 0 | 4294967295 | - | m |  |
| 17 | Fuel Consumed (counted) | 4 | Unsigned | 0 | 2147483647 | 0,1 | l |  |
| 18 | Fuel Rate | 2 | Unsigned | 0 | 32768 | 0,1 | l/h |  |
| 19 | AdBlue Level Percent | 1 | Unsigned | 0 | 255 | 0,1 | % |  |
| 20 | AdBlue Level Liters | 2 | Unsigned | 0 | 65535 | 0,1 | l |  |
| 23 | Engine Load | 1 | Unsigned | 0 | 130 | - | % |  |
| 25 | Engine Temperature | 2 | Signed | -600 | 1270 | 0,1 | °C |  |
| 26 | Axle 1 Load | 2 | Unsigned | 0 | 32768 | - | kg |  |
| 27 | Axle 2 Load | 2 | Unsigned | 0 | 32768 | - | kg |  |
| 28 | Axle 3 Load | 2 | Unsigned | 0 | 32768 | - | kg |  |
| 29 | Axle 4 Load | 2 | Unsigned | 0 | 32768 | - | kg |  |
| 30 | Vehicle Speed | 1 | Unsigned | 0 | 255 | - | km/h |  |
| 31 | Accelerator Pedal Position | 1 | Unsigned | 0 | 255 | 0,1 | % |  |
| 32 | Axle 5 Load | 2 | Unsigned | 0 | 32768 | - | kg |  |
| 33 | Fuel Consumed | 4 | Unsigned | 0 | 2147483647 | 0,1 | l |  |
| 34 | Fuel Level Liters | 2 | Unsigned | 0 | 65535 | 0,1 | l |  |
| 35 | Engine RPM | 2 | Unsigned | 0 | 16384 | - | rpm |  |
| 36 | Total Mileage | 4 | Unsigned | 0 | 4294967295 | - | m |  |
| 37 | Fuel Level Percent | 1 | Unsigned | 0 | 255 | 0,1 | % |  |
| 38 | Control State Flags | 4 | Unsigned | 0 | 4294967295 | - | - |  |
| 39 | Agricultural Machinery Flags | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 40 | Harvesting Time | 4 | Unsigned | 0 | 16777215 | - | min |  |
| 41 | Area of Harvest | 4 | Unsigned | 0 | 4294967295 | - | m2 |  |
| 42 | Mowing Efficiency | 4 | Unsigned | 0 | 4294967295 | - | m2/h |  |
| 43 | Grain Mown Volume | 4 | Unsigned | 0 | 4294967295 | - | kg |  |
| 44 | Grain Moisture | 2 | Unsigned | 0 | 65535 | 0,1 | % |  |
| 45 | Harvesting Drum RPM | 2 | Unsigned | 0 | 65535 | - | rpm |  |
| 46 | Gap Under Harvesting Drum | 1 | Unsigned | 0 | 255 | - | mm |  |
| 47 | Security State Flags | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 141 | Battery Temperature | 2 | Signed | -600 | 1270 | 0,1 | °C |  |
| 142 | Battery Level Percent | 1 | Unsigned | 0 | 255 | 0,1 | % |  |
| 143 | Door Status | 2 | Unsigned | 0 | 16128 | - | - |  |
| 176 | DTC Errors | 1 | Unsigned | 0 | 255 | - | - |  |
| 177 | DTC Codes | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 226 | CNG Status | 1 | Unsigned | 0 | 1 | - | - |  |
| 227 | CNG Used | 4 | Unsigned | 0 | 4294967295 | - | kg |  |
| 228 | CNG Level | 2 | Unsigned | 0 | 65535 | - | % |  |

#### FMS elements — 39 ids

| id | name | B | type | min | max | mult | units | seen |
|---|---|---|---|---|---|---|---|---|
| 79 | Brake Switch | 1 | Unsigned | 0 | 1 | - | - | Y |
| 80 | Wheel Based Speed | 4 | Unsigned | 0 | 65536 | - | km/h | Y |
| 81 | Cruise Control Active | 1 | Unsigned | 0 | 1 | - | - | Y |
| 82 | Clutch Switch | 1 | Unsigned | 0 | 1 | - | - | Y |
| 83 | PTO State | 1 | Unsigned | 0 | 2 | - | - | Y |
| 84 | Acceleration Pedal Position | 4 | Unsigned | 0 | 102 | - | % | Y |
| 85 | Engine Current Load | 1 | Unsigned | 0 | 125 | - | % | Y |
| 86 | Engine Total Fuel Used | 4 | Unsigned | 0 | 2105540607 | - | l | Y |
| 87 | Fuel Level | 4 | Unsigned | 0 | 102 | - | % | Y |
| 88 | Engine Speed | 4 | Unsigned | 0 | 8032 | - | rpm | Y |
| 89 | Axle weight 1 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 90 | Axle weight 2 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 91 | Axle weight 3 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 92 | Axle weight 4 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 93 | Axle weight 5 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 94 | Axle weight 6 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 95 | Axle weight 7 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 96 | Axle weight 8 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 97 | Axle weight 9 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 98 | Axle weight 10 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 99 | Axle weight 11 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 100 | Axle weight 12 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 101 | Axle weight 13 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 102 | Axle weight 14 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 103 | Axle weight 15 | 4 | Unsigned | 0 | 32766 | - | kg |  |
| 104 | Engine Total Hours Of Operation | 4 | Unsigned | 0 | 214748364 | - | h | Y |
| 110 | Diagnostics Supported | 1 | Unsigned | 0 | 3 | - | - | Y |
| 113 | Service Distance | 4 | Signed | -160635 | 167040 | - | km | Y |
| 122 | Direction Indication | 1 | Unsigned | 0 | 1 | - | - | Y |
| 123 | Tachograph Performance | 1 | Unsigned | 0 | 1 | - | - |  |
| 124 | Handling Info | 1 | Unsigned | 0 | 1 | - | - |  |
| 125 | System Event | 1 | Unsigned | 0 | 1 | - | - | Y |
| 127 | Engine Coolant Temperature | 1 | Signed | -40 | 210 | - | °C | Y |
| 128 | Ambient Air Temperature | 2 | Signed | -273 | 1770 | - | °C | Y |
| 135 | Fuel Rate | 4 | Unsigned | 0 | 3212 | - | l/h | Y |
| 136 | Instantaneous Fuel Economy | 4 | Unsigned | 0 | 125 | - | km/l | Y |
| 137 | PTO Drive Engagement | 1 | Unsigned | 0 | 3 | - | - | Y |
| 138 | High Resolution Engine Total Fuel Used | 4 | Unsigned | 0 | 4211081.215 l | - | l or ml | Y |
| 139 | Combined Weight | 4 | Unsigned | 0 | 642550 | - | kg | Y |

#### Manual CAN elements — 10 ids

| id | name | B | type | min | max | mult | units | seen |
|---|---|---|---|---|---|---|---|---|
| 145 | Manual CAN 00 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 146 | Manual CAN 01 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 147 | Manual CAN 02 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 148 | Manual CAN 03 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 149 | Manual CAN 04 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 150 | Manual CAN 05 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 151 | Manual CAN 06 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 152 | Manual CAN 07 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 153 | Manual CAN 08 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 154 | Manual CAN 09 | 1-8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |

#### Tachograph data elements — 32 ids

| id | name | B | type | min | max | mult | units | seen |
|---|---|---|---|---|---|---|---|---|
| 48 | Tacho Data Source | 1 | Unsigned | 0 | 4 | - | - |  |
| 56 | Driver 1 Continuous Driving Time | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 57 | Driver 2 Continuous Driving Time | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 58 | Driver 1 Cumulative Break Time | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 59 | Driver 2 Cumulative Break Time | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 60 | Driver 1 Selected Activity Duration | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 61 | Driver 2 Selected Activity Duration | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 69 | Driver 1 Cumulative Driving Time | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 77 | Driver 2 Cumulative Driving Time | 2 | Unsigned | 0 | 0xffff | - | - |  |
| 183 | Drive Recognize | 1 | Unsigned | 0 | 1 | - | - |  |
| 184 | Driver 1 Working State | 1 | Unsigned | 0 | 5 | - | - |  |
| 185 | Driver 2 Working State | 1 | Unsigned | 0 | 5 | - | - |  |
| 186 | Tachograph Over Speed | 1 | Unsigned | 0 | 1 | - | - |  |
| 187 | Driver 1 Card Presence | 1 | Unsigned | 0 | 1 | - | - |  |
| 188 | Driver 2 Card Presence | 1 | Unsigned | 0 | 1 | - | - |  |
| 189 | Driver 1 Time Related States | 1 | Unsigned | 0 | 15 | - | - |  |
| 190 | Driver 2 Time Related States | 1 | Unsigned | 0 | 15 | - | - |  |
| 191 | Vehicle Speed | 2 | Unsigned | 0 | 65535 | - | km/h |  |
| 192 | Odometer | 4 | Unsigned | 0 | 4294967295 | - | m |  |
| 193 | Trip Distance | 4 | Unsigned | 0 | 4294967295 | - | m |  |
| 194 | Timestamp | 4 | Unsigned | 0 | 4294967295 | - | - |  |
| 195 | Driver 1 ID MSB | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 196 | Driver 1 ID LSB | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 197 | Driver 2 ID MSB | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 198 | Driver 2 ID LSB | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 222 | Card 1 Issuing Member State | 1 | Unsigned | 0 | 255 | - | - |  |
| 223 | Card 2 Issuing Member State | 1 | Unsigned | 0 | 255 | - | - |  |
| 231 | Vehicle Registration Number Part1 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 232 | Vehicle Registration Number Part2 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 233 | Vehicle Identification Number Part1 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 234 | Vehicle Identification Number Part2 | 8 | Unsigned | 0 | 0xffffffffffffffff | - | - |  |
| 235 | Vehicle Identification Number Part3 | 1 | Unsigned | 0 | 0xff | - | - |  |

#### Eventual I/O elements — 67 ids

| id | name | B | type | min | max | mult | units | seen |
|---|---|---|---|---|---|---|---|---|
| 155 | Geofence zone 01 | 1 | Unsigned | 0 | 1 | - | - |  |
| 156 | Geofence zone 02 | 1 | Unsigned | 0 | 1 | - | - |  |
| 157 | Geofence zone 03 | 1 | Unsigned | 0 | 1 | - | - |  |
| 158 | Geofence zone 04 | 1 | Unsigned | 0 | 1 | - | - |  |
| 159 | Geofence zone 05 | 1 | Unsigned | 0 | 1 | - | - |  |
| 160 | Geofence zone 06 | 1 | Unsigned | 0 | 1 | - | - |  |
| 161 | Geofence zone 07 | 1 | Unsigned | 0 | 1 | - | - |  |
| 162 | Geofence zone 08 | 1 | Unsigned | 0 | 1 | - | - |  |
| 163 | Geofence zone 09 | 1 | Unsigned | 0 | 1 | - | - |  |
| 164 | Geofence zone 10 | 1 | Unsigned | 0 | 1 | - | - |  |
| 165 | Geofence zone 11 | 1 | Unsigned | 0 | 1 | - | - |  |
| 166 | Geofence zone 12 | 1 | Unsigned | 0 | 1 | - | - |  |
| 167 | Geofence zone 13 | 1 | Unsigned | 0 | 1 | - | - |  |
| 168 | Geofence zone 14 | 1 | Unsigned | 0 | 1 | - | - |  |
| 169 | Geofence zone 15 | 1 | Unsigned | 0 | 1 | - | - |  |
| 170 | Geofence zone 16 | 1 | Unsigned | 0 | 1 | - | - |  |
| 171 | Geofence zone 17 | 1 | Unsigned | 0 | 1 | - | - |  |
| 172 | Geofence zone 18 | 1 | Unsigned | 0 | 1 | - | - |  |
| 173 | Geofence zone 19 | 1 | Unsigned | 0 | 1 | - | - |  |
| 174 | Geofence zone 20 | 1 | Unsigned | 0 | 1 | - | - |  |
| 175 | Auto Geofence | 1 | Unsigned | 0 | 1 | - | - |  |
| 242 | Data Limit Hit | 1 | Unsigned | 0 | 1 | - | - |  |
| 243 | Idling | 1 | Unsigned | 0 | 1 | - | - |  |
| 246 | Towing | 1 | Unsigned | 0 | 1 | - | - |  |
| 247 | Crash Detection | 1 | Unsigned | 0 | 5 | - | - |  |
| 248 | Geofence Zone Over Speeding | 1 | Unsigned | 0 | 1 | - | - |  |
| 249 | Jamming | 1 | Unsigned | 0 | 1 | - | - |  |
| 251 | Immobilizer | 1 | Unsigned | 0 | 1 | - | - |  |
| 252 | Authorized Driving | 1 | Unsigned | 0 | 1 | - | - |  |
| 253 | Green Driving Type | 1 | Unsigned | 1 | 3 | - | - | Y |
| 254 | Green Driving Value | 1 | Unsigned | 0 | 255 | acc and braking: 0.01 | G or rad | Y |
| 255 | Over Speeding | 1 | Unsigned | 0 | 255 | - | km/h |  |
| 327 | Geofence zone 21 | 1 | Unsigned | 0 | 1 | - | - |  |
| 328 | Geofence zone 22 | 1 | Unsigned | 0 | 1 | - | - |  |
| 329 | Geofence zone 23 | 1 | Unsigned | 0 | 1 | - | - |  |
| 330 | Geofence zone 24 | 1 | Unsigned | 0 | 1 | - | - |  |
| 331 | Geofence zone 25 | 1 | Unsigned | 0 | 1 | - | - |  |
| 332 | Geofence zone 26 | 1 | Unsigned | 0 | 1 | - | - |  |
| 333 | Geofence zone 27 | 1 | Unsigned | 0 | 1 | - | - |  |
| 334 | Geofence zone 28 | 1 | Unsigned | 0 | 1 | - | - |  |
| 335 | Geofence zone 29 | 1 | Unsigned | 0 | 1 | - | - |  |
| 336 | Geofence zone 30 | 1 | Unsigned | 0 | 1 | - | - |  |
| 337 | Geofence zone 31 | 1 | Unsigned | 0 | 1 | - | - |  |
| 338 | Geofence zone 32 | 1 | Unsigned | 0 | 1 | - | - |  |
| 339 | Geofence zone 33 | 1 | Unsigned | 0 | 1 | - | - |  |
| 340 | Geofence zone 34 | 1 | Unsigned | 0 | 1 | - | - |  |
| 341 | Geofence zone 35 | 1 | Unsigned | 0 | 1 | - | - |  |
| 342 | Geofence zone 36 | 1 | Unsigned | 0 | 1 | - | - |  |
| 343 | Geofence zone 37 | 1 | Unsigned | 0 | 1 | - | - |  |
| 344 | Geofence zone 38 | 1 | Unsigned | 0 | 1 | - | - |  |
| 345 | Geofence zone 39 | 1 | Unsigned | 0 | 1 | - | - |  |
| 346 | Geofence zone 40 | 1 | Unsigned | 0 | 1 | - | - |  |
| 347 | Geofence zone 41 | 1 | Unsigned | 0 | 1 | - | - |  |
| 348 | Geofence zone 42 | 1 | Unsigned | 0 | 1 | - | - |  |
| 349 | Geofence zone 43 | 1 | Unsigned | 0 | 1 | - | - |  |
| 350 | Geofence zone 44 | 1 | Unsigned | 0 | 1 | - | - |  |
| 351 | Geofence zone 45 | 1 | Unsigned | 0 | 1 | - | - |  |
| 352 | Geofence zone 46 | 1 | Unsigned | 0 | 1 | - | - |  |
| 353 | Geofence zone 47 | 1 | Unsigned | 0 | 1 | - | - |  |
| 354 | Geofence zone 48 | 1 | Unsigned | 0 | 1 | - | - |  |
| 355 | Geofence zone 49 | 1 | Unsigned | 0 | 1 | - | - |  |
| 356 | Geofence zone 50 | 1 | Unsigned | 0 | 1 | - | - |  |
| 358 | Custom Scenario 1 | 1 | Unsigned | 0 | 1 | - | - |  |
| 359 | Custom Scenario 2 | 1 | Unsigned | 0 | 1 | - | - |  |
| 360 | Custom Scenario 3 | 1 | Unsigned | 0 | 1 | - | - |  |
| 361 | Custom Scenario 4 | 1 | Unsigned | 0 | 1 | - | - |  |
| 362 | Trace Order | 2 | Unsigned | 0 | 65535 | - | - |  |

### 5.3 The ids that actually appear on the wire

Every one of the 51 (id, width) pairs the captures carry **for ids the table lists** matches the declared width — 51 agreements, 0 disagreements. **State that honestly:** the captures carry **86** distinct (id, width) pairs. **35 of them (41 %) have no row in the vendor table at all** — ids 109, 111, and the entire 256…287 block, plus 288. Those were not "checked and passed"; they were unanswerable. The width check validates the layout; **it validates nothing about the 41 % of the observed id space that carries the CAN/reefer bank.**

| id | name (FM6300 table) | B | signed | mult | units | observed raw | reading |
|---|---|---|---|---|---|---|---|
| 1 | Digital Input 1 | 1 | U | — | — | 0, 1 | logic |
| 2, 3, 4 | Digital Input 2/3/4 | 1 | U | — | — | 0 | logic |
| 11 | **Analog Input 3** | 2 | U | 0,001 | V | 39, 38 | 0.039 V |
| 21 | GSM Signal | 1 | U | — | — | 4 | 4 of 5 |
| 22 | Data Mode | 1 | U | — | — | 3 | enum 0…5 |
| 24 | Speed | 2 | U | — | km/h | 84 | 84 km/h |
| 62 | **Dallas Temperature ID 1** | **8** | U | — | — | 0 | **the only N8 element ever observed**, and it is zero |
| 66 | External Voltage | 2 | U | 0,001 | **mV** ⚠ | 22074, 28713 | **22.074 V / 28.713 V** — trust `mult`, not `units` |
| 67 | Battery Voltage | 2 | U | 0,001 | **mV** ⚠ | 9904 | 9.904 V |
| 68 | Battery Current | 2 | U | — | mA | 0 | 0 mA |
| 70 | PCB Temperature | 2 | **S** | 0,1 | °C | 297, 349, 350 | 29.7 / 34.9 / 35.0 °C |
| 71 | GNSS Status | 1 | U | — | — | 3 | enum 0…5 |
| 76 | Fuel Counter | 4 | U | — | — | 0 | ⚠ units column blank |
| 79 | Brake Switch | 1 | U | — | — | 0 | logic |
| 80 | **Wheel Based Speed** | 4 | U | — | km/h | 84 | **84 km/h whole units** — §5.4 A1 |
| 81 | Cruise Control Active | 1 | U | — | — | 1 | on |
| 82 | Clutch Switch | 1 | U | — | — | 1 | |
| 83 | PTO State | 1 | U | — | — | 0 | |
| 84 | Acceleration Pedal Position | 4 | U | — | % | 0 | 0 % (cruise on) |
| 85 | Engine Current Load | 1 | U | — | % | 56, 55 | % |
| 86 | Engine Total Fuel Used | 4 | U | — | l | 87400 | **87 400 L** |
| 87 | Fuel Level | 4 | U | — | % | 96 | 96 % — **or 38.4 %**, §9 Q13 |
| 88 | Engine Speed | 4 | U | — | rpm | 1056, 1055 | **whole rpm** — §5.4 A1 |
| 104 | Engine Total Hours Of Operation | 4 | U | — | h | 4371 | **whole hours** — §5.4 A1 |
| **109** | **absent from vendor table** | 4 | — | — | — | `0x30333030` | **ASCII "0300"** — §5.6 |
| 110 | Diagnostics Supported | 1 | U | — | — | 0 | |
| **111** | **absent from vendor table** | 1 | — | — | — | 0 | flespi: "Requests supported" |
| **113** | **Service Distance** | 4 | **S** | — | km | `0xFFFD8C85` | **−160 635 km = exactly the documented minimum = a J1939 not-available SENTINEL**, §7 T-7 |
| 122 | Direction Indication | 1 | U | — | — | **3** | ⚠ **documented max is 1**; this is a 2-bit J1939 state, 3 = not available |
| 125 | System Event | 1 | U | — | — | 0 | |
| 127 | **Engine Coolant Temperature** | 1 | **S** | — | °C | 86 | **86 °C or 46 °C** — §5.4 A5, unresolved, 40 °C apart |
| 128 | Ambient Air Temperature | 2 | **S** | — | °C | 15 | **15 °C** whole (J1939 offset would give −272.5 °C) |
| 135 | Fuel Rate | 4 | U | — | l/h | 32 | **32 L/h whole** — §5.4 A1, and note id **18** is a *different* Fuel Rate with ×0,1 |
| 136 | Instantaneous Fuel Economy | 4 | U | — | km/l | 2 | 2 km/l |
| 137 | PTO Drive Engagement | 1 | U | — | — | 0 | |
| 138 | High Res Engine Total Fuel Used | 4 | U | — | **l or ml** ⚠ | 87541 | **litres on this device** (agrees with id 86 to 0.16 %) — §5.4 A3 |
| 139 | Combined Weight | 4 | U | — | kg | 47200 | 47 200 kg |
| 144 | SD Status | 1 | U | — | — | 0 | |
| 178 | Network Type | 1 | U | — | — | 0 | |
| 180 | Digital Output 2 | 1 | U | — | — | 0 | |
| 181 | GNSS PDOP | 2 | U | **blank** ⚠ | blank | 11 | **1.1 at ×0.1 (INFERRED** from max 500 and 17 satellites) |
| 182 | GNSS HDOP | 2 | U | **blank** ⚠ | blank | 6 | **0.6 at ×0.1 (INFERRED)** |
| 199 | Trip Odometer | 4 | U | — | m | 0 | metres |
| 200 | Sleep Mode | 1 | U | — | — | 0 | |
| 205 | **GSM Cell ID** | **4** | U | — | — | 7603371 | ⚠ 2 bytes on FMB1xx — §7 T-8 |
| 206 | GSM Area Code | 2 | U | — | — | 20161 | LAC |
| 216 | Total Odometer | 4 | U | — | m | 256909985 | **256 910 km** |
| 239 | Ignition | 1 | U | — | — | 1 | |
| 240 | Movement | 1 | U | — | — | 1 | |
| 241 | Active GSM Operator | 4 | U | — | — | 20820 | **MCC 208 / MNC 20 = France** |
| 253 | Green Driving Type | 1 | U | — | — | 2, 3 | 1 accel, 2 brake, 3 corner |
| 254 | **Green Driving Value** | 1 | U | **acc and braking: 0.01** ⚠ | **G or rad** ⚠ | 31, 29, 35, 35 | **unit depends on id 253** — §5.4 A4 |
| **256…287** | **absent from vendor table** | 1/2/4 | — | — | — | all 0 | 32 contiguous ids — §5.6, §7 T-9 |
| **288** | **absent from vendor table** | 1 | — | — | — | 0 | |

### 5.4 Ambiguous scaling — every one, marked

> **Every item in this list is a place where the vendor's own table cannot be read literally.** Ship these as raw, or ship them with the reading stated here and a test that pins the reading.

**A1 — FMS block (ids 79…139): the published `max` columns are raw J1939 counter ranges printed next to already-converted values. Do NOT use them for range validation, and do NOT apply J1939 resolutions.** *(INFERRED from one real record, but from five mutually-reinforcing cross-checks inside it.)*

| id | doc max | J1939 resolution if applied | observed | why the raw reading wins |
|---|---|---|---|---|
| 80 Wheel Based Speed | 65536 "km/h" | 1/256 km/h per bit → **0.33 km/h** | 84 | GNSS says 81, id 24 says 84 |
| 88 Engine Speed | 8032 rpm | ×0.125 → **132 rpm** | 1056 | 132 rpm at 84 km/h is impossible |
| 104 Engine Hours | 214748364 h | ×0.05 → **218 h** | 4371 | 256 910 km ÷ 218 h = 1175 km/h |
| 135 Fuel Rate | 3212 l/h | ×0.05 → **1.6 L/h** | 32 | 32 L/h = 38 L/100 km at 84 km/h ✅ |
| 128 Ambient Air Temp | 1770 °C | offset −273 → **−272.5 °C** | 15 | 15 °C is the ambient |

A decoder that "corrects for the 1/256 resolution" reports a 47-tonne truck doing **0.33 km/h**.

**A2 — External / Battery Voltage (ids 66, 67): the `units` column and the `mult` column contradict each other inside one row.** Table says `Multiplier 0,001` and `Units mV`. Multiplied out that reads 0.001 mV. Physics settles it: 22074 → **22.074 V** on a 24 V vehicle. The same table gives Analog Inputs 1/2/3 (ids 9/10/11) the identical `0,001` multiplier with `Units V`. **Rule: for the 63x table, trust the `mult` column and treat the `units` column as describing the RAW unit.**

**A3 — id 138 High-Resolution Engine Total Fuel Used: `Units = "l or ml"`.** The vendor's own words: the unit depends on *"the FMS fuel settings (item id 121)"* — a **configuration** value that is not on the wire. **Runtime disambiguation:** compare against id 86 in the same record; if 138 ≈ 86 it is litres (87 541 vs 87 400 here ⇒ litres). If id 86 is absent, **the unit is UNKNOWN and a 1000× error is live.**

**A4 — id 254 Green Driving Value: one element's unit is defined by another element's value, and the vendor row is self-contradictory.** `Multiplier: acc and braking: 0.01`, `Units: G or rad`, description: *"if harsh acceleration or braking – g\*100 (value 123 → 1.23g), if harsh cornering – **degrees (value in radians)**"* — that last clause contradicts itself in six words. Meanwhile the **2013 vendor PDF says `g*10 m/s²` for all three types**, which would make the real captured braking event **3.1 g** — a value no truck survives. **Take the wiki (×0.01) for acceleration and braking. For cornering the unit is UNKNOWN**: raw 35 is either 35° or 0.35 rad (≈20°). And id 253 is a **separately configurable element** — if it is absent from the record, emit 254 raw with an explicit "unit unknown" marker. A guess here is a 100× lie in a safety report.

**A5 — id 127 Engine Coolant Temperature: the vendor row is internally impossible and the two readings differ by exactly 40 °C.** Row: `1 byte | Signed | −40 | 210 | mult — | °C`. **A signed byte cannot express 210.** Either it is unsigned with the J1939 SPN 110 offset of −40 (raw 0…250 → −40…210 °C), or it is already-converted signed °C with a max copied from the raw SPN range.
- **INFERRED reading: 86 = 86 °C** (offset already applied). Cross-check inside the same record: 56 % engine load, 1056 rpm, 84 km/h, 47 200 kg, cruise on — that is an 86 °C engine, not a 46 °C one. And the sibling id 128 proves the convention: its documented range is the raw J1939 SPN 171 range while its value is already converted.
- ⚠ **Our own `packages/codec/src/dictionaries.ts` asserts the OPPOSITE convention for the FMB120 table** ("the wire byte is 0…250 with the description Offset by -40"). **Do not silently harmonise them** — flag it as a separate question (§9 Q4).
- Note that **nothing in the pipeline applies an offset in either direction**, so today the choice is invisible in code and shows up only in the customer's number. An overheat rule at >100 °C fires 40 °C early or never.

**A6 — LLS fuel level (ids 201/203/210/212/214): `Units = "kvants or ltr"`.** Depends on sensor configuration, not on the wire. **UNKNOWN per device.**

**A7 — Tachograph durations (ids 56–61, 69, 77): the wiki leaves the `Units` column blank; the 2013 vendor PDF says minutes for all eight.** Take **minutes** (INFERRED from the PDF).

**A8 — id 184 Driver 1 Working State: three different enums for the same concept.** Current wiki id 184: `0 Rest, 1 Driver available, 2 Work, 3 Drive, 4 Error, 5 Not available`. 2013 PDF id 184: `… 6 error, 7 not available`. The FMS-path equivalent (id 115/116/118): `7 Error, 8 not available`. **Take the current wiki for id 184** (it is the maintained page for shipping firmware) but **treat every value ≥ 4 as a single non-nominal bucket** until a capture settles it — otherwise an "Error" state can be reported as "Drive".

**A9 — ids 145–154 Manual CAN: meaning, scaling AND width live in per-device configuration.** Vendor footnote: *"CAN property length can vary depending on filter settings. Data can be sent as 1, 2, 4 or 8 byte property."* **Treat as opaque bytes. Never scale. Never name.**

**A10 — ids 89–103 Axle weight: documented max 32766 kg matches neither the J1939 valid max (32127.5) nor the full range (32767.5).** Range column unreliable.

**A11 — ids 181/182 GNSS PDOP/HDOP: multiplier column is blank, documented max is 500.** ×0.1 is **INFERRED** (gives 1.1 / 0.6 at 17 satellites, which is right; unscaled 11 / 6 would be terrible dilution figures inconsistent with a 17-satellite fix).

**A12 — the `multiplier` field is declared in `AvlDictionaryEntry` and applied NOWHERE in our repo.** That is a *default*, not a *contract*. Ids 11 (×0.001 V) and 70 (×0.1 °C) are real Codec-16 elements with real multipliers, so today the FM6320 frame's PCB temperature surfaces as `349` with a units column that says `°C`. **Decide and write down exactly one layer where multiplication happens (codec, worker, or render) and make the codec's output type say raw-vs-scaled explicitly** — otherwise a downstream rule threshold is silently off by 10× or 1000×, and `28713 V` looks like a sensor fault rather than a scaling bug.

### 5.5 Fixed-width fragmentation — Codec 16's substitute for strings

Because there is **no NX group** (§3.5), multi-byte strings are split across consecutive fixed-width ids and must be reassembled by the decoder:

| value | ids | total | encoding | source |
|---|---|---|---|---|
| VIN | **233 + 234 + 235** | 8 + 8 + 1 = **17 ASCII bytes** | ASCII, trailing NUL/space padded | **VERIFIED r1** FM6300 table |
| Driver 1 card id (tachograph) | **195 + 196** | 8 + 8 = **16 ASCII** | MSB then LSB | **VERIFIED r1** + **r2** (`if (model.matches("FM.6..")) { … putLong(io195).putLong(io196) … }`) |
| Driver 2 card id | **197 + 198** | 16 ASCII | same | **VERIFIED r1** |
| ICCID | **219 + 220 + 221** | 8 + 8 + 8 | | **VERIFIED r1** |
| LVCAN driver ids | 106/107/108/130, or 129–131 / 132–134 | 3 × 8 ASCII | adapter path | **r1** (2013 PDF) |

**Decode these as ASCII explicitly and trim trailing `0x00` and spaces.** Traccar's implementation uses the **platform default charset** and never trims — do not copy that. And **do not map id 256 to VIN**: that mapping belongs exclusively to Codec 8E's variable-length section (§7 T-12).

### 5.6 Ids the vendor table does not contain, that real devices send

| ids | what we know | confidence |
|---|---|---|
| **109** | 4-byte value `0x30333030` = **ASCII "0300"**. 2013 vendor PDF: *"109 SW-version supported, 4 ASCII bytes (Version format – ab.cd)"*. flespi maps AVL 109 → `fms.software.version`, type **string**. Read as an integer it is 808 661 040. | **VERIFIED by decode + r3 + r1(PDF)**; absent from the live wiki |
| **111** | 1-byte, observed 0. flespi: "Requests supported". | **INFERRED** |
| **256…287** | 32 contiguous ids across the 1/2/4-byte groups. The 2013 vendor PDF describes this exact range as **Thermo King iBox reefer** data (§6.4), and the observed widths match the PDF on 32/32 ids. **But every observed value is zero**, so the mapping of names to ids inside the block is *not* verified — any permutation of the six adjacent 2-byte fields in a zone produces byte-identical output. | **widths VERIFIED, names UNKNOWN** |
| **288** | 1-byte, observed 0 (in the fabricated V4 frame only). 2013 PDF places 288…326 in the **Mobileye** block; ids 288–299 are corroborated name-for-name by the *current* FMB640/FMC650 wiki tables. | **INFERRED** |

> **Do not import ids 256–326 into a shipping dictionary from the 2013 PDF text-scrape.** That mirror is a third-party HTML extraction of the PDF, and it demonstrably scrambles columns elsewhere (its worked example labels an N4 element "id 70" where the hex says `004C` = 76, and it pastes the same "Altitude 148 meters – Angle 214º – 12 Visible sattelites" boilerplate under two different examples whose hex says 174/185/11). Contiguous runs like 261–269 and 288–326 are exactly where a one-row scrape shift is invisible: every id still exists, every width still plausible, every value still in range. Surface these ids as `io_<id>` until a page-image reading of the original PDF, or the LV-CAN200 / ALL-CAN300 / Thermo King adapter parameter page, confirms the names.

---

## 6. Vehicle data — CAN / FMS / OBD

### 6.1 Four independent paths, and the decoder must know which is live

| path | ids | how it reaches the device | notes |
|---|---|---|---|
| **LV-CAN200 / ALL-CAN300 adapter** | 12–20, 23, 25–47, 141–143, 176–177, 226–228 | RS232 to a Teltonika CAN adapter that speaks a per-vehicle **program number** | **VERIFIED r1**, FMB630_CAN_adapters |
| **FMS / J1939 direct (AUTOCAN)** | **79–139** | FMS-standard bus, decoded on the device | the block that appears in real truck traffic (V2) |
| **Tachograph** | 48–61, 69, 77, 183–198, 231–235 | K-line + FMS | two competing representations, §6.5 |
| **Manual CAN 00–09** | 145–154 | raw CAN frames selected by configuration | opaque, §6.6 |

**There is no OBD-II on this family.** FM63XX is a truck/FMS device: J1939/FMS and adapter paths only. Do not look for OBD PIDs.

### 6.2 LV-CAN200 / ALL-CAN300 adapter

The vehicle profile is selected by a **Program Number**, reported as **AVL id 12, 4 bytes** (**VERIFIED r1**).

⚠ **Stale range in our generated dictionary.** The vendor moved program numbers from 3-digit to 4-digit from 2017-09-01: *"all program numbers that were up to 999 are changed to start from 1000"* (**VERIFIED r1**, FMB630_CAN_adapters). `fm6300.json` still carries `max: 999` for id 12 — **a range check against that would reject every modern adapter.**

Bitfield elements published with full bit tables on `FMB630_CAN_adapters` (**VERIFIED r1**): id 38 **Control State Flags** 4 B · id 39 **Agricultural Machinery Flags** 8 B · id 47 **Security State Flags** 8 B. Decode these as bitfields, never as integers.

⚠ **The adapter id→meaning map is firmware-dependent, not just model-dependent**: *"LVCAN AVL ID list changes"* — firmware 00.02.32 (**VERIFIED r1**, FM6300_firmware_errata). The dictionary is properly keyed by **(model, firmware)**, and we have no mechanism for the firmware half.

### 6.3 FMS / J1939 direct — the block that actually appears in traffic

Ids 79…139, 39 elements. **They carry no multiplier and arrive in engineering units** (§5.4 A1). The complete set as documented, with the readings verified against V2 where observed:

| SPN concept | AVL id | B | units | verified reading in V2 |
|---|---|---|---|---|
| Brake Switch | 79 | 1 | — | 0 |
| **Wheel Based Speed** (SPN 84) | **80** | 4 | km/h | **84 km/h whole units** |
| Cruise Control Active | 81 | 1 | — | 1 |
| Clutch Switch | 82 | 1 | — | 1 |
| PTO State | 83 | 1 | — | 0 |
| Accelerator Pedal Position (SPN 91) | 84 | 4 | % | 0 % |
| Engine Current Load (SPN 92) | 85 | 1 | % | 56 % |
| Engine Total Fuel Used (SPN 250) | 86 | 4 | l | 87 400 L |
| Fuel Level (SPN 96) | 87 | 4 | % | 96 (or 38.4 — §9 Q13) |
| **Engine Speed** (SPN 190) | **88** | 4 | rpm | **1056 rpm whole units** |
| Axle weights | 89–103 | 4 | kg | not observed; range column unreliable (A10) |
| Engine Total Hours (SPN 247) | 104 | 4 | h | **4371 h whole units** |
| VIN (FMS path) | 105–108 | 4×? | ASCII | **not observed; contested** — §9 Q12 |
| SW version supported | **109** | 4 | **ASCII** | **"0300"** |
| Diagnostics Supported | 110 | 1 | — | 0 |
| Requests Supported | 111 | 1 | — | 0 |
| High-res total vehicle distance | 112 | 4 | m | not observed |
| **Service Distance** (SPN 914) | **113** | 4 | **km SIGNED** | **−160 635 = documented minimum = SENTINEL** |
| Tachograph fields (FMS path) | 114–121, 126 | — | — | not observed; absent from live wiki |
| Direction Indication | 122 | 1 | — | **3** (doc max 1) |
| System Event | 125 | 1 | — | 0 |
| **Engine Coolant Temperature** (SPN 110) | **127** | 1 | °C **signed** | **86 — offset question, A5** |
| Ambient Air Temperature (SPN 171) | 128 | 2 | °C signed | **15 °C whole units** |
| Driver 1/2 Identification (FMS) | 129–134 | 3×8 | ASCII | not observed; absent from live wiki |
| **Fuel Rate** (SPN 183) | **135** | 4 | l/h | **32 L/h whole units** |
| Instantaneous Fuel Economy (SPN 184) | 136 | 4 | km/l | 2 |
| PTO Drive Engagement | 137 | 1 | — | 0 |
| **High-Res Total Fuel Used** (SPN 250) | **138** | 4 | **l OR ml** | 87 541 → litres here (A3) |
| Combined Weight (SPN 180) | 139 | 4 | kg | 47 200 kg |

⚠ **The same physical quantity exists twice with different scaling on different paths, and neither table says which is live:**

| quantity | adapter path | FMS path | trap |
|---|---|---|---|
| Fuel Rate | id **18**, 2 B, **×0,1**, l/h | id **135**, 4 B, no mult, l/h | applying id 18's convention to id 135 reports **3.2 L/h** |
| Total Mileage | id 16 / id 36 | id 112 | id 36 is metres |
| Tacho speed | id 52 | id 191 | |
| Tacho odometer | id 48 | id 192 | |
| Trip distance | id 49 | id 193 | |
| Driver ids | 106/107/108/130 | 195/196/197/198 | §5.5 |

**Rule (INFERRED, mine): never resolve a "vehicle data" name without knowing which path produced it.** The safe discriminator is the id itself: 79–139 is FMS, 12–47 is adapter.

### 6.4 Reefer (Thermo King iBox) — ids 256…287

**Widths VERIFIED by decode (V3, 32/32 ids). Names from the 2013 vendor PDF only; every observed value is zero, so names are UNKNOWN.**

Structure as the PDF describes it:
```
256 Fuel Level             1 B  %   resolution 0.5
257 Battery Voltage        2 B  V   resolution 0.05
258 Total Electric Hours   4 B  h   resolution 0.05
259 Total Vehicle Hours    4 B  h   resolution 0.05
260 Total Engine Hours     4 B  h   resolution 0.05
Zone n  (n=1: 261..269,  n=2: 270..278,  n=3: 279..287), same order in each zone:
  +0 Alarm Type                1 B  enum 0..15  (0 none … 15 shutdown/catastrophic)
  +1 Alarm Code                1 B  0..255, manufacturer specific
  +2 Return Air Temperature 1  2 B  int16, °C x10
  +3 Supply Air Temperature 1  2 B
  +4 Temperature Setpoint      2 B
  +5 Evaporator Coil Temp      2 B
  +6 Return Air Temperature 2  2 B
  +7 Supply Air Temperature 2  2 B
  +8 Operating mode            1 B
```
The observed widths line up exactly: the ids the PDF calls 1-byte are `{256, 261, 262, 269, 270, 271, 278, 279, 280, 287}` and **those are precisely the ten ids in V3's N1 group**; 258/259/260 are the only three in N4. That is a real, non-trivial structural corroboration.

⚠ **It is not a semantic one.** Each zone has **six adjacent 2-byte fields**; any permutation among them decodes byte-identically on an all-zero record. Label a reefer customer's setpoint as supply-air and every number stays plausible — in the one product line where the number *is* the product.

⚠ **Operating mode (ids 269 / 278 / 287) is NOT the raw byte.** Vendor: *"Received data needs to be masked as E0 >> 5 to get described operating mode."* i.e. `mode = (raw & 0xE0) >> 5`, giving `0` power off/unknown · `1` cooling · `2` heating · `3` defrost · `4` null · `5` pretrip · `6/7` manufacturer. Reporting the raw byte gives 0/32/64/96 where the mode is 0/1/2/3.

### 6.5 Tachograph

Two competing representations of the same data, both on this hardware:

| via | ids |
|---|---|
| **K-line / FMS tacho block** | 183–198 (Driver 1 ID = **195 MSB + 196 LSB**, 8+8 B ASCII; Driver 2 = 197+198), 231–235 (incl. VIN 233+234+235) |
| **LV-CAN adapter** | 48–61, 69, 77, 106/107/108/130 |

**Do not look for the driver card in AVL id 78 (iButton).** Id 78 is the 1-Wire iButton path and is empty when a tachograph is attached. Sub-trap on id 78 itself: it is **little-endian** and the presence guard must be `!= 0`, not `> 0` — a card id with the top bit set reads as a negative long and is silently dropped. This is a *firmware* bug too, not only a decoder one: *"Corrected the byte inversion issue in 1-Wire Matrix (ReadROM) ID parsing"* (**VERIFIED r1**, FMC234_firmware_errata).

Durations (ids 56–61, 69, 77) are in **minutes** (§5.4 A7). Working-state enums are contested (§5.4 A8).

### 6.6 Manual CAN 00–09 (ids 145…154)

Configured per element as `<priority>,<CANTypeID>,<outputDataMask>,<CANID>` — e.g. `setparam 1406 1,0,51,18FEE925` (**VERIFIED r1**, FM6300_Device_Family_Parameter_list). The 8-bit **Output Data Mask** selects which bytes of the CAN payload are forwarded; the vendor says the property is then sent as *"1, 2, 4 or 8 byte property"*.

**Consequence: the width, meaning and scaling of ids 145–154 exist only in that device's configuration and are not derivable from the frame.** Emit them as raw bytes with the width the group gave you, and never name or scale them. How a mask selecting 3, 5, 6 or 7 bytes is padded onto a 4- or 8-byte property is **UNKNOWN** (§9 Q14).

### 6.7 A behavioural landmine that looks like a decoding bug

**VERIFIED r1**, FM6300 firmware errata 00.02.77 (2018-03-01): *"Functionality for sending 0 value added for CAN/AutoCan."*

**Before that firmware, a CAN/AutoCAN element whose value was zero was omitted from the record entirely.** So on any FM63XX older than 00.02.77 — and this family shipped from 2016 and is still in fleets — an ignition-off, a zero fuel rate or a zero wheel speed simply never arrives.

**Rule: absence of a CAN element is not evidence of anything. Never carry a CAN-derived value forward across records.** A truck whose last non-zero wheel-speed sticks shows as permanently moving; an idle-time report shows zero idling; an ignition-based trip never closes.

---

## 7. THE TRAP LIST

Every entry: symptom → cause → source → the test that catches it. **This section is the most valuable thing in the document.** It is deliberately not compressed.

---

### T-1 · The wiki contradicts itself about the width of "N of Total IO", and the wrong row desyncs every record

**Symptom.** Every record after the first desyncs. Positions land in the ocean or in 1970; the frame is then rejected as `NoD1 != NoD2`; you ACK 0; the device retransmits the identical packet forever; the customer's map never advances.

**Cause.** On https://wiki.teltonika-gps.com/view/Codec the §Codec 16 **IO Element structure table** says `Generation Type | 1 byte | N of Total IO | 1 byte`, while the **three-way comparison table on the same page** says `AVL Data IO element total IO count length | Codec8: 1 byte | Codec8E: 2 bytes | Codec16: 2 bytes`. Note the comparison table has a *second* count row two lines below — `AVL Data IO element IO count length | 1 byte | 2 bytes | 1 byte` — which is **correct** for the per-group counts. Exactly one row is corrupt: the total. The same table's rows are demonstrably shifted: on /view/Teltonika_Data_Sending_Protocols the next row reads `Generation Type | Is Using | Not Using | Is Using`, i.e. it claims **Codec 8 uses a generation type**, which is false in every implementation and every Codec-8 sample that decodes.

**Adjudication (VERIFIED by decode).** I ran both hypotheses against all five real frames. **1-byte total: byte accounting closes exactly on 10/10 records** across four independent captures, and `N1+N2+N4+N8 == N` every time. **2-byte total: overruns or desyncs on every single record.** The vendor's own annotated examples print a single byte ("0A – 10 IO elements in record (total)", "04", "05"). Traccar, Go, Rust and Elixir all read 1 byte.

**Source.** https://wiki.teltonika-gps.com/view/Codec (both tables) · TeltonikaProtocolDecoder.java:473-518 · alim-zanibekov/teltonika `decodeElementsCodec16` · neilberkman/teltonika_codec codec16.ex.

**Test.** Decode all five frames and assert (a) the walker's cursor lands **exactly on** the NoD2 byte, i.e. consumed == `8 + dataLen - 1`; (b) `N1+N2+N4+N8 == declared N` for every record; (c) record count == NoD1. Then add a **negative** test that reads the total as 2 bytes and asserts it throws — that pins the corrupt-wiki-row hypothesis as refuted, in code, forever.

---

### T-2 · The wiki's own TCP example contradicts its own hex on Priority

**Symptom.** You write a fixture from the vendor's parse table, it says `priority: 1`, your decoder says 0, and you "fix" your correct decoder.

**Cause.** The table says `Priority | 01`. The byte at record offset 8 is `00` — in **both** records. The CRC `0x5FB3` validates over exactly those bytes, so `00` is what the device sent.

**Source.** https://wiki.teltonika-gps.com/view/Codec §Codec 16 Example. Independently asserted as 0 by `razrlab/teltonika`, `Groupe-Savoy/teltonika-sdk` and `neilberkman/teltonika_codec` test suites.

**Test.** Fixture asserts `priority === 0` on both records of V1, with a comment naming the wiki table as wrong.

---

### T-3 · Truncating the 2-byte AVL id to one byte — the ids alias onto plausible elements instead of failing loudly

**Symptom.** Silent wrong data with no error anywhere. A geofence-zone-21 event (id 327) is recorded as **GNSS Status** (id 71). A reefer element (id 257) is recorded as **Digital Input 1** (id 1) — the customer sees a door sensor toggling on a vehicle that has none.

**Cause.** Low-byte truncation is a *total function*: it always produces a valid-looking low id. `327→71 · 328→72 · 356→100 · 358→102 · 361→105 · 256→0 · 257→1 · 288→32`. Ids > 255 are the entire reason Codec 16 exists, and the FM6300 table runs to 395 (geofence zones 21–50 at 327–356, Custom Scenarios 1–4 at 358–361).

**Source.** **VERIFIED r1** /view/Codec (*"AVL ID's higher than 255 can only be used with Codec16"*) + FM6300 parameter page. **VERIFIED by decode**: V3 carries a contiguous 256…287 block; truncation renders it as ids 0…31.

**Test.** On V3, assert the decoded IO map contains keys 256…287 and does **not** contain any of 0…31. Property test: for any id ≥ 256, `decoded.has(id) && !decoded.has(id & 0xFF)`.

---

### T-4 · Rejecting the frame on an unknown Generation Type (> 7), or treating 3 = "Reserved" as an error

**Symptom.** One unexpected byte from a firmware you have never seen destroys an entire packet — up to 255 records, potentially a whole offline backlog — and you ACK 0, so the device resends it and you destroy it again. An infinite loop that eats the device's flash from the oldest end.

**Cause.** The vendor publishes eight values and **reserves one of them** (value 3), i.e. explicitly plans to add more. The whole vendor explanation is *"More information about it you can find here"* where "here" is plain text, not a link. Two shipping libraries hard-reject: Go returns `"invalid generation type, must be number from 0 to 7"` and aborts the **packet**; Rust returns `RejectionReason::InvalidGenerationType`. Traccar reads the byte and discards it, and never validates — which here is the **safe** behaviour.

**Source.** https://wiki.teltonika-gps.com/view/Codec §Generation type · alim-zanibekov/teltonika `decodeElementsCodec16` · nom-teltonika decoder.rs · TeltonikaProtocolDecoder.java (`buf.readUnsignedByte(); // generation type`).

**Test.** V8 in §8: a Codec-16 frame with generation type `0x09` and a repaired CRC. Assert the record still decodes, the position is still persisted, the value is surfaced as an unmapped numeric, and a metric/counter fires so ops can see it. **Apply the same rule symmetrically to Priority** (see T-5).

---

### T-5 · Hard-throwing on an out-of-enum Priority — the asymmetry nobody notices

**Symptom.** The first panic-button press on an FM63XX hits an untested code path. If the byte is anything other than 0/1/2, `parseAvl`'s `if (priority > 2) throw new FrameError(...)` rejects the **whole packet**, including the good records beside it, and `session.ts` answers a FrameError with `encodeAck(0)` — the livelock its own comment describes.

**Cause.** The wiki lists 0/1/2 but **nowhere says a higher value is illegal**. And there is **no Codec-16 capture anywhere with priority 1 or 2** — every genuine frame (wiki TCP, wiki UDP, all three Traccar frames) has priority `0x00`. Even the vendor's "priority 01" table entry is contradicted by its own hex (T-2).

**Source.** /view/Codec Priority table · our `packages/codec/src/parse.ts` · §8 GAPS.

**Test.** V11 (priority 2, CRC `0x0000368A`) must decode as Panic and reach the SOS path. A priority-3 frame (**CRC `0x0000A217`** — I computed it) must **not** cost the frame: clamp or pass through and count a metric.

---

### T-6 · Letting a dictionary handler read a different width than the group declared

**Symptom.** Everything after the mis-sized element in that record is garbage — wrong odometer, wrong fuel, wrong ignition — and then the record boundary is wrong, so the frame collapses. Customer sees a trip that teleports and a fuel graph that spikes.

**Cause.** The same AVL id has different widths on different families, so a shared handler table will eventually read 1 byte out of a 4-byte element. Traccar hit this repeatedly and eventually gave up on getting the table right, adding a **structural guard** instead: `int index = buf.readerIndex(); … handler.accept(position, buf); buf.readerIndex(index + length);`.

**Source.** Traccar commit `73407e12a` "Safer Teltonika IO decoding" · the instances that forced it: `d16c01cbe` "Fix FM11 FM12 FM36 decoding" (ids 205/206 narrowed), `74a6ec5ff` "Fix FM6320 decoding" (id 80 narrowed — **and that commit is what added our best test vector**), `5f5879624` "Fix FMB640 IO decoding" (ids 80–89 excluded from `FM*6**`).

**Test.** Enforce it in the **decoder**, not the dictionary: after every element handler, assert `cursor == elementStart + declaredWidth` and throw otherwise. Unit-test with a deliberately wrong dictionary entry (declare id 80 as 1 byte, feed V2 where it is 4) and assert the guard fires rather than the record shifting.

---

### T-7 · AVL id 113 decoded with the FMB1xx meaning — two plausible lies, one of them the product

**Symptom.** Read as an FMB battery level: *"Battery 255 %"*. Read as 4-byte unsigned: *"next service in 4 294 806 661 km"*. The truth in the real capture is **−160 635 km**, i.e. the truck is 160 635 km **overdue** — the fleet-maintenance number the customer actually bought.

**Cause.** On FM63XX/FMB630 id 113 is **Service Distance: 4 bytes, SIGNED, min −160635, max 167040 km** — the J1939 SPN 914 range verbatim. On FMB1xx the same id is a 1-byte battery percentage. **And the captured value is exactly the documented minimum, which makes it a J1939 "not available" SENTINEL, not a distance.** Rendering it literally tells a fleet it is 160 000 km overdue for service.

**Source.** **VERIFIED r1** FM6300 parameter page · **VERIFIED r2, the live bug**: `register(113, fmbXXX.or(ftXXX), (p,b) -> p.set(KEY_BATTERY_LEVEL, b.readUnsignedByte()))` where `fmbXXX = m.matches("FM[B-Z]...|MTB100|MSP500")` — **the string "FMB630" MATCHES**, so a Traccar user who types FMB630 gets battery level today. **VERIFIED r3**: flespi carries *both* meanings for FM6300. **VERIFIED by decode**: `0xFFFD8C85` = −160 635.

**Test.** Fixture on V2: `io(113) === -160635`, unit km, **and flagged as a sentinel rather than rendered**. Dictionary-level test: iterate every id present in both the FM63XX and FMB1xx tables and assert our selector picked the FM63XX row.

---

### T-8 · AVL id 205 is 4 bytes on FM63XX and 2 on FMB1xx — and the wrong value is small and plausible

**Symptom.** The cell id is silently the top half of the real one: **116 instead of 7 603 371**. Any LBS/cell-tower fallback position lands in the wrong place, so a device with no GPS fix shows up in the wrong city and the "last known location" is a fabrication.

**Cause.** Family id reuse, but worse than T-7 because the wrong value is not absurd.

**Source.** **VERIFIED r1**: `205 | GSM Cell ID | 4 | Unsigned | 0 | 4294967295` on FM6300. **VERIFIED r2**: `register(205, fmbXXX.or(tatXXX), (p,b) -> p.set("cid2g", b.readUnsignedShort()))` — 2 bytes, and FMB630 matches. **VERIFIED by decode**: V2 carries `00CD 007404AB` (id 205 = 7 603 371) next to `00CE 4EC1` (id 206 = 20 161).

**Test.** On V2 assert `io(205) === 7603371` and `io(206) === 20161`. The T-6 structural guard catches this class in general.

---

### T-9 · Treating the ids 256–287 name map as verified because "it was cross-checked against a capture"

**Symptom.** A reefer customer's temperature setpoint is labelled as supply-air temperature, or return-air-2 as return-air-1. Every number is plausible; nothing errors; the product is wrong in the exact dimension the customer bought it for.

**Cause.** V3 carries all 32 ids and **every value is zero**. An all-zero record proves the **width** assignment and nothing else. Each reefer zone has six adjacent 2-byte fields; any permutation among them produces byte-identical output on that capture. It is easy — and this document's ancestors did it — to call that "a decoded proof, not a doc reading".

**Source.** §4.5 decode · §6.4 · the 2013 PDF via a text-scrape mirror with known column scrambling (§5.6).

**Test.** On V3, assert ids 256–287 decode as **fixed-width numeric elements of widths 1/2/4** and that **no named sensor field is produced**. Keep them as `io_<id>` with an ADR note. When a non-zero reefer capture arrives, the settling test is: setpoint constant while return/supply air drift.

---

### T-10 · AVL id 11 is mislabelled in the wiki's own Codec-16 example

**Symptom.** You resolve id 11 as `ICCID1` (an 8-byte SIM identifier) and read 8 bytes where the wire has 2 — desync — or you report an "ICCID" of `39`.

**Cause.** The wiki's Codec-16 example prints *"00 0B (AVL ID: 11, Name: **ICCID1**)"* next to a **2-byte** value. The FMB630/FM6300 parameter table says `11 | Analog Input 3 | 2 | Unsigned | 0 | 30000 | 0,001 | V`. ICCID1 is the **FMB1xx-family** meaning and is 8 bytes there. Traccar goes further: `register(11, fmbXXX, … b.readLong())` — 8 bytes — under a predicate that **matches "FMB630"**.

**Adjudication:** the FM6300 table wins. Codec 16 is an FM63XY protocol; the value on the wire is 2 bytes; `0x0027` = 39 → 0.039 V is a plausible floating analog input, and 39 is not a plausible ICCID.

**Source.** https://wiki.teltonika-gps.com/view/Codec vs https://wiki.teltonika-gps.com/view/FM6300_Teltonika_Data_Sending_Parameters_ID · TeltonikaProtocolDecoder.java.

**Test.** V1 fixture asserts `io(11)` is a 2-byte value named Analog Input 3, and that no `iccid` field is produced.

---

### T-11 · Scaling id 254 without reading id 253 from the same record — a 100× error in a safety report

**Symptom.** A harsh-braking event of 0.35 g is published as "35 g"; a 35° cornering event as "0.35°". Either number silently poisons driver scoring and insurance telematics.

**Cause.** One element's unit is defined by another element's value, and id 253 is **separately configurable** — it may be absent. The vendor row is self-contradictory ("degrees (value in radians)"), and the 2013 PDF says `g*10` for all three types, which would make the real captured braking event **3.1 g**.

**The sharp edge, VERIFIED by decode.** In V2, records 2 and 3 are 50 ms apart with identical coordinates and differ in **exactly one byte**: id 253 goes 2 → 3, while **id 254 stays 35 in both**. The same raw 35 must read as 0.35 g in one record and 35°/0.35 rad in the next.

**Source.** FM6300 parameter page ids 253/254 · 2013 PDF · flespi (`harsh.cornering.angle`, degrees) · §4.2 decode.

**Test.** Fixture on V2: record 2 → `{type: harshBraking, value: 0.35, unit: 'g'}`; record 3 → `{type: harshCornering, value: 35, unit: 'deg-or-rad-UNKNOWN'}`. Separate test: when id 253 is absent, 254 is emitted raw with an explicit "unit unknown" marker and **never guessed**. ⚠ Do **not** write `31` into this fixture — that is record 0's value (§4.2).

---

### T-12 · Mapping AVL id 256 to VIN on Codec 16

**Symptom.** A vehicle whose VIN is displayed as `0` or as four binary bytes, on every FM63XX in the fleet.

**Cause.** In Codec 8E, ids 256/325 appear in the **NX variable-length group** as ASCII strings of declared length. **Codec 16 has no NX group.** Id 256 on this hardware is a fixed-width element in a contiguous 256–288 block.

**Source.** **VERIFIED r2** that the mapping is NX-only: `if (codec == CODEC_8_EXT) { … if (id == 256 || id == 325) { position.set(KEY_VIN, buf.readSlice(length).toString(US_ASCII)); }` — inside the branch Codec 16 never enters. **VERIFIED by decode**: V3's 256 is one byte, 257 two, 258–260 four.

**Test.** On V3 assert no `vin` field is produced. The Codec-16 VIN, if you want one, is ids **233+234+235** (§5.5).

---

### T-13 · Diagnosing `NoD1 != NoD2` as a corrupt packet

**Symptom.** The reporter's exact words: *"a packet from an FMC880 that the device keeps trying to send to the server over and over again."* Ingest looks healthy, CRC passes, and one device sits in a permanent retransmit loop with zero positions landing.

**Cause.** **NoD2 is the last byte of the data field.** If your record walk consumed one byte too many or too few, you read some *other* byte and compare it to NoD1. In the reported case two independent parsers agreed the packet was "buggy"; the maintainer eventually found the real cause was **his own IO read loop**. (Note the raw dump also had hundreds of trailing zero bytes from an unzeroed receive buffer — a second reason to slice by the **declared** length, never by bytes-read.)

**Source.** https://github.com/alim-zanibekov/teltonika/issues/4 — *"It seems we both made a mistake in the code :) … I made a mistake in the 8E codec I/O elements decoding logic, specifically in the variable length I/O element read loop."*

**Test.** Make the mismatch error carry the walker's cursor and the expected NoD2 offset; assert a deliberately desynced walk reports *"cursor at N, NoD2 expected at M"* rather than "corrupt packet". **Operationally: `NoD1 != NoD2` must raise a DECODER-BUG alert, never a device-fault alert, and must not ACK 0** — a frame whose structure we cannot walk is a property of our code, and retransmission cannot fix it.

---

### T-14 · Destroying the session on an oversize or unwalkable frame

**Symptom.** Permanent wedge triggered by exactly the backlog flush you most need to receive. `FrameError → session.onData → this.destroy()`, no ACK, device reconnects, resends the identical packet, repeat — while the FM63XX's **1 MB flash overwrites its oldest unsent records**.

**Cause.** Our live default is `StreamFramer(maxDataLength = 4096)`. Real observed record size is 224 B, so **19 records overflow the cap** — and NoD1 permits 255. The vendor's "1280 bytes" is borrowed from a Codec-8 note (§2.3) and the vendor's own errata says *"AVL packet size depends of hardware."* The arithmetic protocol bound is **65 028 bytes**.

**Source.** §2.3 · FM6300_firmware_errata 00.01.10 · our `packages/codec/src/frame.ts`.

**Test.** Synthesise a legal 40-record Codec-16 frame (~9 KB) and assert it is framed and decoded, not destroyed. Assert that an oversize frame results in **park-and-ACK**, never `destroy()`, and never ACK 0.

---

### T-15 · The ACK contract has two half-rules in circulation and they contradict each other

**Symptom.** A poison packet is ACKed 0 forever; every good record queued behind it on the device is lost when the flash wraps. Or: a partial ACK is treated as a cursor, the device resends everything, and you double-count.

**Cause.** Two statements coexist in this problem space and only one is sourced:
- **"ACK exactly NoD1, or ACK nothing you have not persisted"** — consistent with the only primary text (Rule A2: mismatch ⇒ resend the packet).
- **"ACK the count actually persisted"** (our CLAUDE.md rule 4) — correct for a *transient* persist failure, but for a **deterministic decode failure** it is an infinite loop, because the retransmission is byte-identical and will fail identically.

There is **no primary source** for a cursor reading (§9 Q10).

**Source.** /view/Codec (*"If sent data number and reported by server doesn't match module resends sent data"*) · Template:FMB_GPRS_settings · Traccar `parseData` (ACKs the header count before decoding — do not copy).

**Test.** Feed a frame that deterministically fails to decode and assert the pipeline **parks it and ACKs `declaredCount`** rather than ACKing 0. Feed a frame that fails transiently (Redis down) and assert **no ACK at all** is written, so the device retries the whole packet. Assert the two paths are distinguishable in code.

---

### T-16 · Trusting record order inside a frame

**Symptom.** Trip segmentation cuts a journey in half or stitches two together, because a backlog arrived out of order. Odometer deltas go negative.

**Cause.** `Records Sorting` defaults to **newest-first** on this family, high-priority records jump the queue regardless, and the flush path has been reworked repeatedly in firmware. In the V4 corpus frame the two records in one packet are **3.7 years apart** (ascending); nothing in the protocol prevents the reverse.

**Source.** **VERIFIED r1** parameter 108 default 0 = from newest · Template:FMB_GPRS_settings · Help_with_Server_FAQ (*"Records can be sorted by using timestamp as a record sorting method"*).

**Test.** Feed a frame whose records are in **descending** timestamp order; assert the pipeline sorts by fix time before the trip/geofence/overspeed engines see them, **within the device's shard** so ordering rule 5 is not violated, and that all records are still persisted.

---

### T-17 · Deduplicating on coordinates, or at second resolution

**Symptom.** Deduping on `(device, lat, lon)` throws away a real safety event. Not deduping at all double-counts driver-behaviour events. Deduping on `(device, timestamp)` at **second** resolution silently drops record 3 of V2.

**Cause.** Each eventual element that fires generates its **own record**, and two green-driving events can fire inside one GPS fix. **VERIFIED by decode**: V2 records 2 and 3 are **50 ms apart**, byte-identical in every GPS field, differing in one IO byte. Genuine firmware-level duplicates also exist: *"Disallowed GSM updates during server response wait periods to prevent duplicate record sending in online deep sleep mode"* and *"Resolved an issue where duplicate records were created if UART communication with the modem stopped working…"* (**VERIFIED r1**, FMC234_firmware_errata). And UDP retries reuse the same AVL packet id, so byte-identical frames legitimately arrive twice.

**Test.** On V2 assert **4** positions persist, that records 2 and 3 both survive, and that the `ON CONFLICT DO NOTHING` key includes **milliseconds**. Separate test: a byte-identical retransmitted frame produces **zero** new rows.

---

### T-18 · Reading every IO value as unsigned

**Symptom.** A below-sea-level installation reports **65 531 m** altitude. A cold PCB reports **6 553.5 °C**. Service distance reports 4.29 billion km. Sub-zero ambient reports 655 °C.

**Cause.** The Codec-16 wire has **no type tag** — only width. Signedness lives exclusively in the per-model parameter table. Signed elements on FM6300/FMB630: **113** Service Distance (4 B), **70** PCB Temperature (2 B, ×0.1, −550…1150), **127** Engine Coolant Temperature (1 B), **128** Ambient Air Temperature (2 B), plus every Dallas Temperature. At least one shipping open-source parser reads everything unsigned (`<<io_id::16, value::unsigned-size(value_bits), rest::binary>>`).

**Source.** FM6300 parameter page (the `type` column) · neilberkman/teltonika_codec codec16.ex.

**Test.** Table-driven over the whole FM63XX dictionary: for every entry typed **Signed**, feed the all-`0xFF` value of its width and assert the decode is −1 (or the type's most-negative value), not `2^n − 1`.

---

### T-19 · Treating Traccar's corpus as ground truth for CRC — one of its Codec-16 vectors has a broken CRC

**Symptom.** You diff against Traccar, the frame "works there", and you weaken your CRC check to accept it.

**Cause.** The `…009D1002…` frame (the vendor PDF's example) declares CRC `0x000009A5`; the true CRC-16/IBM over Codec ID…NoD2 is **`0xA6DE`**. **Traccar never validates Teltonika CRCs** — the only `Checksum.CRC16_IBM` use in the decoder is for an *outbound* Codec-12 image request — so nobody noticed for a decade. I brute-forced every span offset 0–19 × every plausible end × four CRC-16 variants; nothing yields `0x09A5`.

**Source.** §4.4 · Traccar `TeltonikaProtocolDecoderTest.java` · https://idoc.tips/fmb630-protocols-v02-pdf-free.html.

**Test.** Keep a **standing assertion that V4 FAILS CRC**. If anyone ever "fixes" the CRC to accept it, that test tells them they broke the CRC instead. Use the repaired V5 for layout tests.

---

### T-20 · The wiki's UDP example is malformed in three independent ways

**Symptom.** You build the UDP path from the vendor's only UDP example and reject every real datagram (or accept garbage) because you copied its length arithmetic.

**Cause.** Three defects in one 74-byte sample: (1) Length field `0x015B` = 347 for a 74-byte datagram (should be 72); (2) the bytes at offsets 5 and 24 are **transposed** — the hex has AVL packet id 01 / NoD1 07 where the table says 07 / 01; (3) the table prints the Ignition value as `00` where the wire says `01`, and prints the N2 id as one byte where the wire carries two.

**Source.** §4.3 · https://wiki.teltonika-gps.com/view/Codec §Codec16 over UDP · `danieljvsa/teltonika-go` ships `WithLenientUDPLength()` specifically for this sample (with, I argue, the wrong diagnosis).

**Test.** Keep V6 as an explicit **negative** fixture with its three defects annotated, and V7 (independently encoded, repaired) as the positive one. Assert the strict `decodeUdpHeader` rejects V6 and accepts V7. **Do not use V6 as evidence that real devices emit `NoD1 != NoD2`** — no such device behaviour has ever been observed.

---

### T-21 · Believing the UDP Length field is anything other than `datagram − 2`

**Symptom.** Off-by-two rejections on every UDP datagram, or an accept-anything parser.

**Cause.** The only Codec-16 UDP sample has a wrong length field, which invites "maybe the field means something else". It does not: **VERIFIED by decode** on the two well-formed UDP samples on the same wiki page — Codec 8 `0x003D` = 61 for 63 bytes, Codec 8E `0x005F` = 95 for 97 bytes. `length = total − 2` holds; only the Codec-16 sample is broken.

**Test.** Assert `length === datagram.length - 2` on V7 and on the wiki's Codec-8/8E UDP samples; assert V6 fails that check.

---

### T-22 · The UDP ACK packet id: vendor echoes, Traccar hardcodes zero

**Symptom.** A UDP device retransmits forever because it did not recognise your ACK.

**Cause.** The wiki says *"Acknowledgment packet should have the same Packet ID as acknowledged data packet"* and its example echoes `CAFE` → `0005CAFE010701`. Traccar writes `response.writeShort(0)` → `00050000010701`. Traccar appears to get away with it because the vendor text says the module validates *"AVL Packet ID and Number of accepted AVL elements"* — the **AVL** packet id, not the channel packet id — but that is an argument from silence.

**Test.** Assert our UDP ACK echoes the channel Packet ID (V15, `0005CAFE010701`). Keep V16 (`00050000010701`) in the corpus as a labelled **disagreement**, not a target.

---

### T-23 · Emitting phantom IO elements when the declared total exceeds the group sum

**Symptom.** Every affected record carries an extra element with **id 0 and a null value**, which becomes an `io_0` attribute on a customer's device page — an id the vendor does not define.

**Cause.** A shipping Go library does `data.Elements = make([]IOElement, ioCount)` — pre-allocating by the **declared** total — then fills only as many as the groups contain. The over-fill case is checked; the **under**-fill case is not, leaving zero-valued structs in the tail.

**Source.** alim-zanibekov/teltonika `decodeElementsCodec16`. (An open PR, #7, adds exactly the `N1+N2+N4+N8 == declared` validation.)

**Test.** Synthesise a record declaring total = 5 with groups summing to 4 (recompute CRC) and assert we **throw with the mismatch** rather than emitting a phantom. Assert both directions: total > sum **and** total < sum.

---

### T-24 · Cross-checking against Traccar without pinning its configuration

**Symptom.** You diff your correct decoder against Traccar, they disagree, and you "fix" yours to match Traccar's desynced output.

**Cause.** `protocol.teltonika.extended=true` makes Traccar read a **16-byte IO group for every codec**, gated on a boolean config flag rather than on the codec: `if (extended) { int cnt = readExtByte(buf, codec, CODEC_8_EXT); for (…) { int id = readExtByte(buf, codec, CODEC_8_EXT, CODEC_16); position.set(PREFIX_IO + id, hexDump(buf.readSlice(16))); } }`. With the flag on and codec 16, it reads the **NoD2 byte as a count** and walks off the end. **No vendor text supports a 16-byte group in Codec 16** — the §Codec 16 IO Element table ends at N8, and the comparison table says Codec 16 has no variable-size elements.

**Source.** TeltonikaProtocolDecoder.java lines 54, 67, 515-520 · /view/Codec.

**Test.** When cross-checking, pin `protocol.teltonika.extended=false` and record that in the harness. Do not implement the 16-byte group.

---

### T-25 · Reading the device's timestamp as UTC on firmware older than 00.02.67

**Symptom.** An entire day of history shifted by the mobile operator's UTC offset. Trips at the wrong hour, driving-time and tachograph reports wrong by 1–3 h, geofence dwell windows misaligned. **Nothing looks broken**, which is the whole problem — and under hard rule 7 (UTC in the DB, zone applied at render) the error becomes permanent in storage.

**Cause.** *"NITZ time synchronization use UTC time"* is a **FIX**, shipped in 00.02.67 (2017-11-22). Before it, the device stored the *local* part of NITZ. *"NITZ Time Sync added"* only arrived in 00.02.42 (2017-08-11) — before that the RTC drifted freely. The **final** firmware for this family still lists *"Timestamp generation improvements"* (01.00.34, 2020-08-10). The sibling 640 line added a *"Time jump filter"* as late as 2022.

**There is no in-band discriminator.** The field looks identical either way.

**Source.** https://wiki.teltonika-gps.com/view/FM6300_firmware_errata · FMB640_firmware_errata.

**Test.** Add a **backward** skew gate symmetric to our existing forward one (`positions_clock_skewed_total` in `apps/worker/src/liveState.ts` only guards a device running *ahead*). Count `positions_clock_behind_total` when the lag is a near-exact whole-hour or half-hour offset **and the device is not flushing a backlog**. Synthetic test: timestamps at exactly `server_time − 7200000 ms` on a live socket must flag the device, not silently accept. Cheaper long-term fix: read the firmware version out of band with a Codec-12 `getver` at session start and gate on it.

---

### T-26 · Selecting the dictionary from a free-text model string

**Symptom.** Two customers with identical trucks see different dashboards: one has fuel and RPM columns, one has none, a third has the wrong family's meanings. Nothing errors.

**Cause.** Traccar's predicates are **case-sensitive regexes over a user-typed field**: `fmbXXX = m.matches("FM[B-Z]...|MTB100|MSP500")` matches **FMB630** but **not FM6300** ('6' is not in `[B-Z]`); `fmb6XX = m.matches("FM.6..")` matches FMB630/FMB640/FMC640 but **not FM6300** (position 3 is '3'). So **FM6300 matches neither predicate and gets no dictionary at all**, while FMB630 gets FMB1xx meanings for ids 11, 113, 205, 206. Lowercase matches nothing.

**And our own catalogue has the mirror-image gap:** `catalogue.json` maps only `FM6300` and `FMB630` to the `fm6300` table. **FM6320 — the only model we have genuine bytes from — is absent.** `tableForModel('FM6320')` returns undefined, `applySign` returns at its first line, and id 113 surfaces as 4 294 806 661 with no name and no signedness.

**Source.** TeltonikaProtocolDecoder.java:190-191 · our `packages/codec/dictionaries/catalogue.json` and `src/dictionaries.ts`.

**The production answer (r3, from a platform running 582 786 Teltonika devices):** *"If a device with the correct type is not created and the model is not known for the given device, the flespi parsing engine automatically sends the **getver** command after connection initialization. The response contains the hardware model, which is remembered under the hood, tied to the IMEI, and used to parse the parameters correctly."* Watch the case: *"flespi-native device model names have lowercase letters, while the device usually answers its hardware_model with capital letters."* Their protocol developer states the underlying problem in one line: *"different device models use the same IDs for different parameters."*

**Test.** (a) A device whose stored model is empty triggers exactly one Codec-12 `getver` and **no positions are decoded with a guessed table** before the answer arrives. (b) The matcher is case- and separator-insensitive: `FM6300`, `FM6320`, `FMB630`, `fmb630`, `FMB-630` all select `fm6300`. (c) A model matching **no** table decodes to raw `io_<id>` and raises a visible warning — it must **never** fall back to the FMB1xx table.

---

### T-27 · Routing Codec 16 through `complete-teltonika-parser` (our current dependency)

**Symptom.** No exception, no CRC failure, no `NoD1/NoD2` failure — and **completely invented data**. Verified by execution on the V1 fixture:

```
rec0  ts=2019-07-10T12:06:54Z  EventID=11   ElementCount=1284  ids=[0,11,256,363,768,9984,…]
rec1  ts=1970-01-01T00:00:00Z  EventID=512  ElementCount=2816  ids=[16982]
```
Truth: `N = 4`, ids `{1, 3, 11, 66}`, both timestamps in 2019.

**Cause.** Read from `IOelement.js`: `var id_size = codec_id == 0x08 ? 1 : 2;` — and **that same width is then used for the event id, the total count and every group count**, while the **generation-type byte is never read**. Its internal `catch` calls `on_error` **only if supplied and otherwise swallows the exception entirely**, and `parse.ts` constructs `new ProtocolParser(hex)` with one argument.

**Source.** https://www.npmjs.com/package/complete-teltonika-parser v0.3.6, executed.

**Test.** Assert `decodeIoWithLib` is **never** reached for codec `0x10`. Hand-roll Codec 16 in `walk.ts` style. Add a regression test that the V1 fixture decodes to `N = 4` and ids `{1,3,11,66}`.

---

### T-28 · Reusing the 8E walker for Codec 16 because "both have 2-byte ids"

**Symptom.** Instant desync on record 1.

**Cause.** `walkRecords(region, extended: boolean)` is a **two**-state switch and Codec 16 is a **third** shape. `extended = true` reads 2-byte counts (overruns every record); `extended = false` reads 1-byte ids (aliases every id). And the descriptor most people reach for — `{idSize, countSize}` — is **still wrong**, because Codec 16 needs **three** widths: event id 2 B, element ids 2 B, counts 1 B. Our existing `walkRecords` reads the event id through the same `readCount()` helper as the counts, so wiring `countSize = 1` reads only the **high byte** of a 2-byte event id and every field after it shifts by one. On V2 (event id `0x00FD`) that desyncs into `N = 7` vs sum.

**Fix.** `{eventIdSize, idSize, countSize, genType, nx}` → Codec 8 `{1,1,1,false,false}` · 8E `{2,2,2,false,true}` · **Codec 16 `{2,2,1,true,false}`**. `extractNx8e` stays 8E-only.

**Test.** Assert walking V1 with the 8E shape **throws**, and with the Codec-8 shape **throws**, so no future refactor can quietly pass the wrong flag. And assert `eventIoId === 253` on V2 — the one value in the whole corpus that distinguishes a 1-byte from a 2-byte event-id read.

---

### T-29 · Not handling the bare `0xFF` ping in the framer

**Symptom.** Reported verbatim: *"it appears not to handle PING messages (0xFF) sent by Teltonika devices. This causes an error and subsequent closure of the connection with the device **if a normal data message arrives after a PING**"* — so the error surfaces on the *next* data message and looks unrelated.

**Cause, traced through our own code.** `packages/codec/src/frame.ts` has **no 0xFF branch**. A lone ping byte sits in the buffer (`buf.length < 4` → null); the *next* AVL packet is then read as `readUInt32BE(0) = 0xFF000000 ≠ 0` → IMEI branch → `len = 0xFF00 = 65280 > 64` → `FrameError` → `session.onData` calls `this.destroy()`. **The packet is never ACKed, the device reconnects and resends, and the cycle repeats forever.** Ping Mode defaults to 0 on FM63XY so it bites only configured devices — but flespi *recommends* enabling it.

**Source.** https://github.com/alim-zanibekov/teltonika/issues/2 · Traccar `TeltonikaFrameDecoderTest` (`FF000F3132…` → `[FF]`, `[000F…]`) · Template:FMB_GPRS_settings.

**Test.** Feed `FF` followed by V1 in one TCP segment; assert two frames are extracted, that **nothing is written back** for the ping, that the idle timer is refreshed, and that V1 is ACKed `00000002`. **This is the one case where our current behaviour is worse than the ACK-0 path.**

---

### T-30 · Writing the ACK and closing the socket in the same tick, or replying from an unreachable interface

**Symptom.** The single most-reported Teltonika field failure. The device resends identical records forever; your database fills with duplicates; the Configurator's **Last Server Response Time reads 01.01.1970 01:00:00**. Everything server-side looks correct — CRC passes, count is right, four bytes written.

**Cause.** Two independent server-side causes, both invisible from the parser: (1) closing the TCP connection in the same breath as the write discards the ACK — *"add a sleep(1) between the fwrite and fclose was enough"*; (2) binding the listener to a specific local address instead of `0.0.0.0` — *"local address was good for receiving data, but 0.0.0.0 is good for receiving and sending too."*

**Source.** https://github.com/uro/teltonika-fm-parser/issues/10 (four independent reporters, FMB965 / FMC880) · Help_with_Server_FAQ.

**Test.** Integration test against `tools/simulator`: send N records, ACK N, close the socket in the same event-loop tick, assert the simulator does **not** retransmit. Unit test: ingest never calls `socket.destroy()` before the write callback fires. **Ops signal: a per-device "identical frame received twice" counter — that counter, not the parse rate, is the ACK-delivery health metric.**

---

### T-31 · Assuming the device is waiting for your ACK at all

**Symptom.** Silent, permanent data loss with **no retransmission and no error**.

**Cause.** `ACK Type = TCP/IP` (Rule A7). On such a device, records are deleted the moment the TCP stack accepts them; a pipeline drop after the socket read is unrecoverable, and CLAUDE.md rule 4 protects nothing. FM63XY does not expose the knob — but the same server serves FMB/FMC devices where it exists, and a user in the field did flip it (*"I tried to switch to TCP instead of AVL, as it does not require answer"*).

**Source.** https://wiki.teltonika-gps.com/view/Help_with_Server_FAQ · https://github.com/uro/teltonika-fm-parser/issues/10.

**Test.** Make it observable rather than assumed: record the configured ACK type per device (readable via Codec-12 `getparam`) in the registry and alert when a device is on TCP/IP ACK. With TCP/IP ACK simulated, assert the pipeline treats a persist failure as an **ALERT** (dropped-records counter + log) rather than relying on retransmission.

---

### T-32 · "Absent element == zero" on CAN data

**Symptom.** An ignition-off, a zero fuel rate or a zero wheel speed never arrives, so the last non-zero value sticks forever. A truck shows as permanently moving; an idle-time report shows zero idling; an ignition-based trip never closes.

**Cause.** Before firmware 00.02.77 (2018-03-01) the device packed only non-zero CAN values. *"Functionality for sending 0 value added for CAN/AutoCan."* Older FM6300 units are still in fleets — the family shipped from 2016 and firmware ended 2020.

**Source.** https://wiki.teltonika-gps.com/view/FM6300_firmware_errata.

**Test.** Feed record A with id 240 (Movement) = 1, then record B **omitting** id 240; assert the derived movement state becomes `unknown`/stale-flagged rather than remaining 1. Surface a per-device "elements seen" set so a silently-missing element is diagnosable.

---

### T-33 · Rendering a J1939 sentinel as a measurement

**Symptom.** *"Service due 160 635 km ago."* *"Direction indication: 3"* on a field documented `0…1`.

**Cause.** FMS elements carry J1939's not-available / error encodings straight through. Id 113 arrives at exactly its documented minimum (−160 635 = SPN 914 "not available"); id 122 arrives as 3 where the documented range is 0–1 (a 2-bit J1939 state where 3 = not available).

**Source.** §4.2 decode · FM6300 parameter page.

**Test.** For each FMS id with a documented range, assert a value **at the range boundary** is emitted as `null`/`not-available` with the raw preserved, never as a measurement.

---

### T-34 · Using `Traccar` as a **parameter** oracle (it is a fine framing oracle and a hostile dictionary)

Worst collisions for a device labelled `FMB630` (Traccar's `decodeParameter` resets `readerIndex(index+length)` so it never desyncs — **it just emits wrong numbers**):

| id | Traccar emits | FM63XY truth |
|---|---|---|
| 36 | `rpm` (u16) | Total Mileage, 4 B **metres** |
| 236 | `alarm: general` when > 0 | **Axis X accelerometer** — alarms on every non-zero reading |
| 30 | `faultCount` | Vehicle Speed km/h |
| 31 | `engineLoad` u8 | Accelerator Pedal Position ×0.1 % |
| 26/27/28 | `bleTemp2..4` = short/100 | Axle 1/2/3 Load, kg |
| 12 | `fuelUsed` = u32/1000 | **Program Number** |
| 11 | `iccid` = readLong() | Analog Input 3, 2 B |
| 113 | `batteryLevel` u8 | Service Distance 4 B signed |
| 72–75 | `temp1..4` = readInt()/10 | Dallas Temperature, **2 B** |

Traccar *deliberately* excludes `fmb6XX` from ids 80–89 — the one place it got the family split right, and it got there via the FM6320 bug that produced our best test vector.

**Test.** A dictionary test that walks every id Traccar registers under a predicate matching "FMB630" and asserts our resolution differs where the tables differ, with the FM63XX row winning.

---

## 8. Test vectors

Sixteen vectors. **Five are real published frames** (V1, V2, V3, V4, V6); **six are derived by mutation** and labelled as such; the rest are session bytes. Formatted for transcription into `packages/codec/__fixtures__/wiki/codec16.hex.json` (shape borrowed from `codec8.hex.json`).

**Hard rule 9 applies the moment these land: a fixture is immutable. Transcribe the numbers from this section, not from memory, and not from any wiki table — several wiki tables are wrong (T-2, T-10, T-20).**

### 8.1 Inventory, provenance and licence

| # | name | dir | source | licence | CRC |
|---|---|---|---|---|---|
| **V1** | `codec16-tcp-wiki-2rec-zero-gps-onchange` | dev→srv TCP | **r1** wiki /view/Codec §Codec 16 Example | vendor page — **cite the URL, do not vendor the page text**; the hex is a protocol example | `0x5FB3` ✅ |
| **V2** | `codec16-tcp-fm6320-4rec-46io-fms` | dev→srv TCP | **r2** Traccar `TeltonikaProtocolDecoderTest.java` L≈43, added by commit `74a6ec5ff` **"Fix FM6320 decoding"** (2022-08-16) | **Apache-2.0 — attribution required** | `0xEB85` ✅ |
| **V3** | `codec16-tcp-highids-1rec-ids256to287` | dev→srv TCP | **r2** same file, L≈82. **Model UNKNOWN** | **Apache-2.0** | `0x0D3B` ✅ |
| **V4** | `codec16-tcp-2rec-n8-BAD-CRC` | dev→srv TCP | **r1 content / r5 host** FMB630 Protocols v0.02 PDF, also **r2** Traccar L≈79 | Apache-2.0 (Traccar copy) | **`0x09A5` declared, `0xA6DE` true — FAILS** |
| **V5** | `codec16-tcp-2rec-n8-CRC-REPAIRED` | dev→srv TCP | **DERIVED** from V4 — last 4 bytes only | Apache-2.0 attribution still required; the repair is ours | `0xA6DE` ✅ |
| **V6** | `codec16-udp-wiki-AS-PUBLISHED-malformed` | dev→srv UDP | **r1** wiki §Codec16 over UDP | vendor page | none (UDP) |
| **V7** | `codec16-udp-1rec-HEADER-REPAIRED` | dev→srv UDP | **r4** `alim-zanibekov/teltonika` `TestCodecs16EncodeUDP` — an **independent encoder's** output | **MIT** (© 2022 Alim Zanibekov) | none (UDP) |
| **V8** | `codec16-tcp-generation-type-9` | dev→srv TCP | **DERIVED** from V1, byte 36 = `0x09`, CRC repaired | ours | `0x0F40` ✅ |
| **V9** | `codec16-tcp-corrupt-crc` | dev→srv TCP | **DERIVED** from V1, last byte flipped | ours | **intentionally wrong** |
| **V10** | `codec16-tcp-priority-1-high` | dev→srv TCP | **DERIVED** from V1 | ours | `0xCB2E` ✅ |
| **V11** | `codec16-tcp-priority-2-panic` | dev→srv TCP | **DERIVED** from V1 | ours | `0x368A` ✅ |
| **V12** | `imei-handshake` | dev→srv TCP | **r1** wiki + **r2** navtrack Codec16 test | vendor hex | — |
| **V13** | `handshake-accept` | srv→dev | **r1** wiki | — | — |
| **V14** | `ack-tcp-2-records` | srv→dev | **r1** wiki + **r2** Traccar `parseData` | — | — |
| **V15** | `ack-udp-vendor` | srv→dev UDP | **r1** wiki | — | — |
| **V16** | `ack-udp-traccar-DISAGREEMENT` | srv→dev UDP | **DERIVED** from Traccar's write sequence | Apache-2.0 | — |

Cross-checking test suites that independently assert V1's decode (useful as a second opinion, not as a source): `razrlab/teltonika` `test/codec16.test.js` (priority 0, gen 5, event 11, N 4, id 66 → 22.074) · `Groupe-Savoy/teltonika-sdk` `tests/parser/codec16.test.ts` (MIT; timestamps `2019-07-10T12:06:54.000Z` / `:55.000Z`) · `neilberkman/teltonika_codec` (Apache-2.0; asserts `generation_type: :on_change`) · `navtrack` `TeltonikaProtocolCodec16Tests.cs` (asserts the handshake `01` and the ACK `00000002`).

⚠ Traccar's own assertion on V2/V3/V4 is only a sanity envelope — `verifyPositions` checks non-empty, `fixTime` after 1999 and before now+25 h, lat/lon in range, altitude −12262…18000, speed 0…869 kn. **It asserts none of the IO values.** Every IO expectation below is our decode.

### 8.2 Ready-to-transcribe fixture JSON

```json
{
  "source_url": "https://wiki.teltonika-gps.com/view/Codec#Codec_16",
  "snapshot_url": "https://web.archive.org/web/20260112035544/https://wiki.teltonika-gps.com/view/Codec",
  "retrieved_at": "2026-09-10",
  "attribution": "V1/V6 hex verbatim from the Teltonika wiki Codec page. V2/V3/V4 from Traccar's TeltonikaProtocolDecoderTest.java (Apache-2.0, (c) Anton Tananaev) - V2 added by commit 74a6ec5ff 'Fix FM6320 decoding', so it is a real FM6320 capture. V7 from alim-zanibekov/teltonika (MIT). V5/V8/V9/V10/V11 are DERIVED by mutation from the vectors named in each case's note - not device captures. All expected values are our own byte-by-byte decode; all CRCs recomputed. See docs/protocols/teltonika-codec16.md.",
  "cases": [
    {
      "name": "V1-wiki-2rec-zero-gps-onchange",
      "direction": "device->server",
      "hex": "000000000000005F10020000016BDBC7833000000000000000000000000000000000000B05040200010000030002000B00270042563A00000000016BDBC7871800000000000000000000000000000000000B05040200010000030002000B00260042563A00000200005FB3",
      "note": "Vendor's own TCP example. The wiki's parse table says priority 01; the hex says 00 and the CRC validates over it. Both records are exact 0/0 with satellites 0 => fix_valid false on both ADR-039 tests. AVL id 11 is Analog Input 3 here, NOT ICCID1.",
      "ack": "00000002",
      "expect": {
        "kind": "avl", "codec": 16, "recordCount": 2, "crcOk": true,
        "records": [
          { "tsMs": 1562760414000, "priority": 0, "lon": 0, "lat": 0, "altitude": 0, "angle": 0, "satellites": 0, "speed": 0,
            "eventIoId": 11, "generationType": 5, "ioTotal": 4, "recordBytes": 46,
            "io": { "1": "0", "3": "0", "11": "39", "66": "22074" } },
          { "tsMs": 1562760415000, "priority": 0, "lon": 0, "lat": 0, "altitude": 0, "angle": 0, "satellites": 0, "speed": 0,
            "eventIoId": 11, "generationType": 5, "ioTotal": 4, "recordBytes": 46,
            "io": { "1": "0", "3": "0", "11": "38", "66": "22074" } }
        ]
      }
    },
    {
      "name": "V2-fm6320-4rec-46io-fms",
      "direction": "device->server",
      "hex": "00000000000003831004000001735ACE37F80000E3B9331C71E290006900E211005100FD072E1600010100160300470300F00100150400B20000C80000EF01009000004F00005101005201005300005538006E00006F00007A03007D00007F5600890000FD0200FE1F09004326B00044000000B5000B00B6000600427029001800540046015D00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022A1005000000054005400000000005600015568005700000060005800000420006800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000000001735ACE3CA80000E3B08A1C71DD29006900E311005100FD072E1600010100160300470300F00100150400B20000C80000EF01009000004F00005101005201005300005537006E00006F00007A03007D00007F5600890000FD0200FE1D09004326AC0044000000B5000B00B600060042701F001800540046015D00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022CE00500000005400540000000000560001556800570000006000580000041F006800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000000001735ACE3FC80000E3A7C01C71D7C2006900E311005100FD072E1600010100160300470300F00100150400B20000C80000EF01009000004F00005101005201005300005537006E00006F00007A03007D00007F5600890000FD0200FE2309004326AC0044000000B5000B00B6000600427015001800540046015E00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022E700500000005400540000000000560001556800570000006000580000041F006800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000000001735ACE3FFA0000E3A7C01C71D7C2006900E311005100FD072E1600010100160300470300F00100150400B20000C80000EF01009000004F00005101005201005300005537006E00006F00007A03007D00007F5600890000FD0300FE2309004326AC0044000000B5000B00B6000600427015001800540046015E00CE4EC10080000F0F00F10000515400CD007404AB00D80F5022E700500000005400540000000000560001556800570000006000580000041F006800001113006D303330300071FFFD8C85008700000020008800000002008A000155F5008B0000B86000040000EB85",
      "note": "REAL FM6320 capture (traccar commit 74a6ec5ff). Loaded artic truck near Orleans, France. Records 2 and 3 are 50ms apart with identical GPS and differ in EXACTLY one byte: id 253 goes 2->3, while id 254 is 35 in BOTH. Do NOT write 31 for records 2/3 - 31 is record 0. id 113 = -160635 is a J1939 not-available SENTINEL, not a distance. id 109 is ASCII '0300', not 808661040.",
      "ack": "00000004",
      "expect": {
        "kind": "avl", "codec": 16, "recordCount": 4, "crcOk": true,
        "records": [
          { "tsMs": 1594956331000, "priority": 0, "lon": 1.4924083, "lat": 47.7225616, "altitude": 105, "angle": 226, "satellites": 17, "speed": 81,
            "eventIoId": 253, "generationType": 7, "ioTotal": 46, "recordBytes": 224,
            "groupCounts": { "n1": 22, "n2": 9, "n4": 15, "n8": 0 },
            "io": { "1":"1","22":"3","71":"3","240":"1","21":"4","178":"0","200":"0","239":"1","144":"0","79":"0","81":"1","82":"1","83":"0","85":"56","110":"0","111":"0","122":"3","125":"0","127":"86","137":"0","253":"2","254":"31",
                    "67":"9904","68":"0","181":"11","182":"6","66":"28713","24":"84","70":"349","206":"20161","128":"15",
                    "241":"20820","205":"7603371","216":"256909985","80":"84","84":"0","86":"87400","87":"96","88":"1056","104":"4371","109":"808661040","113":"4294806661","135":"32","136":"2","138":"87541","139":"47200" } },
          { "tsMs": 1594956332200, "priority": 0, "lon": 1.4921866, "lat": 47.7224233, "altitude": 105, "angle": 227, "satellites": 17, "speed": 81,
            "eventIoId": 253, "generationType": 7, "ioTotal": 46, "recordBytes": 224,
            "io": { "253":"2", "254":"29", "85":"55", "66":"28703", "88":"1055", "216":"256910030", "70":"349" } },
          { "tsMs": 1594956333000, "priority": 0, "lon": 1.4919616, "lat": 47.7222850, "altitude": 105, "angle": 227, "satellites": 17, "speed": 81,
            "eventIoId": 253, "generationType": 7, "ioTotal": 46, "recordBytes": 224,
            "io": { "253":"2", "254":"35", "85":"55", "66":"28693", "88":"1055", "216":"256910055", "70":"350" } },
          { "tsMs": 1594956333050, "priority": 0, "lon": 1.4919616, "lat": 47.7222850, "altitude": 105, "angle": 227, "satellites": 17, "speed": 81,
            "eventIoId": 253, "generationType": 7, "ioTotal": 46, "recordBytes": 224,
            "io": { "253":"3", "254":"35", "85":"55", "66":"28693", "88":"1055", "216":"256910055", "70":"350" } }
        ]
      }
    },
    {
      "name": "V3-highids-1rec-ids256to287",
      "direction": "device->server",
      "hex": "000000000000009F100100000164D855401800D5E3B744EC11C762023B011A060000000007200A010000010500010600010D00010E00010F00011600011700011800011F001301010000010700000108000001090000010A0000010B0000010C000001100000011100000112000001130000011400000115000001190000011A0000011B0000011C0000011D0000011E000003010200000000010300000000010400000000000100000D3B",
      "note": "Proves 2-byte AVL ids on the wire: every id is 256..287, unrepresentable in Codec 8. Both coordinate axes negative (Santiago, Chile). ALL VALUES ARE ZERO - this confirms WIDTHS only, never names. Must NOT produce a vin field and must NOT contain any id 0..31.",
      "ack": "00000001",
      "expect": {
        "kind": "avl", "codec": 16, "recordCount": 1, "crcOk": true,
        "records": [
          { "tsMs": 1532637823000, "priority": 0, "lon": -70.6496700, "lat": -33.4379166, "altitude": 571, "angle": 282, "satellites": 6, "speed": 0,
            "eventIoId": 0, "generationType": 7, "ioTotal": 32, "recordBytes": 156,
            "groupCounts": { "n1": 10, "n2": 19, "n4": 3, "n8": 0 },
            "ioIdsN1": [256,261,262,269,270,271,278,279,280,287],
            "ioIdsN2": [257,263,264,265,266,267,268,272,273,274,275,276,277,281,282,283,284,285,286],
            "ioIdsN4": [258,259,260],
            "allValuesZero": true }
        ]
      }
    },
    {
      "name": "V4-2rec-n8-BAD-CRC-negative-vector",
      "direction": "device->server",
      "hex": "000000000000009D10020000013FEB55FF74000F0EA850209A690000AE00B90B00000000070A050001000002000003000004000120000200180000004601290200C700000000004C0000000001003E00000000000000000000015B198C7498000F0DBC502095872F00AE00B90B00000000070A050001000002000003000004000120000200180000004601290200C700000000004C0000000001003E000000000000000002000009A5",
      "note": "NEGATIVE VECTOR. Declared CRC 0x09A5; true CRC-16/IBM is 0xA6DE. Must be REJECTED with CrcError before any record walk, and must NOT be ACKed with a non-zero count. Keep this assertion standing: if anyone ever 'fixes' the CRC to accept this frame, they broke the CRC. Structurally it is the ONLY frame carrying an N8 element (id 62 Dallas Temperature ID 1, value 0). INFERRED fabricated: two records 3.7 years apart with byte-identical IO.",
      "expect": { "kind": "error", "error": "CrcError", "crcDeclared": "0x000009A5", "crcTrue": "0x0000A6DE" }
    },
    {
      "name": "V5-2rec-n8-CRC-REPAIRED-derived",
      "direction": "device->server",
      "hex": "000000000000009D10020000013FEB55FF74000F0EA850209A690000AE00B90B00000000070A050001000002000003000004000120000200180000004601290200C700000000004C0000000001003E00000000000000000000015B198C7498000F0DBC502095872F00AE00B90B00000000070A050001000002000003000004000120000200180000004601290200C700000000004C0000000001003E0000000000000000020000A6DE",
      "note": "DERIVED, NOT A CAPTURE: V4 with the final 4 bytes changed 000009A5 -> 0000A6DE. Nothing else touched. Use this for the layout test that needs all four group widths including N8.",
      "ack": "00000002",
      "expect": {
        "kind": "avl", "codec": 16, "recordCount": 2, "crcOk": true,
        "records": [
          { "tsMs": 1374042849140, "priority": 0, "lon": 25.2618832, "lat": 54.6990336, "altitude": 174, "angle": 185, "satellites": 11, "speed": 0,
            "eventIoId": 0, "generationType": 7, "ioTotal": 10, "recordBytes": 77,
            "groupCounts": { "n1": 5, "n2": 2, "n4": 2, "n8": 1 },
            "io": { "1":"0","2":"0","3":"0","4":"0","288":"0","24":"0","70":"297","199":"0","76":"0","62":"0" } },
          { "tsMs": 1490782287000, "priority": 0, "lon": 25.2558416, "lat": 54.6670383, "altitude": 174, "angle": 185, "satellites": 11, "speed": 0,
            "eventIoId": 0, "generationType": 7, "ioTotal": 10, "recordBytes": 77,
            "io": { "1":"0","2":"0","3":"0","4":"0","288":"0","24":"0","70":"297","199":"0","76":"0","62":"0" } }
        ]
      }
    },
    {
      "name": "V6-udp-wiki-AS-PUBLISHED-malformed",
      "direction": "device->server-udp",
      "hex": "015BCAFE0101000F33353230393430383532333135393210070000015117E40FE80000000000000000000000000000000000EF05050400010000030000B40000EF01010042111A000001",
      "note": "NEGATIVE VECTOR, three defects: (1) Length field 0x015B=347 for a 74-byte datagram (should be 72); (2) bytes at offsets 5 and 24 are TRANSPOSED - hex has avlPacketId 01 / NoD1 07 where the wiki's own table says 07 / 01; (3) the wiki's table prints ignition (id 239) as 00 where the wire says 01. Our strict decodeUdpHeader must reject it. Do NOT cite this as evidence that devices emit NoD1 != NoD2 - no such device behaviour has ever been observed.",
      "expect": { "kind": "error", "error": "UdpHeaderError" }
    },
    {
      "name": "V7-udp-1rec-HEADER-REPAIRED",
      "direction": "device->server-udp",
      "hex": "0048CAFE0107000F33353230393430383532333135393210010000015117E40FE80000000000000000000000000000000000EF05050400010000030000B40000EF01010042111A000001",
      "note": "Independent encoder output (alim-zanibekov/teltonika TestCodecs16EncodeUDP, MIT) for the same content, and independently reconstructible from the wiki's own parse table. Differs from V6 in exactly three bytes: Length 015B->0048, avlPacketId 01->07, NoD1 07->01. No CRC exists on UDP.",
      "ack": "0005CAFE010701",
      "expect": {
        "kind": "avl-udp", "codec": 16, "packetId": 51966, "avlPacketId": 7, "imei": "352094085231592", "recordCount": 1,
        "records": [
          { "tsMs": 1447804801000, "priority": 0, "lon": 0, "lat": 0, "altitude": 0, "angle": 0, "satellites": 0, "speed": 0,
            "eventIoId": 239, "generationType": 5, "ioTotal": 5, "recordBytes": 48,
            "io": { "1":"0", "3":"0", "180":"0", "239":"1", "66":"4378" } }
        ]
      }
    },
    {
      "name": "V8-generation-type-9-must-not-reject",
      "direction": "device->server",
      "hex": "000000000000005F10020000016BDBC7833000000000000000000000000000000000000B09040200010000030002000B00270042563A00000000016BDBC7871800000000000000000000000000000000000B05040200010000030002000B00260042563A00000200000F40",
      "note": "DERIVED from V1: record 0's generation-type byte (absolute offset 36) set 0x05 -> 0x09, CRC recomputed to 0x00000F40. 0x09 is outside the vendor enum 0..7. POLICY ASSERTION: the record must still decode and persist, with the raw value surfaced as unmapped; rejecting costs a position and, under the ACK contract, forces a retransmission that will never be accepted. Full sweep CRCs for byte 36 = 0..7: 93F7, 6FE2, 2BDE, D7CB, A3A6, 5FB3, 1B8F, E79A.",
      "ack": "00000002",
      "expect": { "kind": "avl", "codec": 16, "recordCount": 2, "crcOk": true,
                  "records": [ { "generationType": 9, "generationTypeKnown": false }, { "generationType": 5 } ] }
    },
    {
      "name": "V9-corrupt-crc",
      "direction": "device->server",
      "hex": "000000000000005F10020000016BDBC7833000000000000000000000000000000000000B05040200010000030002000B00270042563A00000000016BDBC7871800000000000000000000000000000000000B05040200010000030002000B00260042563A00000200005FB2",
      "note": "DERIVED from V1: final CRC byte 0xB3 -> 0xB2. Must be rejected by the CRC path BEFORE any record walk, and must NOT be ACKed with a non-zero count.",
      "expect": { "kind": "error", "error": "CrcError" }
    },
    {
      "name": "V10-priority-1-high",
      "direction": "device->server",
      "hex": "000000000000005F10020000016BDBC7833001000000000000000000000000000000000B05040200010000030002000B00270042563A00000000016BDBC7871801000000000000000000000000000000000B05040200010000030002000B00260042563A0000020000CB2E",
      "note": "DERIVED from V1: both priority bytes 0x00 -> 0x01, CRC 0x0000CB2E. Exists because NO real Codec-16 frame with priority != 0 exists anywhere - even the vendor's 'priority 01' table entry is contradicted by its own hex.",
      "ack": "00000002",
      "expect": { "kind": "avl", "codec": 16, "recordCount": 2, "crcOk": true, "records": [ { "priority": 1 }, { "priority": 1 } ] }
    },
    {
      "name": "V11-priority-2-panic",
      "direction": "device->server",
      "hex": "000000000000005F10020000016BDBC7833002000000000000000000000000000000000B05040200010000030002000B00270042563A00000000016BDBC7871802000000000000000000000000000000000B05040200010000030002000B00260042563A0000020000368A",
      "note": "DERIVED from V1: both priority bytes -> 0x02 (Panic), CRC 0x0000368A. Must reach the panic/SOS path. For the out-of-enum negative case, priority 0x03 on both records needs CRC 0x0000A217 (computed) - and that frame must NOT cost the whole packet.",
      "ack": "00000002",
      "expect": { "kind": "avl", "codec": 16, "recordCount": 2, "crcOk": true, "records": [ { "priority": 2 }, { "priority": 2 } ] }
    },
    {
      "name": "V12-imei-handshake",
      "direction": "device->server",
      "hex": "000F333536333037303432343431303133",
      "note": "be16 length 0x000F=15 then ASCII '356307042441013'. Server replies 0x01 accept / 0x00 reject. Codec-independent; included so the Codec-16 set can drive a full session.",
      "expect": { "kind": "imei", "imei": "356307042441013", "reply": "01" }
    },
    { "name": "V13-handshake-accept", "direction": "server->device", "hex": "01", "expect": { "kind": "handshake-accept" } },
    { "name": "V14-ack-tcp-2-records", "direction": "server->device", "hex": "00000002",
      "note": "4-byte BE record count. Reply to V1. 1 record -> 00000001, 4 records -> 00000004, full rejection -> 00000000. Codec 16 takes NO special branch. NEVER send this for codec 0x0C/0x0D/0x0E.",
      "expect": { "kind": "ack-tcp", "count": 2 } },
    { "name": "V15-ack-udp-vendor", "direction": "server->device-udp", "hex": "0005CAFE010701",
      "note": "Correct reply to V7. Length 0x0005, Packet ID 0xCAFE ECHOED, not-usable 0x01, AVL packet id 0x07 echoed, accepted count 0x01. The AVL packet id echo is load-bearing for retransmission suppression.",
      "expect": { "kind": "ack-udp", "packetId": 51966, "avlPacketId": 7, "count": 1 } },
    { "name": "V16-ack-udp-traccar-DISAGREEMENT", "direction": "server->device-udp", "hex": "00050000010701",
      "note": "NOT A TARGET. Traccar hardcodes the channel Packet ID to 0x0000 instead of echoing 0xCAFE. Kept as a labelled disagreement: echo the packet id, per the wiki.",
      "expect": { "kind": "ack-udp", "packetId": 0, "avlPacketId": 7, "count": 1 } }
  ]
}
```

### 8.3 Corpus gaps — what NO vector anywhere covers

Do not mistake a green fixture suite for coverage. Every item below has **zero** real bytes behind it.

1. **Priority 1 (High) or 2 (Panic)** — no real capture, anywhere. Every genuine frame is priority 0. **Our panic/SOS path is untested against Codec-16 wire data.** V10/V11 are synthetic stand-ins.
2. **A non-zero N8 (8-byte) value.** The only N8 element in existence is id 62 in V4, value `0x0000000000000000` — and that frame's CRC is invalid. Odometers, iButton ids and CAN totals live in this group.
3. **Generation types 0, 1, 2, 3, 4 and 6.** Only 5 and 7 have ever been observed. Six of eight documented values are pure documentation.
4. **A genuine UDP capture.** There is exactly one UDP Codec-16 example in the world, it is broken three ways, and every open-source "UDP Codec 16 vector" is a re-encoding of that same record. No multi-record UDP datagram; no observed retransmission pair.
5. **`Number of Data = 0`** (empty keep-alive packet). No sample.
6. **Frames at the documented size limits** — largest real record 224 B, largest packet 911 B. Oversize handling is untested at any real boundary.
7. **A record split across TCP segments**, and two frames coalesced in one read. Only synthetic splits exercise our framer.
8. **`satellites == 0` with NON-ZERO last-known coordinates** — the case the vendor explicitly documents. Every zero-fix Codec-16 sample is *also* exact 0/0, so **the ADR-039 branch that matters most (one zero axis is a real place; sat == 0 alone invalidates) has no Codec-16 wire evidence behind it.**
9. **Any AVL id ≥ 289.** Highest observed anywhere is 288. The 2-byte field allows 65535 and the FM6300 table itself runs to 395.
10. **A negative altitude, or any altitude outside 0…571 m.** The sign path is untested (§9 Q3).
11. **A duplicate AVL id inside one record.** Our Map-based `io` would silently overwrite; some parsers raise "Repeated id". No sample shows whether devices do it.
12. **A capture from an actual FMB630** — the model the vendor names *first*. Our only model-attributed frame is an FM6320.
13. **Codec 12/13/14 sessions against a Codec-16-speaking device.** The wiki says FM63XX needs Codec 12 for Garmin/LCD/COM-TCP-Link, so these devices do speak it — we have no bytes.
14. **A real frame where `NoD1 != NoD2`.** Only the wiki's malformed UDP example shows it, and that is a documentation typo (T-20). The real-world trigger rate of our cross-check is unknown.
15. **Device behaviour on a partial ACK** for Codec 16 specifically (§9 Q10).

---

## 9. Open questions

Ordered by how much a wrong guess costs. Each carries **what would settle it** and **what it costs while open**.

### Q1 · What are the wire bytes of "Empty Codec 12" (Network Ping Mode = 2)? — **UNKNOWN**
**Settled by:** setting parameter 156 = 2 on an FM63XX and capturing, or a vendor example.
**Cost while open:** LOW-MEDIUM. Our `parseCommandFrame` requires `dataLen ≥ 8` and type `0x05/0x06`, so a zero-quantity Codec-12 frame raises `FrameError` → ACK 0. Survivable (unlike the 0xFF path, T-29), but it means a ping-mode-2 device produces a periodic spurious error and a spurious ACK 0.

### Q2 · What does a device do after receiving `00` (login reject)? — **UNKNOWN**
**Settled by:** a capture against a server that rejects a known IMEI.
**Cost while open:** LOW for decoding, MEDIUM for capacity planning — an unknown reconnect interval with no retry cap is a self-inflicted DDoS from a mis-provisioned fleet.

### Q3 · Is Altitude signed or unsigned? — **UNKNOWN, and implementations disagree**
The wiki says only *"Altitude – meters above sea level"*, 2 bytes, and never states signedness. **Traccar reads `buf.readShort()` (signed); nom-teltonika reads `cursor.u16()` (unsigned).** No sample anywhere has a negative altitude, so the wire cannot settle it.
**Settled by:** a capture from below sea level (Netherlands, Dead Sea, Baku), or a vendor statement.
**Cost while open:** MEDIUM. **Use signed** — the failure mode of unsigned is a 65 km altitude, catastrophic and obvious; the failure mode of signed is nothing.

### Q4 · Does id 127 Engine Coolant Temperature carry the J1939 −40 offset on the wire? — **UNKNOWN, 40 °C at stake**
The vendor row (`1 byte | Signed | −40 | 210`) is internally impossible. One real sample reads 86, which is 86 °C already-converted or 46 °C with the offset. **Our own `dictionaries.ts` asserts the opposite convention for FMB120.**
**Settled by:** a cold-start capture where coolant climbs from ambient — any value **below 40** proves no offset is embedded (86 = 86 °C); a value pinned at ≥ 40 while the engine is cold proves the offset is on the wire (86 = 46 °C). Id 128 in the same record gives you the ambient for free. Or a vendor statement scoped to FM63XY rather than to the SPN.
**Cost while open:** HIGH. An overheat rule at > 100 °C fires 40 °C early or never fires. Both readings look believable on a dashboard.

### Q5 · Are the top two bytes of the 4-byte CRC field guaranteed zero? — **UNKNOWN**
All five samples have `0000`; our parse compares the full uint32, stricter than any documented rule.
**Settled by:** a firmware statement, or one counter-example frame.
**Cost while open:** LOW but sharp — a single non-conforming firmware would make us reject **every** frame from that device.

### Q6 · Is the UDP "Not usable byte" (offset 4) ever anything but `0x01`? — **UNKNOWN**
Traccar names it "packet type" and ignores it.
**Settled by:** a UDP capture from real FM63XY hardware.
**Cost while open:** LOW while we do not ship UDP.

### Q7 · What does a Codec-16 priority 1 / 2 record actually look like? — **UNKNOWN (no sample exists)**
**Settled by:** a simulator scenario driving the panic input on real hardware, or any field capture.
**Cost while open:** HIGH for the product. The panic/SOS path — the feature with the highest consequence of failure — has never seen Codec-16 wire data, and `parseAvl` currently **hard-throws on priority > 2**, rejecting the whole packet (T-5).

### Q8 · Do generation types 0, 1, 2, 3, 4, 6 ever appear, and does 3 ("Reserved") ever appear? — **UNKNOWN**
**Settled by:** production telemetry from real hardware.
**Cost while open:** MEDIUM, and asymmetric: log-and-keep costs nothing if they never appear; hard-reject costs an entire packet the first time one does (T-4).

### Q9 · Does a Codec-16 device emit `satellites == 0` with non-zero last-known coordinates? — **UNKNOWN on the wire, VERIFIED in the docs**
The wiki states it plainly (*"Longitude, Latitude and Altitude values are last valid fix, and Angle, Satellites and Speed are 0"*), yet every zero-fix Codec-16 sample is *also* exact 0/0.
**Settled by:** any FM63XX capture taken indoors after a valid fix.
**Cost while open:** MEDIUM-HIGH. This is precisely the ADR-039 branch (`satellites == 0` **or** an exact 0/0 ⇒ `fix_valid = false`) and Codec 16 has no evidence behind the half of it that distinguishes a stale fix from Null Island.

### Q10 · Does ACKing a count LOWER than NoD1 ever behave as a partial cursor on any firmware? — **UNKNOWN**
The only primary text says mismatch ⇒ resend the packet. The cursor reading is community folklore with **no source behind it**, and our own `parse.ts` comment repeats it.
**Settled by:** a controlled test — send 5 records, ACK 3, count the records in the retransmission (**5** = whole-packet resend; **2** = cursor).
**Cost while open:** HIGH. It decides whether a partial ACK is a retry or an infinite loop (T-15), and it is cheap to settle the moment hardware exists.

### Q11 · Can an FM63XY ever emit Codec 8/8E? — **UNKNOWN**
No codec-selection parameter exists in the FMB630/FM6300 list, which is consistent with "always Codec 16" — but **absence of a parameter is not a statement**.
**Settled by:** a Codec-8 capture from an FM63XY, or a vendor statement.
**Cost while open:** LOW if the decoder dispatches on the codec byte (which it must anyway).

### Q12 · What are ids 105–108 — the FMS VIN, or LVCAN driver ids? — **UNKNOWN, sources conflict**
The 2013 PDF's AUTOCAN block reads 105–108 as *"vehicle identification number, Max 24 ASCII bytes"*; the same PDF's LV-CAN/tacho block assigns 106/107/108 to LVCAN Driver1 ID High/Low and Driver2 ID High. **Both cannot hold simultaneously** — the split may be by attached CAN source. The current wiki lists neither.
**Settled by:** a capture from an FM63XY with FMS VIN reporting enabled, or the FMB630 Configurator's I/O element list.
**Cost while open:** MEDIUM. A VIN rendered as a driver id, or vice versa, is a customer-visible identity error.

### Q13 · Is id 87 Fuel Level already a percentage, or a raw ×0.4 count? — **UNKNOWN**
Observed `0x60` = 96 in all four records of the only capture. 96 % converted and 38.4 % raw (96 × 0.4) are **both physically plausible**, and the record set has no variation to exploit.
**Settled by:** a capture spanning a refuel or a long drive-down, or a device where id 87 and an adapter fuel-percent id (37) are both enabled and comparable.
**Cost while open:** MEDIUM. A fuel-theft alarm threshold is meaningless at 2.5× uncertainty.

### Q14 · How is a Manual CAN element padded when the Output Data Mask selects 3, 5, 6 or 7 bytes? — **UNKNOWN**
The vendor says only 1/2/4/8-byte properties exist, so it must pad or round — but neither the padding side (leading vs trailing) nor the fill byte is documented.
**Settled by:** a bench FM63XY with a 3-bit mask and a known CAN payload.
**Cost while open:** LOW if ids 145–154 are emitted opaquely, as §6.6 requires. HIGH the moment someone tries to name one.

### Q15 · What are the real names behind ids 256–287 (and 288–326)? — **UNKNOWN**
Widths are verified on 32/32 ids; every observed value is zero; the only naming source is a text-scrape of a 2013 PDF with demonstrated column scrambling.
**Settled by:** page images of the original *FMB630 Protocols v0.02* PDF, the LV-CAN200 / ALL-CAN300 / Thermo King iBox adapter parameter page, or a reefer capture with mutually distinguishable non-zero temperatures.
**Cost while open:** HIGH for reefer customers specifically, zero for everyone else. Surface as `io_<id>` and the cost stays zero.

### Q16 · Which firmware is a given device running, and did it timestamp in UTC? — **UNKNOWN in-band**
NITZ used local time before 00.02.67 (2017-11-22), and there is **no in-band discriminator**.
**Settled by:** a Codec-12 `getver` at session start, cached against the IMEI (what flespi does for model detection anyway).
**Cost while open:** HIGH and *silent*. Trips at the wrong hour, reports on the wrong day, permanently written into `positions` under hard rule 7 (T-25).

### Q17 · Which models exactly are "FM63XY", and is FMB631 real? — **partly UNKNOWN**
FM6300 and FM6320 have wiki pages; **FMB631 returns 404**. Our `catalogue.json` maps only FM6300 and FMB630 — **FM6320, the only model we have real bytes from, is missing**.
**Settled by:** a vendor page enumerating the family, or the Configurator's model list.
**Cost while open:** HIGH *today*, and trivially fixable: `tableForModel('FM6320')` currently returns undefined, so the one device we have evidence from decodes against no dictionary, no names and no signedness (T-26).

### Q18 · Is the maximum AVL packet size 512, 1280, 65 028, or "whatever the modem allows"? — **UNKNOWN**
512 is refuted by an 899-byte frame with a valid CRC from a labelled FM6320. 1280 is borrowed from a Codec-8 note. The vendor's own errata says it *"depends of hardware"*.
**Settled by:** a capture from a known FM6300/FMB630 flushing a large backlog.
**Cost while open:** MEDIUM-HIGH. Our live cap is 4096 and the failure mode is `destroy()` with no ACK — a permanent wedge on exactly the backlog flush that matters (T-14).

### Q19 · Where does multiplier application happen? — **not a source question, a contract question**
`multiplier` is declared and applied nowhere. Ids 11 (×0.001 V) and 70 (×0.1 °C) are live Codec-16 elements.
**Settled by:** us, in an ADR. Pick one layer, make the type say raw-vs-scaled.
**Cost while open:** MEDIUM. Everything downstream that reads the `units` column is silently off by 10× or 1000× (§5.4 A12).

---

## 10. Verdict

### 10.1 Is this implementable today without guessing?

**The transport and the record layout: YES, unreservedly.** Framing, CRC (named, with polynomial/init/reflection and a verified check value), handshake, ACK bytes, and the full byte map of a Codec-16 record are pinned by a vendor structure table, confirmed by five independent implementations, and **verified by decoding every known frame byte-exactly** — cursor landing on NoD2, `N1+N2+N4+N8 == N`, and CRC matching on 10/10 records where a CRC exists. Four competing layout hypotheses were tested and each fails on every sample. Nobody has to guess a single offset in §3. The one internal vendor contradiction (T-1) is decided by hex, not by preference.

**The parameter layer: NO, not without explicitly refusing to name things.** The captures carry 86 distinct (id, width) pairs; **35 of them (41 %) have no row in the vendor's own dictionary**, including the entire 256–287 block. Every scaling decision in §5.4 A1 — whole km/h, whole rpm, whole hours, whole L/h — rests on internal consistency within **one truck's one frame at one operating point**, from **one FM6320 on one firmware on 2020-07-17**. The only other nominally-FMB630 vector is fabricated (T-19 / §4.4). Two elements (id 127 coolant, id 87 fuel level) have two plausible readings differing by 40 °C and 2.5×, and no sample can distinguish them.

**So the honest answer is: implement §2–§4 today, and ship §5–§6 as raw `io_<id>` with names only where a vendor row and a decoded value agree.** The framing will be exactly right. Anything you *name* beyond that list is a plausible, silent, durable lie written into `positions.attrs` where a customer will act on it.

### 10.2 The riskiest byte

**Record offset 27 — `N of Total IO`.**

It is one byte. The vendor's own page tells you twice, and the two answers disagree: the structure table says 1 byte, the three-way comparison table on the same page says 2. Read it as 2 and **every record after the first desyncs**; the frame then fails the `NoD1 == NoD2` check; the reflex response is to reject and ACK 0; the device retransmits the identical packet forever; and while it does, **its 1 MB flash overwrites its oldest unsent records** (§2.8). One byte, read from the wrong table, silently destroys history you already had.

It earns the title over its rivals because it is the only place in the protocol where the *vendor documentation itself* actively points at the wrong answer, and because the failure is self-amplifying rather than self-limiting.

**Runners-up, in order:**

1. **Record offset 26 — the generation-type byte** — because forgetting it shifts everything after it by exactly one, and because two shipping libraries *reject the whole packet* on a value they do not recognise (T-4).
2. **Record offset 24–25 — the 2-byte Event IO ID** — because a `{idSize, countSize}` descriptor with only two widths reads its high byte alone and shifts every subsequent field by one (T-28). V2's event id `0x00FD` is the only value in the corpus that exposes it.
3. **Any 2-byte AVL id above 255** — because truncation to one byte is a *total function*: it never errors, it just relabels a reefer sensor as a door switch (T-3).
4. **The four ACK bytes** — because they are the only bytes we write, the device's reader never resynchronises (Rule A6), and the difference between ACKing `declaredCount` and ACKing `0` is the difference between parking one bad frame and destroying a fleet's backlog (T-15).
5. **`0xFF`, the ping** — one byte, no branch in our framer today, and a permanent wedge for any device configured with Network Ping Mode = 1 (T-29).

### 10.3 The five things to do first

1. **Add the `0xFF` branch to `StreamFramer.tryExtract`** before the zero-preamble test. Consume 1 byte, emit `{kind:'ping'}`, reply nothing, refresh the idle timer. This is a live defect today, not a Codec-16 one.
2. **Replace `walkRecords(data, extended: boolean)` with `{eventIdSize, idSize, countSize, genType, nx}`** — Codec 8 `{1,1,1,false,false}`, 8E `{2,2,2,false,true}`, Codec 16 `{2,2,1,true,false}`. Assert both wrong shapes throw on V1.
3. **Never route codec `0x10` through `complete-teltonika-parser`** (T-27). It accepts the codec, invents IO ids, produces a 1970 timestamp, and throws nothing.
4. **Add `FM6320` (and the rest of FM63XY) to `catalogue.json`** — the one device we have real bytes from currently resolves to no dictionary at all.
5. **Land V1, V2, V3, V4(negative), V5, V7 as fixtures with the exact numbers in §8.2** — including `254 = 35` on records 2 and 3 of V2, not 31. Under hard rule 9 a fixture is immutable, so the first transcription is the only one you get.
