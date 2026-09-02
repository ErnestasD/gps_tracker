import type { LocalizedDoc } from "./types";

/**
 * subprocessors — long-form content authored EN (source of truth) + LT/PL/DE translations (W9 i18n).
 * Generated from the extraction/translation workflow; edit the prose here directly going forward.
 */
export const subprocessors: LocalizedDoc = {
  "en": {
    "title": "Subprocessors",
    "label": "LEGAL",
    "updated": "August 2026",
    "blocks": [
      {
        "p": "These are the third parties Orbetra uses to deliver the service and that may process personal data on our behalf. The list is complete: no other party receives customer data. It is maintained under section 8 of the [DPA](/dpa) and was last reviewed in **August 2026**."
      },
      {
        "table": {
          "head": [
            "Sub-processor",
            "Purpose",
            "Processing location"
          ],
          "rows": [
            [
              "Hetzner Online GmbH",
              "Primary application, database and telemetry hosting",
              "Germany (EU)"
            ],
            [
              "Mapbox, Inc.",
              "Map tiles rendered in the web app",
              "USA — request metadata only, SCCs in place"
            ],
            [
              "CARTO (Mapbox-independent)",
              "Basemap style and tiles on the public marketing site only (no customer data)",
              "USA/EU CDN — request metadata only, SCCs in place"
            ],
            [
              "Self-hosted Photon & OSRM",
              "Geocoding and routing (operated by Orbetra, no third party)",
              "Germany (EU)"
            ],
            [
              "Stripe Payments Europe, Ltd.",
              "Subscription billing and payment processing",
              "Ireland (EU)"
            ],
            [
              "Postmark (ActiveCampaign, LLC)",
              "Transactional email (alerts, reports, account emails)",
              "EU region endpoint"
            ],
            [
              "Cloudflare, Inc.",
              "DNS, TLS termination and DDoS protection",
              "Global edge — EU-first routing, SCCs in place"
            ]
          ]
        }
      },
      {
        "h2": "1. How we notify changes"
      },
      {
        "p": "Before we add or replace a sub-processor we update this page and notify customers by email at least **30 days** in advance. To be added to that notification list, email [hello@orbetra.com](mailto:hello@orbetra.com) with the address you want us to use."
      },
      {
        "p": "A customer may object in writing within the 30-day notice period on reasonable data-protection grounds. We will discuss the objection in good faith and try to offer an alternative or a change of configuration; if we cannot resolve it, the customer may terminate the affected part of the service without penalty and we refund prepaid fees for the unused period. The full process is in section 8 of the [DPA](/dpa)."
      },
      {
        "p": "Where a change is urgent — for example replacing a provider that has become a security risk — we may act sooner and notify without delay, explaining why."
      },
      {
        "h2": "2. Where data is processed"
      },
      {
        "p": "Application data and telemetry are stored in the European Union. Where a sub-processor handles limited metadata outside the EEA, transfers rely on the EU Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914). See the [DPA](/dpa) for details."
      }
    ]
  },
  "lt": {
    "title": "Subtvarkytojai",
    "label": "TEISINĖ INFORMACIJA",
    "updated": "2026 m. rugpjūtis",
    "blocks": [
      {
        "p": "Tai tretieji asmenys, kuriuos Orbetra pasitelkia paslaugai teikti ir kurie mūsų vardu gali tvarkyti asmens duomenis. Sąrašas išsamus: jokia kita šalis negauna klientų duomenų. Jis tvarkomas pagal [DPA](/dpa) 8 skirsnį ir paskutinį kartą peržiūrėtas **2026 m. rugpjūtį**."
      },
      {
        "table": {
          "head": [
            "Subtvarkytojas",
            "Paskirtis",
            "Duomenų tvarkymo vieta"
          ],
          "rows": [
            [
              "Hetzner Online GmbH",
              "Pagrindinė programos, duomenų bazės ir telemetrijos priegloba",
              "Vokietija (ES)"
            ],
            [
              "Mapbox, Inc.",
              "Žemėlapio išklotinės, atvaizduojamos žiniatinklio programoje",
              "JAV — tik užklausų metaduomenys, taikomos standartinės sutarčių sąlygos"
            ],
            [
              "CARTO (nepriklausomas nuo Mapbox)",
              "Pagrindinio žemėlapio stilius ir išklotinės tik viešojoje rinkodaros svetainėje (jokių klientų duomenų)",
              "JAV/ES CDN — tik užklausų metaduomenys, taikomos standartinės sutarčių sąlygos"
            ],
            [
              "Savarankiškai talpinami Photon ir OSRM",
              "Geokodavimas ir maršrutų sudarymas (valdo Orbetra, be trečiųjų šalių)",
              "Vokietija (ES)"
            ],
            [
              "Stripe Payments Europe, Ltd.",
              "Prenumeratos sąskaitų išrašymas ir mokėjimų tvarkymas",
              "Airija (ES)"
            ],
            [
              "Postmark (ActiveCampaign, LLC)",
              "Sisteminiai el. laiškai (įspėjimai, ataskaitos, paskyros laiškai)",
              "ES regiono galinis taškas"
            ],
            [
              "Cloudflare, Inc.",
              "DNS, TLS nutraukimas ir apsauga nuo DDoS",
              "Pasaulinis paribio (edge) tinklas — pirmenybė teikiama ES maršrutams, taikomos standartinės sutarčių sąlygos"
            ]
          ]
        }
      },
      {
        "h2": "1. Kaip pranešame apie pakeitimus"
      },
      {
        "p": "Prieš pridėdami ar pakeisdami subtvarkytoją atnaujiname šį puslapį ir el. paštu pranešame klientams likus ne mažiau kaip **30 dienų**. Kad būtumėte įtraukti į šį pranešimų sąrašą, rašykite [hello@orbetra.com](mailto:hello@orbetra.com) nurodydami adresą, kuriuo norite gauti pranešimus."
      },
      {
        "p": "Klientas per 30 dienų pranešimo laikotarpį gali raštu pareikšti prieštaravimą dėl pagrįstų duomenų apsaugos priežasčių. Prieštaravimą aptarsime sąžiningai ir stengsimės pasiūlyti alternatyvą arba konfigūracijos pakeitimą; jei problemos išspręsti nepavyks, klientas gali be baudos nutraukti atitinkamą paslaugos dalį, o už nepanaudotą laikotarpį iš anksto sumokėtus mokesčius grąžiname. Visa procedūra aprašyta [DPA](/dpa) 8 skirsnyje."
      },
      {
        "p": "Kai pakeitimas skubus — pavyzdžiui, kai keičiame tiekėją, tapusį saugumo rizika, — galime imtis veiksmų anksčiau ir nedelsdami apie tai pranešti, paaiškindami priežastis."
      },
      {
        "h2": "2. Kur tvarkomi duomenys"
      },
      {
        "p": "Programos duomenys ir telemetrija saugomi Europos Sąjungoje. Kai subtvarkytojas tvarko ribotus metaduomenis už EEE ribų, perdavimai grindžiami ES standartinėmis sutarčių sąlygomis (Komisijos įgyvendinimo sprendimas (ES) 2021/914). Išsamesnės informacijos ieškokite [DPA](/dpa)."
      }
    ]
  },
  "pl": {
    "title": "Podprocesorzy",
    "label": "INFORMACJE PRAWNE",
    "updated": "sierpień 2026",
    "blocks": [
      {
        "p": "To podmioty trzecie, które Orbetra wykorzystuje do świadczenia usługi i które mogą przetwarzać dane osobowe w naszym imieniu. Lista jest kompletna: żaden inny podmiot nie otrzymuje danych klientów. Jest prowadzona zgodnie z sekcją 8 [DPA](/dpa) i była ostatnio weryfikowana w **sierpniu 2026**."
      },
      {
        "table": {
          "head": [
            "Podprocesor",
            "Cel",
            "Miejsce przetwarzania"
          ],
          "rows": [
            [
              "Hetzner Online GmbH",
              "Podstawowy hosting aplikacji, bazy danych i telemetrii",
              "Niemcy (UE)"
            ],
            [
              "Mapbox, Inc.",
              "Kafelki mapy renderowane w aplikacji webowej",
              "USA — wyłącznie metadane żądań, obowiązują standardowe klauzule umowne"
            ],
            [
              "CARTO (niezależny od Mapbox)",
              "Styl mapy podkładowej i kafelki wyłącznie na publicznej stronie marketingowej (bez danych klientów)",
              "CDN w USA/UE — wyłącznie metadane żądań, obowiązują standardowe klauzule umowne"
            ],
            [
              "Samodzielnie hostowane Photon i OSRM",
              "Geokodowanie i wyznaczanie tras (obsługiwane przez Orbetra, bez podmiotów trzecich)",
              "Niemcy (UE)"
            ],
            [
              "Stripe Payments Europe, Ltd.",
              "Rozliczanie subskrypcji i przetwarzanie płatności",
              "Irlandia (UE)"
            ],
            [
              "Postmark (ActiveCampaign, LLC)",
              "E-maile transakcyjne (alerty, raporty, wiadomości dotyczące konta)",
              "Punkt końcowy w regionie UE"
            ],
            [
              "Cloudflare, Inc.",
              "DNS, terminacja TLS i ochrona przed DDoS",
              "Globalna sieć brzegowa — routing z priorytetem UE, obowiązują standardowe klauzule umowne"
            ]
          ]
        }
      },
      {
        "h2": "1. Jak informujemy o zmianach"
      },
      {
        "p": "Przed dodaniem lub zastąpieniem podprocesora aktualizujemy tę stronę i powiadamiamy klientów e-mailem z co najmniej **30-dniowym** wyprzedzeniem. Aby zostać dodanym do tej listy powiadomień, napisz na [hello@orbetra.com](mailto:hello@orbetra.com), podając adres, którego mamy używać."
      },
      {
        "p": "Klient może w formie pisemnej wnieść sprzeciw w 30-dniowym okresie powiadomienia z uzasadnionych względów ochrony danych. Rozpatrzymy sprzeciw w dobrej wierze i postaramy się zaproponować alternatywę lub zmianę konfiguracji; jeśli nie uda się go rozwiązać, klient może bez kar wypowiedzieć dotkniętą część usługi, a opłacone z góry kwoty za niewykorzystany okres zwracamy. Pełna procedura znajduje się w sekcji 8 [DPA](/dpa)."
      },
      {
        "p": "Jeśli zmiana jest pilna — na przykład zastąpienie dostawcy, który stał się zagrożeniem bezpieczeństwa — możemy zadziałać wcześniej i powiadomić bez zbędnej zwłoki, wyjaśniając przyczyny."
      },
      {
        "h2": "2. Gdzie przetwarzane są dane"
      },
      {
        "p": "Dane aplikacji i telemetria są przechowywane w Unii Europejskiej. Gdy podprocesor obsługuje ograniczone metadane poza EOG, przekazywanie opiera się na standardowych klauzulach umownych UE (decyzja wykonawcza Komisji (UE) 2021/914). Szczegóły znajdują się w [DPA](/dpa)."
      }
    ]
  },
  "de": {
    "title": "Unterauftragsverarbeiter",
    "label": "RECHTLICHES",
    "updated": "August 2026",
    "blocks": [
      {
        "p": "Dies sind die Dritten, die Orbetra zur Erbringung des Dienstes einsetzt und die in unserem Auftrag personenbezogene Daten verarbeiten dürfen. Die Liste ist vollständig: Keine andere Partei erhält Kundendaten. Sie wird gemäß Abschnitt 8 des [DPA](/dpa) geführt und wurde zuletzt im **August 2026** überprüft."
      },
      {
        "table": {
          "head": [
            "Unterauftragsverarbeiter",
            "Zweck",
            "Verarbeitungsort"
          ],
          "rows": [
            [
              "Hetzner Online GmbH",
              "Primäres Hosting von Anwendung, Datenbank und Telemetrie",
              "Deutschland (EU)"
            ],
            [
              "Mapbox, Inc.",
              "In der Web-App gerenderte Kartenkacheln",
              "USA — nur Anfrage-Metadaten, Standardvertragsklauseln vereinbart"
            ],
            [
              "CARTO (unabhängig von Mapbox)",
              "Basiskarten-Stil und -Kacheln ausschließlich auf der öffentlichen Marketing-Website (keine Kundendaten)",
              "USA/EU-CDN — nur Anfrage-Metadaten, Standardvertragsklauseln vereinbart"
            ],
            [
              "Selbst gehostetes Photon & OSRM",
              "Geokodierung und Routing (betrieben von Orbetra, kein Dritter)",
              "Deutschland (EU)"
            ],
            [
              "Stripe Payments Europe, Ltd.",
              "Abonnementabrechnung und Zahlungsabwicklung",
              "Irland (EU)"
            ],
            [
              "Postmark (ActiveCampaign, LLC)",
              "Transaktions-E-Mails (Benachrichtigungen, Berichte, Konto-E-Mails)",
              "Endpunkt in der EU-Region"
            ],
            [
              "Cloudflare, Inc.",
              "DNS, TLS-Terminierung und DDoS-Schutz",
              "Globale Edge — EU-first-Routing, Standardvertragsklauseln vereinbart"
            ]
          ]
        }
      },
      {
        "h2": "1. Wie wir Änderungen mitteilen"
      },
      {
        "p": "Bevor wir einen Unterauftragsverarbeiter hinzufügen oder ersetzen, aktualisieren wir diese Seite und benachrichtigen Kunden mindestens **30 Tage** im Voraus per E-Mail. Um in diese Benachrichtigungsliste aufgenommen zu werden, senden Sie eine E-Mail an [hello@orbetra.com](mailto:hello@orbetra.com) mit der Adresse, die wir verwenden sollen."
      },
      {
        "p": "Ein Kunde kann innerhalb der 30-tägigen Ankündigungsfrist aus berechtigten Datenschutzgründen schriftlich Widerspruch einlegen. Wir werden den Widerspruch nach Treu und Glauben erörtern und versuchen, eine Alternative oder eine Änderung der Konfiguration anzubieten; können wir ihn nicht lösen, kann der Kunde den betroffenen Teil des Dienstes ohne Vertragsstrafe kündigen, und wir erstatten im Voraus gezahlte Entgelte für den ungenutzten Zeitraum. Das vollständige Verfahren ist in Abschnitt 8 des [DPA](/dpa) beschrieben."
      },
      {
        "p": "Ist eine Änderung dringend — etwa der Austausch eines Anbieters, der zu einem Sicherheitsrisiko geworden ist —, können wir früher handeln und unverzüglich unter Angabe der Gründe benachrichtigen."
      },
      {
        "h2": "2. Wo Daten verarbeitet werden"
      },
      {
        "p": "Anwendungsdaten und Telemetrie werden in der Europäischen Union gespeichert. Verarbeitet ein Unterauftragsverarbeiter begrenzte Metadaten außerhalb des EWR, stützen sich die Übermittlungen auf die EU-Standardvertragsklauseln (Durchführungsbeschluss (EU) 2021/914 der Kommission). Einzelheiten finden Sie im [DPA](/dpa)."
      }
    ]
  }
};
