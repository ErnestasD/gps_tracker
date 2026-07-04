# E01-4 Plan — Codec package: parser wrap + dictionaries + golden corpus (L)

**Story:** IMPLEMENTATION_PLAN.md E01-4 · **Implements:** PROJECT_PLAN §3 entire, CLAUDE.md rules 8–9
**Status:** in progress · **Cut line:** corpus+wrapper ‖ dictionaries (per story)

## Sequence (test-first, per CLAUDE.md workflow 2)
1. **Golden fixtures FIRST** (`packages/codec/__fixtures__/wiki/*.json`): hex examples pulled
   from https://wiki.teltonika-gps.com/view/Codec verbatim (curl + manual extraction — no
   LLM transcription of hex), each fixture carries `source_url` + expected parse fields.
   Failing tests committed before implementation.
2. `crc16.ts` — CRC-16/IBM implemented independently from the wiki spec (verifies parser AND
   serves the simulator later).
3. `frame.ts` — streaming framer (per-connection instance, feed(chunk)→Frame[]), 4 KiB cap,
   handles: split mid-length-field, two packets in one read, IMEI handshake frame.
4. Parser evaluation: `complete-teltonika-parser` vs `teltonika-codec-parser` against the
   corpus; wrap winner behind Appendix A `TeltonikaCodec` interface (their types never
   exposed). Decision + rationale → `docs/adr/010-codec-parser-choice.md`. If both fail the
   corpus, hand-roll parse.ts from wiki spec (allowed fallback — spec §3 is normative).
5. `codec12.ts` — encode(cmd)/decode(response) per wiki Codec 12 section.
6. Dictionaries `dictionaries/fmb1xx.json` (+fmc, tat, fmb6xx stub) from wiki AVL ID tables,
   each entry with source_url + retrieved_at; loader validates schema; unknown IDs → `io_<id>`.
7. Property test: parse(encode(x)) ≡ x on generated records (drives encoder in, used by
   simulator later — simulator-engine ADR: TS encoder here vs Go lib, record decision).

## AC tracking (from story)
- [ ] every wiki Codec-page hex example parses byte-exact (incl. GSM=3, DIN1=1,
      ExtVoltage=0x5E0F, ActiveOperator, iButton assertions from the worked example)
- [ ] Traccar-harvested packets ≥10 with attribution header parse without throw
- [ ] Codec 8 + 8E covered; Codec 16 → raw-fallback; Codec 12 encode/decode vs wiki example
- [ ] invalid CRC → CrcError with frame attached; NumberOfData1≠2 → FrameError
- [ ] branch coverage ≥95%; property parse(encode(x))≡x
- [ ] simulator-engine ADR recorded
- [ ] edge fixtures: split mid-length, two-in-one-read, southern-hemisphere sign bit,
      timestamp window edges, zero-record packet

## NOT here
Network I/O beyond pure functions, DB writes, simulator scenarios (E02-1), ingest (E01-5).
