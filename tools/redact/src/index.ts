/**
 * @orbetra/redact — strip real IMEIs out of a capture before it becomes a committed fixture.
 *
 * CLAUDE.md hard rule 12 has named this tool since the first commit, README.md and PROJECT_PLAN.md
 * both describe it, and until now it was `export const packageName` and nothing else. It is written
 * here because the first capture corpus large enough to need it arrived: the protocol research for
 * the vendors being added carries 69 Luhn-valid IMEIs harvested from public sources.
 *
 * WHAT IT DOES, and the boundary matters more than the code:
 *
 *   * DECIMAL occurrences are rewritten. A 15-digit run that passes the Luhn check is an IMEI with
 *     overwhelming probability; one that fails it is a serial number, a timestamp in microseconds,
 *     or a coincidence, and is left alone. The replacement is deterministic (same input → same
 *     output, so one device stays one device across a corpus), keeps its length, and is itself
 *     Luhn-valid so a fixture that verifies the checksum still passes.
 *
 *   * BINARY occurrences are REPORTED, NEVER REWRITTEN. Protocols carry the IMEI inside the frame —
 *     BCD in GT06's login packet, ASCII in Teltonika's handshake — and those bytes are covered by a
 *     CRC. Rewriting them silently produces a frame that no longer verifies, which is a fixture that
 *     lies. The caller gets the offsets and decides: re-record the capture, or accept a frame whose
 *     provenance is public. Silently corrupting evidence is the one thing this tool must not do.
 *
 * The synthetic IMEIs use TAC 35000000, which is assigned but whose serial range here is generated,
 * so a redacted value never collides with a device anyone actually owns and reads as obviously fake
 * to a human scanning a fixture.
 */
export const packageName = '@orbetra/redact'

/** Luhn over a digit string — the check every real IMEI satisfies and most 15-digit numbers do not. */
export function isLuhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** The check digit that makes a 14-digit body a valid IMEI. */
function checkDigit(body14: string): number {
  let sum = 0
  for (let i = 0; i < body14.length; i++) {
    let d = body14.charCodeAt(body14.length - 1 - i) - 48
    if (i % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return (10 - (sum % 10)) % 10
}

/**
 * A stable pseudonym for one IMEI. FNV-1a rather than a crypto hash on purpose: this is not a
 * privacy boundary — the mapping is one-way only in the sense that nobody keeps the table — it is a
 * consistency device, so a capture that mentions the same device forty times still describes one
 * device afterwards.
 */
export function pseudonymFor(imei: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < imei.length; i++) {
    h ^= imei.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const serial = String(h % 1_000_000).padStart(6, '0')
  const body = `35000000${serial}` // TAC 35000000 + generated serial = 14 digits
  return `${body}${checkDigit(body)}`
}

export interface RedactionReport {
  /** the text with every decimal IMEI replaced */
  text: string
  /** original → pseudonym, so a human can re-read their own capture if they still hold the original */
  replaced: Map<string, string>
  /** IMEIs found INSIDE hex blobs: rewriting them would break the frame's CRC, so they are only reported */
  inFrame: { imei: string; encoding: 'bcd' | 'ascii'; context: string }[]
}

const IMEI_RE = /\b\d{15}\b/g
/** long-enough hex runs to plausibly be a frame rather than a colour or a hash fragment */
const HEX_RE = /\b[0-9a-fA-F]{24,}\b/g

/**
 * Find an IMEI hiding inside a hex blob. Two encodings cover every protocol in this repo's roadmap:
 * BCD (each byte holds two digits — GT06, JT808) and ASCII (Teltonika's handshake sends the digits
 * as text). Both are searched at every offset because the frame header length varies by protocol,
 * and a false positive here costs a human ten seconds while a false negative costs a leak.
 */
function imeisInHex(hex: string): { imei: string; encoding: 'bcd' | 'ascii' }[] {
  const out: { imei: string; encoding: 'bcd' | 'ascii' }[] = []
  const seen = new Set<string>()
  const push = (imei: string, encoding: 'bcd' | 'ascii') => {
    if (isLuhnValid(imei) && !seen.has(imei + encoding)) {
      seen.add(imei + encoding)
      out.push({ imei, encoding })
    }
  }
  // BCD: the digits ARE the hex characters. The window SLIDES — a first draft used
  // `hex.match(/\d{15}/g)`, which takes non-overlapping matches from the left and therefore misses
  // any IMEI that does not begin exactly where a digit run begins. In a GT06 login the run starts
  // one nibble early, so that version reported nothing at all on the one frame it exists for.
  for (const run of hex.match(/\d{15,}/g) ?? []) {
    for (let i = 0; i + 15 <= run.length; i++) push(run.slice(i, i + 15), 'bcd')
  }
  // ASCII: every pair of hex chars is a byte; a run of 15 digit-bytes (0x30-0x39) is the IMEI as text
  const bytes = hex.match(/../g) ?? []
  let run = ''
  for (const b of bytes) {
    const v = parseInt(b, 16)
    if (v >= 0x30 && v <= 0x39) {
      run += String.fromCharCode(v)
      if (run.length === 15) {
        push(run, 'ascii')
        run = run.slice(1)
      }
    } else {
      run = ''
    }
  }
  return out
}

/**
 * Redact one text. Pure: it reads nothing and writes nothing, so it is the same function whether it
 * is called by the CLI, by a test, or by a future capture pipeline.
 */
export function redact(text: string): RedactionReport {
  const replaced = new Map<string, string>()
  const inFrame: RedactionReport['inFrame'] = []

  for (const hex of text.match(HEX_RE) ?? []) {
    for (const hit of imeisInHex(hex)) {
      inFrame.push({ ...hit, context: hex.length > 48 ? `${hex.slice(0, 48)}…` : hex })
    }
  }

  const out = text.replace(IMEI_RE, (m, offset: number) => {
    // a 15-digit run that sits inside a hex blob is frame content, not prose — leave the bytes alone
    const before = text.slice(Math.max(0, offset - 8), offset)
    const after = text.slice(offset + 15, offset + 23)
    if (/[0-9a-fA-F]{8}$/.test(before) || /^[0-9a-fA-F]{8}/.test(after)) return m
    if (!isLuhnValid(m)) return m
    const p = pseudonymFor(m)
    replaced.set(m, p)
    return p
  })

  return { text: out, replaced, inFrame }
}
