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
      },
      {"h2": "Your own domain", "id": "dns"},
      {"p": "White-label customers run the dashboard on their own address — `fleet.yourcompany.com`, or `yourcompany.com` itself. Two DNS records make that work: one proves the domain is yours, one sends visitors to us. You add them once, in the control panel of whoever manages your domain."},
      {"h2": "What the two records do", "id": "dns-what"},
      {"p": "The **TXT** record is proof of ownership. It sits on a name of its own — `_orbetra-verify.` in front of your address — and its value is a token we generate for you. It sends nobody anywhere; it only lets us confirm you control the domain. You can leave it in place afterwards."},
      {"p": "The **routing** record is what actually brings visitors to us. It is either a CNAME or an A record, and which one depends on your address — see below."},
      {"h2": "CNAME or A record", "id": "dns-cname-a"},
      {"p": "If your address has a word in front of your domain — `fleet.yourcompany.com` — use a **CNAME**. It points at our name rather than a number, so if our address ever changes, you do not have to do anything."},
      {"p": "If your address is the domain itself — `yourcompany.com`, with nothing in front — a CNAME cannot be used. That is not a limit of our product: a domain on its own always carries the records that make it a domain, and a CNAME is not allowed to sit beside any of them. Almost no provider will let you create one there. Use the **A** record instead, or, if your provider offers **ALIAS** or **ANAME**, use that — it behaves like an A record but still follows us if our address changes."},
      {"p": "Your dashboard shows the one record that applies to the address you entered. You do not have to choose."},
      {"h2": "The dot at the end of a name", "id": "dns-dot"},
      {"p": "We write names in full and with a dot at the end — `fleet.yourcompany.com.` — because that dot means “this name is already complete”."},
      {"p": "Many control panels follow the older convention where a name **without** a dot is treated as unfinished, and your domain is added to it a second time. Paste `fleet.yourcompany.com` without the dot and the record can quietly end up at `fleet.yourcompany.com.yourcompany.com`. The panel lists it looking perfectly correct and the address answers nothing."},
      {"p": "So: keep the dot, or enter only the part before your domain (`fleet`). Both are right. The full name without a dot is the one to avoid. If your dashboard detects that this has happened, it says so."},
      {"h2": "What the statuses mean", "id": "dns-status"},
      {"table": {"head": ["Status", "Meaning"], "rows": [["**Pending**", "We have not yet seen both records in public DNS. The dashboard keeps checking on its own."], ["**Found**", "That record is published and correct."], ["**Not found**", "We cannot see it yet. Changes take a few minutes to spread; if it has been longer, check the name and value against the table."], ["**Verified**", "Both records are in place. HTTPS is issued automatically on the first secure request."]]}},
      {"p": "Nothing here affects e-mail. Mail is delivered by MX records, which are separate and are never touched by this setup."}
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
              "Įspėjimai: degimas, greičio viršijimas, geozona, maitinimo nutrūkimas."
            ],
            [
              "POST",
              "/v1/webhooks",
              "Užregistruoti HTTPS galinį tašką įvykiams gauti. **Tik su skydelio sesija.**"
            ]
          ]
        }
      },
      {
        "h2": "Webhooks"
      },
      {
        "p": "Užregistruokite HTTPS galinį tašką ir Orbetra siųs įvykius iškart jiems įvykus. Kiekvienas pristatymas pasirašomas HMAC-SHA256 antraštėje `X-Signature` (`sha256=<hex>` iš tikslių turinio baitų) ir turi `X-Webhook-Id` idempotentiškumui — patikrinkite parašą prieš pasitikėdami turiniu. Nepavykę pristatymai kartojami eksponentiškai ilginant pertrauką."
      },
      {
        "code": "{\n  \"kind\": \"geofence\",\n  \"deviceId\": \"<device-id>\",\n  \"at\": \"2026-08-03T09:41:12Z\",\n  \"payload\": { \"geofenceId\": \"<geofence-id>\", \"name\": \"Depot\", \"transition\": \"exit\" }\n}"
      },
      {
        "p": "Įvykių tipai: `geofence`, `overspeed`, `ignition`, `din_change`, `power_cut`, `low_battery`, `panic`, `device_offline`, `fuel_theft`. Jei neužsiprenumeruosite nė vieno, gausite visus."
      },
      {
        "h2": "Įrenginių prijungimas"
      },
      {
        "p": "Teltonika sekikliai palaikomi jau šiandien — Orbetra supranta jų protokolą tiesiogiai. Nukreipkite sekiklį į priėmimo serverį per savo paskyros prievadą, įjunkite maitinimą — programoje jis pasirodys per minutę."
      },
      {
        "code": "# Teltonika configurator\nServer:   ingest.orbetra.com\nProtocol: TCP\nPort:     <provided in app → Devices → Add device>"
      },
      {
        "p": "Naudojate modelį, kurio nepaminėjome? [Atsiųskite mums sąrašą](/pilot) ir patvirtinsime, kurias IO reikšmes atpažįstame pagal pavadinimą."
      },
      {"h2": "Nuosavas domenas", "id": "dns"},
      {"p": "White-label klientai skydelį naudoja savo adresu — `fleet.jusuimone.lt` arba tiesiog `jusuimone.lt`. Tam reikia dviejų DNS įrašų: vienas patvirtina, kad domenas jūsų, kitas atveda lankytojus pas mus. Juos pridedate vieną kartą, savo domeno valdytojo skydelyje."},
      {"h2": "Ką daro tie du įrašai", "id": "dns-what"},
      {"p": "**TXT** įrašas yra nuosavybės įrodymas. Jis stovi atskiru vardu — prieš jūsų adresą pridėjus `_orbetra-verify.` — o jo reikšmė yra jums sugeneruotas raktas. Jis nieko niekur neveda; tik leidžia mums įsitikinti, kad domenas valdomas jūsų. Patvirtinus jį galite palikti."},
      {"p": "**Nukreipimo** įrašas ir yra tas, kuris atveda lankytojus. Tai arba CNAME, arba A įrašas — kuris, priklauso nuo jūsų adreso, žr. žemiau."},
      {"h2": "CNAME ar A įrašas", "id": "dns-cname-a"},
      {"p": "Jei jūsų adresas turi žodį prieš domeną — `fleet.jusuimone.lt` — naudokite **CNAME**. Jis rodo į mūsų vardą, o ne į skaičių, tad jei mūsų adresas kada pasikeis, jums daryti nieko nereikės."},
      {"p": "Jei jūsų adresas yra pats domenas — `jusuimone.lt`, be nieko priekyje — CNAME uždėti neįmanoma. Tai ne mūsų produkto apribojimas: pats domenas visada turi įrašus, kurie jį domenu ir daro, o CNAME negali stovėti šalia jokio kito. Beveik nė vienas tiekėjas to sukurti neleis. Naudokite **A** įrašą, arba, jei tiekėjas siūlo **ALIAS** ar **ANAME**, geriau juos — jie veikia kaip A įrašas, bet vis tiek seka paskui mus, jei mūsų adresas pasikeis."},
      {"p": "Skydelis rodo tą vieną įrašą, kuris tinka jūsų įvestam adresui. Rinktis jums nereikia."},
      {"h2": "Taškas vardo gale", "id": "dns-dot"},
      {"p": "Vardus rašome pilnus ir su tašku gale — `fleet.jusuimone.lt.` — nes tas taškas reiškia „šis vardas jau pilnas“."},
      {"p": "Daugelis valdymo skydelių laikosi senesnės taisyklės: vardas **be** taško laikomas nebaigtu, ir prie jo dar kartą pridedamas jūsų domenas. Įklijavus `fleet.jusuimone.lt` be taško, įrašas gali tyliai atsidurti ties `fleet.jusuimone.lt.jusuimone.lt`. Skydelyje jis atrodys visiškai teisingas, o adresas neatsakys nieko."},
      {"p": "Taigi: arba palikite tašką, arba įrašykite tik dalį prieš savo domeną (`fleet`). Abu variantai teisingi. Vengti reikia pilno vardo be taško. Jei jūsų skydelis tai aptinka, jis apie tai praneša."},
      {"h2": "Ką reiškia būsenos", "id": "dns-status"},
      {"table": {"head": ["Būsena", "Reikšmė"], "rows": [["**Laukiama**", "Dar nematome abiejų įrašų viešame DNS. Skydelis tikrina pats."], ["**Rasta**", "Tas įrašas paskelbtas ir teisingas."], ["**Nerasta**", "Kol kas jo nematome. Pakeitimai pasklinda per kelias minutes; jei praėjo ilgiau, palyginkite vardą ir reikšmę su lentele."], ["**Patvirtinta**", "Abu įrašai vietoje. HTTPS išduodamas automatiškai per pirmą saugią užklausą."]]}},
      {"p": "Paštui tai įtakos neturi. Laiškus pristato MX įrašai — jie atskiri ir šio nustatymo niekada neliečiami."}
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
      },
      {"h2": "Własna domena", "id": "dns"},
      {"p": "Klienci white-label korzystają z panelu pod własnym adresem — `fleet.twojafirma.pl` albo po prostu `twojafirma.pl`. Potrzebne są do tego dwa rekordy DNS: jeden potwierdza, że domena jest Twoja, drugi kieruje do nas odwiedzających. Dodaje się je raz, w panelu tego, kto zarządza Twoją domeną."},
      {"h2": "Co robią te dwa rekordy", "id": "dns-what"},
      {"p": "Rekord **TXT** to dowód własności. Stoi pod własną nazwą — z `_orbetra-verify.` przed Twoim adresem — a jego wartością jest wygenerowany dla Ciebie token. Nikogo nigdzie nie kieruje; pozwala nam tylko potwierdzić, że domena należy do Ciebie. Po weryfikacji możesz go zostawić."},
      {"p": "Rekord **kierujący** to ten, który faktycznie sprowadza odwiedzających. Jest to CNAME albo rekord A — który, zależy od Twojego adresu, patrz niżej."},
      {"h2": "CNAME czy rekord A", "id": "dns-cname-a"},
      {"p": "Jeśli Twój adres ma słowo przed domeną — `fleet.twojafirma.pl` — użyj **CNAME**. Wskazuje na naszą nazwę, a nie na liczbę, więc jeśli nasz adres kiedyś się zmieni, nie musisz nic robić."},
      {"p": "Jeśli Twój adres to sama domena — `twojafirma.pl`, bez niczego z przodu — CNAME nie da się ustawić. To nie ograniczenie naszego produktu: sama domena zawsze ma rekordy, które czynią ją domeną, a CNAME nie może stać obok żadnego z nich. Prawie żaden dostawca nie pozwoli go tam utworzyć. Użyj rekordu **A**, albo — jeśli dostawca oferuje **ALIAS** lub **ANAME** — raczej ich: działają jak rekord A, ale nadal podążają za nami."},
      {"p": "Panel pokazuje ten jeden rekord, który pasuje do wpisanego adresu. Nie musisz wybierać."},
      {"h2": "Kropka na końcu nazwy", "id": "dns-dot"},
      {"p": "Nazwy zapisujemy w pełnej formie i z kropką na końcu — `fleet.twojafirma.pl.` — ponieważ ta kropka oznacza „ta nazwa jest już pełna”."},
      {"p": "Wiele paneli stosuje starszą zasadę: nazwa **bez** kropki jest traktowana jako niedokończona i Twoja domena zostaje do niej doklejona drugi raz. Po wklejeniu `fleet.twojafirma.pl` bez kropki rekord może po cichu trafić pod `fleet.twojafirma.pl.twojafirma.pl`. W panelu wygląda całkowicie poprawnie, a adres nie odpowiada."},
      {"p": "Zatem: albo zostaw kropkę, albo wpisz tylko część przed swoją domeną (`fleet`). Oba sposoby są prawidłowe. Unikać należy pełnej nazwy bez kropki. Jeśli panel to wykryje, poinformuje o tym."},
      {"h2": "Co oznaczają statusy", "id": "dns-status"},
      {"table": {"head": ["Status", "Znaczenie"], "rows": [["**Oczekuje**", "Nie widzimy jeszcze obu rekordów w publicznym DNS. Panel sprawdza samodzielnie."], ["**Znaleziono**", "Ten rekord jest opublikowany i poprawny."], ["**Nie znaleziono**", "Na razie go nie widzimy. Zmiany rozchodzą się kilka minut; jeśli minęło więcej, porównaj nazwę i wartość z tabelą."], ["**Zweryfikowana**", "Oba rekordy są na miejscu. HTTPS wystawiany jest automatycznie przy pierwszym bezpiecznym żądaniu."]]}},
      {"p": "Nie ma to wpływu na pocztę. Wiadomości dostarczają rekordy MX — są osobne i ta konfiguracja nigdy ich nie dotyka."}
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
      },
      {"h2": "Eigene Domain", "id": "dns"},
      {"p": "White-Label-Kunden betreiben das Dashboard unter ihrer eigenen Adresse — `fleet.ihrefirma.de` oder `ihrefirma.de` selbst. Dafür sind zwei DNS-Einträge nötig: einer belegt, dass die Domain Ihnen gehört, der andere bringt Besucher zu uns. Sie legen sie einmal an, im Panel Ihres Domain-Verwalters."},
      {"h2": "Was die beiden Einträge tun", "id": "dns-what"},
      {"p": "Der **TXT**-Eintrag ist der Eigentumsnachweis. Er steht unter einem eigenen Namen — mit `_orbetra-verify.` vor Ihrer Adresse — und sein Wert ist ein für Sie erzeugtes Token. Er leitet niemanden weiter; er erlaubt uns nur zu bestätigen, dass die Domain Ihnen gehört. Nach der Prüfung können Sie ihn stehen lassen."},
      {"p": "Der **weiterleitende** Eintrag bringt die Besucher tatsächlich zu uns. Das ist entweder ein CNAME oder ein A-Eintrag — welcher, hängt von Ihrer Adresse ab, siehe unten."},
      {"h2": "CNAME oder A-Eintrag", "id": "dns-cname-a"},
      {"p": "Hat Ihre Adresse ein Wort vor der Domain — `fleet.ihrefirma.de` — nehmen Sie ein **CNAME**. Es zeigt auf unseren Namen statt auf eine Zahl; ändert sich unsere Adresse einmal, müssen Sie nichts tun."},
      {"p": "Ist Ihre Adresse die Domain selbst — `ihrefirma.de`, ohne etwas davor — lässt sich kein CNAME setzen. Das ist keine Einschränkung unseres Produkts: eine Domain für sich trägt immer die Einträge, die sie zur Domain machen, und ein CNAME darf neben keinem von ihnen stehen. Nahezu kein Anbieter lässt dort eines anlegen. Nehmen Sie den **A**-Eintrag, oder — bietet Ihr Anbieter **ALIAS** oder **ANAME** — lieber diese: sie wirken wie ein A-Eintrag, folgen uns aber weiterhin."},
      {"p": "Ihr Dashboard zeigt genau den Eintrag, der zu der eingegebenen Adresse passt. Sie müssen nicht wählen."},
      {"h2": "Der Punkt am Ende eines Namens", "id": "dns-dot"},
      {"p": "Wir schreiben Namen vollständig und mit einem Punkt am Ende — `fleet.ihrefirma.de.` — denn dieser Punkt bedeutet „dieser Name ist bereits vollständig“."},
      {"p": "Viele Panels folgen der älteren Regel: ein Name **ohne** Punkt gilt als unfertig, und Ihre Domain wird ein zweites Mal angehängt. Fügt man `fleet.ihrefirma.de` ohne Punkt ein, landet der Eintrag womöglich still unter `fleet.ihrefirma.de.ihrefirma.de`. Im Panel sieht er völlig korrekt aus, und die Adresse antwortet nicht."},
      {"p": "Also: entweder den Punkt behalten oder nur den Teil vor Ihrer Domain eintragen (`fleet`). Beides ist richtig. Zu vermeiden ist der vollständige Name ohne Punkt. Erkennt Ihr Dashboard das, sagt es Ihnen Bescheid."},
      {"h2": "Was die Status bedeuten", "id": "dns-status"},
      {"table": {"head": ["Status", "Bedeutung"], "rows": [["**Ausstehend**", "Wir sehen noch nicht beide Einträge im öffentlichen DNS. Das Dashboard prüft von selbst weiter."], ["**Gefunden**", "Dieser Eintrag ist veröffentlicht und korrekt."], ["**Nicht gefunden**", "Wir sehen ihn noch nicht. Änderungen brauchen einige Minuten; ist es länger her, vergleichen Sie Name und Wert mit der Tabelle."], ["**Verifiziert**", "Beide Einträge stehen. HTTPS wird bei der ersten sicheren Anfrage automatisch ausgestellt."]]}},
      {"p": "Auf E-Mail hat das keinen Einfluss. Nachrichten liefern MX-Einträge aus — sie sind getrennt und werden von dieser Einrichtung nie berührt."}
    ]
  }
};
