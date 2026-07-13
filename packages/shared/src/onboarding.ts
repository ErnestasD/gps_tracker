/**
 * Device onboarding config generator (V1-nice) — the SMS path to point a Teltonika device
 * at our server WITHOUT any Teltonika software (cloud FOTA WEB is gold-partner-only).
 *
 * FMB/FMC SMS command syntax (https://wiki.teltonika-gps.com/view/FMB_SMS/GPRS_Commands):
 * `<login> <password> <command>`. Default login+password are EMPTY, so the payload begins
 * with two spaces. Server parameters (FMB120 Data Sending Parameters ID wiki):
 *   2004 Domain (server host) · 2005 Port · 2003 Server protocol (0=TCP,1=UDP)
 *   2001 APN name · 2002 APN username · 2003(x) APN password  (APN is carrier-specific).
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
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
  /** device profile family key (fmb1xx/fmc/tat-asset). FMB/FMC share the 2004/2005 params;
   * an unknown family still gets the FMB syntax + a caveat. */
  family?: string
}

export interface OnboardingSheet {
  imei: string
  host: string
  port: number
  /** the SMS that points the device at our server (empty login+password prefix). */
  smsServer: string
  /** the SMS that sets the carrier APN — only when an apn was given. */
  smsApn: string | null
  /** short operator checklist. */
  steps: string[]
  /** true when the family isn't a known FMB/FMC — the params may differ. */
  familyCaveat: boolean
}

const KNOWN_FAMILIES = new Set(['fmb1xx', 'fmc', 'fmb6xx-stub'])
// printable-ASCII, no ';' or ':' in the host (they are the SMS field separators)
const SAFE_HOST = /^[a-zA-Z0-9.-]{1,253}$/

export function buildOnboarding(input: OnboardingInput): OnboardingSheet {
  const host = SAFE_HOST.test(input.host) ? input.host : 'orbetra.com'
  const port = Number.isInteger(input.port) && input.port > 0 && input.port < 65536 ? input.port : 5027
  // empty login + password → two leading spaces (Teltonika SMS contract)
  const smsServer = `  setparam 2004:${host};2005:${port};2003:0`
  const apn = input.apn?.trim()
  const smsApn = apn !== undefined && apn !== '' && /^[\x20-\x7e]+$/.test(apn) ? `  setparam 2001:${apn}` : null

  const familyCaveat = input.family !== undefined && !KNOWN_FAMILIES.has(input.family)
  const steps = [
    'Insert a working data SIM into the tracker and power it on.',
    smsApn !== null
      ? 'Send the APN SMS below to the tracker’s phone number, wait ~30 s.'
      : 'Set the carrier APN on the tracker (ask your SIM provider for the APN).',
    'Send the server SMS below to the tracker’s phone number.',
    'Within ~1 minute the device connects and appears online here — then manage it fully from the Commands panel (no more SMS).',
  ]
  if (familyCaveat) steps.push('NOTE: this device family may use different parameters — verify against the Teltonika wiki for your model.')

  return { imei: input.imei, host, port, smsServer, smsApn, steps, familyCaveat }
}
