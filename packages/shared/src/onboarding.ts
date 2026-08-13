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
  /** device profile key, for display. FMB/FMC share the 2004/2005 params. */
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

export function buildOnboarding(input: OnboardingInput): OnboardingSheet {
  // NO fallback host. It used to be `'orbetra.com'`, so a deployment that never set
  // INGEST_PUBLIC_HOST told a reseller's installer to point their customer's hardware at OUR
  // domain — and that string is then written INTO the tracker, where any technician servicing the
  // vehicle reads it back. An unset host now yields `null` commands, which the sheet renders as a
  // visible gap and the send route refuses; a missing configuration must look missing.
  const host = SAFE_HOST.test(input.host) ? input.host : null
  const port = Number.isInteger(input.port) && input.port > 0 && input.port < 65536 ? input.port : 5027
  // empty login + password → two leading spaces (Teltonika SMS contract). 2006:0 = protocol TCP
  // (our ingest is TCP-only); the APN password (2003) is deliberately left untouched.
  const smsServer = host === null ? null : `  setparam 2004:${host};2005:${port};2006:0`
  const apn = input.apn?.trim()
  // reject any APN carrying a separator/space (';'/':' would inject a second setparam) — drop to
  // null on a bad value, exactly as host falls back; the {1,63} bound also caps length server-side
  const apnSafe = apn !== undefined && apn !== '' && SAFE_APN.test(apn) ? apn : null
  const smsApn = apnSafe !== null ? `  setparam 2001:${apnSafe}` : null
  // combined single SMS for the automated gateway: prepend the APN param (2001) to the server
  // triplet in ONE setparam when an APN is given — ~55 chars, well under one 160-char segment.
  const smsAuto = host === null ? null : `  setparam ${apnSafe !== null ? `2001:${apnSafe};` : ''}2004:${host};2005:${port};2006:0`

  const familyCaveat = input.legacyProfile ?? true
  const steps = [
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
