import type { LocalizedDoc } from "./types";

/**
 * The host that actually serves `/v1` today (the dashboard host). Kept in ONE place because the
 * published base URL used to be a vanity `api.orbetra.com` that no vhost answered on, repeated
 * across four locales — a single constant is what stops the four from drifting apart again.
 *
 * Deliberately NOT a dedicated `api.` hostname: this is a white-label product, and a reseller's
 * customers reach the same `/v1` surface on the RESELLER's verified domain. Naming our own host as
 * "the" API host in the public docs would leak Orbetra into their brand.
 */
const API_BASE = "https://dash.orbetra.com";

/**
 * docs — long-form content authored EN (source of truth) + LT/PL/DE translations (W9 i18n).
 * Generated from the extraction/translation workflow; edit the prose here directly going forward.
 */
export const docs: LocalizedDoc = {
  "en": {
    "title": "Docs & API reference",
    "label": "DEVELOPERS",
    "updated": "August 2026",
    "blocks": [
      {
        "p": `Everything in Orbetra is available over a REST API — the same one our own dashboard uses. Base URL: \`${API_BASE}\` (white-label customers use their own verified domain).`
      },
      {
        "h2": "Getting started"
      },
      {
        "p": "Create an account, add your first tracker, then generate an API key in the app under Settings → API keys. Keys are scoped per account and can be revoked at any time. **REST API access is part of the White-label / TSP plans** — on a Direct plan the API-keys screen is not available; [see pricing](/pricing)."
      },
      {
        "code": `curl ${API_BASE}/v1/devices \\\n  -H "X-Api-Key: orb_live_<your-api-key>"`
      },
      {
        "p": "No account yet? [Create one free](/signup) or [open the live demo](/demo)."
      },
      {
        "h2": "Authentication"
      },
      {
        "p": "Send your key in the `X-Api-Key` header over HTTPS. (`Authorization: Bearer` is the dashboard session token, not an API key — a key sent that way is rejected.) Requests without a valid key return `401`. Endpoints are rate-limited per key; exceeding a limit returns `429` with a `Retry-After` header."
      },
      {
        "code": "X-Api-Key: orb_live_<your-api-key>\nContent-Type: application/json"
      },
      {
        "h2": "REST endpoints"
      },
      {
        "table": {
          "head": [
            "Method",
            "Path",
            "Description"
          ],
          "rows": [
            [
              "GET",
              "/v1/devices",
              "List devices in your account."
            ],
            [
              "GET",
              "/v1/devices/{id}",
              "Single device: name, plate, profile, status."
            ],
            [
              "GET",
              "/v1/devices/last",
              "Last known position of every device — the live snapshot."
            ],
            [
              "GET",
              "/v1/devices/{id}/positions",
              "Positions for a device and time range."
            ],
            [
              "GET",
              "/v1/trips",
              "Trips grouped by device and day."
            ],
            [
              "POST",
              "/v1/geofences",
              "Create a polygon, circle or corridor geofence. **Dashboard session only.**"
            ],
            [
              "GET",
              "/v1/events",
              "Alerts: ignition, overspeed, geofence, power cut."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Register an HTTPS endpoint for push events. **Dashboard session only.**"
            ]
          ]
        }
      },
      {
        "h2": "Webhooks"
      },
      {
        "p": "Register an HTTPS endpoint and Orbetra pushes events as they happen. Every delivery is signed with HMAC-SHA256 in the `X-Signature` header (`sha256=<hex>` over the exact body bytes) and carries an `X-Webhook-Id` for idempotency — verify the signature before trusting the payload. Failed deliveries are retried with exponential backoff."
      },
      {
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofenceId\": \"<geofence-id>\", \"name\": \"Depot\", \"transition\": \"exit\" }\n}"
      },
      {
        "p": "Event kinds: `geofence`, `overspeed`, `ignition`, `din_change`, `power_cut`, `low_battery`, `panic`, `device_offline`, `fuel_theft`. Subscribe to none and you get them all."
      },
      {
        "h2": "Device onboarding"
      },
      {
        "p": "Teltonika trackers are supported today — Orbetra speaks their protocol natively. Point the tracker at the ingest host with your account port, power it up, and it appears in the app within a minute."
      },
      {
        "code": "# Teltonika configurator\nServer:   ingest.orbetra.com\nProtocol: TCP\nPort:     <provided in app → Devices → Add device>"
      },
      {
        "p": "Running a model we haven't listed? [Send us the list](/pilot) and we'll confirm which IO values we decode by name."
      }
    ]
  },
  "lt": {
    "title": "Dokumentacija ir API žinynas",
    "label": "KŪRĖJAMS",
    "updated": "2026 m. rugpjūtis",
    "blocks": [
      {
        "p": `Viskas Orbetra sistemoje pasiekiama per REST API — tą patį, kurį naudoja mūsų pačių valdymo skydelis. Bazinis URL: \`${API_BASE}\` (white-label klientai naudoja savo patvirtintą domeną).`
      },
      {
        "h2": "Darbo pradžia"
      },
      {
        "p": "Susikurkite paskyrą, pridėkite pirmąjį sekiklį, tada programoje sugeneruokite API raktą skiltyje Nustatymai → API raktai. Raktai galioja konkrečiai paskyrai ir bet kada gali būti atšaukti. **REST API prieiga įeina į White-label / TSP planus** — Direct plane API raktų skiltis neprieinama; [žr. kainas](/pricing)."
      },
      {
        "code": `curl ${API_BASE}/v1/devices \\\n  -H "X-Api-Key: orb_live_<your-api-key>"`
      },
      {
        "p": "Dar neturite paskyros? [Susikurkite ją nemokamai](/signup) arba [atverkite tiesioginę demonstraciją](/demo)."
      },
      {
        "h2": "Autentifikavimas"
      },
      {
        "p": "Raktą siųskite antraštėje `X-Api-Key` per HTTPS. (`Authorization: Bearer` yra valdymo skydelio sesijos raktas, ne API raktas — taip atsiųstas API raktas atmetamas.) Užklausos be galiojančio rakto grąžina `401`. Užklausų dažnis ribojamas kiekvienam raktui; viršijus ribą grąžinama `429` su antrašte `Retry-After`."
      },
      {
        "code": "X-Api-Key: orb_live_<your-api-key>\nContent-Type: application/json"
      },
      {
        "h2": "REST galiniai taškai"
      },
      {
        "table": {
          "head": [
            "Metodas",
            "Kelias",
            "Aprašymas"
          ],
          "rows": [
            [
              "GET",
              "/v1/devices",
              "Pateikia jūsų paskyros įrenginių sąrašą."
            ],
            [
              "GET",
              "/v1/devices/{id}",
              "Vienas įrenginys: pavadinimas, valst. numeris, profilis, būsena."
            ],
            [
              "GET",
              "/v1/devices/last",
              "Paskutinė kiekvieno įrenginio pozicija — momentinis vaizdas."
            ],
            [
              "GET",
              "/v1/devices/{id}/positions",
              "Įrenginio pozicijos pagal laiko intervalą."
            ],
            [
              "GET",
              "/v1/trips",
              "Kelionės, sugrupuotos pagal įrenginį ir dieną."
            ],
            [
              "POST",
              "/v1/geofences",
              "Sukurti daugiakampio, apskritimo ar koridoriaus geozoną. **Tik su skydelio sesija.**"
            ],
            [
              "GET",
              "/v1/events",
              "Įspėjimai: uždegimas, greičio viršijimas, geografinė zona, maitinimo nutrūkimas."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Užregistruoti HTTPS galinį tašką įvykių gavimui. **Tik su skydelio sesija.**"
            ]
          ]
        }
      },
      {
        "h2": "Webhooks"
      },
      {
        "p": "Užregistruokite HTTPS galinį tašką ir Orbetra siųs įvykius jiems įvykus. Kiekvienas pristatymas pasirašomas HMAC-SHA256 antraštėje `X-Signature` (`sha256=<hex>` iš tikslių turinio baitų) ir turi `X-Webhook-Id` idempotentiškumui — patikrinkite parašą prieš pasitikėdami turiniu. Nepavykę pristatymai kartojami taikant eksponentinį atidėjimą."
      },
      {
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofenceId\": \"<geofence-id>\", \"name\": \"Depot\", \"transition\": \"exit\" }\n}"
      },
      {
        "p": "Įvykių tipai: `geofence`, `overspeed`, `ignition`, `din_change`, `power_cut`, `low_battery`, `panic`, `device_offline`, `fuel_theft`. Neužsiprenumeravus nė vieno, gausite visus."
      },
      {
        "h2": "Įrenginių prijungimas"
      },
      {
        "p": "Teltonika sekikliai palaikomi jau šiandien — Orbetra natūraliai supranta jų protokolą. Nukreipkite sekiklį į priėmimo serverį naudodami savo paskyros prievadą, įjunkite maitinimą, ir jis programoje pasirodys per minutę."
      },
      {
        "code": "# Teltonika configurator\nServer:   ingest.orbetra.com\nProtocol: TCP\nPort:     <provided in app → Devices → Add device>"
      },
      {
        "p": "Naudojate modelį, kurio nepaminėjome? [Atsiųskite mums sąrašą](/pilot) ir patvirtinsime, kurias IO reikšmes atpažįstame pagal pavadinimą."
      }
    ]
  },
  "pl": {
    "title": "Dokumentacja i przewodnik po API",
    "label": "DLA PROGRAMISTÓW",
    "updated": "Sierpień 2026",
    "blocks": [
      {
        "p": `Wszystko w Orbetrze jest dostępne przez REST API — to samo, którego używa nasz własny panel. Bazowy adres URL: \`${API_BASE}\` (klienci white-label używają własnej zweryfikowanej domeny).`
      },
      {
        "h2": "Pierwsze kroki"
      },
      {
        "p": "Utwórz konto, dodaj pierwszy tracker, a następnie wygeneruj klucz API w aplikacji w sekcji Ustawienia → Klucze API. Klucze mają zasięg ograniczony do konta i można je odwołać w dowolnym momencie. **Dostęp do REST API wchodzi w skład planów White-label / TSP** — w planie Direct sekcja kluczy API jest niedostępna; [zobacz cennik](/pricing)."
      },
      {
        "code": `curl ${API_BASE}/v1/devices \\\n  -H "X-Api-Key: orb_live_<your-api-key>"`
      },
      {
        "p": "Nie masz jeszcze konta? [Załóż je za darmo](/signup) lub [otwórz demo na żywo](/demo)."
      },
      {
        "h2": "Uwierzytelnianie"
      },
      {
        "p": "Klucz wysyłaj w nagłówku `X-Api-Key` przez HTTPS. (`Authorization: Bearer` to token sesji panelu, a nie klucz API — klucz wysłany w ten sposób zostanie odrzucony.) Żądania bez ważnego klucza zwracają `401`. Liczba żądań jest ograniczana na klucz; przekroczenie limitu zwraca `429` z nagłówkiem `Retry-After`."
      },
      {
        "code": "X-Api-Key: orb_live_<your-api-key>\nContent-Type: application/json"
      },
      {
        "h2": "Punkty końcowe REST"
      },
      {
        "table": {
          "head": [
            "Metoda",
            "Ścieżka",
            "Opis"
          ],
          "rows": [
            [
              "GET",
              "/v1/devices",
              "Lista urządzeń na Twoim koncie."
            ],
            [
              "GET",
              "/v1/devices/{id}",
              "Pojedyncze urządzenie: nazwa, numer rejestracyjny, profil, status."
            ],
            [
              "GET",
              "/v1/devices/last",
              "Ostatnia znana pozycja każdego urządzenia — migawka na żywo."
            ],
            [
              "GET",
              "/v1/devices/{id}/positions",
              "Pozycje urządzenia dla zakresu czasu."
            ],
            [
              "GET",
              "/v1/trips",
              "Trasy pogrupowane według urządzenia i dnia."
            ],
            [
              "POST",
              "/v1/geofences",
              "Utwórz geofence w postaci wielokąta, okręgu lub korytarza. **Tylko sesja panelu.**"
            ],
            [
              "GET",
              "/v1/events",
              "Alerty: zapłon, przekroczenie prędkości, geofence, odcięcie zasilania."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Zarejestruj punkt końcowy HTTPS do odbioru zdarzeń push. **Tylko sesja panelu.**"
            ]
          ]
        }
      },
      {
        "h2": "Webhooks"
      },
      {
        "p": "Zarejestruj punkt końcowy HTTPS, a Orbetra będzie przesyłać zdarzenia w miarę ich występowania. Każda dostawa jest podpisana algorytmem HMAC-SHA256 w nagłówku `X-Signature` (`sha256=<hex>` z dokładnych bajtów treści) i zawiera `X-Webhook-Id` zapewniający idempotentność — zweryfikuj podpis, zanim zaufasz ładunkowi. Nieudane dostawy są ponawiane z wykładniczym odstępem."
      },
      {
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofenceId\": \"<geofence-id>\", \"name\": \"Depot\", \"transition\": \"exit\" }\n}"
      },
      {
        "p": "Rodzaje zdarzeń: `geofence`, `overspeed`, `ignition`, `din_change`, `power_cut`, `low_battery`, `panic`, `device_offline`, `fuel_theft`. Nie subskrybuj żadnego, a otrzymasz wszystkie."
      },
      {
        "h2": "Podłączanie urządzeń"
      },
      {
        "p": "Trackery Teltonika są już obsługiwane — Orbetra natywnie posługuje się ich protokołem. Skieruj tracker na host odbiorczy, używając portu swojego konta, włącz zasilanie, a pojawi się w aplikacji w ciągu minuty."
      },
      {
        "code": "# Teltonika configurator\nServer:   ingest.orbetra.com\nProtocol: TCP\nPort:     <provided in app → Devices → Add device>"
      },
      {
        "p": "Używasz modelu, którego nie wymieniliśmy? [Wyślij nam listę](/pilot), a potwierdzimy, które wartości IO dekodujemy według nazwy."
      }
    ]
  },
  "de": {
    "title": "Dokumentation & API-Referenz",
    "label": "ENTWICKLER",
    "updated": "August 2026",
    "blocks": [
      {
        "p": `Alles in Orbetra ist über eine REST-API verfügbar — dieselbe, die auch unser eigenes Dashboard nutzt. Basis-URL: \`${API_BASE}\` (White-Label-Kunden nutzen ihre eigene verifizierte Domain).`
      },
      {
        "h2": "Erste Schritte"
      },
      {
        "p": "Erstellen Sie ein Konto, fügen Sie Ihren ersten Tracker hinzu und generieren Sie dann in der App unter Einstellungen → API-Schlüssel einen API-Schlüssel. Schlüssel gelten pro Konto und können jederzeit widerrufen werden. **Der REST-API-Zugang ist Teil der White-label-/TSP-Tarife** — im Direct-Tarif ist der API-Schlüssel-Bereich nicht verfügbar; [siehe Preise](/pricing)."
      },
      {
        "code": `curl ${API_BASE}/v1/devices \\\n  -H "X-Api-Key: orb_live_<your-api-key>"`
      },
      {
        "p": "Noch kein Konto? [Kostenlos erstellen](/signup) oder [die Live-Demo öffnen](/demo)."
      },
      {
        "h2": "Authentifizierung"
      },
      {
        "p": "Senden Sie Ihren Schlüssel im Header `X-Api-Key` über HTTPS. (`Authorization: Bearer` ist das Sitzungs-Token des Dashboards, kein API-Schlüssel — so gesendet wird ein Schlüssel abgelehnt.) Anfragen ohne gültigen Schlüssel geben `401` zurück. Endpunkte sind pro Schlüssel ratenbegrenzt; bei Überschreitung wird `429` mit einem `Retry-After`-Header zurückgegeben."
      },
      {
        "code": "X-Api-Key: orb_live_<your-api-key>\nContent-Type: application/json"
      },
      {
        "h2": "REST-Endpunkte"
      },
      {
        "table": {
          "head": [
            "Methode",
            "Pfad",
            "Beschreibung"
          ],
          "rows": [
            [
              "GET",
              "/v1/devices",
              "Listet die Geräte in Ihrem Konto auf."
            ],
            [
              "GET",
              "/v1/devices/{id}",
              "Einzelnes Gerät: Name, Kennzeichen, Profil, Status."
            ],
            [
              "GET",
              "/v1/devices/last",
              "Letzte bekannte Position jedes Geräts — die Live-Momentaufnahme."
            ],
            [
              "GET",
              "/v1/devices/{id}/positions",
              "Positionen für ein Gerät und einen Zeitraum."
            ],
            [
              "GET",
              "/v1/trips",
              "Fahrten, gruppiert nach Gerät und Tag."
            ],
            [
              "POST",
              "/v1/geofences",
              "Erstellen Sie einen Polygon-, Kreis- oder Korridor-Geofence. **Nur mit Dashboard-Sitzung.**"
            ],
            [
              "GET",
              "/v1/events",
              "Warnungen: Zündung, Geschwindigkeitsüberschreitung, Geofence, Stromausfall."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Registrieren Sie einen HTTPS-Endpunkt für Push-Ereignisse. **Nur mit Dashboard-Sitzung.**"
            ]
          ]
        }
      },
      {
        "h2": "Webhooks"
      },
      {
        "p": "Registrieren Sie einen HTTPS-Endpunkt, und Orbetra sendet Ereignisse, sobald sie eintreten. Jede Zustellung wird mit HMAC-SHA256 im `X-Signature`-Header signiert (`sha256=<hex>` über die exakten Body-Bytes) und trägt zur Idempotenz eine `X-Webhook-Id` — verifizieren Sie die Signatur, bevor Sie dem Payload vertrauen. Fehlgeschlagene Zustellungen werden mit exponentiellem Backoff wiederholt."
      },
      {
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofenceId\": \"<geofence-id>\", \"name\": \"Depot\", \"transition\": \"exit\" }\n}"
      },
      {
        "p": "Ereignistypen: `geofence`, `overspeed`, `ignition`, `din_change`, `power_cut`, `low_battery`, `panic`, `device_offline`, `fuel_theft`. Abonnieren Sie keines, erhalten Sie alle."
      },
      {
        "h2": "Geräte-Onboarding"
      },
      {
        "p": "Teltonika-Tracker werden bereits heute unterstützt — Orbetra spricht ihr Protokoll nativ. Richten Sie den Tracker mit dem Port Ihres Kontos auf den Ingest-Host, schalten Sie ihn ein, und er erscheint innerhalb einer Minute in der App."
      },
      {
        "code": "# Teltonika configurator\nServer:   ingest.orbetra.com\nProtocol: TCP\nPort:     <provided in app → Devices → Add device>"
      },
      {
        "p": "Verwenden Sie ein Modell, das wir nicht aufgeführt haben? [Senden Sie uns die Liste](/pilot), und wir bestätigen, welche IO-Werte wir namentlich decodieren."
      }
    ]
  }
};
