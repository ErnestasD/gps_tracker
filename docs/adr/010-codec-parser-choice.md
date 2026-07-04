# ADR-010: Codec parser — wrap complete-teltonika-parser (ISC)

**Date:** 2026-07-04 · **Status:** accepted · **Story:** E01-4

## Context
E01-4 mandates evaluating `complete-teltonika-parser` vs `teltonika-codec-parser` against
the wiki golden corpus, wrapping the winner behind the Appendix A `TeltonikaCodec` interface.

## Evaluation (2026-07-04, scratchpad, both latest npm versions)
`complete-teltonika-parser@0.3.6` (ISC):
- Codec 8 wiki example 1: byte-exact decode — GSM(21)=3, DIN1(1)=1, ExtVoltage(66)=0x5E0F,
  ActiveOperator(241)=0x601A, iButton(78)=0, ts 2019-06-10T10:04:46Z, CRC verified. ✓
- Codec 8E wiki example: ICCID1/2 (8-byte) exact; 8-byte values returned as decimal strings
  via BigInt — no Number precision loss (verified with synthetic 2^64−1 value). ✓
- Negative coordinates (two's complement): exact to 1e-7. ✓
- Codec 12 response decode ✓ · corrupt CRC → throws ✓
- Codec 16: THROWS on the official wiki example — unsupported in practice. (Acceptable:
  our v1 contract for 16 is raw-fallback, PROJECT_PLAN §3.1.)

`teltonika-codec-parser`: constructor API unclear (`invalid Codec parameter value` on the
canonical example with documented usage); abandoned evaluation after complete-teltonika-parser
passed everything relevant.

## Decision
Runtime dependency of `packages/codec` ONLY: `complete-teltonika-parser@0.3.6` (pinned exact),
used for Codec 8/8E field decode and Codec 12/13/14 payload decode. Never exposed outside
the wrapper. In-house (from wiki spec): CRC-16/IBM (independent verification + simulator),
streaming framer, structural record-boundary walker (per-record `raw` bytes for rec_hash I3;
also cross-checks the lib's record count), Codec 12 encode, Codec 16 raw-fallback,
IMEI handshake + ACK encoding.

## Consequences
- Lib bugs are contained: CRC and structure are verified independently before the lib runs;
  disagreement throws rather than trusting either side.
- Codec 16 full decode deferred until an FMB6xx story needs it (walker already scans 16-bit
  ID layout; only field mapping is missing).
- Version bumps of the parser require re-running the golden corpus (CI does this by default).
