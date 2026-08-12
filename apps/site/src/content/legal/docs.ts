import type { LocalizedDoc } from "./types";

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
        "p": "Everything in Orbetra is available over a REST API — the same one our own dashboard uses. Base URL: `https://api.orbetra.com`"
      },
      {
        "h2": "Getting started"
      },
      {
        "p": "Create an account, add your first tracker, then generate an API key in the app under Settings → API keys. Keys are scoped per account and can be revoked at any time."
      },
      {
        "code": "curl https://api.orbetra.com/v1/devices \\\n  -H \"Authorization: Bearer <your-api-key>\""
      },
      {
        "p": "No account yet? [Create one free](/signup) or [open the live demo](/demo)."
      },
      {
        "h2": "Authentication"
      },
      {
        "p": "All requests use a bearer token over HTTPS. Requests without a valid key return `401`. Endpoints are rate-limited per key; exceeding a limit returns `429` with a `Retry-After` header."
      },
      {
        "code": "Authorization: Bearer <your-api-key>\nContent-Type: application/json"
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
              "Single device with last known position."
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
              "Create a polygon, circle or corridor geofence."
            ],
            [
              "GET",
              "/v1/events",
              "Alerts: ignition, overspeed, geofence, power cut."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Register an HTTPS endpoint for push events."
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
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofence\": \"Depot\", \"direction\": \"exit\" }\n}"
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
        "p": "Viskas Orbetra sistemoje pasiekiama per REST API — tą patį, kurį naudoja mūsų pačių valdymo skydelis. Bazinis URL: `https://api.orbetra.com`"
      },
      {
        "h2": "Darbo pradžia"
      },
      {
        "p": "Susikurkite paskyrą, pridėkite pirmąjį sekiklį, tada programoje sugeneruokite API raktą skiltyje Nustatymai → API raktai. Raktai galioja konkrečiai paskyrai ir bet kada gali būti atšaukti."
      },
      {
        "code": "curl https://api.orbetra.com/v1/devices \\\n  -H \"Authorization: Bearer <your-api-key>\""
      },
      {
        "p": "Dar neturite paskyros? [Susikurkite ją nemokamai](/signup) arba [atverkite tiesioginę demonstraciją](/demo)."
      },
      {
        "h2": "Autentifikavimas"
      },
      {
        "p": "Visos užklausos naudoja bearer prieigos raktą per HTTPS. Užklausos be galiojančio rakto grąžina `401`. Galinių taškų užklausų dažnis ribojamas kiekvienam raktui; viršijus ribą grąžinama `429` su antrašte `Retry-After`."
      },
      {
        "code": "Authorization: Bearer <your-api-key>\nContent-Type: application/json"
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
              "Vienas įrenginys su paskutine žinoma pozicija."
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
              "Sukurti daugiakampio, apskritimo ar koridoriaus geografinę zoną."
            ],
            [
              "GET",
              "/v1/events",
              "Įspėjimai: uždegimas, greičio viršijimas, geografinė zona, maitinimo nutrūkimas."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Užregistruoti HTTPS galinį tašką įvykių gavimui."
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
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofence\": \"Depot\", \"direction\": \"exit\" }\n}"
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
        "p": "Wszystko w Orbetrze jest dostępne przez REST API — to samo, którego używa nasz własny panel. Bazowy adres URL: `https://api.orbetra.com`"
      },
      {
        "h2": "Pierwsze kroki"
      },
      {
        "p": "Utwórz konto, dodaj pierwszy tracker, a następnie wygeneruj klucz API w aplikacji w sekcji Ustawienia → Klucze API. Klucze mają zasięg ograniczony do konta i można je odwołać w dowolnym momencie."
      },
      {
        "code": "curl https://api.orbetra.com/v1/devices \\\n  -H \"Authorization: Bearer <your-api-key>\""
      },
      {
        "p": "Nie masz jeszcze konta? [Załóż je za darmo](/signup) lub [otwórz demo na żywo](/demo)."
      },
      {
        "h2": "Uwierzytelnianie"
      },
      {
        "p": "Wszystkie żądania używają tokena bearer przez HTTPS. Żądania bez ważnego klucza zwracają `401`. Punkty końcowe mają ograniczenie liczby żądań na klucz; przekroczenie limitu zwraca `429` z nagłówkiem `Retry-After`."
      },
      {
        "code": "Authorization: Bearer <your-api-key>\nContent-Type: application/json"
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
              "Pojedyncze urządzenie z ostatnią znaną pozycją."
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
              "Utwórz geofence w postaci wielokąta, okręgu lub korytarza."
            ],
            [
              "GET",
              "/v1/events",
              "Alerty: zapłon, przekroczenie prędkości, geofence, odcięcie zasilania."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Zarejestruj punkt końcowy HTTPS do odbioru zdarzeń push."
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
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofence\": \"Depot\", \"direction\": \"exit\" }\n}"
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
        "p": "Alles in Orbetra ist über eine REST-API verfügbar — dieselbe, die auch unser eigenes Dashboard nutzt. Basis-URL: `https://api.orbetra.com`"
      },
      {
        "h2": "Erste Schritte"
      },
      {
        "p": "Erstellen Sie ein Konto, fügen Sie Ihren ersten Tracker hinzu und generieren Sie dann in der App unter Einstellungen → API-Schlüssel einen API-Schlüssel. Schlüssel gelten pro Konto und können jederzeit widerrufen werden."
      },
      {
        "code": "curl https://api.orbetra.com/v1/devices \\\n  -H \"Authorization: Bearer <your-api-key>\""
      },
      {
        "p": "Noch kein Konto? [Kostenlos erstellen](/signup) oder [die Live-Demo öffnen](/demo)."
      },
      {
        "h2": "Authentifizierung"
      },
      {
        "p": "Alle Anfragen verwenden ein Bearer-Token über HTTPS. Anfragen ohne gültigen Schlüssel geben `401` zurück. Endpunkte sind pro Schlüssel ratenbegrenzt; bei Überschreitung eines Limits wird `429` mit einem `Retry-After`-Header zurückgegeben."
      },
      {
        "code": "Authorization: Bearer <your-api-key>\nContent-Type: application/json"
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
              "Einzelnes Gerät mit der letzten bekannten Position."
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
              "Erstellen Sie einen Polygon-, Kreis- oder Korridor-Geofence."
            ],
            [
              "GET",
              "/v1/events",
              "Warnungen: Zündung, Geschwindigkeitsüberschreitung, Geofence, Stromausfall."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Registrieren Sie einen HTTPS-Endpunkt für Push-Ereignisse."
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
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofence\": \"Depot\", \"direction\": \"exit\" }\n}"
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
