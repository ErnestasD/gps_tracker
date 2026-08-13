import type { LocalizedDoc } from "./types";

/**
 * cookies — long-form content authored EN (source of truth) + LT/PL/DE translations (W9 i18n).
 * Generated from the extraction/translation workflow; edit the prose here directly going forward.
 */
export const cookies: LocalizedDoc = {
  "en": {
    "title": "Cookie Policy",
    "label": "LEGAL",
    "updated": "August 2026",
    "notice": "This is a convenience translation. In case of any discrepancy, the English version prevails.",
    "blocks": [
      {
        "p": "Orbetra uses minimal cookies: essential ones needed to run the site and the app, and one optional cookie that credits a partner referral. Our product analytics is cookieless and aggregated — we do not run advertising or cross-site tracking cookies."
      },
      {
        "h2": "1. What cookies are"
      },
      {
        "p": "A cookie is a small file a site stores in your browser and reads back on later requests. Local storage and session storage do the same job with a different browser API, and the same rules apply — so we list all three below. Cookies that are strictly necessary to deliver a service you asked for do not need consent; anything else does, and we ask for it before setting it."
      },
      {
        "h2": "2. What we set"
      },
      {
        "table": {
          "head": [
            "Name",
            "Type",
            "Purpose",
            "Duration"
          ],
          "rows": [
            [
              "`orbetra_cookie_consent`",
              "Essential",
              "Stores your cookie choice so we don't ask again.",
              "Local storage — until you change it or clear site data"
            ],
            [
              "`orbetra_lang`",
              "Essential",
              "Remembers your interface language (EN/PL/DE/LT).",
              "Local storage — until you change it or clear site data"
            ],
            [
              "`orb_refresh`",
              "Essential",
              "Keeps you signed in to the Orbetra app. HttpOnly and SameSite=Strict, and sent only to the authentication endpoint — never with map or data requests.",
              "14 days, renewed while you stay signed in"
            ],
            [
              "`tc_ref`",
              "Optional",
              "Credits a partner referral when you arrive via a `?ref=` link. Set only if you accept, and deleted if you choose essential only.",
              "60 days"
            ],
            [
              "`tc_ref_pending`",
              "Optional",
              "Holds a referral code from a `?ref=` link until you answer the banner, so the referral is not lost while you decide. Discarded if you choose essential only.",
              "Session storage — cleared when you close the tab"
            ]
          ]
        }
      },
      {
        "p": "The optional `tc_ref` cookie is the only non-essential item. It is written only after you choose \"Accept all\", it holds nothing but the partner code from the `?ref=` link, and choosing \"Essential only\" deletes it."
      },
      {
        "h2": "3. Analytics"
      },
      {
        "p": "Our website analytics is aggregated and cookieless: it counts page views and referrers without storing anything in your browser and without building a profile of you. We do not use Google Analytics, advertising pixels, or cross-site trackers, and we do not sell or share visitor data."
      },
      {
        "h2": "4. Third-party requests from maps"
      },
      {
        "p": "Map tiles are loaded from Mapbox in the product and from CARTO on this marketing site. Loading a tile is a normal web request, so those providers receive technical metadata — your IP address, browser user agent and the map area requested. We do not send them your account details or your fleet data, and neither provider is used to track you across sites. See the [Privacy Policy](/privacy) for the transfer safeguards that apply."
      },
      {
        "h2": "5. Your choice"
      },
      {
        "p": "You can change your decision at any time, here or from the banner. Withdrawing consent is as easy as giving it: choosing \"Essential only\" deletes the referral cookie immediately."
      },
      {
        "p": "Your browser can also block or delete cookies and clear local storage for a site — the settings live under Privacy or Site data in Chrome, Firefox, Safari and Edge. Blocking essential items will sign you out of the app and reset your language choice."
      },
      {
        "h2": "6. Changes and contact"
      },
      {
        "p": "If we add or change a cookie we update this page, and we ask for consent again if the change affects a non-essential one. Questions go to [hello@orbetra.com](mailto:hello@orbetra.com). How we handle personal data more generally is described in the [Privacy Policy](/privacy)."
      }
    ]
  },
  "lt": {
    "title": "Slapukų politika",
    "label": "TEISINĖ INFORMACIJA",
    "updated": "2026 m. rugpjūtis",
    "notice": "Tai neoficialus vertimas patogumui. Esant bet kokiems neatitikimams, pirmenybė teikiama angliškai versijai.",
    "blocks": [
      {
        "p": "Orbetra naudoja minimalų slapukų kiekį: būtinuosius, reikalingus svetainei ir programėlei veikti, ir vieną neprivalomą slapuką, kuris įskaito partnerio rekomendaciją. Mūsų produkto analitika veikia be slapukų ir yra apibendrinta — mes nenaudojame reklaminių ar tarpsvetaininio sekimo slapukų."
      },
      {
        "h2": "1. Kas yra slapukai"
      },
      {
        "p": "Slapukas — tai nedidelis failas, kurį svetainė išsaugo jūsų naršyklėje ir nuskaito vėlesnių užklausų metu. Vietinė saugykla (local storage) ir seanso saugykla (session storage) atlieka tą patį darbą naudodamos kitą naršyklės API, ir joms taikomos tos pačios taisyklės — todėl toliau išvardijame visus tris. Slapukams, kurie yra griežtai būtini jūsų prašytai paslaugai suteikti, sutikimo nereikia; visiems kitiems jo reikia, ir mes jo paprašome prieš juos įrašydami."
      },
      {
        "h2": "2. Ką įrašome"
      },
      {
        "table": {
          "head": [
            "Pavadinimas",
            "Tipas",
            "Paskirtis",
            "Trukmė"
          ],
          "rows": [
            [
              "`orbetra_cookie_consent`",
              "Būtinasis",
              "Įsimena jūsų pasirinkimą dėl slapukų, kad daugiau neklaustume.",
              "Vietinė saugykla — kol jo nepakeisite arba neišvalysite svetainės duomenų"
            ],
            [
              "`orbetra_lang`",
              "Būtinasis",
              "Įsimena jūsų sąsajos kalbą (EN/PL/DE/LT).",
              "Vietinė saugykla — kol jos nepakeisite arba neišvalysite svetainės duomenų"
            ],
            [
              "`orb_refresh`",
              "Būtinasis",
              "Palaiko jus prisijungusius prie Orbetra programėlės. HttpOnly ir SameSite=Strict, siunčiamas tik į autentifikavimo galinį tašką — niekada su žemėlapio ar duomenų užklausomis.",
              "14 dienų, atnaujinamas kol išliekate prisijungę"
            ],
            [
              "`tc_ref`",
              "Neprivalomasis",
              "Įskaito partnerio rekomendaciją, kai atvykstate per `?ref=` nuorodą. Įrašomas tik jei sutinkate, ir ištrinamas, jei pasirenkate tik būtinuosius.",
              "60 dienų"
            ],
            [
              "`tc_ref_pending`",
              "Neprivalomasis",
              "Laiko rekomendacijos kodą iš `?ref=` nuorodos, kol atsakysite į juostą, kad rekomendacija nebūtų prarasta, kol svarstote. Atmetamas, jei pasirenkate tik būtinuosius.",
              "Seanso saugykla — išvaloma uždarius kortelę"
            ]
          ]
        }
      },
      {
        "p": "Neprivalomasis `tc_ref` slapukas yra vienintelis nebūtinas elementas. Jis įrašomas tik po to, kai pasirenkate „Priimti visus“, jame nėra nieko, išskyrus partnerio kodą iš `?ref=` nuorodos, o pasirinkus „Tik būtinieji“ jis ištrinamas."
      },
      {
        "h2": "3. Analitika"
      },
      {
        "p": "Mūsų svetainės analitika yra apibendrinta ir be slapukų: ji skaičiuoja puslapių peržiūras ir nukreipiančius šaltinius, nieko nesaugodama jūsų naršyklėje ir nekurdama jūsų profilio. Mes nenaudojame nei Google Analytics, nei reklaminių pikselių, nei tarpsvetaininio sekimo priemonių, taip pat neparduodame ir nesidaliname lankytojų duomenimis."
      },
      {
        "h2": "4. Trečiųjų šalių užklausos iš žemėlapių"
      },
      {
        "p": "Žemėlapių išklotinės (tiles) produkte įkeliamos iš Mapbox, o šioje rinkodaros svetainėje — iš CARTO. Išklotinės įkėlimas yra įprasta žiniatinklio užklausa, todėl šie tiekėjai gauna techninius metaduomenis — jūsų IP adresą, naršyklės user agent ir prašomą žemėlapio sritį. Mes nesiunčiame jiems jūsų paskyros duomenų ar jūsų parko duomenų, ir nė vienas tiekėjas nenaudojamas jums sekti įvairiose svetainėse. Perdavimo apsaugos priemones, kurios taikomos, rasite [Privatumo politikoje](/privacy)."
      },
      {
        "h2": "5. Jūsų pasirinkimas"
      },
      {
        "p": "Savo sprendimą galite pakeisti bet kada — čia arba juostoje. Atšaukti sutikimą taip pat paprasta, kaip jį duoti: pasirinkus „Tik būtinieji“, rekomendacijos slapukas nedelsiant ištrinamas."
      },
      {
        "p": "Jūsų naršyklė taip pat gali blokuoti arba ištrinti slapukus ir išvalyti svetainės vietinę saugyklą — šie nustatymai yra skiltyje Privatumas arba Svetainės duomenys naršyklėse Chrome, Firefox, Safari ir Edge. Būtinųjų elementų blokavimas atjungs jus nuo programėlės ir atstatys jūsų kalbos pasirinkimą."
      },
      {
        "h2": "6. Pakeitimai ir kontaktai"
      },
      {
        "p": "Jei pridedame ar keičiame slapuką, atnaujiname šį puslapį, o jei pakeitimas susijęs su nebūtinuoju slapuku, sutikimo paprašome iš naujo. Klausimus siųskite adresu [hello@orbetra.com](mailto:hello@orbetra.com). Kaip apskritai tvarkome asmens duomenis, aprašyta [Privatumo politikoje](/privacy)."
      }
    ]
  },
  "pl": {
    "title": "Polityka plików cookie",
    "label": "INFORMACJE PRAWNE",
    "updated": "sierpień 2026",
    "notice": "To jest tłumaczenie pomocnicze. W przypadku jakichkolwiek rozbieżności rozstrzygająca jest wersja angielska.",
    "blocks": [
      {
        "p": "Orbetra używa minimalnej liczby plików cookie: niezbędnych do działania witryny i aplikacji oraz jednego opcjonalnego pliku, który zalicza polecenie partnerskie. Nasza analityka produktowa działa bez plików cookie i jest zagregowana — nie stosujemy reklamowych ani śledzących między witrynami plików cookie."
      },
      {
        "h2": "1. Czym są pliki cookie"
      },
      {
        "p": "Plik cookie to niewielki plik, który witryna zapisuje w Twojej przeglądarce i odczytuje przy kolejnych żądaniach. Pamięć lokalna (local storage) i pamięć sesji (session storage) realizują to samo zadanie za pomocą innego API przeglądarki i obowiązują je te same zasady — dlatego wszystkie trzy wymieniamy poniżej. Pliki cookie ściśle niezbędne do świadczenia usługi, o którą prosiłeś, nie wymagają zgody; wszystkie pozostałe jej wymagają, a my prosimy o nią przed ich zapisaniem."
      },
      {
        "h2": "2. Co ustawiamy"
      },
      {
        "table": {
          "head": [
            "Nazwa",
            "Typ",
            "Cel",
            "Czas przechowywania"
          ],
          "rows": [
            [
              "`orbetra_cookie_consent`",
              "Niezbędny",
              "Zapisuje Twój wybór dotyczący plików cookie, abyśmy nie pytali ponownie.",
              "Pamięć lokalna — do czasu zmiany lub wyczyszczenia danych witryny"
            ],
            [
              "`orbetra_lang`",
              "Niezbędny",
              "Zapamiętuje język interfejsu (EN/PL/DE/LT).",
              "Pamięć lokalna — do czasu zmiany lub wyczyszczenia danych witryny"
            ],
            [
              "`orb_refresh`",
              "Niezbędny",
              "Utrzymuje Twoje zalogowanie w aplikacji Orbetra. HttpOnly i SameSite=Strict, wysyłany wyłącznie do punktu końcowego uwierzytelniania — nigdy z żądaniami map lub danych.",
              "14 dni, odnawiany, gdy pozostajesz zalogowany"
            ],
            [
              "`tc_ref`",
              "Opcjonalny",
              "Zalicza polecenie partnerskie, gdy trafiasz przez link `?ref=`. Ustawiany tylko, jeśli wyrazisz zgodę, i usuwany, jeśli wybierzesz tylko niezbędne.",
              "60 dni"
            ],
            [
              "`tc_ref_pending`",
              "Opcjonalny",
              "Przechowuje kod polecenia z linku `?ref=` do czasu odpowiedzi na baner, aby polecenie nie zostało utracone, zanim podejmiesz decyzję. Odrzucany, jeśli wybierzesz tylko niezbędne.",
              "Pamięć sesji — usuwana po zamknięciu karty"
            ]
          ]
        }
      },
      {
        "p": "Opcjonalny plik `tc_ref` to jedyny element nie-niezbędny. Jest zapisywany dopiero po wybraniu opcji „Zaakceptuj wszystkie”, zawiera wyłącznie kod partnera z linku `?ref=`, a wybranie opcji „Tylko niezbędne” go usuwa."
      },
      {
        "h2": "3. Analityka"
      },
      {
        "p": "Analityka naszej witryny jest zagregowana i działa bez plików cookie: zlicza odsłony stron i źródła odesłań, nie zapisując niczego w Twojej przeglądarce i nie tworząc Twojego profilu. Nie używamy Google Analytics, pikseli reklamowych ani narzędzi śledzących między witrynami, a także nie sprzedajemy ani nie udostępniamy danych odwiedzających."
      },
      {
        "h2": "4. Żądania stron trzecich z map"
      },
      {
        "p": "Kafelki map w produkcie są ładowane z Mapbox, a na tej witrynie marketingowej z CARTO. Załadowanie kafelka to zwykłe żądanie sieciowe, więc dostawcy ci otrzymują techniczne metadane — Twój adres IP, user agent przeglądarki oraz żądany obszar mapy. Nie przekazujemy im danych Twojego konta ani danych Twojej floty, a żaden z dostawców nie służy do śledzenia Cię między witrynami. Zabezpieczenia mające zastosowanie do transferu opisano w [Polityce prywatności](/privacy)."
      },
      {
        "h2": "5. Twój wybór"
      },
      {
        "p": "Swoją decyzję możesz zmienić w dowolnym momencie — tutaj lub z poziomu banera. Wycofanie zgody jest tak samo proste jak jej udzielenie: wybranie opcji „Tylko niezbędne” natychmiast usuwa plik polecenia."
      },
      {
        "p": "Twoja przeglądarka może również blokować lub usuwać pliki cookie oraz czyścić pamięć lokalną witryny — ustawienia te znajdują się w sekcji Prywatność lub Dane witryny w przeglądarkach Chrome, Firefox, Safari i Edge. Zablokowanie elementów niezbędnych wyloguje Cię z aplikacji i zresetuje wybór języka."
      },
      {
        "h2": "6. Zmiany i kontakt"
      },
      {
        "p": "Jeśli dodamy lub zmienimy plik cookie, aktualizujemy tę stronę, a jeśli zmiana dotyczy pliku nie-niezbędnego, ponownie prosimy o zgodę. Pytania prosimy kierować na [hello@orbetra.com](mailto:hello@orbetra.com). Sposób, w jaki ogólnie przetwarzamy dane osobowe, opisano w [Polityce prywatności](/privacy)."
      }
    ]
  },
  "de": {
    "title": "Cookie-Richtlinie",
    "label": "RECHTLICHES",
    "updated": "August 2026",
    "notice": "Dies ist eine Übersetzung zu Ihrer Erleichterung. Bei etwaigen Abweichungen ist die englische Fassung maßgeblich.",
    "blocks": [
      {
        "p": "Orbetra verwendet nur minimale Cookies: unbedingt erforderliche, die für den Betrieb der Website und der App nötig sind, und ein optionales Cookie, das eine Partnerempfehlung anrechnet. Unsere Produktanalyse kommt ohne Cookies aus und ist aggregiert — wir setzen keine Werbe- oder seitenübergreifenden Tracking-Cookies ein."
      },
      {
        "h2": "1. Was Cookies sind"
      },
      {
        "p": "Ein Cookie ist eine kleine Datei, die eine Website in Ihrem Browser speichert und bei späteren Anfragen wieder ausliest. Local Storage und Session Storage erfüllen dieselbe Aufgabe über eine andere Browser-API, und es gelten dieselben Regeln — daher führen wir alle drei unten auf. Cookies, die zur Bereitstellung eines von Ihnen angeforderten Dienstes unbedingt erforderlich sind, bedürfen keiner Einwilligung; alles andere schon, und wir holen sie ein, bevor wir es setzen."
      },
      {
        "h2": "2. Was wir setzen"
      },
      {
        "table": {
          "head": [
            "Name",
            "Typ",
            "Zweck",
            "Dauer"
          ],
          "rows": [
            [
              "`orbetra_cookie_consent`",
              "Erforderlich",
              "Speichert Ihre Cookie-Auswahl, damit wir nicht erneut fragen.",
              "Local Storage — bis Sie sie ändern oder die Website-Daten löschen"
            ],
            [
              "`orbetra_lang`",
              "Erforderlich",
              "Merkt sich Ihre Oberflächensprache (EN/PL/DE/LT).",
              "Local Storage — bis Sie sie ändern oder die Website-Daten löschen"
            ],
            [
              "`orb_refresh`",
              "Erforderlich",
              "Hält Sie in der Orbetra-App angemeldet. HttpOnly und SameSite=Strict und wird nur an den Authentifizierungs-Endpunkt gesendet — niemals mit Karten- oder Datenanfragen.",
              "14 Tage, verlängert, solange Sie angemeldet bleiben"
            ],
            [
              "`tc_ref`",
              "Optional",
              "Rechnet eine Partnerempfehlung an, wenn Sie über einen `?ref=`-Link kommen. Wird nur gesetzt, wenn Sie zustimmen, und gelöscht, wenn Sie nur die erforderlichen wählen.",
              "60 Tage"
            ],
            [
              "`tc_ref_pending`",
              "Optional",
              "Speichert einen Empfehlungscode aus einem `?ref=`-Link, bis Sie auf das Banner reagieren, damit die Empfehlung während Ihrer Entscheidung nicht verloren geht. Wird verworfen, wenn Sie nur die erforderlichen wählen.",
              "Session Storage — wird beim Schließen des Tabs gelöscht"
            ]
          ]
        }
      },
      {
        "p": "Das optionale Cookie `tc_ref` ist das einzige nicht erforderliche Element. Es wird erst gesetzt, nachdem Sie „Alle akzeptieren“ gewählt haben, es enthält nichts außer dem Partnercode aus dem `?ref=`-Link, und die Wahl von „Nur erforderliche“ löscht es."
      },
      {
        "h2": "3. Analyse"
      },
      {
        "p": "Die Analyse unserer Website ist aggregiert und cookielos: Sie zählt Seitenaufrufe und Verweisquellen, ohne etwas in Ihrem Browser zu speichern und ohne ein Profil von Ihnen zu erstellen. Wir verwenden weder Google Analytics noch Werbe-Pixel oder seitenübergreifende Tracker, und wir verkaufen oder teilen keine Besucherdaten."
      },
      {
        "h2": "4. Anfragen Dritter durch Karten"
      },
      {
        "p": "Kartenkacheln werden im Produkt von Mapbox und auf dieser Marketing-Website von CARTO geladen. Das Laden einer Kachel ist eine normale Webanfrage, sodass diese Anbieter technische Metadaten erhalten — Ihre IP-Adresse, den User Agent Ihres Browsers und den angeforderten Kartenausschnitt. Wir übermitteln ihnen weder Ihre Kontodaten noch Ihre Flottendaten, und keiner der Anbieter wird eingesetzt, um Sie seitenübergreifend zu verfolgen. Die geltenden Garantien für die Übermittlung finden Sie in der [Datenschutzerklärung](/privacy)."
      },
      {
        "h2": "5. Ihre Wahl"
      },
      {
        "p": "Sie können Ihre Entscheidung jederzeit ändern — hier oder über das Banner. Der Widerruf der Einwilligung ist ebenso einfach wie ihre Erteilung: Die Wahl von „Nur erforderliche“ löscht das Empfehlungs-Cookie sofort."
      },
      {
        "p": "Ihr Browser kann Cookies ebenfalls blockieren oder löschen und den Local Storage einer Website leeren — die Einstellungen finden Sie unter Datenschutz oder Website-Daten in Chrome, Firefox, Safari und Edge. Das Blockieren erforderlicher Elemente meldet Sie von der App ab und setzt Ihre Sprachauswahl zurück."
      },
      {
        "h2": "6. Änderungen und Kontakt"
      },
      {
        "p": "Wenn wir ein Cookie hinzufügen oder ändern, aktualisieren wir diese Seite, und wir holen erneut eine Einwilligung ein, wenn die Änderung ein nicht erforderliches Cookie betrifft. Fragen richten Sie an [hello@orbetra.com](mailto:hello@orbetra.com). Wie wir personenbezogene Daten allgemein verarbeiten, ist in der [Datenschutzerklärung](/privacy) beschrieben."
      }
    ]
  }
};
