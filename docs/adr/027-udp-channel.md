# ADR-027: Teltonika UDP Channel (connectionless ingest)

Status: accepted · 2026-07-16

## Context

Teltonika FMB/FMC devices can be configured to report over TCP **or** UDP (`setparam 2006:1` =
UDP). Until now apps/ingest only spoke TCP (Codec 8/8E over the streaming framer). A device set to
UDP simply could not connect. UDP is common on metered/cellular fleets where the connectionless
channel avoids TCP handshake overhead on every wake-up.

The UDP wire format differs from TCP: there is **no** `0x00000000` preamble, no 4-byte data length,
and **no CRC**; instead every datagram is self-contained and carries its own IMEI plus a packet id.

## Decision

Add a UDP listener (`node:dgram`, a built-in — no new dependency, so no dep-ADR needed) alongside
the TCP server, sharing the same Redis, device registry, shard model, sanity rules, and metrics.

**Wire format** (rule 8 — cited). The Teltonika wiki (https://wiki.teltonika-gps.com/view/Codec,
"UDP Channel") is Cloudflare-gated from CI, so the byte layout is grounded in the approved oracle
(CLAUDE.md "when stuck"): Traccar `TeltonikaProtocolDecoder.decodeUdp` (Apache-2.0, reference logic,
not copied):

```
request:  [2B length][2B packet id][1B unused=0x01][1B AVL packet id][2B IMEI len][IMEI ASCII][AVL data]
response: [2B length=5][2B packet id][1B 0x01][1B AVL packet id][1B accepted count]
```

`length` counts every byte after itself. The **AVL data is the identical codec-8/8E payload TCP
carries, minus the preamble/length/CRC** — so `decodeUdpPacket` re-wraps it into a synthetic TCP
frame with a self-consistent CRC and decodes it through the single audited `parseFrame` path. One
record walker / IO decoder serves both transports; there is no second implementation to drift.

Persistence + the ACK count go through a shared `persistAvlBatch` helper (persist.ts) used by BOTH
the TCP session and the UDP listener, so the two write byte-identical stream payloads (rule 4 / I1).

**Packet-id echo.** We echo the request's packet id in the response, per the wiki (the device sends
that id expecting acknowledgement of it). Traccar instead writes `0` — a deviation that works only
because devices don't strictly validate the field. Echoing is strictly safer: a device that
validates stays in sync, one that ignores it is unaffected.

**Flood defense (source IPs are spoofable).** UDP has no handshake, so a per-IP rate limiter alone
is both bypassable (each spoofed source gets a fresh window) and itself an unbounded key map. The
primary guard is therefore a GLOBAL datagrams/sec ceiling (`INGEST_UDP_MAX_DGRAMS_PER_SEC`, default
50k) that bounds total work regardless of source; the per-IP window map is additionally capped
(`maxTrackedIps`) and swept every 60 s. The heavy AVL parse is also deferred until AFTER the registry
lookup authorizes the IMEI (`decodeUdpHeader` → lookup → `parseUdpAvl`), so an unauthenticated flood
can't drive the expensive parser. ACKs are only ever sent to a source that supplied a valid
registered IMEI in a strictly larger datagram than the 7-byte reply — deamplification, not a
reflection vector.

**Backpressure.** UDP has no flow control, so instead of pausing (TCP's I4 behaviour) the listener
**sheds**: above the shard-depth threshold it drops the datagram without persisting or ACKing, and
the device resends. Memory stays bounded (§10 failure #11).

**Statelessness = free retire check.** There is no handshake and no per-socket state; the registry
lookup on *every* datagram doubles as the E08-4 retire check — a retired/erased device stops being
persisted on its very next datagram.

**Config.** UDP shares the TCP port by default (`INGEST_UDP_PORT` defaults to `INGEST_TCP_PORT`; set
`0` to disable). Compose publishes `5027/udp`. Per-IP flood guard reuses the sliding-window limiter
(`INGEST_UDP_MAX_DGRAMS_PER_IP_PER_MIN`, default 6000).

## Scope / follow-ups

- **Codec-12 commands over UDP** are out of scope: the listener ACKs zero-persisted for non-AVL
  packets. GPRS command delivery over the connectionless channel is a follow-up (the E08-2 pending
  queue is TCP-drain today).
- Per-device ordering relies on the worker's per-shard serialization + I2/I3 (same as the TCP
  handover window) — the ingest only XADDs.

## Consequences

- UDP-configured Teltonika devices now connect with zero business-logic changes downstream.
- The refactor put both transports on one persistence path (net reduction in duplicated hot-path
  code), re-verified by the unchanged 12-test TCP suite.
