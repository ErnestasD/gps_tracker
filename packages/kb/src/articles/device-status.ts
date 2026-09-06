import type { KbArticle } from '../types.js'

export const deviceStatus: KbArticle = {
  slug: 'device-status',
  category: 'map',
  surfaces: { site: true, app: true },
  doc: {
    en: {
      title: 'Device status — the two things "inactive" could mean',
      summary: 'Online, Offline, No contact, Never reported, Active and Retired are two different scales. Mixing them up costs an afternoon.',
      keywords: ['status', 'online', 'offline', 'no contact', 'never reported', 'retired', 'active', 'presence', 'colour'],
      blocks: [
        { p: 'There are two independent questions about a device, and they must never be answered with the same word.' },
        { h2: 'Scale one — is it talking to us right now?', id: 'presence' },
        { table: { head: ['Status', 'Means', 'What to do'], rows: [
          ['**Online**', 'Reported within the last few minutes.', 'Nothing.'],
          ['**Offline**', 'Nothing for several minutes.', 'Usually nothing — a parked vehicle reports less often on purpose.'],
          ['**No contact**', 'Silent for a long stretch.', 'Worth a look: coverage, power, data allowance.'],
          ['**Never reported**', 'Registered here and has never sent anything at all.', 'The installation is not finished — see [Device not reporting](kb:device-not-reporting).'],
        ] } },
        { callout: 'note', p: 'These thresholds are generous on purpose. Trackers batch their records and typically upload every couple of minutes, so a stricter definition of "online" would make a perfectly healthy vehicle flicker between states for an entire trip.' },
        { h2: 'Scale two — is it in service?', id: 'lifecycle' },
        { table: { head: ['Status', 'Means'], rows: [
          ['**Active**', 'In your fleet, counting toward your plan, allowed to send data.'],
          ['**Retired**', 'Taken out of service by a person. Its data is refused from now on; its history stays readable — see [Retiring a device](kb:device-lifecycle).'],
        ] } },
        { h2: 'Why the vocabulary is kept apart', id: 'why-separate' },
        { p: 'A word like "inactive" would be true of a van parked overnight and true of a tracker pulled out of a sold vehicle, and those two situations call for opposite responses. A vehicle that is quiet is a fact about the last few minutes; a vehicle that is retired is a decision somebody made. The interface never lets one word carry both.' },
        { h2: 'Read the time, not just the label', id: 'time' },
        { p: 'Beside every status is the moment of last contact. That timestamp is more useful than the label: "no contact, last seen 11 minutes ago" is a vehicle in a car park, and "no contact, last seen 6 days ago" is a job for someone. When you are deciding whether to act, the time is the number that decides it.' },
      ],
    },
    lt: {
      title: 'Įrenginio būsena — du dalykai, kuriuos galėtų reikšti „neaktyvus"',
      summary: 'Prisijungęs, Neprisijungęs, Nėra ryšio, Niekada nesiuntė, Aktyvus ir Nurašytas – tai dvi skirtingos skalės. Jas supainiojus prarandama popietė.',
      keywords: ['būsena', 'prisijungęs', 'neprisijungęs', 'nėra ryšio', 'niekada nesiuntė', 'nurašytas', 'aktyvus', 'spalva'],
      blocks: [
        { p: 'Apie įrenginį galima klausti dviejų nepriklausomų dalykų, ir jų niekada negalima atsakyti tuo pačiu žodžiu.' },
        { h2: 'Pirma skalė — ar jis su mumis kalba dabar?', id: 'presence' },
        { table: { head: ['Būsena', 'Reiškia', 'Ką daryti'], rows: [
          ['**Prisijungęs**', 'Siuntė duomenis per pastarąsias kelias minutes.', 'Nieko.'],
          ['**Neprisijungęs**', 'Kelias minutes nieko.', 'Paprastai nieko – stovintis automobilis sąmoningai siunčia rečiau.'],
          ['**Nėra ryšio**', 'Tyli jau ilgą laiką.', 'Verta pažiūrėti: aprėptis, maitinimas, duomenų limitas.'],
          ['**Niekada nesiuntė**', 'Užregistruotas čia ir nė karto nieko neatsiuntė.', 'Montavimas nebaigtas – žr. [Įrenginys nesiunčia duomenų](kb:device-not-reporting).'],
        ] } },
        { callout: 'note', p: 'Šios ribos sąmoningai dosnios. Sekliai kaupia įrašus ir paprastai išsiunčia kas porą minučių, tad griežtesnė „prisijungęs" apibrėžtis verstų visiškai sveiką automobilį visą kelionę mirgėti tarp būsenų.' },
        { h2: 'Antra skalė — ar jis eksploatuojamas?', id: 'lifecycle' },
        { table: { head: ['Būsena', 'Reiškia'], rows: [
          ['**Aktyvus**', 'Yra jūsų parke, skaičiuojamas į planą, jam leidžiama siųsti duomenis.'],
          ['**Nurašytas**', 'Žmogaus išimtas iš eksploatacijos. Nuo šiol jo duomenys nepriimami; istorija lieka skaitoma – žr. [Įrenginio nurašymas](kb:device-lifecycle).'],
        ] } },
        { h2: 'Kodėl žodynas laikomas atskirai', id: 'why-separate' },
        { p: 'Žodis „neaktyvus" būtų teisingas ir apie nakčiai pastatytą furgoną, ir apie iš parduoto automobilio išimtą seklį, o šios dvi situacijos reikalauja priešingų veiksmų. Tylintis automobilis – faktas apie pastarąsias kelias minutes; nurašytas automobilis – kažkieno priimtas sprendimas. Sąsaja niekada neleidžia vienam žodžiui nešti abiejų.' },
        { h2: 'Skaitykite laiką, o ne vien užrašą', id: 'time' },
        { p: 'Šalia kiekvienos būsenos yra paskutinio ryšio momentas. Ta laiko žyma naudingesnė nei užrašas: „nėra ryšio, matytas prieš 11 minučių" – tai automobilis aikštelėje, o „nėra ryšio, matytas prieš 6 dienas" – tai darbas kažkam. Sprendžiant, ar reaguoti, būtent laikas ir nulemia.' },
      ],
    },
    pl: {
      title: 'Status urządzenia — dwie rzeczy, które mogłoby znaczyć „nieaktywne"',
      summary: 'Online, Offline, Brak kontaktu, Nigdy nie raportowało, Aktywne i Wycofane to dwie różne skale. Pomylenie ich kosztuje popołudnie.',
      keywords: ['status', 'online', 'offline', 'brak kontaktu', 'nigdy nie raportowało', 'wycofane', 'aktywne', 'kolor'],
      blocks: [
        { p: 'O urządzeniu można zadać dwa niezależne pytania i nigdy nie wolno odpowiadać na nie tym samym słowem.' },
        { h2: 'Skala pierwsza — czy mówi do nas teraz?', id: 'presence' },
        { table: { head: ['Status', 'Znaczy', 'Co zrobić'], rows: [
          ['**Online**', 'Raportowało w ciągu ostatnich kilku minut.', 'Nic.'],
          ['**Offline**', 'Nic od kilku minut.', 'Zwykle nic — zaparkowany pojazd celowo raportuje rzadziej.'],
          ['**Brak kontaktu**', 'Milczy od dłuższego czasu.', 'Warto sprawdzić: zasięg, zasilanie, pakiet danych.'],
          ['**Nigdy nie raportowało**', 'Zarejestrowane tutaj i nigdy nic nie wysłało.', 'Montaż nie jest dokończony — zobacz [Urządzenie nie raportuje](kb:device-not-reporting).'],
        ] } },
        { callout: 'note', p: 'Te progi są celowo hojne. Lokalizatory grupują zapisy i zwykle wysyłają co kilka minut, więc surowsza definicja „online" sprawiłaby, że całkowicie sprawny pojazd migotałby między stanami przez całą trasę.' },
        { h2: 'Skala druga — czy jest w eksploatacji?', id: 'lifecycle' },
        { table: { head: ['Status', 'Znaczy'], rows: [
          ['**Aktywne**', 'W Twojej flocie, liczy się do planu, wolno mu wysyłać dane.'],
          ['**Wycofane**', 'Wyjęte z eksploatacji przez człowieka. Jego dane są od tej pory odrzucane; historia pozostaje czytelna — zobacz [Wycofywanie urządzenia](kb:device-lifecycle).'],
        ] } },
        { h2: 'Dlaczego słownictwo jest rozdzielone', id: 'why-separate' },
        { p: 'Słowo „nieaktywne" byłoby prawdziwe zarówno o busie zaparkowanym na noc, jak i o lokalizatorze wyjętym ze sprzedanego auta, a te dwie sytuacje wymagają przeciwnych reakcji. Milczący pojazd to fakt o ostatnich kilku minutach; wycofany pojazd to czyjaś decyzja. Interfejs nigdy nie pozwala jednemu słowu nieść obu.' },
        { h2: 'Czytaj czas, nie tylko etykietę', id: 'time' },
        { p: 'Obok każdego statusu jest moment ostatniego kontaktu. Ten znacznik jest bardziej użyteczny niż etykieta: „brak kontaktu, widziany 11 minut temu" to pojazd na parkingu, a „brak kontaktu, widziany 6 dni temu" to zadanie dla kogoś. Gdy decydujesz, czy działać, to czas o tym rozstrzyga.' },
      ],
    },
    de: {
      title: 'Gerätestatus — die zwei Dinge, die „inaktiv" heißen könnte',
      summary: 'Online, Offline, Kein Kontakt, Nie gemeldet, Aktiv und Stillgelegt sind zwei verschiedene Skalen. Sie zu verwechseln kostet einen Nachmittag.',
      keywords: ['status', 'online', 'offline', 'kein kontakt', 'nie gemeldet', 'stillgelegt', 'aktiv', 'farbe'],
      blocks: [
        { p: 'Zu einem Gerät gibt es zwei unabhängige Fragen, und sie dürfen nie mit demselben Wort beantwortet werden.' },
        { h2: 'Skala eins — spricht es gerade mit uns?', id: 'presence' },
        { table: { head: ['Status', 'Bedeutet', 'Zu tun'], rows: [
          ['**Online**', 'Hat in den letzten Minuten gemeldet.', 'Nichts.'],
          ['**Offline**', 'Seit einigen Minuten nichts.', 'Meist nichts — ein geparktes Fahrzeug meldet absichtlich seltener.'],
          ['**Kein Kontakt**', 'Seit längerer Zeit still.', 'Ein Blick lohnt: Abdeckung, Strom, Datenvolumen.'],
          ['**Nie gemeldet**', 'Hier registriert und hat nie irgendetwas gesendet.', 'Der Einbau ist nicht fertig — siehe [Gerät meldet sich nicht](kb:device-not-reporting).'],
        ] } },
        { callout: 'note', p: 'Diese Schwellen sind bewusst großzügig. Tracker bündeln ihre Datensätze und laden meist alle paar Minuten hoch; eine strengere Definition von „online" ließe ein kerngesundes Fahrzeug eine ganze Fahrt lang zwischen den Zuständen flackern.' },
        { h2: 'Skala zwei — ist es im Dienst?', id: 'lifecycle' },
        { table: { head: ['Status', 'Bedeutet'], rows: [
          ['**Aktiv**', 'In Ihrer Flotte, zählt gegen den Tarif, darf Daten senden.'],
          ['**Stillgelegt**', 'Von einem Menschen außer Dienst gestellt. Seine Daten werden ab jetzt abgewiesen; die Historie bleibt lesbar — siehe [Gerät stilllegen](kb:device-lifecycle).'],
        ] } },
        { h2: 'Warum das Vokabular getrennt bleibt', id: 'why-separate' },
        { p: 'Ein Wort wie „inaktiv" träfe auf einen über Nacht geparkten Transporter zu und ebenso auf einen aus einem verkauften Fahrzeug ausgebauten Tracker — und beide Lagen verlangen gegenteilige Reaktionen. Ein stilles Fahrzeug ist eine Tatsache über die letzten Minuten; ein stillgelegtes Fahrzeug ist die Entscheidung eines Menschen. Die Oberfläche lässt nie ein Wort beides tragen.' },
        { h2: 'Lesen Sie die Zeit, nicht nur das Etikett', id: 'time' },
        { p: 'Neben jedem Status steht der Zeitpunkt des letzten Kontakts. Dieser Zeitstempel ist nützlicher als das Etikett: „kein Kontakt, zuletzt vor 11 Minuten" ist ein Fahrzeug auf einem Parkplatz, „kein Kontakt, zuletzt vor 6 Tagen" ist eine Aufgabe für jemanden. Wenn Sie entscheiden, ob Sie handeln, entscheidet die Zeit.' },
      ],
    },
  },
}
