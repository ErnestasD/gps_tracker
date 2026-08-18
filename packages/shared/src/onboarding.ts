/**
 * Device onboarding config generator (V1-nice) — the SMS path to point a Teltonika device
 * at our server WITHOUT any Teltonika software (cloud FOTA WEB is gold-partner-only).
 *
 * FMB/FMC SMS command syntax (https://wiki.teltonika-gps.com/view/FMB_SMS/GPRS_Commands):
 * `<login> <password> <command>`. Default login+password are EMPTY, so the payload begins
 * with two spaces. Parameter IDs (FMB120 Data Sending Parameters ID wiki):
 *   2001 APN name · 2002 APN username · 2003 APN password  (the APN triplet, carrier-specific)
 *   2004 Domain (server host) · 2005 Port · 2006 Server protocol (0=TCP,1=UDP)
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 * NB: 2003 is the APN PASSWORD, not the protocol — an earlier draft's `2003:0` silently set
 * the APN password to "0". Protocol is 2006; our ingest is TCP-only (apps/ingest) so we set
 * 2006:0 explicitly and never touch the APN password.
 *
 * PURE — no I/O, no secrets. `host`/`port` come from config; `apn` is operator-entered
 * (we cannot know the SIM carrier's APN).
 */
export interface OnboardingInput {
  imei: string
  host: string
  port: number
  /** carrier APN (optional — the SMS omits the APN command when absent). */
  apn?: string
  /**
   * Device profile key (e.g. `ftc887`, `fmc150`). Displayed, and — since it is the only thing here
   * that identifies the hardware — it selects the SMS command PREFIX. See `smsPrefixFor`.
   */
  family?: string
  /**
   * The profile is a legacy FAMILY row (`fmb1xx`, `fmc`, `fmb6xx-stub`, `tat-asset`) rather than one
   * of the catalogued per-MODEL profiles — i.e. we do not know which hardware this actually is.
   *
   * This is what the caveat is for, and keying it on a NAME got it backwards. `KNOWN_FAMILIES` held
   * the three legacy keys, which are exactly the ones the picker no longer offers, so every device
   * created through today's 105-model picker was told "this device family may use different
   * parameters — verify against the Teltonika wiki". A warning on 100% of devices carries no
   * information, and it made the genuinely-unknown case indistinguishable from a plain FMB120 whose
   * commands the generator derived from that model's own wiki page. Defaults to true when the
   * caller does not say, because "unknown" is the safe side of this.
   */
  legacyProfile?: boolean
  /** the platform can send this SMS itself (gateway configured AND the plan allows it AND a SIM
   *  number is saved) — the steps then say "press Send" instead of "send it yourself". */
  canSend?: boolean
}

export interface OnboardingSheet {
  imei: string
  /** null ⇒ INGEST_PUBLIC_HOST is not configured for this deployment; the commands are null too. */
  host: string | null
  port: number
  /** the SMS that points the device at our server (empty login+password prefix). null when unset. */
  smsServer: string | null
  /** the SMS that sets the carrier APN — only when an apn was given. */
  smsApn: string | null
  /** the ONE SMS the automated gateway actually sends: APN (when given) + server params combined
   * in a single setparam, so a device with no auto-APN gets data AND the server address at once
   * (one charge, atomic). Falls back to server-only when no APN. Prefer this for programmatic sends;
   * smsServer/smsApn stay split for the manual copy-paste sheet. null when the host is unset. */
  smsAuto: string | null
  /** short operator checklist. */
  steps: string[]
  /** true when the family isn't a known FMB/FMC — the params may differ. */
  familyCaveat: boolean
}

// host and APN both land in a ';'/':' -separated setparam string, so NEITHER may contain those
// separators (or spaces) — else a crafted value injects extra params (e.g. redirect the device
// to another server, rewrite the APN password). Both are constrained to hostname/APN charsets.
const SAFE_HOST = /^[a-zA-Z0-9.-]{1,253}$/
const SAFE_APN = /^[a-zA-Z0-9._-]{1,63}$/

/**
 * The FT / "Fast & Easy" platform: FTC*, FTM*, ATC*, ATM*. 25 of the 105 catalogued models.
 *
 * Teltonika documents these on a differently-NAMED page (`<model>_SMS/GPRS_Command_List`, versus
 * `<model>_SMS/GPRS_Commands` for everything else), and the difference is not cosmetic — the
 * command prefix differs. See `smsPrefixFor`.
 */
const FT_PLATFORM = /^(?:ftc|ftm|atc|atm)/i

/**
 * FTC and FTM models ship with their own position hidden, and the config SMS turns that off.
 *
 * Parameter 11813 "GPS data masking" defaults to `1` — "GNSS data sent as zero" — and it applies in
 * the device's Private mode, which these models cannot leave: switching needs a DIN input FTC887
 * does not physically have, and the weekly Business window is factory-set to 00:00–00:00, i.e.
 * empty. So a brand-new tracker, correctly onboarded, transmits zeros for position, satellite count
 * AND the GNSS date, forever.
 *
 * That is indistinguishable from a tracker that cannot see the sky, and it cost most of a day on
 * real hardware: the device reported `GNSS Status 2` (on, searching), `satellites 0`, HDOP/PDOP
 * 1000 and `Date:1970-01-01` for eight hours on a windowsill. Setting 11813 to 0 produced 16
 * satellites and a valid Vilnius fix in the same minute — the receiver had been tracking all along.
 * The customer would blame us, and from where they stand they would be right to.
 *
 * Founder decision 2026-08-18: masked position contradicts the purpose of a fleet-tracking
 * platform, so we clear it at onboarding rather than leaving each customer to discover it. The
 * command is visible in the sheet, so this is disclosed, not silent. A fleet that genuinely needs
 * private/business trips configures it deliberately afterwards.
 *
 * NOT the whole FT family: ATC and ATM have no parameter 11813 (checked against ATC700's list), and
 * naming an id a model does not have risks the device rejecting the entire setparam. Verified
 * present with default 1 on FTC881, FTC887, FTC921 and FTM134; absent on FMB120 and FMC150.
 * https://wiki.teltonika-gps.com/view/FTC887_Parameter_List
 */
const MASKS_ITS_OWN_POSITION = /^(?:ftc|ftm)/i
const UNMASK = ';11813:0'

/**
 * The leading whitespace that stands in for an unset SMS password — ONE space or TWO, by platform.
 *
 * This is the whole config SMS. Get it wrong and the device receives a perfectly deliverable
 * message, parses nothing, replies nothing, and simply never connects — indistinguishable at the
 * server from a dead SIM, a wrong APN or a device that was never powered on. It cost a real
 * hardware session on an FTC887: Twilio reported `delivered`, the tracker's lights were on, and
 * ingest saw not one TCP SYN in 90 seconds.
 *
 * FMB-generation firmware parses `<SMS login><space><SMS password><space><command>`, so with the
 * factory-empty login AND password the message begins with TWO spaces:
 *   https://wiki.teltonika-gps.com/view/FMB120_SMS/GPRS_Commands
 *   — "If SMS login and password are not set leave two spaces before command"
 *
 * The FT platform parses `<password><space><command>` — there is no separate login field, so an
 * unset password means ONE space:
 *   https://wiki.teltonika-gps.com/view/FTC887_SMS/GPRS_Command_List
 *   — "Before every SMS command, enter the password OR a whitespace (when the password is not set)"
 *   — example given: `getinfo` with no password is sent as " getinfo"
 *
 * Checked against both wikis for FTC134 / FTC881 / FTC887 / FTM134 / ATC700 / ATM700 (one space)
 * and FMB120 / TAT100 / TAT240 / GH5200 / TST100 / TMT250 / MSP500 / MTB100 / TFT100 (two).
 *
 * An unknown or legacy family gets TWO — the FMB reading — because that is what the other 80
 * models take and what every device created before the per-model picker used.
 */
export function smsPrefixFor(family: string | undefined): '  ' | ' ' {
  return family !== undefined && FT_PLATFORM.test(family.trim()) ? ' ' : '  '
}

export function buildOnboarding(input: OnboardingInput): OnboardingSheet {
  // NO fallback host. It used to be `'orbetra.com'`, so a deployment that never set
  // INGEST_PUBLIC_HOST told a reseller's installer to point their customer's hardware at OUR
  // domain — and that string is then written INTO the tracker, where any technician servicing the
  // vehicle reads it back. An unset host now yields `null` commands, which the sheet renders as a
  // visible gap and the send route refuses; a missing configuration must look missing.
  const host = SAFE_HOST.test(input.host) ? input.host : null
  const port = Number.isInteger(input.port) && input.port > 0 && input.port < 65536 ? input.port : 5027
  // the unset-password prefix, ONE space or TWO depending on the platform (smsPrefixFor).
  // 2006:0 = protocol TCP (our ingest is TCP-only); the APN password (2003) is left untouched.
  // The parameter IDs themselves are shared: FTC887's own Parameter List documents 2001 APN,
  // 2004 Domain, 2005 Port, 2006 Data protocol (0 – TCP) exactly as FMB120 does.
  // https://wiki.teltonika-gps.com/view/FTC887_Parameter_List
  const prefix = smsPrefixFor(input.family)
  // …and, on the models that ship with their position masked, the parameter that unmasks it. It
  // rides on the SERVER command rather than the APN one because it belongs to "make this tracker
  // report to us", and because that is the command an operator copy-pastes when sending by hand —
  // leaving it off there would reproduce the whole failure for anyone not using the button.
  const unmask = input.family !== undefined && MASKS_ITS_OWN_POSITION.test(input.family.trim()) ? UNMASK : ''
  const smsServer = host === null ? null : `${prefix}setparam 2004:${host};2005:${port};2006:0${unmask}`
  const apn = input.apn?.trim()
  // reject any APN carrying a separator/space (';'/':' would inject a second setparam) — drop to
  // null on a bad value, exactly as host falls back; the {1,63} bound also caps length server-side
  const apnSafe = apn !== undefined && apn !== '' && SAFE_APN.test(apn) ? apn : null
  const smsApn = apnSafe !== null ? `${prefix}setparam 2001:${apnSafe}` : null
  // combined single SMS for the automated gateway: prepend the APN param (2001) to the server
  // triplet in ONE setparam when an APN is given — ~55 chars, well under one 160-char segment.
  const smsAuto = host === null ? null : `${prefix}setparam ${apnSafe !== null ? `2001:${apnSafe};` : ''}2004:${host};2005:${port};2006:0${unmask}`

  const familyCaveat = input.legacyProfile ?? true
  /**
   * The steps change when WE can send the SMS, because otherwise the sheet tells a customer to do
   * by hand something the platform will do for them — the copy-paste commands stay below either
   * way, as a fallback and as the record of what was sent.
   *
   * This is the first minute anyone spends with the product. "Type this setparam string into an
   * SMS" is where they are lost, and it was being printed even on deployments with a working SMS
   * gateway and a saved SIM number.
   */
  const steps = input.canSend === true
    ? [
        'Insert a working data SIM into the tracker and power it on.',
        'Save the tracker’s SIM phone number above.',
        'Press “Send config SMS” — we send the APN and server settings to the device for you.',
        'Within ~1 minute the device connects and appears online here — then manage it fully from the Commands panel (no more SMS).',
      ]
    : [
        'Insert a working data SIM into the tracker and power it on.',
        smsApn !== null
          ? 'Send the APN SMS below to the tracker’s phone number, wait ~30 s.'
          : 'Set the carrier APN on the tracker (ask your SIM provider for the APN).',
        'Send the server SMS below to the tracker’s phone number.',
        'Within ~1 minute the device connects and appears online here — then manage it fully from the Commands panel (no more SMS).',
      ]
  if (familyCaveat) steps.push('NOTE: this device family may use different parameters — verify against the Teltonika wiki for your model.')

  return { imei: input.imei, host, port, smsServer, smsApn, smsAuto, steps, familyCaveat }
}
