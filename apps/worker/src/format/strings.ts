import { SUPPORTED_LOCALES, type DisplayUnits, type Locale } from '@orbetra/shared'

/**
 * Every user-facing word the WORKER writes, in the four languages the product ships
 * (the five `TODO(account-settings)` markers this closes).
 *
 * The web has been fully translated since E03-2 and the outbound mail was not: a Lithuanian haulier
 * could run the dashboard in Lithuanian and miles and still get "Overspeed — Speed 95 km/h over
 * limit 90 km/h" in their inbox. The alert e-mail is the part of a tracking product a customer sees
 * most often and the part they see when something is wrong, so English-only there is not a rough
 * edge; it is the product speaking a different language exactly when it matters.
 *
 * NOT the web i18n bundle — the worker cannot import it (different app, and the bundle is loaded by
 * an HTTP fetch in the browser). But the VOCABULARY is deliberately the same: "Rida", "Prastova",
 * "Įvažiavimai" are the words already on the dashboard, so a report e-mail and the screen it came
 * from name the same thing the same way. Where the web has a translation, this file copies it rather
 * than inventing a synonym.
 *
 * A typed `Record<Locale, WorkerStrings>` over an INTERFACE, not an index signature: adding a key
 * here fails the build in three languages until they are written, which is the only mechanism that
 * has ever kept a four-language table complete.
 */

/** Unit labels are localized too — Lithuanian writes km/val and val., German Std., Polish godz. */
export interface UnitLabels {
  km: string
  mi: string
  kmh: string
  mph: string
  l: string
  gal: string
  /** hours — used by idle/engine columns and the offline alert */
  h: string
  /** volts — the symbol is SI and identical everywhere, kept here so callers never inline it */
  v: string
}

export interface WorkerStrings {
  unit: UnitLabels

  // ── alert notifications (notify/message.ts) ────────────────────────────────
  /** the alert body's first line, e.g. "Overspeed alert" */
  alertHeading: (title: string) => string
  labelDevice: string
  labelWhen: string
  /** by rule kind; an unknown kind falls back to a humanized slug (never a raw `some_kind`) */
  alertTitle: Record<string, string>
  detail: {
    overspeed: (speed: string, limit: string, u: string) => string
    lowBattery: (volts: string, threshold: string, v: string) => string
    ignition: (on: boolean) => string
    dinChange: (active: boolean) => string
    powerCut: string
    panic: string
    deviceOffline: (hours: string, threshold: string, h: string) => string
    /** transition null ⇒ the geofence name alone (an unknown/absent transition) */
    geofence: (name: string, transition: 'enter' | 'exit' | null) => string
    fuelTheft: (drop: string, baseline: string, now: string, unit: string) => string
  }
  /** the word used when a geofence event carries no name */
  geofenceFallbackName: string

  // ── scheduled reports (format/report.ts, reports/scheduledReporter.ts) ─────
  reportTitle: Record<string, string>
  /** the report body's first line, e.g. "Mileage report" */
  reportHeading: (title: string) => string
  reportSubject: (brand: string, title: string, from: string, to: string) => string
  /** the closing line: which zone the timestamps are in, and who sent this */
  reportFooter: (timezone: string, brand: string) => string
  noData: string
  col: {
    day: string
    device: string
    trips: string
    stops: string
    /** "Idle (h)" — takes the localized hours label */
    idle: (h: string) => string
    /** "Engine (h)" */
    engine: (h: string) => string
    events: string
    /** "Distance (km)" / "Distance (mi)" */
    distance: (u: string) => string
    /** "Max speed (km/h)" / "Max speed (mph)" */
    maxSpeed: (u: string) => string
    enters: string
    exits: string
    start: string
    end: string
  }
}

const EN: WorkerStrings = {
  unit: { km: 'km', mi: 'mi', kmh: 'km/h', mph: 'mph', l: 'l', gal: 'gal', h: 'h', v: 'V' },
  alertHeading: (title) => `${title} alert`,
  labelDevice: 'Device',
  labelWhen: 'When',
  alertTitle: {
    overspeed: 'Overspeed',
    low_battery: 'Low battery',
    ignition: 'Ignition',
    din_change: 'Input change',
    power_cut: 'Power cut',
    panic: 'Panic / SOS',
    device_offline: 'Device offline',
    geofence: 'Geofence',
    fuel_theft: 'Fuel theft',
  },
  detail: {
    overspeed: (s, l, u) => `Speed ${s} ${u} over limit ${l} ${u}`,
    lowBattery: (volts, threshold, v) => `Battery ${volts} ${v} below ${threshold} ${v}`,
    ignition: (on) => `Ignition turned ${on ? 'on' : 'off'}`,
    dinChange: (active) => `Digital input 1 ${active ? 'active' : 'inactive'}`,
    powerCut: 'External power lost',
    panic: 'SOS / panic button triggered',
    deviceOffline: (hours, threshold, h) => `No fix for ${hours} ${h} (threshold ${threshold} ${h})`,
    geofence: (name, t) => (t === null ? name : `${t === 'enter' ? 'entered' : 'exited'} ${name}`),
    fuelTheft: (drop, baseline, now, u) => `Fuel dropped ${drop} ${u} (baseline ${baseline} ${u}, now ${now} ${u})`,
  },
  geofenceFallbackName: 'geofence',
  reportTitle: { mileage: 'Mileage', stops: 'Stops', engine_hours: 'Engine hours', overspeed: 'Overspeed', geofence: 'Geofence', trips: 'Trips' },
  reportHeading: (title) => `${title} report`,
  reportSubject: (brand, title, from, to) => `${brand} — ${title} report (${from} to ${to})`,
  reportFooter: (tz, brand) => `All times shown in ${tz}. Generated by ${brand}.`,
  noData: '(no data in this period)',
  col: {
    day: 'Day',
    device: 'Device',
    trips: 'Trips',
    stops: 'Stops',
    idle: (h) => `Idle (${h})`,
    engine: (h) => `Engine (${h})`,
    events: 'Events',
    distance: (u) => `Distance (${u})`,
    maxSpeed: (u) => `Max speed (${u})`,
    enters: 'Enters',
    exits: 'Exits',
    start: 'Start',
    end: 'End',
  },
}

const LT: WorkerStrings = {
  unit: { km: 'km', mi: 'mi', kmh: 'km/val', mph: 'mph', l: 'l', gal: 'gal', h: 'val.', v: 'V' },
  alertHeading: (title) => `Pranešimas: ${title}`,
  labelDevice: 'Įrenginys',
  labelWhen: 'Kada',
  alertTitle: {
    overspeed: 'Greičio viršijimas',
    low_battery: 'Žema baterija',
    ignition: 'Uždegimas',
    din_change: 'Įvesties pokytis',
    power_cut: 'Maitinimo nutrūkimas',
    panic: 'Pavojaus mygtukas',
    device_offline: 'Įrenginys neprisijungęs',
    geofence: 'Geozona',
    fuel_theft: 'Kuro vagystė',
  },
  detail: {
    overspeed: (s, l, u) => `Greitis ${s} ${u}, leistina ${l} ${u}`,
    lowBattery: (volts, threshold, v) => `Baterija ${volts} ${v}, žemiau ${threshold} ${v}`,
    ignition: (on) => `Degimas ${on ? 'įjungtas' : 'išjungtas'}`,
    dinChange: (active) => `Skaitmeninė įvestis 1 ${active ? 'aktyvi' : 'neaktyvi'}`,
    powerCut: 'Dingo išorinis maitinimas',
    panic: 'Paspaustas pavojaus (SOS) mygtukas',
    deviceOffline: (hours, threshold, h) => `Nėra ryšio ${hours} ${h} (riba ${threshold} ${h})`,
    geofence: (name, t) => (t === null ? name : `${t === 'enter' ? 'įvažiavo į' : 'išvažiavo iš'} ${name}`),
    fuelTheft: (drop, baseline, now, u) => `Kuro sumažėjo ${drop} ${u} (buvo ${baseline} ${u}, dabar ${now} ${u})`,
  },
  geofenceFallbackName: 'geozona',
  reportTitle: { mileage: 'Rida', stops: 'Sustojimai', engine_hours: 'Variklio valandos', overspeed: 'Greičio viršijimai', geofence: 'Geozonos', trips: 'Kelionės' },
  // A COLON, not "<title> ataskaita": Lithuanian would need the report name in the genitive ("ridos
  // ataskaita", "kelionių ataskaita") and a template cannot decline it. The label form is correct
  // for every title, which is why all four languages use the same shape.
  reportHeading: (title) => `Ataskaita: ${title}`,
  reportSubject: (brand, title, from, to) => `${brand} — ataskaita: ${title} (${from}–${to})`,
  reportFooter: (tz, brand) => `Visas laikas rodomas ${tz} zona. Parengė ${brand}.`,
  noData: '(šiuo laikotarpiu duomenų nėra)',
  col: {
    day: 'Diena',
    device: 'Įrenginys',
    trips: 'Kelionės',
    stops: 'Sustojimai',
    idle: (h) => `Prastova (${h})`,
    engine: (h) => `Variklis (${h})`,
    events: 'Įvykiai',
    distance: (u) => `Atstumas (${u})`,
    maxSpeed: (u) => `Maks. greitis (${u})`,
    enters: 'Įvažiavimai',
    exits: 'Išvažiavimai',
    start: 'Pradžia',
    end: 'Pabaiga',
  },
}

const DE: WorkerStrings = {
  unit: { km: 'km', mi: 'mi', kmh: 'km/h', mph: 'mph', l: 'l', gal: 'gal', h: 'Std.', v: 'V' },
  alertHeading: (title) => `Meldung: ${title}`,
  labelDevice: 'Gerät',
  labelWhen: 'Zeitpunkt',
  alertTitle: {
    overspeed: 'Geschwindigkeit',
    low_battery: 'Batterie schwach',
    ignition: 'Zündung',
    din_change: 'Eingangswechsel',
    power_cut: 'Stromausfall',
    panic: 'Panik / SOS',
    device_offline: 'Gerät offline',
    geofence: 'Geofence',
    fuel_theft: 'Kraftstoffdiebstahl',
  },
  detail: {
    overspeed: (s, l, u) => `Geschwindigkeit ${s} ${u}, erlaubt ${l} ${u}`,
    lowBattery: (volts, threshold, v) => `Batterie ${volts} ${v}, unter ${threshold} ${v}`,
    ignition: (on) => `Zündung ${on ? 'ein' : 'aus'}`,
    dinChange: (active) => `Digitaleingang 1 ${active ? 'aktiv' : 'inaktiv'}`,
    powerCut: 'Externe Stromversorgung unterbrochen',
    panic: 'SOS-/Paniktaste ausgelöst',
    deviceOffline: (hours, threshold, h) => `Seit ${hours} ${h} keine Position (Schwelle ${threshold} ${h})`,
    geofence: (name, t) => (t === null ? name : `${t === 'enter' ? 'Einfahrt' : 'Ausfahrt'} ${name}`),
    fuelTheft: (drop, baseline, now, u) => `Kraftstoff um ${drop} ${u} gesunken (vorher ${baseline} ${u}, jetzt ${now} ${u})`,
  },
  geofenceFallbackName: 'Geofence',
  reportTitle: { mileage: 'Kilometer', stops: 'Stopps', engine_hours: 'Motorstunden', overspeed: 'Geschwindigkeit', geofence: 'Geofence', trips: 'Fahrten' },
  reportHeading: (title) => `Bericht: ${title}`,
  reportSubject: (brand, title, from, to) => `${brand} — Bericht: ${title} (${from} – ${to})`,
  reportFooter: (tz, brand) => `Alle Zeiten in ${tz}. Erstellt von ${brand}.`,
  noData: '(keine Daten in diesem Zeitraum)',
  col: {
    day: 'Tag',
    device: 'Gerät',
    trips: 'Fahrten',
    stops: 'Stopps',
    idle: (h) => `Leerlauf (${h})`,
    engine: (h) => `Motor (${h})`,
    events: 'Ereignisse',
    distance: (u) => `Distanz (${u})`,
    maxSpeed: (u) => `Max. Tempo (${u})`,
    enters: 'Einfahrten',
    exits: 'Ausfahrten',
    start: 'Start',
    end: 'Ende',
  },
}

const PL: WorkerStrings = {
  unit: { km: 'km', mi: 'mi', kmh: 'km/h', mph: 'mph', l: 'l', gal: 'gal', h: 'godz.', v: 'V' },
  alertHeading: (title) => `Powiadomienie: ${title}`,
  labelDevice: 'Urządzenie',
  labelWhen: 'Kiedy',
  alertTitle: {
    overspeed: 'Przekroczenie prędkości',
    low_battery: 'Niski poziom baterii',
    ignition: 'Zapłon',
    din_change: 'Zmiana wejścia',
    power_cut: 'Zanik zasilania',
    panic: 'Alarm / SOS',
    device_offline: 'Urządzenie offline',
    geofence: 'Geostrefa',
    fuel_theft: 'Kradzież paliwa',
  },
  detail: {
    overspeed: (s, l, u) => `Prędkość ${s} ${u}, limit ${l} ${u}`,
    lowBattery: (volts, threshold, v) => `Bateria ${volts} ${v}, poniżej ${threshold} ${v}`,
    ignition: (on) => `Zapłon ${on ? 'włączony' : 'wyłączony'}`,
    dinChange: (active) => `Wejście cyfrowe 1 ${active ? 'aktywne' : 'nieaktywne'}`,
    powerCut: 'Utrata zasilania zewnętrznego',
    panic: 'Uruchomiono przycisk alarmowy (SOS)',
    deviceOffline: (hours, threshold, h) => `Brak pozycji od ${hours} ${h} (próg ${threshold} ${h})`,
    geofence: (name, t) => (t === null ? name : `${t === 'enter' ? 'wjazd do' : 'wyjazd z'} ${name}`),
    fuelTheft: (drop, baseline, now, u) => `Spadek paliwa o ${drop} ${u} (było ${baseline} ${u}, jest ${now} ${u})`,
  },
  geofenceFallbackName: 'geostrefa',
  reportTitle: { mileage: 'Przebieg', stops: 'Postoje', engine_hours: 'Godziny pracy', overspeed: 'Przekroczenia prędkości', geofence: 'Geostrefy', trips: 'Trasy' },
  reportHeading: (title) => `Raport: ${title}`,
  reportSubject: (brand, title, from, to) => `${brand} — raport: ${title} (${from} – ${to})`,
  reportFooter: (tz, brand) => `Wszystkie godziny w strefie ${tz}. Wygenerowano przez ${brand}.`,
  noData: '(brak danych w tym okresie)',
  col: {
    day: 'Dzień',
    device: 'Urządzenie',
    trips: 'Trasy',
    stops: 'Postoje',
    idle: (h) => `Postój (${h})`,
    engine: (h) => `Silnik (${h})`,
    events: 'Zdarzenia',
    distance: (u) => `Dystans (${u})`,
    maxSpeed: (u) => `Maks. prędkość (${u})`,
    enters: 'Wjazdy',
    exits: 'Wyjazdy',
    start: 'Start',
    end: 'Koniec',
  },
}

const STRINGS: Record<Locale, WorkerStrings> = { en: EN, lt: LT, de: DE, pl: PL }

/**
 * Strings for a locale — anything unrecognised falls back to English.
 *
 * The argument is whatever is in `accounts.locale`, i.e. a TEXT column with no CHECK constraint (see
 * the migration): a value written by a later release, or by hand, must render an e-mail in English
 * rather than throw inside a notification path.
 */
export function stringsFor(locale: string | null | undefined): WorkerStrings {
  return (locale !== null && locale !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? STRINGS[locale as Locale] : EN)
}

/** The unit LABEL for each of the account's three unit choices, in its language. */
export function unitLabels(s: WorkerStrings, u: DisplayUnits): { distance: string; speed: string; volume: string; hours: string } {
  return {
    distance: u.distance === 'mi' ? s.unit.mi : s.unit.km,
    speed: u.speed === 'mph' ? s.unit.mph : s.unit.kmh,
    volume: u.volume === 'gal' ? s.unit.gal : s.unit.l,
    hours: s.unit.h,
  }
}
