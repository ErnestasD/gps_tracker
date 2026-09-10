# Protocol research

Six documents, ~12,200 lines, produced 2026-09-09/10 before a single line of a new decoder was
written. They exist because hard rule 8 requires a citation for every byte offset and AVL id we act
on, and because the cheapest place to learn a protocol's traps is from the people who already hit
them.

| File | What it covers | Traps | Test vectors | Open questions | Implementable today? |
|---|---|---:|---:|---:|---|
| `ruptela.md` | Ruptela, 49 packet types | 34 | 66 | 33 | core yes; tachograph, BLE, UDP, full CAN no |
| `queclink.md` | Queclink @Track (ASCII + HEX) | 46 | 69 | 38 | ASCII yes if model-gated with no fallback; HEX no |
| `gt06.md` | GT06 / Concox-Jimi, 55 packet types | 44 | 51 | 31 | not without resolving the four width axes |
| `teltonika-codec16.md` | Codec 16 (0x10), the codec FMB6xx speaks | 34 | 16 | 19 | record layout yes; AVL dictionary no |
| `teltonika-audit.md` | our OWN Teltonika support, audited against the published surface | 49 holes (1 closed) | — | — | n/a — it is the hole list |
| `multiplier-units.md` | why the wiki's Multiplier cell means two opposite things, and which rows we decided | 11 elements / 57 rows | — | — | classes A+B fixed; C, D, E recorded, not fixed |

## How to read them

Every claim is labelled **VERIFIED** (read in a primary spec, or decoded from real bytes that
checked out), **INFERRED** (the only coherent reading of a source that does not state it outright)
or **UNKNOWN** (not settled by anything reachable). Those labels are the point. A document that
reads as uniformly confident would be more comfortable and worth much less.

**The trap lists are the most valuable sections** — each entry is a decoding bug somebody else
already shipped and fixed, with its symptom, its cause, a source URL and the test that catches it.
The open questions are the second most valuable: they are what we do not know, stated so that
nobody has to rediscover the gap at 03:00 with a customer on the phone.

One recurring theme runs through all four families and is worth internalising before writing any
decoder: **the frame is provable and the meaning is not.** Framing, lengths and CRCs can be settled
offline from a corpus, and every mistake in them fails loudly. Scaling factors, units and id
semantics cannot, and every mistake in them ships a plausible wrong number that nobody reports. Our
own Teltonika audit reached the same conclusion about our existing code: strong at the frame, weak
where the frame stops.

## Provenance and licence

Source classes, in the order the documents trust them:

1. **Vendor protocol PDFs** — cited by section, never vendored. They are not redistributable, and no
   copy of one lives in this repository. Worked examples printed inside them appear as individual
   hex frames with the section cited, which is quotation, not redistribution.
2. **Traccar** (decoders and unit tests) — Apache-2.0, reusable with attribution. Its test files are
   the richest seam we have: real frames with asserted expected values.
3. **flespi protocol pages** — parameter names and types, cited by URL.
4. **Other implementations** — read as oracles. Note the licences the documents record: some are MIT
   (safe to learn from and cite), at least one is AGPL-3.0 (read as an oracle, never copy a line).
5. **Forums, issues, captures** — cited by URL; treated as evidence, not as specification.

## Identifiers in these documents

The documents contain **69 Luhn-valid IMEIs**, all harvested from public sources: Traccar's
Apache-2.0 test corpus, public GitHub issue reports and vendor documentation examples.

On 2026-09-10 every one of them was checked against our own `devices` table: **none belongs to any
device we have ever registered.** That check is why the hex frames are committed byte-identical
rather than rewritten — a frame is covered by a CRC, and redacting the identifier inside it produces
a test vector that no longer verifies, i.e. a fixture that lies. Rule 12 exists to keep *our
customers'* identifiers out of committed fixtures, and it is satisfied here by fact, not by
assertion.

**For any capture we record ourselves, that reasoning does not apply.** Run it through
`tools/redact` first — which, until this branch, was a stub that three documents claimed existed. It
now rewrites decimal IMEIs to deterministic synthetic ones and *reports* IMEIs it finds inside hex
frames rather than corrupting them, leaving the decision with a person.

## What these documents are not

They are research, not specification. Where one contradicts a vendor document, the vendor document
wins and the contradiction is a finding worth recording (CLAUDE.md: when the plan and the wiki
conflict, the wiki wins). Where one of them is more confident than its own evidence — and at least
one is, by its own adversarial reviewer's account — the label in the text is what to trust, not the
tone.
