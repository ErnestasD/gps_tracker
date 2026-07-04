# ADR-013: ParsedPacket contract extension (Appendix A)

**Date:** 2026-07-04 · **Status:** accepted · **Story:** E01-4 (adversarial review finding)

## Context
IMPLEMENTATION_PLAN Appendix A froze `ParsedPacket` as:
`{ kind:'imei' } | { kind:'avl'; codec: 8|0x8e|16; records } | { kind:'cmdResponse'; text }`.
Implementation needs three additions the frozen shape lacks:
- `cmdResponse.codec: 12|13|14` — `decodeCodec12` must reject a Codec 13/14 frame
  masquerading as a command response; without the discriminator the check is impossible.
- `cmdResponse.nack?: boolean` — Codec 14 nACK (type 0x11) carries no text; callers must
  distinguish "empty response" from "device refused".
- `avl.rawFallback?: boolean` — marks Codec 16 packets that passed CRC/framing but were
  not field-decoded (v1 contract, PROJECT_PLAN §3.1); callers read `frame.bytes` for payload.

The adversarial review correctly flagged that this was shipped without the ADR Appendix A
requires. This ADR records it; IMPLEMENTATION_PLAN Appendix A is updated in the same commit.

## Decision
Extend the contract with the three fields above (all additive — no existing field changed,
so consumers coded against the old shape keep compiling). Appendix A in IMPLEMENTATION_PLAN
now shows the extended union and points here.

## Consequences
- E01-5 ingest and E08-2 command dispatcher can rely on `codec`/`nack` discriminators.
- Any future Appendix A change follows this same path: ADR + same-commit plan update,
  serial lane only (Appendix D).
