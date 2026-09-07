import type { KbCategory } from './types.js'

/**
 * The twelve shelves of the knowledge base, in reading order.
 *
 * The order is a journey, not an alphabet: what tracking is → getting a tracker reporting → the
 * live map → what the platform builds out of positions (trips, alerts, reports) → the fleet
 * records around them → the commercial and reseller material → integrations and trust → the
 * things that go wrong. A reader who starts at the top and keeps going is never sent forward to
 * a term that has not been introduced yet.
 */
export const KB_CATEGORIES: readonly KbCategory[] = [
  {
    id: 'start',
    icon: 'Compass',
    label: {
      en: { title: 'Getting started', blurb: 'What GPS tracking is, and the first hour with a new account.' },
      lt: { title: 'Pradžia', blurb: 'Kas yra GPS sekimas ir ką nuveikti per pirmą valandą su nauja paskyra.' },
      pl: { title: 'Pierwsze kroki', blurb: 'Czym jest lokalizacja GPS i co zrobić w pierwszej godzinie na nowym koncie.' },
      de: { title: 'Erste Schritte', blurb: 'Was GPS-Ortung ist — und die erste Stunde mit einem neuen Konto.' },
    },
  },
  {
    id: 'devices',
    icon: 'Cpu',
    label: {
      en: { title: 'Trackers & installation', blurb: 'Choosing, connecting and configuring the hardware in the vehicle.' },
      lt: { title: 'Sekliai ir montavimas', blurb: 'Kaip pasirinkti, prijungti ir sukonfigūruoti įrangą automobilyje.' },
      pl: { title: 'Lokalizatory i montaż', blurb: 'Wybór, podłączenie i konfiguracja urządzenia w pojeździe.' },
      de: { title: 'Tracker & Einbau', blurb: 'Auswahl, Anschluss und Konfiguration der Hardware im Fahrzeug.' },
    },
  },
  {
    id: 'map',
    icon: 'Map',
    label: {
      en: { title: 'The live map', blurb: 'Reading positions, statuses and everything the map draws.' },
      lt: { title: 'Gyvas žemėlapis', blurb: 'Kaip skaityti pozicijas, būsenas ir viską, ką piešia žemėlapis.' },
      pl: { title: 'Mapa na żywo', blurb: 'Jak czytać pozycje, statusy i wszystko, co rysuje mapa.' },
      de: { title: 'Die Live-Karte', blurb: 'Positionen, Status und alles, was die Karte zeichnet — richtig gelesen.' },
    },
  },
  {
    id: 'trips',
    icon: 'Route',
    label: {
      en: { title: 'Trips & history', blurb: 'How a stream of positions becomes trips, distance and a replay.' },
      lt: { title: 'Kelionės ir istorija', blurb: 'Kaip pozicijų srautas virsta kelionėmis, rida ir peržaidimu.' },
      pl: { title: 'Trasy i historia', blurb: 'Jak strumień pozycji staje się trasami, przebiegiem i odtworzeniem.' },
      de: { title: 'Fahrten & Historie', blurb: 'Wie aus einem Positionsstrom Fahrten, Kilometer und ein Replay werden.' },
    },
  },
  {
    id: 'alerts',
    icon: 'Bell',
    label: {
      en: { title: 'Zones, rules & alerts', blurb: 'Getting told about the things you would otherwise have to watch for.' },
      lt: { title: 'Zonos, taisyklės ir pranešimai', blurb: 'Kaip gauti žinią apie tai, ko kitaip tektų tykoti patiems.' },
      pl: { title: 'Strefy, reguły i alerty', blurb: 'Jak dostawać powiadomienia o tym, czego inaczej trzeba by pilnować.' },
      de: { title: 'Zonen, Regeln & Alarme', blurb: 'Sich melden lassen, statt selbst hinzusehen.' },
    },
  },
  {
    id: 'reports',
    icon: 'FileText',
    label: {
      en: { title: 'Reports', blurb: 'The numbers you hand to accounting, a customer or a driver.' },
      lt: { title: 'Ataskaitos', blurb: 'Skaičiai, kuriuos paduodate buhalterijai, klientui ar vairuotojui.' },
      pl: { title: 'Raporty', blurb: 'Liczby, które przekazujesz księgowości, klientowi albo kierowcy.' },
      de: { title: 'Berichte', blurb: 'Die Zahlen für die Buchhaltung, den Kunden oder den Fahrer.' },
    },
  },
  {
    id: 'fleet',
    icon: 'Car',
    label: {
      en: { title: 'Vehicles & drivers', blurb: 'The records around the tracker: who drove, what is due, which papers expire.' },
      lt: { title: 'Automobiliai ir vairuotojai', blurb: 'Įrašai aplink seklį: kas vairavo, kada servisas, kada baigiasi dokumentai.' },
      pl: { title: 'Pojazdy i kierowcy', blurb: 'Dane wokół lokalizatora: kto jechał, co się należy, którym dokumentom kończy się termin.' },
      de: { title: 'Fahrzeuge & Fahrer', blurb: 'Die Daten rund um den Tracker: wer gefahren ist, was ansteht, welche Papiere ablaufen.' },
    },
  },
  {
    id: 'account',
    icon: 'CreditCard',
    label: {
      en: { title: 'Plan & billing', blurb: 'What your plan includes, how it is invoiced, and what happens if it lapses.' },
      lt: { title: 'Planas ir mokėjimai', blurb: 'Kas įeina į planą, kaip išrašomos sąskaitos ir kas nutinka neapmokėjus.' },
      pl: { title: 'Plan i płatności', blurb: 'Co obejmuje plan, jak wygląda fakturowanie i co się dzieje przy braku płatności.' },
      de: { title: 'Tarif & Abrechnung', blurb: 'Was der Tarif enthält, wie abgerechnet wird und was bei Zahlungsverzug passiert.' },
    },
  },
  {
    id: 'tsp',
    icon: 'Store',
    label: {
      en: { title: 'For resellers', blurb: 'Running the platform as your own product, under your own brand.' },
      lt: { title: 'Perpardavėjams', blurb: 'Kaip valdyti platformą kaip savo produktą su savo prekės ženklu.' },
      pl: { title: 'Dla resellerów', blurb: 'Jak prowadzić platformę jako własny produkt pod własną marką.' },
      de: { title: 'Für Reseller', blurb: 'Die Plattform als eigenes Produkt unter eigener Marke betreiben.' },
    },
  },
  {
    id: 'integrations',
    icon: 'Plug',
    label: {
      en: { title: 'API & integrations', blurb: 'Pulling the data into your own systems.' },
      lt: { title: 'API ir integracijos', blurb: 'Kaip persikelti duomenis į savo sistemas.' },
      pl: { title: 'API i integracje', blurb: 'Jak przenieść dane do własnych systemów.' },
      de: { title: 'API & Integrationen', blurb: 'Die Daten in die eigenen Systeme holen.' },
    },
  },
  {
    id: 'trust',
    icon: 'ShieldCheck',
    label: {
      en: { title: 'Data, privacy & law', blurb: 'Where the data lives, how long it stays, and tracking staff lawfully.' },
      lt: { title: 'Duomenys, privatumas ir teisė', blurb: 'Kur laikomi duomenys, kiek jie saugomi ir kaip teisėtai sekti darbuotojus.' },
      pl: { title: 'Dane, prywatność i prawo', blurb: 'Gdzie są dane, jak długo są przechowywane i jak legalnie monitorować pracowników.' },
      de: { title: 'Daten, Datenschutz & Recht', blurb: 'Wo die Daten liegen, wie lange sie bleiben und wie Mitarbeiterortung rechtmäßig bleibt.' },
    },
  },
  {
    id: 'troubleshooting',
    icon: 'LifeBuoy',
    label: {
      en: { title: 'Troubleshooting', blurb: 'When something does not show up, arrive or add up.' },
      lt: { title: 'Gedimų šalinimas', blurb: 'Kai kažkas nepasirodo, neatkeliauja arba nesueina.' },
      pl: { title: 'Rozwiązywanie problemów', blurb: 'Gdy coś się nie pojawia, nie dociera albo się nie zgadza.' },
      de: { title: 'Fehlersuche', blurb: 'Wenn etwas nicht auftaucht, nicht ankommt oder nicht aufgeht.' },
    },
  },
]
