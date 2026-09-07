import type { KbArticle } from '../types.js'

export const eventTypes: KbArticle = {
  slug: 'event-types',
  category: 'alerts',
  surfaces: { site: true, app: true },
  screen: '/app/events',
  doc: {
    en: {
      title: 'Every event type, in plain words',
      summary: 'The nine things a rule can watch for, what each one actually detects, and what it needs from the hardware.',
      keywords: ['event', 'overspeed', 'ignition', 'power cut', 'low battery', 'panic', 'offline', 'fuel theft', 'din'],
      blocks: [
        { p: 'Nine kinds of event cover everything a rule can watch. Some need only GPS; some need a wire; one needs a fuel reading.' },
        { h2: 'Movement and place', id: 'movement' },
        { table: { head: ['Kind', 'Fires when', 'Needs'], rows: [
          ['**Geofence**', 'A vehicle enters a zone, leaves it, or does either — your choice.', 'A drawn zone. See [Geofences](kb:geofences).'],
          ['**Overspeed**', 'Speed goes above the limit you set on the rule.', 'Nothing extra. A continuing overspeed is one event with an end time, not a stream.'],
          ['**Ignition**', 'The engine is switched on or off.', 'An ignition wire, or a device that can work it out for itself.'],
        ] } },
        { h2: 'Power and hardware', id: 'power' },
        { table: { head: ['Kind', 'Fires when', 'Needs'], rows: [
          ['**Power cut**', 'The tracker loses its external supply — a disconnected battery, a cut cable, an unplugged OBD device.', 'A wired or plug-in device with a backup battery to report it.'],
          ['**Low battery**', 'Voltage falls below the threshold you set.', 'A device that reports voltage. Set the threshold to suit the vehicle rather than leaving the default.'],
          ['**Device offline**', 'Nothing has been heard for the number of hours you set.', 'Nothing extra. The most useful rule in the whole list, and the one people forget.'],
          ['**DIN change**', 'A digital input changes state — a door, a PTO, a tipper, a fridge door, a panic loop.', 'An input wired to something. What it means depends on the installation.'],
        ] } },
        { h2: 'Driver and cargo', id: 'driver' },
        { table: { head: ['Kind', 'Fires when', 'Needs'], rows: [
          ['**Panic**', 'The panic button is pressed.', 'A button wired in. Give this rule a channel somebody actually watches.'],
          ['**Fuel theft**', 'The fuel level drops by more than the percentage or the number of litres you set.', 'A fuel reading, from CAN or a level sensor — see [CAN and OBD data](kb:can-and-obd).'],
        ] } },
        { h2: 'Reading the events list', id: 'list' },
        { p: 'Every event that fired is listed with its time, vehicle, kind, severity and location, and you can filter by any of those. An event with a duration has both a start and an end. Details show what the rule saw at the moment it fired — the speed, the zone, the voltage — which is what settles most “was that real?” questions.' },
        { callout: 'tip', p: 'The events list is complete regardless of channels. If a rule fired but nobody got an e-mail, the event is here and the problem is the channel — see [Not getting e-mails](kb:not-getting-emails).' },
        { h2: 'Two rules worth having on day one', id: 'recommend' },
        { ul: [
          '**Device offline** on the whole account. It is the rule that tells you a tracker died, a SIM ran out, or a vehicle was taken somewhere with no coverage — the failures that are otherwise invisible precisely because nothing happens.',
          '**Power cut**, where the hardware supports it. On a wired installation this is the closest thing to a tamper alarm.',
        ] },
      ],
    },
    lt: {
      title: 'Visi įvykių tipai paprastais žodžiais',
      summary: 'Devyni dalykai, kuriuos gali stebėti taisyklė, ką kiekvienas iš tikrųjų aptinka ir ko jam reikia iš įrangos.',
      keywords: ['įvykis', 'greičio viršijimas', 'degimas', 'maitinimo dingimas', 'silpna baterija', 'pavojaus mygtukas', 'nėra ryšio', 'kuro vagystė'],
      blocks: [
        { p: 'Devyni tipai aprėpia viską, ką gali stebėti taisyklė. Vieniems reikia tik GPS, kitiems – laido, o vienam – kuro rodmens.' },
        { h2: 'Judėjimas ir vieta', id: 'movement' },
        { table: { head: ['Tipas', 'Suveikia, kai', 'Ko reikia'], rows: [
          ['**Geozona**', 'Automobilis įvažiuoja į zoną, iš jos išvažiuoja arba ir viena, ir kita – jūsų pasirinkimu.', 'Nubrėžtos zonos. Žr. [Geozonos](kb:geofences).'],
          ['**Greičio viršijimas**', 'Greitis viršija taisyklėje nustatytą ribą.', 'Nieko papildomo. Besitęsiantis viršijimas yra vienas įvykis su pabaigos laiku, o ne srautas.'],
          ['**Degimas**', 'Variklis užvedamas arba išjungiamas.', 'Degimo laido arba įrenginio, gebančio tai nustatyti.'],
        ] } },
        { h2: 'Maitinimas ir įranga', id: 'power' },
        { table: { head: ['Tipas', 'Suveikia, kai', 'Ko reikia'], rows: [
          ['**Maitinimo nutrūkimas**', 'Sekiklis netenka išorinio maitinimo – atjungtas akumuliatorius, perkirptas laidas, ištrauktas OBD įrenginys.', 'Laidinio ar kištukinio įrenginio su atsargine baterija, kad spėtų pranešti.'],
          ['**Silpna baterija**', 'Įtampa nukrenta žemiau jūsų nustatytos ribos.', 'Įrenginio, kuris praneša įtampą. Ribą nustatykite pagal automobilį, nepalikite numatytosios.'],
          ['**Įrenginys nepasiekiamas**', 'Nieko negirdėti jūsų nurodytą valandų skaičių.', 'Nieko papildomo. Naudingiausia taisyklė visame sąraše ir ta, kurią dažniausiai pamirštama.'],
          ['**Įvesties pokytis**', 'Skaitmeninis įėjimas keičia būseną – durys, PTO, savivartis, šaldytuvo durys, pavojaus grandinė.', 'Prie ko nors prijungto įėjimo. Ką tai reiškia, nusprendžia montavimas.'],
        ] } },
        { h2: 'Vairuotojas ir krovinys', id: 'driver' },
        { table: { head: ['Tipas', 'Suveikia, kai', 'Ko reikia'], rows: [
          ['**Pavojaus mygtukas**', 'Paspaudžiamas pavojaus mygtukas.', 'Prijungto mygtuko. Šiai taisyklei parinkite kanalą, kurį kas nors tikrai stebi.'],
          ['**Kuro vagystė**', 'Kuro lygis nukrenta daugiau, nei nurodėte procentais ar litrais.', 'Kuro rodmens iš CAN arba lygio daviklio – žr. [CAN ir OBD duomenys](kb:can-and-obd).'],
        ] } },
        { h2: 'Kaip skaityti įvykių sąrašą', id: 'list' },
        { p: 'Kiekvienas suveikęs įvykis įrašomas su laiku, automobiliu, tipu, svarba ir vieta, ir pagal bet kurį iš jų galima filtruoti. Trukęs įvykis turi ir pradžią, ir pabaigą. Detalėse rodoma, ką taisyklė matė suveikimo akimirką – greitį, zoną, įtampą – ir kaip tik tai išsprendžia daugumą klausimų „ar tai buvo tikra“.' },
        { callout: 'tip', p: 'Įvykių sąrašas pilnas nepriklausomai nuo kanalų. Jei taisyklė suveikė, bet niekas negavo laiško, įvykis yra čia, o problema – kanale; žr. [Negaunu laiškų](kb:not-getting-emails).' },
        { h2: 'Dvi taisyklės, kurias verta susikurti pirmą dieną', id: 'recommend' },
        { ul: [
          '**Įrenginys nepasiekiamas** visai paskyrai. Būtent ji praneša, kad sekiklis mirė, baigėsi SIM kortelės duomenys arba automobilis nuvarytas ten, kur nėra aprėpties – gedimai, kurie kitaip nematomi kaip tik todėl, kad nieko nevyksta.',
          '**Maitinimo nutrūkimas**, jei įranga tai palaiko. Laidiniame montaže tai artimiausias atitikmuo gadinimo signalizacijai.',
        ] },
      ],
    },
    pl: {
      title: 'Wszystkie rodzaje zdarzeń, prostymi słowami',
      summary: 'Dziewięć rzeczy, których może pilnować reguła, co każda naprawdę wykrywa i czego wymaga od sprzętu.',
      keywords: ['zdarzenie', 'przekroczenie prędkości', 'zapłon', 'utrata zasilania', 'niskie napięcie', 'alarm', 'brak kontaktu', 'kradzież paliwa'],
      blocks: [
        { p: 'Dziewięć rodzajów obejmuje wszystko, czego może pilnować reguła. Jedne potrzebują tylko GPS, inne przewodu, jedna odczytu paliwa.' },
        { h2: 'Ruch i miejsce', id: 'movement' },
        { table: { head: ['Rodzaj', 'Wyzwala się, gdy', 'Wymaga'], rows: [
          ['**Geostrefa**', 'Pojazd wjeżdża do strefy, wyjeżdża z niej albo jedno i drugie — do wyboru.', 'Narysowanej strefy. Zobacz [Geostrefy](kb:geofences).'],
          ['**Przekroczenie prędkości**', 'Prędkość przekracza limit ustawiony w regule.', 'Niczego dodatkowego. Trwające przekroczenie to jedno zdarzenie z czasem końca, nie strumień.'],
          ['**Zapłon**', 'Silnik zostaje uruchomiony lub wyłączony.', 'Przewodu zapłonu albo urządzenia, które potrafi to wywnioskować.'],
        ] } },
        { h2: 'Zasilanie i sprzęt', id: 'power' },
        { table: { head: ['Rodzaj', 'Wyzwala się, gdy', 'Wymaga'], rows: [
          ['**Utrata zasilania**', 'Lokalizator traci zasilanie zewnętrzne — odłączony akumulator, przecięty kabel, wypięte urządzenie OBD.', 'Urządzenia przewodowego lub wtykowego z baterią podtrzymującą, by zdążyło zgłosić.'],
          ['**Niski poziom baterii**', 'Napięcie spada poniżej ustawionego progu.', 'Urządzenia raportującego napięcie. Próg ustaw dla konkretnego pojazdu, nie zostawiaj domyślnego.'],
          ['**Urządzenie offline**', 'Nic nie słychać przez ustawioną liczbę godzin.', 'Niczego dodatkowego. Najbardziej użyteczna reguła z całej listy i ta, o której się zapomina.'],
          ['**Zmiana DIN**', 'Wejście cyfrowe zmienia stan — drzwi, WOM, wywrotka, drzwi chłodni, pętla alarmowa.', 'Wejścia podłączonego do czegoś. Co to znaczy, rozstrzyga montaż.'],
        ] } },
        { h2: 'Kierowca i ładunek', id: 'driver' },
        { table: { head: ['Rodzaj', 'Wyzwala się, gdy', 'Wymaga'], rows: [
          ['**Panika**', 'Ktoś naciska przycisk alarmowy.', 'Podłączonego przycisku. Tej regule daj kanał, który ktoś naprawdę obserwuje.'],
          ['**Kradzież paliwa**', 'Poziom paliwa spada o więcej niż ustawiony procent albo liczbę litrów.', 'Odczytu paliwa z CAN albo sondy poziomu — zobacz [Dane CAN i OBD](kb:can-and-obd).'],
        ] } },
        { h2: 'Czytanie listy zdarzeń', id: 'list' },
        { p: 'Każde wyzwolone zdarzenie jest wypisane z czasem, pojazdem, rodzajem, wagą i lokalizacją, z możliwością filtrowania po każdym z nich. Zdarzenie, które trwało, ma początek i koniec. Szczegóły pokazują, co reguła widziała w chwili wyzwolenia — prędkość, strefę, napięcie — i to rozstrzyga większość pytań „czy to było prawdziwe”.' },
        { callout: 'tip', p: 'Lista zdarzeń jest kompletna niezależnie od kanałów. Jeśli reguła się wyzwoliła, a nikt nie dostał e-maila, zdarzenie jest tutaj, a problem leży w kanale — zobacz [Nie dostaję e-maili](kb:not-getting-emails).' },
        { h2: 'Dwie reguły, które warto założyć pierwszego dnia', id: 'recommend' },
        { ul: [
          '**Urządzenie offline** dla całego konta. To reguła, która mówi, że lokalizator padł, skończył się pakiet danych na karcie SIM albo pojazd pojechał tam, gdzie nie ma zasięgu — awarie niewidoczne właśnie dlatego, że nic się nie dzieje.',
          '**Utrata zasilania**, gdzie sprzęt to obsługuje. Przy montażu przewodowym to najbliższy odpowiednik alarmu antysabotażowego.',
        ] },
      ],
    },
    de: {
      title: 'Alle Ereignistypen, in Klartext',
      summary: 'Die neun Dinge, auf die eine Regel achten kann, was jedes wirklich erkennt und was es von der Hardware braucht.',
      keywords: ['ereignis', 'tempoüberschreitung', 'zündung', 'stromausfall', 'unterspannung', 'notruf', 'kein kontakt', 'kraftstoffdiebstahl'],
      blocks: [
        { p: 'Neun Arten decken alles ab, worauf eine Regel achten kann. Manche brauchen nur GPS, manche eine Leitung, eine einen Kraftstoffwert.' },
        { h2: 'Bewegung und Ort', id: 'movement' },
        { table: { head: ['Art', 'Löst aus, wenn', 'Braucht'], rows: [
          ['**Geozone**', 'Ein Fahrzeug eine Zone betritt, verlässt oder beides — Ihre Wahl.', 'Eine gezeichnete Zone. Siehe [Geozonen](kb:geofences).'],
          ['**Geschwindigkeit**', 'Die Geschwindigkeit über das in dieser Regel festgelegte Limit steigt.', 'Nichts zusätzlich. Eine anhaltende Überschreitung ist ein Ereignis mit Endzeit, kein Strom.'],
          ['**Zündung**', 'Der Motor an- oder ausgeschaltet wird.', 'Eine Zündungsleitung oder ein Gerät, das es ableiten kann.'],
        ] } },
        { h2: 'Strom und Hardware', id: 'power' },
        { table: { head: ['Art', 'Löst aus, wenn', 'Braucht'], rows: [
          ['**Stromausfall**', 'Der Tracker die externe Versorgung verliert — abgeklemmte Batterie, durchtrenntes Kabel, gezogener OBD-Stecker.', 'Ein verkabeltes oder gestecktes Gerät mit Pufferbatterie, damit es das noch melden kann.'],
          ['**Schwache Batterie**', 'Die Spannung unter den von Ihnen gesetzten Schwellwert fällt.', 'Ein Gerät, das Spannung meldet. Setzen Sie den Schwellenwert passend zum Fahrzeug, nicht ausgehend vom Standardwert.'],
          ['**Gerät offline**', 'Für die von Ihnen gesetzte Stundenzahl nichts zu hören war.', 'Nichts zusätzlich. Die nützlichste Regel der ganzen Liste — und die, die vergessen wird.'],
          ['**DIN-Änderung**', 'Ein digitaler Eingang den Zustand wechselt — Tür, Nebenantrieb, Kipper, Kühltür, Panikschleife.', 'Einen an etwas angeschlossenen Eingang. Was er bedeutet, entscheidet der Einbau.'],
        ] } },
        { h2: 'Fahrer und Ladung', id: 'driver' },
        { table: { head: ['Art', 'Löst aus, wenn', 'Braucht'], rows: [
          ['**Panik**', 'Der Panikknopf gedrückt wird.', 'Einen verdrahteten Knopf. Geben Sie dieser Regel einen Kanal, den wirklich jemand beobachtet.'],
          ['**Kraftstoffdiebstahl**', 'Der Füllstand um mehr als den gesetzten Prozentwert oder die gesetzte Literzahl fällt.', 'Einen Kraftstoffwert aus CAN oder von einem Füllstandssensor — siehe [CAN- und OBD-Daten](kb:can-and-obd).'],
        ] } },
        { h2: 'Die Ereignisliste lesen', id: 'list' },
        { p: 'Jedes ausgelöste Ereignis steht mit Zeit, Fahrzeug, Art, Schwere und Ort in der Liste und lässt sich nach jedem davon filtern. Ein Ereignis, das andauerte, hat Beginn und Ende. Die Details zeigen, was die Regel im Auslösemoment gesehen hat — Geschwindigkeit, Zone, Spannung — und genau das klärt die meisten „war das echt“-Fragen.' },
        { callout: 'tip', p: 'Die Ereignisliste ist unabhängig von den Kanälen vollständig. Hat eine Regel ausgelöst, aber niemand eine E-Mail bekommen,, steht das Ereignis hier und das Problem liegt im Kanal — siehe [Keine E-Mails](kb:not-getting-emails).' },
        { h2: 'Zwei Regeln, die sich vom ersten Tag an lohnen', id: 'recommend' },
        { ul: [
          '**Gerät offline** für das ganze Konto. Sie sagt Ihnen, dass ein Tracker gestorben ist, eine SIM leer wurde oder ein Fahrzeug irgendwohin ohne Netzabdeckung gefahren ist — Ausfälle, die sonst gerade deshalb unsichtbar sind, weil nichts passiert.',
          '**Stromausfall**, wo die Hardware es hergibt. Bei einem verkabelten Einbau ist das dem Sabotagealarm am nächsten.',
        ] },
      ],
    },
  },
}
