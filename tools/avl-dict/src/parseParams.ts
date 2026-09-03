/**
 * Parser for a Teltonika `<MODEL>_Parameter_List` page — the CONFIGURABLE parameters, as opposed to
 * the AVL elements parsed by parse.ts.
 *
 * Kept apart from the SMS/onboarding code on purpose: this reads bounds we are about to expose to a
 * customer, and a wrong bound is worse than a missing one. An id absent from a model's page is a
 * fact we record, never a gap we fill from a sibling model.
 */

/** One parameter row as the wiki states it. Strings, because the page states them as strings. */
export interface ParamRange {
  default: string
  min: string
  max: string
  /** The wiki's own name for the parameter — kept so a reviewer can spot a mis-mapped id. */
  name: string
  /**
   * The wiki's `Value` legend cell, verbatim — the ONLY place the corpus states a unit.
   *
   * Dropping it hid a real disagreement: FMB640, FMC650 and FMM650 label parameter 10053 (speed
   * change) "Seconds" while the FT pages treat it as a speed delta. A unit we cannot state from the
   * source is a unit we must not print under a customer's slider, which is why 10053 is not offered
   * at all (see EDITABLE_PARAMS) and why every offered unit is asserted against this string.
   */
  value: string
}

export interface ModelParams {
  sourceUrl: string
  params: Record<string, ParamRange>
  /**
   * CAN elements this model can be told to send, as `<first id of the block> → element name`.
   *
   * Separate from `params` because they are a different KIND of setting. A CAN element is not one
   * parameter but a block of six consecutive ids — priority, operand, high level, low level, event
   * only, avg const — laid out every ten from 45100. Only the first (priority) decides whether the
   * element is transmitted at all: 0 sends nothing, 1–3 send it. Blocks are the unit a customer
   * thinks in ("send me the fuel level"), so blocks are what we store.
   *
   * This is the answer to "why does a working CAN bus report six parameters": the device ships with
   * every block at 0, and nothing in our onboarding ever raised one.
   */
  canElements: Record<string, string>
}

/**
 * The parameters a customer may change, and nothing else.
 *
 * Deliberately excluded, because a customer can strand their own device with them and only an SMS
 * (which costs us money and needs the modem reachable) can undo it:
 *   2001-2003 APN triplet · 2004 domain · 2005 port · 2006 protocol — point the tracker elsewhere
 *   102 power saving — deep sleep takes the modem down, so no GPRS command can ever reach it again
 *   11813 GPS data masking — the platform clears it at onboarding; re-enabling it hides the fleet
 *
 * The roaming sets (10100/1015x) are also excluded. Their send period defaults to 0 — "do not send
 * while roaming" — which is Teltonika protecting the customer from roaming data bills, and it is
 * not ours to overwrite from a slider labelled "update frequency".
 */
export const EDITABLE_PARAMS: Record<string, { key: string; unit: 'seconds' | 'metres' | 'degrees'; group: 'moving' | 'parked'; profile: 'home' }> = {
  '10050': { key: 'movingByTime', unit: 'seconds', group: 'moving', profile: 'home' },
  '10051': { key: 'movingByDistance', unit: 'metres', group: 'moving', profile: 'home' },
  '10052': { key: 'movingByAngle', unit: 'degrees', group: 'moving', profile: 'home' },
  '10055': { key: 'movingSendPeriod', unit: 'seconds', group: 'moving', profile: 'home' },
  '10000': { key: 'parkedByTime', unit: 'seconds', group: 'parked', profile: 'home' },
  '10005': { key: 'parkedSendPeriod', unit: 'seconds', group: 'parked', profile: 'home' },
}

/**
 * Collected but NOT offered — recorded so the artefact tells the truth about what a device is
 * actually running, and so the follow-up that exposes them starts from data rather than a guess.
 *
 * The four ids above are the HOME-network profile. A device whose current operator is not in its
 * roaming list falls into the UNKNOWN profile instead, and both the roaming and unknown send
 * periods ship as `0` on most models — Teltonika protecting the customer from roaming data bills.
 * The consequence is severe and non-obvious: a cross-border truck can be configured through our
 * slider to "send every 2 s" while the profile it is actually using transmits nothing at all, which
 * is precisely the silent-recording failure of 2026-08-18 wearing a different hat.
 *
 * Offering these needs a deliberate product decision about who pays for roaming data, so this slice
 * records them and the settings UI states which profile it writes.
 * https://wiki.teltonika-gps.com/view/FMB120_Data_acquisition_settings
 */
export const OBSERVED_PARAMS: Record<string, { profile: 'roaming' | 'unknown'; mirrors: string }> = {
  '10100': { profile: 'roaming', mirrors: '10000' },
  '10105': { profile: 'roaming', mirrors: '10005' },
  '10150': { profile: 'roaming', mirrors: '10050' },
  '10155': { profile: 'roaming', mirrors: '10055' },
  '10200': { profile: 'unknown', mirrors: '10000' },
  '10205': { profile: 'unknown', mirrors: '10005' },
  '10250': { profile: 'unknown', mirrors: '10050' },
  '10255': { profile: 'unknown', mirrors: '10055' },
}

/** Every id the generator gathers: what we may offer, plus what we must be honest about. */
export const COLLECTED_PARAMS: Record<string, unknown> = { ...EDITABLE_PARAMS, ...OBSERVED_PARAMS }

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** A bound is only usable if it is a plain integer — `""` (a string parameter) or a footnote is not. */
const isInteger = (s: string): boolean => /^-?\d+$/.test(s)

export function parseParameterList(
  html: string,
): { params: Record<string, ParamRange>; canElements: Record<string, string>; warnings: string[] } {
  const params: Record<string, ParamRange> = {}
  const warnings: string[] = []
  const body = html.slice(Math.max(0, html.indexOf('mw-parser-output')))
  const canElements = parseCanElements(body)

  for (const row of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(stripTags)
    const id = cells[0]
    if (id === undefined || !Object.hasOwn(COLLECTED_PARAMS, id)) continue
    // [id, type, default, min, max, value-legend, name] — SIX is the minimum that carries a legend.
    // At exactly five, `cells[length-1]` IS the max, so a five-cell row would record the bound as
    // the parameter's name and read as a successful parse.
    if (cells.length < 6) { warnings.push(`parameter ${id}: only ${cells.length} cells, bounds unreadable`); continue }
    const [, , dflt = '', min = '', max = '', value = ''] = cells
    if (!isInteger(dflt) || !isInteger(min) || !isInteger(max)) {
      warnings.push(`parameter ${id}: non-numeric bounds (default=${dflt} min=${min} max=${max})`)
      continue
    }
    if (Number(min) > Number(max)) { warnings.push(`parameter ${id}: min ${min} > max ${max}`); continue }
    // Some pages (GH5200, TFT100, TMT250, TST100) trail the row with a rowspanned GROUP label, so
    // the last cell is "Home" rather than the parameter name. The name is one column after the
    // legend; fall back to the last cell only when the row is the plain seven-column shape.
    const name = cells[6] ?? cells[cells.length - 1] ?? ''
    const existing = params[id]
    if (existing !== undefined) {
      if (existing.min !== min || existing.max !== max) {
        // NARROWEST wins, not first-seen: a bound we are about to offer a customer must be one
        // BOTH tables agree the device accepts.
        warnings.push(`parameter ${id}: appears twice with different bounds (${existing.min}..${existing.max} vs ${min}..${max}) — kept the intersection`)
        params[id] = {
          ...existing,
          min: String(Math.max(Number(existing.min), Number(min))),
          max: String(Math.min(Number(existing.max), Number(max))),
        }
      }
      continue
    }
    params[id] = { default: dflt, min, max, name, value }
  }
  return { params, canElements, warnings }
}

/**
 * CAN element blocks, read from the LVCAN section's own layout rather than from a hand-written list.
 *
 * The page renders each element as its NAME followed by the block's six ids. Matching that shape —
 * a `45<block>0` id whose next five cells are also 45xxx — is what makes this survive Teltonika
 * renaming or reordering elements: a hardcoded id list would silently stop matching and we would
 * ship a settings screen missing whatever they moved.
 *
 * The block ids advance by TEN while a block spans six, so 45106..45109 are unused padding. Only
 * `45<block>0` is collected: it is the priority, and the priority is the on/off switch.
 * https://wiki.teltonika-gps.com/view/FMC150_Parameter_list (LVCAN section)
 */
function parseCanElements(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  // tags become SEPARATORS here, unlike `stripTags` which deletes them: this parser reads the
  // sequence of cells, so "</td><td>" has to end one cell and start the next rather than glue them
  const cells = body
    .replace(/<[^>]+>/g, '\n')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  for (const [i, cell] of cells.entries()) {
    if (!/^45[1-9]\d0$/.test(cell) || Object.hasOwn(out, cell)) continue
    const rest = cells.slice(i + 1, i + 6)
    if (rest.length < 5 || !rest.every((x) => /^45\d{3}$/.test(x))) continue
    const name = cells[i - 1]
    // a name that is itself an id means we matched a bare id column, not an element row
    if (name === undefined || /^45\d{3}$/.test(name)) continue
    out[cell] = name
  }
  return out
}
