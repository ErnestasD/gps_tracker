import { cityFor, type DemoCity } from "@/lib/demo-geo";

/**
 * WHO the demo fleet is, in the city it drives in.
 *
 * `demo-geo` moved the vans: a Polish visitor now watches them circle Warsaw rather than Vilnius.
 * The people, plates, depots and paperwork did not move with them, so the Warsaw map came with
 * drivers called Jonas Petrauskas holding `LT8451234` licences, a depot named "STL bazė" and a
 * `+370` phone column. A fleet in Warsaw staffed entirely by Lithuanians with Lithuanian licences
 * is not a localisation detail — it is the demo telling a Polish prospect that this product was
 * built for somebody else, which is the exact thing moving the map was meant to stop saying.
 *
 * Two axes decide each field, and they are NOT the same axis:
 *   - the CITY decides what is physically there — people's names, plate shapes, licence and phone
 *     formats, the towns on a route. A Warsaw fleet has Polish drivers whichever language the
 *     interface happens to be in, so the English record carries Warsaw's people, not England's.
 *   - the LANGUAGE decides the words the operator typed — zone names, account names, the company's
 *     own name. An English-speaking operator running a Warsaw fleet writes "Warsaw depot", not
 *     "Baza Warszawa".
 * That is why `en` is not simply `pl` with a different label: it is Warsaw's fleet, named in
 * English. Four complete records rather than a merge — this is fixture data, and a reader
 * checking whether the German demo is right should be able to read the German record.
 *
 * Zone names are deliberately FUNCTIONAL ("Warsaw depot", "Loading yard") rather than named after
 * real districts. The zones are anchored to fractions of a routed loop, so which district sits
 * under one depends on geometry — and a zone confidently labelled "Mokotów" that is drawn over
 * Wola is a worse lie than a generic name, told specifically to the locals we are selling to.
 */
export interface DemoContent {
  /** the operator the demo tenant plays, as it appears in the sidebar and branding */
  company: string;
  /** the same operator with its legal form, for invoices and the account picker */
  companyLegal: string;
  /** the two fleet sub-accounts a TSP-shaped tenant would have */
  accounts: [string, string];
  /** name pools — every generated person in the demo draws from these */
  firstNames: string[];
  lastNames: string[];
  /** towns the fleet works in (the device "location" column, report rows) */
  towns: string[];
  /** a plausible national plate, drawn from the caller's seeded RNG so it stays deterministic */
  plate: (r: () => number) => string;
  /** driving-licence number prefix (country code, as printed on the card) */
  licensePrefix: string;
  /** national mobile prefix INCLUDING the operator digit, e.g. "+3706" */
  phonePrefix: string;
  /** the three seeded geofences, named as this operator would name them */
  zones: { depot: string; yard: string; corridor: string };
  /** a fixed delivery point outside the city — the far end of a planned route */
  terminal: string;
  /** IANA zone the operator's reports are rendered in */
  tz: string;
  /** the operator's own domain, for branding/white-label rows */
  domain: string;
  supportEmail: string;
  /** a CUSTOMER's host, for webhook targets — a different company than the operator */
  clientHost: string;
  /** two haulier accounts the reports page filters by */
  reportAccounts: [string, string];
}

const LT: DemoContent = {
  company: "Demo Logistika",
  companyLegal: "Demo Logistika, UAB",
  accounts: ["Vilniaus parkas", "Kauno parkas"],
  firstNames: ["Jonas", "Mantas", "Rokas", "Tomas", "Lukas", "Andrius", "Darius", "Karolis", "Paulius", "Vytautas", "Gediminas", "Marius"],
  lastNames: ["Kazlauskas", "Petrauskas", "Jankauskas", "Stankevičius", "Butkus", "Urbonas", "Balčiūnas", "Žukauskas", "Vasiliauskas", "Šimkus"],
  towns: ["Vilnius", "Kaunas", "Klaipėda", "Šiauliai", "Panevėžys", "Alytus", "Utena", "Marijampolė"],
  // LT: three letters, three digits — "ABC 123"
  plate: (r) => `${letters(r, 3)} ${digits(r, 3)}`,
  licensePrefix: "LT",
  phonePrefix: "+3706",
  zones: { depot: "Vilniaus bazė", yard: "Krovos aikštelė", corridor: "Miesto koridorius" },
  terminal: "Terminalas Kaunas",
  tz: "Europe/Vilnius",
  domain: "demolog.lt",
  supportEmail: "pagalba@demolog.lt",
  clientHost: "erp.klientas.lt",
  reportAccounts: ["UAB Baltijos logistika", "UAB Kensa transportas"],
};

const PL: DemoContent = {
  company: "Demo Logistyka",
  companyLegal: "Demo Logistyka sp. z o.o.",
  accounts: ["Flota Warszawa", "Flota Łódź"],
  firstNames: ["Piotr", "Marek", "Tomasz", "Krzysztof", "Andrzej", "Paweł", "Michał", "Jakub", "Grzegorz", "Rafał", "Łukasz", "Adam"],
  lastNames: ["Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski"],
  towns: ["Warszawa", "Łódź", "Radom", "Płock", "Siedlce", "Lublin", "Kielce", "Białystok"],
  // PL: Warsaw plates start with W — "WE 1234A"
  plate: (r) => `W${letters(r, 1)} ${digits(r, 4)}${letters(r, 1)}`,
  licensePrefix: "PL",
  phonePrefix: "+4860",
  zones: { depot: "Baza Warszawa", yard: "Plac załadunkowy", corridor: "Korytarz miejski" },
  terminal: "Terminal Łódź",
  tz: "Europe/Warsaw",
  domain: "demolog.pl",
  supportEmail: "pomoc@demolog.pl",
  clientHost: "erp.klient.pl",
  reportAccounts: ["Wisła Logistyka sp. z o.o.", "Kensa Transport sp. z o.o."],
};

// Warsaw's fleet, named in English — see the header: the city decides the people, the language
// decides the wording. The plates, drivers and towns are Poland's because the vans are in Poland.
const EN: DemoContent = {
  company: "Demo Logistics",
  companyLegal: "Demo Logistics Ltd.",
  accounts: ["Warsaw fleet", "Łódź fleet"],
  firstNames: PL.firstNames,
  lastNames: PL.lastNames,
  towns: PL.towns,
  plate: PL.plate,
  licensePrefix: "PL",
  phonePrefix: "+4860",
  zones: { depot: "Warsaw depot", yard: "Loading yard", corridor: "City corridor" },
  terminal: "Łódź terminal",
  tz: "Europe/Warsaw",
  domain: "demolog.com",
  supportEmail: "support@demolog.com",
  clientHost: "erp.customer.com",
  reportAccounts: ["Wisła Logistics Ltd.", "Kensa Transport Ltd."],
};

const DE: DemoContent = {
  company: "Demo Logistik",
  companyLegal: "Demo Logistik GmbH",
  accounts: ["Flotte Berlin", "Flotte Potsdam"],
  firstNames: ["Stefan", "Andreas", "Thomas", "Michael", "Jürgen", "Martin", "Christian", "Matthias", "Frank", "Sebastian", "Daniel", "Tobias"],
  lastNames: ["Müller", "Schmidt", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann", "Schulz", "Koch", "Richter"],
  towns: ["Berlin", "Potsdam", "Brandenburg", "Oranienburg", "Fürstenwalde", "Cottbus", "Frankfurt (Oder)", "Rathenow"],
  // DE: Berlin plates start with B — "B AB 1234"
  plate: (r) => `B ${letters(r, 2)} ${digits(r, 4)}`,
  licensePrefix: "DE",
  phonePrefix: "+49151",
  zones: { depot: "Depot Berlin", yard: "Ladezone", corridor: "Stadtkorridor" },
  terminal: "Terminal Potsdam",
  tz: "Europe/Berlin",
  domain: "demolog.de",
  supportEmail: "support@demolog.de",
  clientHost: "erp.kunde.de",
  reportAccounts: ["Spree Logistik GmbH", "Kensa Transport GmbH"],
};

function letters(r: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(65 + Math.floor(r() * 26));
  return s;
}

function digits(r: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(r() * 10).toString();
  return s;
}

const CONTENT: Record<string, DemoContent> = { lt: LT, pl: PL, en: EN, de: DE };

/** The demo operator for this interface language. Unknown languages fall back to English, as `cityFor` does. */
export function contentFor(lang: string): DemoContent {
  return CONTENT[lang.slice(0, 2).toLowerCase()] ?? EN;
}

/** The city and its operator together — the pair almost every demo page needs. */
export function demoFor(lang: string): { city: DemoCity; content: DemoContent } {
  return { city: cityFor(lang), content: contentFor(lang) };
}

/** A full name drawn from the city's pools, for generated rosters. */
export function personName(c: DemoContent, r: () => number): string {
  return `${c.firstNames[Math.floor(r() * c.firstNames.length)]} ${c.lastNames[Math.floor(r() * c.lastNames.length)]}`;
}
