import type { LocalizedDoc } from "./types";

/**
 * privacy — long-form content authored EN (source of truth) + LT/PL/DE translations (W9 i18n).
 * Generated from the extraction/translation workflow; edit the prose here directly going forward.
 */
export const privacy: LocalizedDoc = {
  "en": {
    "title": "Privacy Policy",
    "label": "LEGAL",
    "updated": "August 2026",
    "notice": "This is a convenience translation. In case of any discrepancy, the English version prevails.",
    "blocks": [
      {
        "p": "This policy explains how we handle personal data on orbetra.com and in the Orbetra platform. It covers both the data we decide about ourselves and the data we process for our customers. Cookies are described separately in the [Cookie Policy](/cookies)."
      },
      {
        "h2": "1. Who we are"
      },
      {
        "p": "The controller for the processing described in section 3 is:"
      },
      {
        "ul": [
          "**MB Dokigo**, a Lithuanian mažoji bendrija, trading as Orbetra",
          "Krivių g. 5, LT-01204 Vilnius, Lithuania",
          "Company code **307575857**",
          "Director: Ernestas Dubovskich",
          "Privacy contact: [hello@orbetra.com](mailto:hello@orbetra.com)"
        ]
      },
      {
        "p": "We have not appointed a data protection officer. All privacy questions, requests and complaints go to [hello@orbetra.com](mailto:hello@orbetra.com) and are handled by the director."
      },
      {
        "h2": "2. Our two roles"
      },
      {
        "p": "For our website, marketing, sales and billing we are the **controller** — we decide why and how the data is processed. For everything inside a customer's Orbetra workspace — telemetry, trips, driver records, workspace users — we act as a **processor** on documented instructions from that customer. For white-label resellers, the reseller is the controller towards its own end customers and we remain the processor. Those roles, our obligations and the security measures are set out in the [Data Processing Addendum](/dpa), which forms part of every customer contract. If you are a driver or an employee of one of our customers, that customer decides how your data is used — please direct your request to them first (see section 14)."
      },
      {
        "h2": "3. Data we collect as controller"
      },
      {
        "ul": [
          "**Account data** — name, work email, company, password hash.",
          "**Billing data** — plan, invoices, VAT details; card data is handled by our payment provider, never stored by us.",
          "**Support and enquiry data** — messages you send us via forms or email, including pilot requests.",
          "**Technical logs** — IP address, user agent and request metadata, kept for security and abuse prevention.",
          "**Referral attribution** — an optional cookie that credits a partner if you arrive via a `?ref=` link, set only with your consent."
        ]
      },
      {
        "p": "Website analytics is aggregated and cookieless. We do not run advertising trackers."
      },
      {
        "h2": "4. Data processed as processor"
      },
      {
        "p": "Inside a workspace we process device telemetry (position, speed, ignition, digital inputs, power and battery status, CAN data where available), trips, geofence and rule events, driver records, maintenance entries, commands sent to devices, and account users. Vehicle and device identity is based on the device IMEI. We do not decide what is tracked, which vehicles are connected or how long records are kept beyond the platform defaults — the customer configures that, and the customer is responsible for informing drivers."
      },
      {
        "h2": "5. Legal bases"
      },
      {
        "ul": [
          "Performance of a contract — providing the service, billing, support.",
          "Legitimate interests — securing the platform, preventing abuse, improving the product, partner attribution.",
          "Consent — optional cookies and marketing email, withdrawable at any time.",
          "Legal obligation — accounting and tax records."
        ]
      },
      {
        "p": "Where we act as processor, the legal basis for the underlying processing is determined by our customer, not by us."
      },
      {
        "h2": "6. Cookies and analytics"
      },
      {
        "p": "We use essential cookies and local storage to run the site and keep you signed in, plus one optional partner-referral cookie that is set only if you accept it. Analytics is aggregated and cookieless. The full list, durations and how to change your choice are in the [Cookie Policy](/cookies)."
      },
      {
        "h2": "7. Retention"
      },
      {
        "ul": [
          "Telemetry and event data: **13 months** by default, then deleted.",
          "Trip records are kept longer for your own historical reporting, but their **coordinates are removed at the same 13-month point** — what remains is the distance, the times and the driver, with no way back to where the vehicle was.",
          "Account data: for the life of the account, then deleted or anonymised within 90 days.",
          "Invoices and accounting records: as required by Lithuanian law (currently 10 years).",
          "Security logs: up to 12 months."
        ]
      },
      {
        "h2": "8. Hosting and international transfers"
      },
      {
        "p": "Orbetra runs on infrastructure physically located in the European Union (Hetzner, Germany). Geocoding (Photon) and routing (OSRM) are self-hosted by us in the EU. Billing runs through Stripe Payments Europe in Ireland, transactional email through Postmark's EU endpoint, and DNS, TLS and DDoS protection through Cloudflare with EU-first routing."
      },
      {
        "p": "Two components involve providers outside the EEA. Map tiles in the product are served by Mapbox (United States), which receives request metadata such as IP address and the map area requested. The basemap on this marketing site is served by CARTO, again request metadata only and no customer data. Those transfers rely on the EU Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914) together with a transfer assessment and supplementary measures. Fleet telemetry and account data stay in the EU."
      },
      {
        "p": "Regional data-residency **entitlements** (choosing a specific region) are available on Scale and Enterprise plans; EU hosting applies to everyone."
      },
      {
        "h2": "9. Sub-processors"
      },
      {
        "p": "A current list is published at [orbetra.com/subprocessors](/subprocessors). We give 30 days' notice before adding or replacing a sub-processor, and customers may object as described in the [DPA](/dpa). We do not sell personal data, and we do not use customer data to train models or for advertising."
      },
      {
        "h2": "10. Security"
      },
      {
        "p": "TLS in transit, encryption at rest, role-based access with least privilege, audit logging, isolated tenants, and regular backups with tested restores. Single sign-on (SSO) is available on Scale and Enterprise plans. Access to production data is limited to the people who need it and is logged. The full list of technical and organisational measures is Annex II of the [DPA](/dpa)."
      },
      {
        "h2": "11. Personal data breaches"
      },
      {
        "p": "If a personal data breach affects data for which we are the controller, we notify the Lithuanian State Data Protection Inspectorate (VDAI) without undue delay and, where feasible, within 72 hours of becoming aware of it (GDPR Art. 33), and we inform affected individuals where the breach is likely to result in a high risk to their rights (Art. 34). Where we are the processor, we notify the affected customer without undue delay and within 72 hours of becoming aware, with the information the customer needs for its own notification."
      },
      {
        "h2": "12. Automated decision-making"
      },
      {
        "p": "We do not carry out automated decision-making that produces legal effects or similarly significantly affects individuals (GDPR Art. 22). The platform generates alerts, scores and reports from rules that the customer configures — for example speeding or geofence alerts — but any decision taken about a driver on the basis of those outputs is made by the customer, with human involvement, and is the customer's responsibility. We do not profile website visitors for advertising."
      },
      {
        "h2": "13. Children's data"
      },
      {
        "p": "Orbetra is a business service sold to organisations. It is not directed at children and we do not knowingly collect personal data from anyone under 16. If you believe a child's data has reached us, write to [hello@orbetra.com](mailto:hello@orbetra.com) and we will delete it."
      },
      {
        "h2": "14. Your rights"
      },
      {
        "p": "Under the GDPR you can request access, rectification, erasure, restriction and portability, object to processing based on legitimate interests, and withdraw consent at any time without affecting processing already carried out. Workspace owners can also run self-service export and erasure from inside the app."
      },
      {
        "p": "Write to [hello@orbetra.com](mailto:hello@orbetra.com). We answer within **one month** of receiving the request (GDPR Art. 12(3)); if the request is complex or you have sent several, we may extend by up to two further months and will tell you why within the first month. Requests are free unless they are manifestly unfounded or excessive. We may ask for information to confirm your identity, and we use it only for that check. If you are an end user of a customer's or reseller's workspace, contact them first — they are the controller; if you send the request to us, we will forward it to them without undue delay."
      },
      {
        "h2": "15. Complaints"
      },
      {
        "p": "If you think we have handled your data badly, tell us first — we would rather fix it. You also have the right to lodge a complaint with a supervisory authority. Our lead authority is the Lithuanian State Data Protection Inspectorate (Valstybinė duomenų apsaugos inspekcija, VDAI), Vilnius, Lithuania — [vdai.lrv.lt](https://vdai.lrv.lt). You may also complain to the supervisory authority of the EU country where you live or work, or where the alleged infringement took place."
      },
      {
        "h2": "16. Changes"
      },
      {
        "p": "We update this policy as the product changes and post the new version here with a revised \"last updated\" date. For material changes affecting customers we also give notice by email."
      }
    ]
  },
  "lt": {
    "title": "Privatumo politika",
    "label": "TEISINĖ INFORMACIJA",
    "updated": "2026 m. rugpjūtis",
    "notice": "Tai vertimas patogumo dėlei. Esant neatitikimams, vadovaujamasi angliška versija.",
    "blocks": [
      {
        "p": "Ši politika paaiškina, kaip mes tvarkome asmens duomenis svetainėje orbetra.com ir Orbetra platformoje. Ji apima tiek duomenis, dėl kurių sprendžiame patys, tiek duomenis, kuriuos tvarkome savo klientų vardu. Slapukai aprašomi atskirai [Slapukų politikoje](/cookies)."
      },
      {
        "h2": "1. Kas mes esame"
      },
      {
        "p": "Duomenų valdytojas, atliekantis 3 skirsnyje aprašytą tvarkymą, yra:"
      },
      {
        "ul": [
          "**MB Dokigo**, Lietuvos mažoji bendrija, veikianti kaip Orbetra",
          "Krivių g. 5, LT-01204 Vilnius, Lietuva",
          "Įmonės kodas **307575857**",
          "Direktorius: Ernestas Dubovskich",
          "Privatumo kontaktai: [hello@orbetra.com](mailto:hello@orbetra.com)"
        ]
      },
      {
        "p": "Duomenų apsaugos pareigūno nepaskyrėme. Visi privatumo klausimai, prašymai ir skundai siunčiami adresu [hello@orbetra.com](mailto:hello@orbetra.com) ir juos tvarko direktorius."
      },
      {
        "h2": "2. Du mūsų vaidmenys"
      },
      {
        "p": "Savo svetainės, rinkodaros, pardavimų ir atsiskaitymų atžvilgiu esame **valdytojas** — mes sprendžiame, kodėl ir kaip duomenys tvarkomi. Viskam, kas yra kliento Orbetra darbo aplinkoje — telemetrijai, kelionėms, vairuotojų įrašams, darbo aplinkos naudotojams — veikiame kaip **tvarkytojas** pagal dokumentuotus to kliento nurodymus. Baltos etiketės (white-label) perpardavėjų atveju perpardavėjas yra valdytojas savo galutinių klientų atžvilgiu, o mes liekame tvarkytoju. Šie vaidmenys, mūsų pareigos ir saugumo priemonės išdėstyti [Duomenų tvarkymo priede](/dpa), kuris yra kiekvienos kliento sutarties dalis. Jei esate vieno iš mūsų klientų vairuotojas ar darbuotojas, tas klientas sprendžia, kaip naudojami jūsų duomenys — pirmiausia kreipkitės į jį (žr. 14 skirsnį)."
      },
      {
        "h2": "3. Duomenys, kuriuos renkame kaip valdytojas"
      },
      {
        "ul": [
          "**Paskyros duomenys** — vardas, darbo el. paštas, įmonė, slaptažodžio maiša.",
          "**Atsiskaitymo duomenys** — planas, sąskaitos, PVM duomenys; mokėjimo kortelių duomenis tvarko mūsų mokėjimų teikėjas, mes jų niekada nesaugome.",
          "**Pagalbos ir užklausų duomenys** — žinutės, kurias mums siunčiate formomis ar el. paštu, įskaitant bandomojo naudojimo (pilot) užklausas.",
          "**Techniniai žurnalai** — IP adresas, naršyklės identifikatorius (user agent) ir užklausų metaduomenys, saugomi saugumo ir piktnaudžiavimo prevencijos tikslais.",
          "**Rekomendacijų priskyrimas** — neprivalomas slapukas, priskiriantis partnerį, jei atvykstate per `?ref=` nuorodą; nustatomas tik su jūsų sutikimu."
        ]
      },
      {
        "p": "Svetainės analitika yra apibendrinta ir be slapukų. Reklamos sekiklių nenaudojame."
      },
      {
        "h2": "4. Duomenys, tvarkomi kaip tvarkytojas"
      },
      {
        "p": "Darbo aplinkoje tvarkome įrenginių telemetriją (padėtis, greitis, uždegimas, skaitmeniniai įėjimai, maitinimo ir baterijos būsena, CAN duomenys, kai jie prieinami), keliones, geozonų ir taisyklių įvykius, vairuotojų įrašus, techninės priežiūros įrašus, įrenginiams siunčiamas komandas ir paskyros naudotojus. Transporto priemonės ir įrenginio tapatybė grindžiama įrenginio IMEI. Mes nesprendžiame, kas yra sekama, kurios transporto priemonės prijungtos ar kiek ilgai įrašai saugomi be platformos numatytųjų nuostatų — tai konfigūruoja klientas, ir klientas yra atsakingas už vairuotojų informavimą."
      },
      {
        "h2": "5. Teisiniai pagrindai"
      },
      {
        "ul": [
          "Sutarties vykdymas — paslaugos teikimas, atsiskaitymas, pagalba.",
          "Teisėti interesai — platformos apsauga, piktnaudžiavimo prevencija, produkto tobulinimas, partnerių priskyrimas.",
          "Sutikimas — neprivalomi slapukai ir rinkodaros el. laiškai, atšaukiami bet kuriuo metu.",
          "Teisinė prievolė — apskaitos ir mokesčių įrašai."
        ]
      },
      {
        "p": "Kai veikiame kaip tvarkytojas, pagrindinio tvarkymo teisinį pagrindą nustato mūsų klientas, o ne mes."
      },
      {
        "h2": "6. Slapukai ir analitika"
      },
      {
        "p": "Naudojame būtinuosius slapukus ir vietinę saugyklą svetainei veikti ir jūsų prisijungimui išlaikyti, taip pat vieną neprivalomą partnerio rekomendacijų slapuką, kuris nustatomas tik jums jį priėmus. Analitika yra apibendrinta ir be slapukų. Visą sąrašą, saugojimo trukmes ir kaip pakeisti savo pasirinkimą rasite [Slapukų politikoje](/cookies)."
      },
      {
        "h2": "7. Saugojimas"
      },
      {
        "ul": [
          "Telemetrijos ir įvykių duomenys: pagal numatytuosius nustatymus **13 mėnesių**, po to ištrinami.",
          "Kelionių įrašai saugomi ilgiau jūsų pačių istorinei ataskaitų teikimo funkcijai, tačiau jų **koordinatės pašalinamos tuo pačiu 13 mėnesių momentu** — lieka atstumas, laikai ir vairuotojas, be galimybės atsekti, kur transporto priemonė buvo.",
          "Paskyros duomenys: visą paskyros galiojimo laiką, po to ištrinami arba anonimizuojami per 90 dienų.",
          "Sąskaitos ir apskaitos įrašai: kaip reikalauja Lietuvos teisė (šiuo metu 10 metų).",
          "Saugumo žurnalai: iki 12 mėnesių."
        ]
      },
      {
        "h2": "8. Prieglobstis ir tarptautiniai duomenų perdavimai"
      },
      {
        "p": "Orbetra veikia infrastruktūroje, fiziškai esančioje Europos Sąjungoje (Hetzner, Vokietija). Geokodavimą (Photon) ir maršrutų sudarymą (OSRM) mes patys prieglobstime ES. Atsiskaitymai vykdomi per Stripe Payments Europe Airijoje, operaciniai el. laiškai — per Postmark ES galinį tašką, o DNS, TLS ir DDoS apsauga — per Cloudflare su ES pirmenybės maršrutizavimu."
      },
      {
        "p": "Du komponentai apima teikėjus už EEE ribų. Produkte esančius žemėlapio fragmentus (tiles) teikia Mapbox (Jungtinės Valstijos), gaunantis užklausų metaduomenis, tokius kaip IP adresas ir prašomas žemėlapio plotas. Šios rinkodaros svetainės pagrindinį žemėlapį teikia CARTO — vėlgi tik užklausų metaduomenys ir jokių klientų duomenų. Šie perdavimai grindžiami ES standartinėmis sutarčių sąlygomis (Komisijos įgyvendinimo sprendimas (ES) 2021/914) kartu su perdavimo vertinimu ir papildomomis priemonėmis. Autoparko telemetrija ir paskyros duomenys lieka ES."
      },
      {
        "p": "Regioninės duomenų buvimo vietos (data-residency) **teisės** (konkretaus regiono pasirinkimas) prieinamos Scale ir Enterprise planuose; ES prieglobstis taikomas visiems."
      },
      {
        "h2": "9. Subtvarkytojai"
      },
      {
        "p": "Dabartinis sąrašas skelbiamas adresu [orbetra.com/subprocessors](/subprocessors). Prieš pridėdami ar pakeisdami subtvarkytoją įspėjame prieš 30 dienų, o klientai gali prieštarauti, kaip aprašyta [DPA](/dpa). Asmens duomenų neparduodame ir nenaudojame klientų duomenų modeliams mokyti ar reklamai."
      },
      {
        "h2": "10. Saugumas"
      },
      {
        "p": "TLS perdavimo metu, šifravimas ramybės būsenoje, vaidmenimis pagrįsta prieiga su mažiausiomis privilegijomis, audito registravimas, izoliuoti nuomininkai (tenants) ir reguliarios atsarginės kopijos su testuotu atkūrimu. Bendroji prisijungimo sistema (SSO) prieinama Scale ir Enterprise planuose. Prieiga prie gamybinių duomenų suteikiama tik ją reikalingiems žmonėms ir yra registruojama. Visas techninių ir organizacinių priemonių sąrašas pateiktas [DPA](/dpa) II priede."
      },
      {
        "h2": "11. Asmens duomenų saugumo pažeidimai"
      },
      {
        "p": "Jei asmens duomenų saugumo pažeidimas paveikia duomenis, kurių atžvilgiu esame valdytojas, nedelsdami ir, kai įmanoma, per 72 valandas nuo sužinojimo apie jį pranešame Valstybinei duomenų apsaugos inspekcijai (VDAI) (BDAR 33 str.) ir informuojame paveiktus asmenis, kai pažeidimas gali kelti didelį pavojų jų teisėms (34 str.). Kai esame tvarkytojas, nedelsdami ir per 72 valandas nuo sužinojimo pranešame paveiktam klientui, pateikdami informaciją, kurios klientui reikia savo pranešimui."
      },
      {
        "h2": "12. Automatizuotas sprendimų priėmimas"
      },
      {
        "p": "Nevykdome automatizuoto sprendimų priėmimo, sukeliančio teisines pasekmes ar panašiai reikšmingai paveikiančio asmenis (BDAR 22 str.). Platforma generuoja įspėjimus, įvertinimus ir ataskaitas pagal kliento sukonfigūruotas taisykles — pavyzdžiui, greičio viršijimo ar geozonų įspėjimus — tačiau bet kokį sprendimą dėl vairuotojo, priimtą remiantis šiais rezultatais, priima klientas, dalyvaujant žmogui, ir tai yra kliento atsakomybė. Svetainės lankytojų reklamos tikslais neprofiliuojame."
      },
      {
        "h2": "13. Vaikų duomenys"
      },
      {
        "p": "Orbetra yra verslo paslauga, parduodama organizacijoms. Ji nėra skirta vaikams ir mes sąmoningai nerenkame asmens duomenų iš jaunesnių nei 16 metų asmenų. Jei manote, kad vaiko duomenys mus pasiekė, rašykite [hello@orbetra.com](mailto:hello@orbetra.com) ir mes juos ištrinsime."
      },
      {
        "h2": "14. Jūsų teisės"
      },
      {
        "p": "Pagal BDAR galite prašyti susipažinti su duomenimis, juos ištaisyti, ištrinti, apriboti jų tvarkymą ir perkelti, nesutikti su tvarkymu, grindžiamu teisėtais interesais, ir bet kuriuo metu atšaukti sutikimą, nedarant įtakos jau atliktam tvarkymui. Darbo aplinkos savininkai taip pat gali savarankiškai atlikti eksportą ir ištrynimą tiesiogiai programėlėje."
      },
      {
        "p": "Rašykite [hello@orbetra.com](mailto:hello@orbetra.com). Atsakome per **vieną mėnesį** nuo prašymo gavimo (BDAR 12 str. 3 d.); jei prašymas sudėtingas arba pateikėte kelis, galime pratęsti dar iki dviejų mėnesių ir per pirmąjį mėnesį jums paaiškinsime kodėl. Prašymai nemokami, nebent jie akivaizdžiai nepagrįsti ar pertekliniai. Galime paprašyti informacijos jūsų tapatybei patvirtinti ir naudojame ją tik šiam patikrinimui. Jei esate kliento ar perpardavėjo darbo aplinkos galutinis naudotojas, pirmiausia kreipkitės į juos — jie yra valdytojas; jei prašymą atsiųsite mums, nedelsdami jį jiems persiųsime."
      },
      {
        "h2": "15. Skundai"
      },
      {
        "p": "Jei manote, kad netinkamai tvarkėme jūsų duomenis, pirmiausia praneškite mums — verčiau tai ištaisysime. Taip pat turite teisę pateikti skundą priežiūros institucijai. Mūsų pagrindinė institucija yra Valstybinė duomenų apsaugos inspekcija (Valstybinė duomenų apsaugos inspekcija, VDAI), Vilnius, Lietuva — [vdai.lrv.lt](https://vdai.lrv.lt). Taip pat galite skųstis ES šalies, kurioje gyvenate ar dirbate, arba kurioje įvyko tariamas pažeidimas, priežiūros institucijai."
      },
      {
        "h2": "16. Pakeitimai"
      },
      {
        "p": "Šią politiką atnaujiname keičiantis produktui ir čia paskelbiame naują versiją su pataisyta „paskutinio atnaujinimo“ data. Apie esminius pakeitimus, turinčius įtakos klientams, taip pat pranešame el. paštu."
      }
    ]
  },
  "pl": {
    "title": "Polityka prywatności",
    "label": "INFORMACJE PRAWNE",
    "updated": "Sierpień 2026",
    "notice": "To jest tłumaczenie pomocnicze. W przypadku jakichkolwiek rozbieżności rozstrzygająca jest wersja angielska.",
    "blocks": [
      {
        "p": "Niniejsza polityka wyjaśnia, jak przetwarzamy dane osobowe w serwisie orbetra.com oraz na platformie Orbetra. Obejmuje zarówno dane, o których decydujemy samodzielnie, jak i dane, które przetwarzamy w imieniu naszych klientów. Pliki cookie opisano oddzielnie w [Polityce plików cookie](/cookies)."
      },
      {
        "h2": "1. Kim jesteśmy"
      },
      {
        "p": "Administratorem przetwarzania opisanego w sekcji 3 jest:"
      },
      {
        "ul": [
          "**MB Dokigo**, litewska mažoji bendrija, działająca pod marką Orbetra",
          "Krivių g. 5, LT-01204 Vilnius, Litwa",
          "Numer identyfikacyjny firmy **307575857**",
          "Dyrektor: Ernestas Dubovskich",
          "Kontakt w sprawach prywatności: [hello@orbetra.com](mailto:hello@orbetra.com)"
        ]
      },
      {
        "p": "Nie powołaliśmy inspektora ochrony danych. Wszystkie pytania, żądania i skargi dotyczące prywatności należy kierować na adres [hello@orbetra.com](mailto:hello@orbetra.com); obsługuje je dyrektor."
      },
      {
        "h2": "2. Nasze dwie role"
      },
      {
        "p": "W odniesieniu do naszej strony internetowej, marketingu, sprzedaży i rozliczeń jesteśmy **administratorem** — decydujemy, dlaczego i w jaki sposób dane są przetwarzane. W odniesieniu do wszystkiego, co znajduje się w przestrzeni roboczej Orbetra klienta — telemetrii, przejazdów, danych kierowców, użytkowników przestrzeni roboczej — działamy jako **podmiot przetwarzający** na udokumentowane polecenie tego klienta. W przypadku resellerów white-label reseller jest administratorem wobec swoich klientów końcowych, a my pozostajemy podmiotem przetwarzającym. Role te, nasze obowiązki oraz środki bezpieczeństwa określono w [Załączniku dotyczącym powierzenia przetwarzania danych](/dpa), który stanowi część każdej umowy z klientem. Jeśli jesteś kierowcą lub pracownikiem jednego z naszych klientów, to ten klient decyduje o sposobie wykorzystania Twoich danych — prosimy w pierwszej kolejności kierować żądanie do niego (zob. sekcja 14)."
      },
      {
        "h2": "3. Dane, które zbieramy jako administrator"
      },
      {
        "ul": [
          "**Dane konta** — imię i nazwisko, służbowy adres e-mail, firma, skrót hasła.",
          "**Dane rozliczeniowe** — plan, faktury, dane VAT; dane kart płatniczych obsługuje nasz dostawca płatności i nigdy nie są przez nas przechowywane.",
          "**Dane wsparcia i zapytań** — wiadomości przesyłane do nas za pośrednictwem formularzy lub e-maila, w tym zgłoszenia pilotażowe.",
          "**Dzienniki techniczne** — adres IP, agent użytkownika (user agent) i metadane żądań, przechowywane w celu zapewnienia bezpieczeństwa i zapobiegania nadużyciom.",
          "**Atrybucja poleceń** — opcjonalny plik cookie przypisujący partnera, jeśli trafisz do nas przez link `?ref=`, ustawiany wyłącznie za Twoją zgodą."
        ]
      },
      {
        "p": "Analityka strony jest zagregowana i nie korzysta z plików cookie. Nie stosujemy trackerów reklamowych."
      },
      {
        "h2": "4. Dane przetwarzane jako podmiot przetwarzający"
      },
      {
        "p": "W przestrzeni roboczej przetwarzamy telemetrię urządzeń (pozycja, prędkość, zapłon, wejścia cyfrowe, stan zasilania i baterii, dane CAN, jeśli są dostępne), przejazdy, zdarzenia geofence i reguł, dane kierowców, wpisy serwisowe, polecenia wysyłane do urządzeń oraz użytkowników konta. Tożsamość pojazdu i urządzenia opiera się na numerze IMEI urządzenia. Nie decydujemy o tym, co jest śledzone, które pojazdy są podłączone ani jak długo przechowywane są rekordy poza domyślnymi ustawieniami platformy — konfiguruje to klient, a klient jest odpowiedzialny za poinformowanie kierowców."
      },
      {
        "h2": "5. Podstawy prawne"
      },
      {
        "ul": [
          "Wykonanie umowy — świadczenie usługi, rozliczenia, wsparcie.",
          "Prawnie uzasadnione interesy — zabezpieczenie platformy, zapobieganie nadużyciom, ulepszanie produktu, atrybucja partnerów.",
          "Zgoda — opcjonalne pliki cookie i e-maile marketingowe, możliwe do wycofania w dowolnym momencie.",
          "Obowiązek prawny — dokumentacja księgowa i podatkowa."
        ]
      },
      {
        "p": "Gdy działamy jako podmiot przetwarzający, podstawę prawną leżącego u podstaw przetwarzania określa nasz klient, a nie my."
      },
      {
        "h2": "6. Pliki cookie i analityka"
      },
      {
        "p": "Używamy niezbędnych plików cookie i pamięci lokalnej do działania serwisu i utrzymania Twojego zalogowania, a także jednego opcjonalnego pliku cookie polecenia partnera, ustawianego tylko wtedy, gdy go zaakceptujesz. Analityka jest zagregowana i nie korzysta z plików cookie. Pełną listę, czasy przechowywania oraz sposób zmiany wyboru znajdziesz w [Polityce plików cookie](/cookies)."
      },
      {
        "h2": "7. Okres przechowywania"
      },
      {
        "ul": [
          "Dane telemetryczne i zdarzeń: domyślnie **13 miesięcy**, następnie usuwane.",
          "Rekordy przejazdów są przechowywane dłużej na potrzeby Twojej własnej sprawozdawczości historycznej, jednak ich **współrzędne są usuwane w tym samym 13-miesięcznym momencie** — pozostają dystans, czasy i kierowca, bez możliwości ustalenia, gdzie znajdował się pojazd.",
          "Dane konta: przez cały okres istnienia konta, następnie usuwane lub anonimizowane w ciągu 90 dni.",
          "Faktury i dokumentacja księgowa: zgodnie z wymogami prawa litewskiego (obecnie 10 lat).",
          "Dzienniki bezpieczeństwa: do 12 miesięcy."
        ]
      },
      {
        "h2": "8. Hosting i międzynarodowe przekazywanie danych"
      },
      {
        "p": "Orbetra działa na infrastrukturze fizycznie zlokalizowanej w Unii Europejskiej (Hetzner, Niemcy). Geokodowanie (Photon) i wyznaczanie tras (OSRM) hostujemy samodzielnie w UE. Rozliczenia realizowane są przez Stripe Payments Europe w Irlandii, e-maile transakcyjne przez punkt końcowy Postmark w UE, a DNS, TLS i ochrona przed DDoS przez Cloudflare z routingiem preferującym UE."
      },
      {
        "p": "Dwa komponenty obejmują dostawców spoza EOG. Kafelki mapy w produkcie dostarcza Mapbox (Stany Zjednoczone), który otrzymuje metadane żądań, takie jak adres IP i żądany obszar mapy. Mapę podkładową na tej stronie marketingowej dostarcza CARTO — również wyłącznie metadane żądań, bez żadnych danych klientów. Te przekazania opierają się na standardowych klauzulach umownych UE (decyzja wykonawcza Komisji (UE) 2021/914) wraz z oceną skutków przekazania i środkami uzupełniającymi. Telemetria floty i dane konta pozostają w UE."
      },
      {
        "p": "Regionalne **uprawnienia** do rezydencji danych (wybór konkretnego regionu) są dostępne w planach Scale i Enterprise; hosting w UE obowiązuje dla wszystkich."
      },
      {
        "h2": "9. Podmioty podprzetwarzające"
      },
      {
        "p": "Aktualna lista jest publikowana pod adresem [orbetra.com/subprocessors](/subprocessors). Z 30-dniowym wyprzedzeniem informujemy o dodaniu lub zmianie podmiotu podprzetwarzającego, a klienci mogą wnieść sprzeciw zgodnie z opisem w [DPA](/dpa). Nie sprzedajemy danych osobowych i nie wykorzystujemy danych klientów do trenowania modeli ani do reklamy."
      },
      {
        "h2": "10. Bezpieczeństwo"
      },
      {
        "p": "TLS podczas przesyłania, szyfrowanie w spoczynku, dostęp oparty na rolach z zasadą najmniejszych uprawnień, rejestrowanie audytowe, izolowani najemcy (tenants) oraz regularne kopie zapasowe z testowanym odtwarzaniem. Logowanie jednokrotne (SSO) jest dostępne w planach Scale i Enterprise. Dostęp do danych produkcyjnych jest ograniczony do osób, które go potrzebują, i jest rejestrowany. Pełna lista środków technicznych i organizacyjnych stanowi Załącznik II do [DPA](/dpa)."
      },
      {
        "h2": "11. Naruszenia ochrony danych osobowych"
      },
      {
        "p": "Jeśli naruszenie ochrony danych osobowych dotyczy danych, których jesteśmy administratorem, bez zbędnej zwłoki i, w miarę możliwości, w ciągu 72 godzin od stwierdzenia naruszenia zgłaszamy je litewskiej Państwowej Inspekcji Ochrony Danych (VDAI) (art. 33 RODO) oraz informujemy osoby, których dane dotyczą, gdy naruszenie może powodować wysokie ryzyko dla ich praw (art. 34). Gdy jesteśmy podmiotem przetwarzającym, bez zbędnej zwłoki i w ciągu 72 godzin od stwierdzenia naruszenia informujemy o nim klienta, którego dotyczy, przekazując informacje potrzebne mu do własnego zgłoszenia."
      },
      {
        "h2": "12. Zautomatyzowane podejmowanie decyzji"
      },
      {
        "p": "Nie prowadzimy zautomatyzowanego podejmowania decyzji, które wywołuje skutki prawne lub w podobny sposób istotnie wpływa na osoby (art. 22 RODO). Platforma generuje alerty, oceny i raporty na podstawie reguł konfigurowanych przez klienta — na przykład alerty o przekroczeniu prędkości lub geofence — jednak każda decyzja podjęta wobec kierowcy na podstawie tych wyników jest podejmowana przez klienta, z udziałem człowieka, i stanowi odpowiedzialność klienta. Nie profilujemy odwiedzających witrynę w celach reklamowych."
      },
      {
        "h2": "13. Dane dzieci"
      },
      {
        "p": "Orbetra to usługa biznesowa sprzedawana organizacjom. Nie jest skierowana do dzieci i nie zbieramy świadomie danych osobowych od osób poniżej 16. roku życia. Jeśli sądzisz, że dotarły do nas dane dziecka, napisz na [hello@orbetra.com](mailto:hello@orbetra.com), a my je usuniemy."
      },
      {
        "h2": "14. Twoje prawa"
      },
      {
        "p": "Na mocy RODO możesz żądać dostępu, sprostowania, usunięcia, ograniczenia i przenoszenia danych, wnieść sprzeciw wobec przetwarzania opartego na prawnie uzasadnionych interesach oraz w dowolnym momencie wycofać zgodę, bez wpływu na przetwarzanie już dokonane. Właściciele przestrzeni roboczych mogą również samodzielnie przeprowadzić eksport i usunięcie danych bezpośrednio w aplikacji."
      },
      {
        "p": "Napisz na [hello@orbetra.com](mailto:hello@orbetra.com). Odpowiadamy w ciągu **jednego miesiąca** od otrzymania żądania (art. 12 ust. 3 RODO); jeśli żądanie jest złożone lub przesłałeś ich kilka, możemy przedłużyć termin o maksymalnie dwa kolejne miesiące i w ciągu pierwszego miesiąca poinformujemy Cię dlaczego. Żądania są bezpłatne, chyba że są ewidentnie nieuzasadnione lub nadmierne. Możemy poprosić o informacje potwierdzające Twoją tożsamość i wykorzystujemy je wyłącznie do tej weryfikacji. Jeśli jesteś użytkownikiem końcowym przestrzeni roboczej klienta lub resellera, skontaktuj się najpierw z nimi — to oni są administratorem; jeśli prześlesz żądanie do nas, przekażemy je im bez zbędnej zwłoki."
      },
      {
        "h2": "15. Skargi"
      },
      {
        "p": "Jeśli uważasz, że niewłaściwie postąpiliśmy z Twoimi danymi, powiedz nam o tym najpierw — wolimy to naprawić. Masz również prawo wnieść skargę do organu nadzorczego. Naszym wiodącym organem jest litewska Państwowa Inspekcja Ochrony Danych (Valstybinė duomenų apsaugos inspekcija, VDAI), Wilno, Litwa — [vdai.lrv.lt](https://vdai.lrv.lt). Możesz również złożyć skargę do organu nadzorczego kraju UE, w którym mieszkasz lub pracujesz, albo w którym doszło do domniemanego naruszenia."
      },
      {
        "h2": "16. Zmiany"
      },
      {
        "p": "Aktualizujemy niniejszą politykę wraz ze zmianami produktu i publikujemy tutaj nową wersję ze zmienioną datą „ostatniej aktualizacji”. O istotnych zmianach dotyczących klientów informujemy dodatkowo e-mailem."
      }
    ]
  },
  "de": {
    "title": "Datenschutzerklärung",
    "label": "RECHTLICHES",
    "updated": "August 2026",
    "notice": "Dies ist eine Übersetzung zu Informationszwecken. Im Falle von Abweichungen ist die englische Fassung maßgeblich.",
    "blocks": [
      {
        "p": "Diese Erklärung beschreibt, wie wir personenbezogene Daten auf orbetra.com und in der Orbetra-Plattform verarbeiten. Sie umfasst sowohl die Daten, über die wir selbst entscheiden, als auch die Daten, die wir für unsere Kunden verarbeiten. Cookies werden gesondert in der [Cookie-Richtlinie](/cookies) beschrieben."
      },
      {
        "h2": "1. Wer wir sind"
      },
      {
        "p": "Verantwortlicher für die in Abschnitt 3 beschriebene Verarbeitung ist:"
      },
      {
        "ul": [
          "**MB Dokigo**, eine litauische mažoji bendrija, auftretend als Orbetra",
          "Krivių g. 5, LT-01204 Vilnius, Litauen",
          "Unternehmenscode **307575857**",
          "Geschäftsführer: Ernestas Dubovskich",
          "Datenschutzkontakt: [hello@orbetra.com](mailto:hello@orbetra.com)"
        ]
      },
      {
        "p": "Wir haben keinen Datenschutzbeauftragten bestellt. Alle Datenschutzanfragen, -anträge und -beschwerden gehen an [hello@orbetra.com](mailto:hello@orbetra.com) und werden vom Geschäftsführer bearbeitet."
      },
      {
        "h2": "2. Unsere zwei Rollen"
      },
      {
        "p": "Für unsere Website, unser Marketing, unseren Vertrieb und unsere Abrechnung sind wir **Verantwortlicher** — wir entscheiden, warum und wie die Daten verarbeitet werden. Für alles innerhalb des Orbetra-Arbeitsbereichs eines Kunden — Telemetrie, Fahrten, Fahrerdaten, Arbeitsbereichsnutzer — handeln wir als **Auftragsverarbeiter** auf dokumentierte Weisung dieses Kunden. Bei White-Label-Wiederverkäufern ist der Wiederverkäufer gegenüber seinen eigenen Endkunden Verantwortlicher, und wir bleiben Auftragsverarbeiter. Diese Rollen, unsere Pflichten und die Sicherheitsmaßnahmen sind im [Auftragsverarbeitungsvertrag](/dpa) festgelegt, der Bestandteil jedes Kundenvertrags ist. Wenn Sie Fahrer oder Mitarbeiter eines unserer Kunden sind, entscheidet dieser Kunde, wie Ihre Daten verwendet werden — bitte richten Sie Ihre Anfrage zunächst an ihn (siehe Abschnitt 14)."
      },
      {
        "h2": "3. Daten, die wir als Verantwortlicher erheben"
      },
      {
        "ul": [
          "**Kontodaten** — Name, geschäftliche E-Mail-Adresse, Unternehmen, Passwort-Hash.",
          "**Abrechnungsdaten** — Tarif, Rechnungen, USt-Angaben; Kartendaten werden von unserem Zahlungsdienstleister verarbeitet und niemals von uns gespeichert.",
          "**Support- und Anfragedaten** — Nachrichten, die Sie uns über Formulare oder E-Mail senden, einschließlich Pilotanfragen.",
          "**Technische Protokolle** — IP-Adresse, User-Agent und Anfrage-Metadaten, gespeichert zur Sicherheit und zur Missbrauchsprävention.",
          "**Empfehlungszuordnung** — ein optionales Cookie, das einem Partner eine Empfehlung zuordnet, wenn Sie über einen `?ref=`-Link zu uns gelangen; nur mit Ihrer Einwilligung gesetzt."
        ]
      },
      {
        "p": "Die Website-Analyse ist aggregiert und cookielos. Wir setzen keine Werbe-Tracker ein."
      },
      {
        "h2": "4. Als Auftragsverarbeiter verarbeitete Daten"
      },
      {
        "p": "Innerhalb eines Arbeitsbereichs verarbeiten wir Gerätetelemetrie (Position, Geschwindigkeit, Zündung, digitale Eingänge, Strom- und Batteriestatus, CAN-Daten sofern verfügbar), Fahrten, Geofence- und Regelereignisse, Fahrerdaten, Wartungseinträge, an Geräte gesendete Befehle sowie Kontonutzer. Die Identität von Fahrzeug und Gerät basiert auf der IMEI des Geräts. Wir entscheiden nicht, was erfasst wird, welche Fahrzeuge angebunden sind oder wie lange Datensätze über die Plattformvorgaben hinaus aufbewahrt werden — das konfiguriert der Kunde, und der Kunde ist für die Information der Fahrer verantwortlich."
      },
      {
        "h2": "5. Rechtsgrundlagen"
      },
      {
        "ul": [
          "Vertragserfüllung — Bereitstellung des Dienstes, Abrechnung, Support.",
          "Berechtigte Interessen — Absicherung der Plattform, Missbrauchsprävention, Produktverbesserung, Partnerzuordnung.",
          "Einwilligung — optionale Cookies und Marketing-E-Mails, jederzeit widerrufbar.",
          "Rechtliche Verpflichtung — Buchhaltungs- und Steuerunterlagen."
        ]
      },
      {
        "p": "Soweit wir als Auftragsverarbeiter handeln, wird die Rechtsgrundlage der zugrunde liegenden Verarbeitung von unserem Kunden und nicht von uns bestimmt."
      },
      {
        "h2": "6. Cookies und Analyse"
      },
      {
        "p": "Wir verwenden notwendige Cookies und lokalen Speicher, um die Website zu betreiben und Sie angemeldet zu halten, sowie ein optionales Partner-Empfehlungs-Cookie, das nur gesetzt wird, wenn Sie es akzeptieren. Die Analyse ist aggregiert und cookielos. Die vollständige Liste, die Speicherdauern und wie Sie Ihre Auswahl ändern, finden Sie in der [Cookie-Richtlinie](/cookies)."
      },
      {
        "h2": "7. Speicherdauer"
      },
      {
        "ul": [
          "Telemetrie- und Ereignisdaten: standardmäßig **13 Monate**, danach gelöscht.",
          "Fahrtdatensätze werden für Ihre eigene historische Berichterstattung länger aufbewahrt, aber ihre **Koordinaten werden zum selben 13-Monats-Zeitpunkt entfernt** — es bleiben die Strecke, die Zeiten und der Fahrer, ohne Möglichkeit, nachzuvollziehen, wo sich das Fahrzeug befand.",
          "Kontodaten: für die Dauer des Kontos, danach innerhalb von 90 Tagen gelöscht oder anonymisiert.",
          "Rechnungen und Buchhaltungsunterlagen: gemäß litauischem Recht (derzeit 10 Jahre).",
          "Sicherheitsprotokolle: bis zu 12 Monate."
        ]
      },
      {
        "h2": "8. Hosting und internationale Datenübermittlungen"
      },
      {
        "p": "Orbetra läuft auf einer Infrastruktur, die physisch in der Europäischen Union angesiedelt ist (Hetzner, Deutschland). Geokodierung (Photon) und Routing (OSRM) hosten wir selbst in der EU. Die Abrechnung läuft über Stripe Payments Europe in Irland, transaktionale E-Mails über den EU-Endpunkt von Postmark und DNS, TLS sowie DDoS-Schutz über Cloudflare mit EU-bevorzugtem Routing."
      },
      {
        "p": "Zwei Komponenten betreffen Anbieter außerhalb des EWR. Kartenkacheln im Produkt werden von Mapbox (Vereinigte Staaten) bereitgestellt, das Anfrage-Metadaten wie IP-Adresse und den angeforderten Kartenausschnitt erhält. Die Basiskarte auf dieser Marketing-Website wird von CARTO bereitgestellt — ebenfalls nur Anfrage-Metadaten und keine Kundendaten. Diese Übermittlungen stützen sich auf die EU-Standardvertragsklauseln (Durchführungsbeschluss (EU) 2021/914 der Kommission) zusammen mit einer Übermittlungsfolgenabschätzung und zusätzlichen Maßnahmen. Flottentelemetrie und Kontodaten verbleiben in der EU."
      },
      {
        "p": "Regionale **Berechtigungen** zur Datenlokalisierung (Auswahl einer bestimmten Region) sind in den Tarifen Scale und Enterprise verfügbar; das EU-Hosting gilt für alle."
      },
      {
        "h2": "9. Unterauftragsverarbeiter"
      },
      {
        "p": "Eine aktuelle Liste wird unter [orbetra.com/subprocessors](/subprocessors) veröffentlicht. Wir kündigen die Hinzunahme oder den Austausch eines Unterauftragsverarbeiters 30 Tage im Voraus an, und Kunden können gemäß der Beschreibung im [DPA](/dpa) widersprechen. Wir verkaufen keine personenbezogenen Daten und verwenden Kundendaten weder zum Trainieren von Modellen noch für Werbung."
      },
      {
        "h2": "10. Sicherheit"
      },
      {
        "p": "TLS bei der Übertragung, Verschlüsselung im Ruhezustand, rollenbasierter Zugriff nach dem Prinzip der geringsten Rechte, Audit-Protokollierung, isolierte Mandanten (Tenants) und regelmäßige Backups mit getesteter Wiederherstellung. Single Sign-On (SSO) ist in den Tarifen Scale und Enterprise verfügbar. Der Zugriff auf Produktivdaten ist auf die Personen beschränkt, die ihn benötigen, und wird protokolliert. Die vollständige Liste der technischen und organisatorischen Maßnahmen ist Anlage II des [DPA](/dpa)."
      },
      {
        "h2": "11. Verletzungen des Schutzes personenbezogener Daten"
      },
      {
        "p": "Betrifft eine Verletzung des Schutzes personenbezogener Daten Daten, für die wir Verantwortlicher sind, melden wir sie unverzüglich und, sofern möglich, binnen 72 Stunden nach Bekanntwerden der litauischen staatlichen Datenschutzaufsichtsbehörde (VDAI) (Art. 33 DSGVO) und informieren die betroffenen Personen, wenn die Verletzung voraussichtlich ein hohes Risiko für ihre Rechte zur Folge hat (Art. 34). Sind wir Auftragsverarbeiter, informieren wir den betroffenen Kunden unverzüglich und binnen 72 Stunden nach Bekanntwerden mit den Informationen, die der Kunde für seine eigene Meldung benötigt."
      },
      {
        "h2": "12. Automatisierte Entscheidungsfindung"
      },
      {
        "p": "Wir führen keine automatisierte Entscheidungsfindung durch, die rechtliche Wirkung entfaltet oder Personen in ähnlicher Weise erheblich beeinträchtigt (Art. 22 DSGVO). Die Plattform erzeugt Warnungen, Bewertungen und Berichte anhand von Regeln, die der Kunde konfiguriert — zum Beispiel Warnungen bei Geschwindigkeitsüberschreitung oder Geofence — doch jede Entscheidung, die auf Grundlage dieser Ergebnisse über einen Fahrer getroffen wird, trifft der Kunde unter Einbeziehung eines Menschen und liegt in der Verantwortung des Kunden. Wir erstellen keine Profile von Website-Besuchern zu Werbezwecken."
      },
      {
        "h2": "13. Daten von Kindern"
      },
      {
        "p": "Orbetra ist ein Geschäftsdienst, der an Organisationen verkauft wird. Er richtet sich nicht an Kinder, und wir erheben wissentlich keine personenbezogenen Daten von Personen unter 16 Jahren. Wenn Sie glauben, dass uns Daten eines Kindes erreicht haben, schreiben Sie an [hello@orbetra.com](mailto:hello@orbetra.com), und wir werden sie löschen."
      },
      {
        "h2": "14. Ihre Rechte"
      },
      {
        "p": "Nach der DSGVO können Sie Auskunft, Berichtigung, Löschung, Einschränkung und Datenübertragbarkeit verlangen, der auf berechtigten Interessen beruhenden Verarbeitung widersprechen und Ihre Einwilligung jederzeit widerrufen, ohne dass die Rechtmäßigkeit der bereits erfolgten Verarbeitung berührt wird. Inhaber von Arbeitsbereichen können Export und Löschung auch als Self-Service direkt in der App durchführen."
      },
      {
        "p": "Schreiben Sie an [hello@orbetra.com](mailto:hello@orbetra.com). Wir antworten innerhalb **eines Monats** nach Eingang des Antrags (Art. 12 Abs. 3 DSGVO); ist der Antrag komplex oder haben Sie mehrere gestellt, können wir um bis zu zwei weitere Monate verlängern und teilen Ihnen den Grund innerhalb des ersten Monats mit. Anträge sind kostenlos, es sei denn, sie sind offenkundig unbegründet oder exzessiv. Wir können Informationen zur Bestätigung Ihrer Identität anfordern und verwenden diese ausschließlich für diese Prüfung. Wenn Sie Endnutzer des Arbeitsbereichs eines Kunden oder Wiederverkäufers sind, wenden Sie sich zuerst an diesen — er ist der Verantwortliche; senden Sie den Antrag an uns, leiten wir ihn unverzüglich an ihn weiter."
      },
      {
        "h2": "15. Beschwerden"
      },
      {
        "p": "Wenn Sie der Ansicht sind, dass wir mit Ihren Daten schlecht umgegangen sind, sagen Sie es uns zuerst — wir bringen es lieber in Ordnung. Sie haben außerdem das Recht, bei einer Aufsichtsbehörde Beschwerde einzulegen. Unsere federführende Behörde ist die litauische staatliche Datenschutzaufsichtsbehörde (Valstybinė duomenų apsaugos inspekcija, VDAI), Vilnius, Litauen — [vdai.lrv.lt](https://vdai.lrv.lt). Sie können sich auch an die Aufsichtsbehörde des EU-Landes wenden, in dem Sie wohnen oder arbeiten oder in dem der mutmaßliche Verstoß stattgefunden hat."
      },
      {
        "h2": "16. Änderungen"
      },
      {
        "p": "Wir aktualisieren diese Erklärung, wenn sich das Produkt ändert, und veröffentlichen die neue Fassung hier mit einem aktualisierten Datum der „letzten Aktualisierung“. Bei wesentlichen Änderungen, die Kunden betreffen, informieren wir zusätzlich per E-Mail."
      }
    ]
  }
};
