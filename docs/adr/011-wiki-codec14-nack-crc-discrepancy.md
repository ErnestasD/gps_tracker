# ADR-011: Wiki Codec 14 nACK example has an internally inconsistent CRC

**Date:** 2026-07-04 · **Status:** accepted (flagged per CLAUDE.md header rule) · **Story:** E01-4

## Finding
The Codec 14 nACK example on https://wiki.teltonika-gps.com/view/Codec (Wayback snapshot
20260112035544) is internally inconsistent:

- Published packet: `00000000 00000010 0E 01 11 00000008 0352093081452468 01 0000 32AC`
- CRC-16/IBM over the published span (`0E…01` with IMEI `…2468`) = **0x635E**, not 0x32AC.
- CRC over the same span with the *request* example's IMEI `…2251` = **0x32AC** — exactly
  the published value.

Conclusion: the page edited the IMEI in the nACK example without recomputing the CRC.
Our CRC implementation is verified against the standard CRC-16/ARC check vector
(`"123456789"` → 0xBB3D) and against every other example on the page (Codec 8 ×3, 8E, 16,
12 ×2, 13, 14 response — all byte-exact).

## Decision
Keep the wiki hex verbatim in the corpus as a **negative fixture**: the case asserts our
parser throws `CrcError` on it (correct behavior for a corrupt packet). Do not "fix" the
hex ourselves — golden fixtures stay verbatim-from-source (CLAUDE.md rule 9).

## Follow-up
Founder may report the typo to Teltonika wiki maintainers. If the page is corrected later,
a new fixture case with the corrected CRC can be ADDED (append-only, new retrieval date).
