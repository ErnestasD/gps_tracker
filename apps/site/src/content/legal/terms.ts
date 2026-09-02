import type { LocalizedDoc } from "./types";

/**
 * terms — long-form content authored EN (source of truth) + LT/PL/DE translations (W9 i18n).
 * Generated from the extraction/translation workflow; edit the prose here directly going forward.
 */
export const terms: LocalizedDoc = {
  "en": {
    "title": "Terms of Service",
    "label": "LEGAL",
    "updated": "August 2026",
    "notice": "The English version of these terms is authoritative. Translations are provided for convenience only; in case of any discrepancy, the English version prevails.",
    "blocks": [
      {
        "p": "These terms govern access to and use of the Orbetra platform, operated by MB Dokigo, a Lithuanian mažoji bendrija, Krivių g. 5, LT-01204 Vilnius, Lithuania, company code 307575857 (\"Orbetra\", \"we\", \"us\"). By creating an account, signing an order form or using the service you accept them. If you accept on behalf of an organisation, you confirm you are authorised to bind it. The service is provided to businesses and other organisations, not to consumers."
      },
      {
        "h2": "1. Definitions"
      },
      {
        "ul": [
          "**Agreement** — these terms together with the documents listed in section 2.",
          "**Customer**, **you** — the organisation that subscribes to the service.",
          "**Service**, **platform** — the Orbetra web application, APIs, webhooks, ingest endpoints and documentation.",
          "**Workspace** — the isolated tenant in which your devices, users and data live. A reseller workspace may contain sub-accounts.",
          "**User** — a person you authorise to access your workspace.",
          "**Customer data** — everything you or your devices send to, or generate in, the service: telemetry, trips, events, driver and vehicle records, configuration and audit logs.",
          "**Device** — a GPS tracking unit identified by its IMEI that you connect to the service.",
          "**Reseller**, **TSP** — a customer licensing the white-label platform to serve its own end customers.",
          "**Order form** — any written or electronic order, pilot or reseller agreement signed by both parties.",
          "**DPA** — the [Data Processing Addendum](/dpa)."
        ]
      },
      {
        "h2": "2. Agreement documents and order of precedence"
      },
      {
        "p": "The Agreement consists of, in descending order of precedence: (a) a signed order form, pilot or reseller agreement, for the matters it expressly covers; (b) the DPA, which prevails on anything concerning the processing of personal data; (c) these terms; (d) the published documentation and the plan descriptions at [orbetra.com/pricing](/pricing). Purchase-order terms, vendor-portal terms or similar documents issued by you do not apply, even if we acknowledge the order."
      },
      {
        "h2": "3. The service"
      },
      {
        "p": "Orbetra is a GPS fleet-tracking platform: live tracking, trips and playback, geofences, rules and alerts, reports, fuel level monitoring, driver records, maintenance reminders, device commands, webhooks and a REST API. Resellers may additionally licence the white-label platform with their own branding, domains and sub-accounts. We may improve and change the service; we will not materially reduce the core functionality of your plan during a paid term without notice under section 25."
      },
      {
        "h2": "4. Accounts and users"
      },
      {
        "p": "You are responsible for the accuracy of your account details, for everything your users do in your workspace, and for keeping credentials and API keys confidential. Users must be at least 18. You must promptly remove access for people who leave your organisation, and tell us at [hello@orbetra.com](mailto:hello@orbetra.com) if you suspect credentials have been compromised. Resellers are responsible towards us for their sub-accounts."
      },
      {
        "h2": "5. Trials and pilots"
      },
      {
        "p": "Free trials run for 30 days without a card. At the end of a trial the workspace becomes read-only unless a paid subscription is started. Trial data is deleted 30 days after the trial ends unless you subscribe. Reseller pilots are sales-led and run for the period stated in the pilot agreement. Trials and pilots are provided as-is, without the uptime commitment in section 12."
      },
      {
        "h2": "6. Fees, billing and taxes"
      },
      {
        "p": "Subscriptions are billed monthly or annually in advance in EUR. Prices are those published at [orbetra.com/pricing](/pricing) at the time of purchase, or those in your order form. Annual plans are billed for the full term. Fees are exclusive of VAT and other taxes; EU business customers who supply a valid VAT number are invoiced under the reverse-charge mechanism where it applies. Plans include a device allowance; usage above that allowance is billed as overage at the rate published for your plan, or you can move to a larger plan at any time. Late payment may lead to suspension after notice under section 17. Fees already paid are non-refundable except where these terms or mandatory law say otherwise. We may change list prices with at least 30 days' notice, effective at your next renewal."
      },
      {
        "h2": "7. Acceptable use"
      },
      {
        "ul": [
          "No unlawful surveillance. You must have a lawful basis for tracking vehicles and must inform drivers as required by local law.",
          "No tracking of individuals outside a legitimate fleet-management purpose, and no use of the service to harass, stalk or covertly monitor a person.",
          "No reverse engineering, resale or sublicensing of the direct product outside a signed reseller agreement.",
          "No attempts to disrupt the service, bypass rate limits, probe or scan the infrastructure, or access other tenants' data.",
          "No uploading of malware, and no use of the platform to store data unrelated to fleet operations.",
          "API keys must be kept secret and rotated if exposed."
        ]
      },
      {
        "h2": "8. Your responsibilities as employer and controller"
      },
      {
        "p": "Vehicle tracking is regulated employment and data-protection territory, and those duties sit with you, not with us. Before connecting devices you must, where applicable: establish and document a lawful basis; inform drivers and other affected people about the tracking, its purpose and its retention; complete any works-council or employee-representative consultation and agreement (for example a Betriebsvereinbarung in Germany, or consultation with employee representatives in Poland and other jurisdictions); carry out a data protection impact assessment where one is required; and configure retention, private-mode and geofence settings so that they match what you told your drivers. You are responsible for the lawfulness of the instructions you give us through the platform."
      },
      {
        "h2": "9. Intellectual property and licence"
      },
      {
        "p": "The platform, its software, interfaces, documentation and branding remain ours and our licensors'. Subject to the Agreement and payment of fees, we grant you a non-exclusive, non-transferable, revocable right to use the service during the subscription term for your internal business purposes — and, for resellers, to resell access to their end customers on the terms of their reseller agreement. Nothing transfers ownership. You keep all rights in your data, your brand assets and your content; you grant us only the limited right to host, process, transmit and display them as needed to provide and support the service. Feedback you send us may be used freely to improve the product, without obligation and without identifying you."
      },
      {
        "h2": "10. Your data"
      },
      {
        "p": "You retain ownership of your data. We process personal data in it under the [Data Processing Addendum](/dpa), as processor on your instructions. You can export via the API, or as CSV or PDF, at any time. Telemetry is retained for 13 months by default. We do not sell customer data and do not use it to train models or for advertising."
      },
      {
        "h2": "11. Confidentiality"
      },
      {
        "p": "Each party may receive non-public information from the other — pricing and order terms, product roadmaps, security details, customer data. Each party will use the other's confidential information only to perform the Agreement, protect it with at least reasonable care, and disclose it only to personnel and subcontractors who need it and are bound by equivalent duties. The duty does not cover information that is public without breach, independently developed, or lawfully received from a third party, and it does not prevent disclosure required by law or a regulator, where the other party is notified if legally permitted. These obligations survive for three years after termination, and for as long as the law protects the information in the case of trade secrets."
      },
      {
        "h2": "12. Support and service levels"
      },
      {
        "p": "Support is provided by email at [hello@orbetra.com](mailto:hello@orbetra.com) on Lithuanian business days. The support level and any named contact depend on your plan, as described at [orbetra.com/pricing](/pricing); specific response targets, where we commit to them, are stated in your order form. A contractual **99.9% monthly uptime commitment with service credits applies to Scale and Enterprise plans only**; the credit schedule and the measurement method are set out in the order form. Credits must be requested in writing within 30 days of the end of the affected month and are the sole and exclusive remedy for missed uptime. All other plans are supported on a best-effort basis without a contractual SLA."
      },
      {
        "h2": "13. Availability and maintenance"
      },
      {
        "p": "We aim for high availability and notify you of incidents that affect your workspace. Planned maintenance is announced in advance where practical and scheduled outside European business hours where possible. Emergency maintenance may be carried out at any time; we will tell you as soon as we reasonably can. Downtime caused by your systems, your devices, mobile networks, GNSS conditions, or by events under section 21, does not count against any uptime commitment."
      },
      {
        "h2": "14. Beta and preview features"
      },
      {
        "p": "Features labelled beta, preview or early access are optional and provided as-is, without warranty, support commitment or SLA. They may change, break or be withdrawn at any time, and they are excluded from sections 12 and 13. Do not rely on them for operationally critical decisions, and treat information about them as confidential."
      },
      {
        "h2": "15. Fair use and API limits"
      },
      {
        "p": "The API and webhooks are subject to the rate limits stated in the documentation and to fair use. We may throttle or temporarily restrict requests that threaten platform stability, and we will contact you before doing so unless the risk is immediate. Sustained usage well beyond your plan — device counts above your entitlement, bulk polling in place of webhooks, or automated re-export of the whole dataset — may require an upgrade. Do not use the API to build a competing tracking service."
      },
      {
        "h2": "16. Devices and third parties"
      },
      {
        "p": "Orbetra depends on your tracking hardware, its SIM connectivity and GNSS availability. We are not responsible for gaps or inaccuracies caused by hardware, installation, network coverage or satellite conditions. Device identity is based on IMEI; the service is not tamper-proof and must not be relied on as sole evidence."
      },
      {
        "h2": "17. Suspension"
      },
      {
        "p": "We may suspend a workspace, a user or an API key if fees remain unpaid after written reminder, if the acceptable-use rules in section 7 are breached, if there is a credible security threat to the platform or to other customers, or if suspension is required by law. Except where the risk is immediate or the law requires otherwise, we give at least 7 days' notice and a chance to fix the problem. Suspension is limited to what is necessary — we restore access as soon as the cause is resolved. Suspension does not suspend your obligation to pay, and it does not by itself delete data: the retention and deletion rules in section 19 apply only on termination."
      },
      {
        "h2": "18. Term and termination"
      },
      {
        "p": "Monthly subscriptions may be cancelled at any time and end at the close of the paid period. Annual subscriptions renew for a further year unless either party gives notice at least 30 days before the renewal date. Either party may terminate for material breach not cured within 30 days of written notice, or immediately if the other party becomes insolvent."
      },
      {
        "h2": "19. Export and deletion after termination"
      },
      {
        "p": "After termination or expiry your workspace stays available in read-only mode for 30 days so you can export data through the app and the API. After that window we delete customer data from live systems within 30 days; residual copies in encrypted backups are overwritten on the normal backup rotation, within 30 days of the deletion. We keep only what law requires us to keep — mainly invoices and accounting records. On written request we will confirm deletion. Resellers are responsible for giving their own end customers an equivalent export window."
      },
      {
        "h2": "20. Liability"
      },
      {
        "p": "To the maximum extent permitted by law, neither party is liable for indirect or consequential loss, loss of profit, or loss of data. Our aggregate liability in any 12-month period is limited to the fees you paid in that period. Nothing limits liability for fraud, wilful misconduct or death and personal injury. These limits apply to the whole Agreement, including the DPA."
      },
      {
        "h2": "21. Force majeure"
      },
      {
        "p": "Neither party is liable for delay or failure caused by events beyond its reasonable control, including natural disasters, war, terrorism, civil unrest, epidemics, strikes, failures of power, mobile networks, GNSS or upstream internet providers, large-scale cyber-attacks, and acts of public authorities. Payment obligations are not excused. If the event lasts more than 30 days, either party may terminate the affected subscription and we refund prepaid fees for the unused period."
      },
      {
        "h2": "22. Subcontractors"
      },
      {
        "p": "We may use subcontractors and sub-processors to deliver the service — the current list is published at [orbetra.com/subprocessors](/subprocessors) — and we remain responsible for their performance as if it were our own. Changes to sub-processors follow the 30-day notice and objection process in the [DPA](/dpa)."
      },
      {
        "h2": "23. Assignment"
      },
      {
        "p": "Neither party may assign the Agreement without the other's written consent, which will not be unreasonably withheld. Either party may assign it in full to an affiliate or to a successor in a merger, reorganisation or sale of substantially all of its business, on written notice. Any other attempted assignment is void."
      },
      {
        "h2": "24. Notices"
      },
      {
        "p": "We give notices by email to the addresses registered in your account and, for changes that affect all customers, by publishing them at orbetra.com — service notices such as incidents and maintenance may also appear in the app. You give notices to [hello@orbetra.com](mailto:hello@orbetra.com); notices of termination or of a legal claim must also be sent by post to MB Dokigo, Krivių g. 5, LT-01204 Vilnius, Lithuania. Email notices are deemed received on the next business day. Keep your billing and administrative contacts current — that is where the notices go."
      },
      {
        "h2": "25. Changes to these terms"
      },
      {
        "p": "We may update these terms with at least 30 days' notice for material changes, given by email and on this page. Continued use after the effective date means acceptance. If a material change is unacceptable to you, you may terminate before it takes effect and we refund prepaid fees for the unused period."
      },
      {
        "h2": "26. Governing law and jurisdiction"
      },
      {
        "p": "Lithuanian law applies, excluding its conflict-of-law rules and the UN Convention on Contracts for the International Sale of Goods; the courts of Vilnius have exclusive jurisdiction, without affecting mandatory consumer protections in your country of residence. Either party may still seek injunctive relief in any competent court to protect its intellectual property or confidential information."
      },
      {
        "h2": "27. General"
      },
      {
        "p": "If any provision is held invalid, the rest stays in force and the invalid part is replaced by a valid one closest to its intent. A failure to enforce a right is not a waiver of it. The Agreement is the entire agreement between the parties on its subject and replaces earlier proposals and statements. Nothing in it creates a partnership, agency or employment relationship, and it creates no rights for third parties. Sections that by their nature should survive termination — including 9, 10, 11, 19, 20, 26 and 27 — do so."
      }
    ]
  },
  "lt": {
    "title": "Paslaugų teikimo sąlygos",
    "label": "TEISINĖ INFORMACIJA",
    "updated": "2026 m. rugpjūtis",
    "notice": "Tai yra vertimas patogumo tikslais. Esant bet kokiems neatitikimams, pirmenybė teikiama angliškajai versijai.",
    "blocks": [
      {
        "p": "Šios sąlygos reglamentuoja prieigą prie Orbetra platformos ir naudojimąsi ja; platformą valdo MB Dokigo, Lietuvos mažoji bendrija, Krivių g. 5, LT-01204 Vilnius, Lietuva, įmonės kodas 307575857 („Orbetra“, „mes“, „mus“). Sukurdami paskyrą, pasirašydami užsakymo formą arba naudodamiesi paslauga jūs jas priimate. Jei priimate organizacijos vardu, patvirtinate, kad esate įgaliotas ją įpareigoti. Paslauga teikiama verslui ir kitoms organizacijoms, o ne vartotojams."
      },
      {
        "h2": "1. Sąvokos"
      },
      {
        "ul": [
          "**Sutartis** — šios sąlygos kartu su 2 skyriuje išvardytais dokumentais.",
          "**Klientas**, **jūs** — organizacija, užsiprenumeravusi paslaugą.",
          "**Paslauga**, **platforma** — Orbetra žiniatinklio programa, API, webhook'ai, priėmimo (ingest) galiniai taškai ir dokumentacija.",
          "**Darbo erdvė** — atskirta jūsų aplinka (tenant), kurioje saugomi jūsų įrenginiai, naudotojai ir duomenys. Perpardavėjo darbo erdvė gali turėti subpaskyrų.",
          "**Naudotojas** — asmuo, kuriam suteikiate teisę prisijungti prie jūsų darbo erdvės.",
          "**Kliento duomenys** — viskas, ką jūs ar jūsų įrenginiai siunčiate į paslaugą arba sukuriate joje: telemetrija, kelionės, įvykiai, vairuotojų ir transporto priemonių įrašai, konfigūracija ir audito žurnalai.",
          "**Įrenginys** — GPS sekimo įrenginys, identifikuojamas pagal IMEI, kurį prijungiate prie paslaugos.",
          "**Perpardavėjas**, **TSP** — klientas, licencijuojantis white-label platformą savo galutiniams klientams aptarnauti.",
          "**Užsakymo forma** — bet koks rašytinis ar elektroninis užsakymas, bandomasis (pilot) ar perpardavimo susitarimas, pasirašytas abiejų šalių.",
          "**DPA** — [Duomenų tvarkymo priedas](/dpa)."
        ]
      },
      {
        "h2": "2. Sutarties dokumentai ir jų viršenybės tvarka"
      },
      {
        "p": "Sutartį sudaro (mažėjančia viršenybės tvarka): (a) pasirašyta užsakymo forma, bandomasis (pilot) ar perpardavimo susitarimas — dėl klausimų, kuriuos jis aiškiai apima; (b) DPA, kuris turi viršenybę visais su asmens duomenų tvarkymu susijusiais klausimais; (c) šios sąlygos; (d) paskelbta dokumentacija ir planų aprašymai adresu [orbetra.com/pricing](/pricing). Jūsų pateikti pirkimo užsakymo, tiekėjų portalo ar panašūs dokumentai netaikomi, net jei užsakymą patvirtiname."
      },
      {
        "h2": "3. Paslauga"
      },
      {
        "p": "Orbetra yra GPS autoparko sekimo platforma: sekimas realiuoju laiku, kelionės ir jų atkūrimas, geozonos, taisyklės ir įspėjimai, ataskaitos, kuro lygio stebėsena, vairuotojų įrašai, techninės priežiūros priminimai, įrenginių komandos, webhook'ai ir REST API. Perpardavėjai papildomai gali licencijuoti white-label platformą su savo prekės ženklu, domenais ir subpaskyromis. Mes galime tobulinti ir keisti paslaugą; apmokėto laikotarpio metu be įspėjimo pagal 25 skyrių iš esmės nesumažinsime jūsų plano pagrindinio funkcionalumo."
      },
      {
        "h2": "4. Paskyros ir naudotojai"
      },
      {
        "p": "Jūs atsakote už savo paskyros duomenų tikslumą, už viską, ką jūsų naudotojai daro jūsų darbo erdvėje, ir už prisijungimo duomenų bei API raktų konfidencialumo užtikrinimą. Naudotojai turi būti ne jaunesni kaip 18 metų. Turite nedelsdami panaikinti prieigą iš jūsų organizacijos išeinantiems asmenims ir pranešti mums adresu [hello@orbetra.com](mailto:hello@orbetra.com), jei įtariate, kad prisijungimo duomenys pažeisti. Perpardavėjai mums atsako už savo subpaskyras."
      },
      {
        "h2": "5. Bandomieji laikotarpiai ir pilotai"
      },
      {
        "p": "Nemokami bandomieji laikotarpiai trunka 30 dienų be kortelės. Pasibaigus bandomajam laikotarpiui darbo erdvė perjungiama į tik skaitymo režimą, nebent pradedama mokama prenumerata. Bandomieji duomenys ištrinami praėjus 30 dienų po bandomojo laikotarpio pabaigos, nebent užsiprenumeruojate. Perpardavėjų pilotus organizuoja pardavimų komanda; jie trunka pilotiniame susitarime nurodytą laikotarpį. Bandomieji laikotarpiai ir pilotai teikiami tokie, kokie yra (as-is), be 12 skyriuje numatyto veikimo laiko įsipareigojimo."
      },
      {
        "h2": "6. Įmokos, sąskaitų išrašymas ir mokesčiai"
      },
      {
        "p": "Sąskaitos už prenumeratas išrašomos iš anksto kas mėnesį arba kasmet eurais (EUR). Kainos yra tos, kurios pirkimo metu paskelbtos adresu [orbetra.com/pricing](/pricing), arba nurodytos jūsų užsakymo formoje. Už metinius planus sąskaita išrašoma už visą laikotarpį. Į įmokas neįskaičiuotas PVM ir kiti mokesčiai; ES verslo klientams, pateikusiems galiojantį PVM mokėtojo kodą, sąskaitos išrašomos taikant atvirkštinio apmokestinimo mechanizmą, kai jis taikytinas. Į planus įskaičiuotas įrenginių limitas; naudojimas virš šio limito apmokestinamas kaip perviršis pagal jūsų planui paskelbtą įkainį, arba bet kada galite pereiti prie didesnio plano. Vėluojant sumokėti, paslauga gali būti sustabdyta, apie tai įspėjus pagal 17 skyrių. Jau sumokėtos įmokos negrąžinamos, išskyrus atvejus, kai šios sąlygos ar imperatyvūs teisės aktai nustato kitaip. Mes galime keisti kainoraščio kainas įspėję ne vėliau kaip prieš 30 dienų; jos įsigalioja jūsų kito atnaujinimo metu."
      },
      {
        "h2": "7. Priimtinas naudojimas"
      },
      {
        "ul": [
          "Jokio neteisėto sekimo. Turite turėti teisėtą pagrindą sekti transporto priemones ir privalote informuoti vairuotojus, kaip reikalauja vietos teisės aktai.",
          "Jokio asmenų sekimo už teisėto autoparko valdymo tikslo ribų ir jokio paslaugos naudojimo asmeniui persekioti, sekti ar slapta stebėti.",
          "Jokios tiesioginio produkto atvirkštinės inžinerijos, perpardavimo ar sublicencijavimo už pasirašyto perpardavimo susitarimo ribų.",
          "Jokių bandymų sutrikdyti paslaugą, apeiti užklausų dažnio ribojimus, tirti ar skenuoti infrastruktūrą arba pasiekti kitų klientų duomenis.",
          "Jokio kenkėjiškų programų įkėlimo ir jokio platformos naudojimo su autoparko veikla nesusijusiems duomenims saugoti.",
          "API raktus privaloma laikyti paslaptyje, o juos atskleidus — nedelsiant pakeisti."
        ]
      },
      {
        "h2": "8. Jūsų, kaip darbdavio ir duomenų valdytojo, pareigos"
      },
      {
        "p": "Transporto priemonių sekimas yra reglamentuojama darbo santykių ir duomenų apsaugos sritis, ir šios pareigos tenka jums, o ne mums. Prieš prijungdami įrenginius, kai taikytina, privalote: nustatyti ir dokumentuoti teisėtą pagrindą; informuoti vairuotojus ir kitus susijusius asmenis apie sekimą, jo tikslą ir saugojimo trukmę; užbaigti bet kokias konsultacijas ir susitarimus su darbo taryba ar darbuotojų atstovais (pavyzdžiui, Betriebsvereinbarung Vokietijoje arba konsultacijas su darbuotojų atstovais Lenkijoje ir kitose jurisdikcijose); atlikti poveikio duomenų apsaugai vertinimą, kai jis reikalingas; ir sukonfigūruoti saugojimo, privataus režimo ir geozonų nustatymus taip, kad jie atitiktų tai, ką pranešėte savo vairuotojams. Jūs atsakote už mums per platformą duodamų nurodymų teisėtumą."
      },
      {
        "h2": "9. Intelektinė nuosavybė ir licencija"
      },
      {
        "p": "Platforma, jos programinė įranga, sąsajos, dokumentacija ir prekės ženklas lieka mūsų ir mūsų licenciarų nuosavybe. Laikantis Sutarties ir sumokėjus įmokas, suteikiame jums neišimtinę, neperleidžiamą, atšaukiamą teisę naudotis paslauga prenumeratos laikotarpiu jūsų vidiniais verslo tikslais, o perpardavėjams — perparduoti prieigą savo galutiniams klientams pagal jų perpardavimo susitarimo sąlygas. Niekas neperduoda nuosavybės teisių. Jūs išsaugote visas teises į savo duomenis, prekės ženklo išteklius ir turinį; suteikiate mums tik ribotą teisę juos talpinti, tvarkyti, perduoti ir rodyti, kiek reikia paslaugai teikti ir palaikyti. Jūsų mums siunčiamą grįžtamąjį ryšį galime laisvai naudoti produktui tobulinti, be jokių įsipareigojimų ir jūsų neidentifikuodami."
      },
      {
        "h2": "10. Jūsų duomenys"
      },
      {
        "p": "Jūs išlaikote savo duomenų nuosavybę. Juose esančius asmens duomenis tvarkome pagal [Duomenų tvarkymo priedą](/dpa), kaip tvarkytojas pagal jūsų nurodymus. Bet kada galite eksportuoti per API arba kaip CSV ar PDF. Telemetrija pagal numatytuosius nustatymus saugoma 13 mėnesių. Mes neparduodame kliento duomenų ir jų nenaudojame modeliams mokyti ar reklamai."
      },
      {
        "h2": "11. Konfidencialumas"
      },
      {
        "p": "Kiekviena šalis gali gauti neviešos informacijos iš kitos — kainodaros ir užsakymo sąlygas, produkto planus, saugumo detales, kliento duomenis. Kiekviena šalis naudos kitos šalies konfidencialią informaciją tik Sutarčiai vykdyti, saugos ją bent pakankamai rūpestingai ir atskleis tik darbuotojams bei subrangovams, kuriems ji reikalinga ir kuriuos saisto lygiavertės pareigos. Ši pareiga netaikoma informacijai, kuri yra vieša be pažeidimo, sukurta savarankiškai arba teisėtai gauta iš trečiosios šalies, ir ji netrukdo atskleisti informacijos, kai to reikalauja įstatymas ar priežiūros institucija, apie tai pranešant kitai šaliai, jei tai teisiškai leidžiama. Šie įsipareigojimai galioja trejus metus po nutraukimo, o komercinių paslapčių atveju — tol, kol įstatymas saugo informaciją."
      },
      {
        "h2": "12. Palaikymas ir paslaugų lygiai"
      },
      {
        "p": "Palaikymas teikiamas el. paštu [hello@orbetra.com](mailto:hello@orbetra.com) Lietuvos darbo dienomis. Palaikymo lygis ir bet koks paskirtas kontaktinis asmuo priklauso nuo jūsų plano, kaip aprašyta adresu [orbetra.com/pricing](/pricing); konkretūs atsako terminai, kai juos įsipareigojame, nurodomi jūsų užsakymo formoje. Sutartinis **99,9 % mėnesinio veikimo laiko įsipareigojimas su paslaugų kreditais taikomas tik Scale ir Enterprise planams**; kreditų lentelė ir matavimo metodas nustatyti užsakymo formoje. Kreditų būtina paprašyti raštu per 30 dienų nuo atitinkamo mėnesio pabaigos; tai vienintelė ir išimtinė teisių gynimo priemonė dėl neįvykdyto veikimo laiko įsipareigojimo. Visi kiti planai palaikomi dedant geriausias pastangas (best-effort), be sutartinio SLA."
      },
      {
        "h2": "13. Prieinamumas ir techninė priežiūra"
      },
      {
        "p": "Siekiame aukšto prieinamumo ir informuojame jus apie incidentus, turinčius įtakos jūsų darbo erdvei. Planinė techninė priežiūra, kai tai praktiška, skelbiama iš anksto ir, kai įmanoma, planuojama ne Europos darbo laiku. Skubi techninė priežiūra gali būti atliekama bet kuriuo metu; pranešime jums, kai tik pagrįstai galėsime. Prastova, kurią sukėlė jūsų sistemos, jūsų įrenginiai, mobiliojo ryšio tinklai, GNSS sąlygos arba 21 skyriuje nurodyti įvykiai, neįskaitoma į jokį veikimo laiko įsipareigojimą."
      },
      {
        "h2": "14. Beta ir peržiūros funkcijos"
      },
      {
        "p": "Funkcijos, pažymėtos kaip beta, peržiūros (preview) ar ankstyvosios prieigos (early access), yra pasirenkamos ir teikiamos tokios, kokios yra (as-is), be garantijos, palaikymo įsipareigojimo ar SLA. Jos gali keistis, sugesti ar būti pašalintos bet kuriuo metu, o 12 ir 13 skyriai joms netaikomi. Nesiremkite jomis priimdami operaciniu požiūriu kritinius sprendimus ir informaciją apie jas laikykite konfidencialia."
      },
      {
        "h2": "15. Sąžiningas naudojimas ir API limitai"
      },
      {
        "p": "API ir webhook'ams taikomi dokumentacijoje nurodyti užklausų dažnio ribojimai ir sąžiningo naudojimo principas. Galime pristabdyti arba laikinai apriboti užklausas, keliančias grėsmę platformos stabilumui, ir prieš tai su jumis susisieksime, nebent rizika neatidėliotina. Ilgą laiką gerokai viršijant jūsų planą — įrenginių skaičius virš jūsų limito, masinės periodinės užklausos (polling) vietoj webhook'ų arba automatinis viso duomenų rinkinio pakartotinis eksportas — gali tekti pereiti prie didesnio plano. Nenaudokite API konkuruojančiai sekimo paslaugai kurti."
      },
      {
        "h2": "16. Įrenginiai ir trečiosios šalys"
      },
      {
        "p": "Orbetra priklauso nuo jūsų sekimo aparatinės įrangos, jos SIM ryšio ir GNSS prieinamumo. Mes neatsakome už spragas ar netikslumus, kuriuos sukelia aparatinė įranga, montavimas, tinklo aprėptis ar palydovinės sąlygos. Įrenginio tapatybė grindžiama IMEI; paslauga nėra apsaugota nuo klastojimo ir neturi būti naudojama kaip vienintelis įrodymas."
      },
      {
        "h2": "17. Sustabdymas"
      },
      {
        "p": "Galime sustabdyti darbo erdvę, naudotoją ar API raktą, jei įmokos lieka nesumokėtos po rašytinio priminimo, jei pažeidžiamos 7 skyriaus priimtino naudojimo taisyklės, jei kyla patikima saugumo grėsmė platformai ar kitiems klientams arba jei sustabdymo reikalauja įstatymas. Išskyrus atvejus, kai rizika neatidėliotina arba įstatymas reikalauja kitaip, įspėjame ne vėliau kaip prieš 7 dienas ir suteikiame galimybę problemą ištaisyti. Sustabdymas taikomas tik tiek, kiek būtina — prieigą atkuriame, kai tik pašalinama priežastis. Sustabdymas nepanaikina jūsų pareigos mokėti ir savaime neištrina duomenų: 19 skyriaus saugojimo ir ištrynimo taisyklės taikomos tik nutraukus sutartį."
      },
      {
        "h2": "18. Galiojimo terminas ir nutraukimas"
      },
      {
        "p": "Mėnesinės prenumeratos gali būti nutrauktos bet kuriuo metu ir baigiasi pasibaigus apmokėtam laikotarpiui. Metinės prenumeratos atnaujinamos dar vieneriems metams, nebent kuri nors šalis įspėja ne vėliau kaip prieš 30 dienų iki atnaujinimo datos. Kiekviena šalis gali nutraukti dėl esminio pažeidimo, neištaisyto per 30 dienų nuo rašytinio įspėjimo, arba nedelsiant, jei kita šalis tampa nemoki."
      },
      {
        "h2": "19. Eksportas ir ištrynimas po nutraukimo"
      },
      {
        "p": "Nutraukus sutartį arba jai pasibaigus, jūsų darbo erdvė dar 30 dienų lieka prieinama tik skaitymo režimu, kad galėtumėte eksportuoti duomenis per programą ir API. Po šio laikotarpio kliento duomenis iš veikiančių sistemų ištriname per 30 dienų; šifruotose atsarginėse kopijose likę duomenys perrašomi įprasto atsarginių kopijų ciklo metu, per 30 dienų nuo ištrynimo. Saugome tik tai, ką saugoti įpareigoja įstatymas — daugiausia sąskaitas faktūras ir apskaitos įrašus. Gavę rašytinį prašymą patvirtinsime ištrynimą. Perpardavėjai atsako už tokio paties eksporto laikotarpio suteikimą savo galutiniams klientams."
      },
      {
        "h2": "20. Atsakomybė"
      },
      {
        "p": "Kiek leidžia įstatymas, nė viena šalis neatsako už netiesioginius ar išvestinius nuostolius, negautą pelną ar duomenų praradimą. Mūsų bendra atsakomybė per bet kurį 12 mėnesių laikotarpį apribojama įmokomis, kurias sumokėjote per tą laikotarpį. Niekas neriboja atsakomybės už sukčiavimą, tyčinį pažeidimą arba mirtį ir kūno sužalojimą. Šios ribos taikomos visai Sutarčiai, įskaitant DPA."
      },
      {
        "h2": "21. Nenugalima jėga (force majeure)"
      },
      {
        "p": "Nė viena šalis neatsako už vėlavimą ar neįvykdymą dėl įvykių, kurių ji negali pagrįstai kontroliuoti, įskaitant stichines nelaimes, karą, terorizmą, pilietinius neramumus, epidemijas, streikus, elektros, mobiliojo ryšio tinklų, GNSS ar interneto tiekėjų sutrikimus, didelio masto kibernetines atakas ir valdžios institucijų veiksmus. Tai neatleidžia nuo pareigos mokėti. Jei įvykis trunka ilgiau nei 30 dienų, kiekviena šalis gali nutraukti atitinkamą prenumeratą, o mes grąžiname iš anksto sumokėtas įmokas už nepanaudotą laikotarpį."
      },
      {
        "h2": "22. Subrangovai"
      },
      {
        "p": "Paslaugai teikti galime pasitelkti subrangovus ir subtvarkytojus — dabartinis sąrašas skelbiamas adresu [orbetra.com/subprocessors](/subprocessors) — ir liekame atsakingi už jų veiklą kaip už savo. Subtvarkytojų pakeitimams taikomas 30 dienų įspėjimo ir prieštaravimo procesas, numatytas [DPA](/dpa)."
      },
      {
        "h2": "23. Perleidimas"
      },
      {
        "p": "Nė viena šalis negali perleisti Sutarties be kitos šalies rašytinio sutikimo, kurio nepagrįstai neatsisakoma duoti. Kiekviena šalis gali ją visą perleisti susijusiai įmonei arba teisių perėmėjui susijungimo, reorganizavimo ar iš esmės viso verslo pardavimo atveju, apie tai raštu pranešusi. Bet koks kitas bandymas perleisti yra negaliojantis."
      },
      {
        "h2": "24. Pranešimai"
      },
      {
        "p": "Pranešimus teikiame el. paštu jūsų paskyroje registruotais adresais, o apie pakeitimus, turinčius įtakos visiems klientams, skelbiame orbetra.com; paslaugų pranešimai, tokie kaip incidentai ir techninė priežiūra, taip pat gali būti rodomi programoje. Jūs teikiate pranešimus adresu [hello@orbetra.com](mailto:hello@orbetra.com); pranešimai apie nutraukimą ar teisinį reikalavimą taip pat turi būti siunčiami paštu adresu MB Dokigo, Krivių g. 5, LT-01204 Vilnius, Lietuva. El. paštu siųsti pranešimai laikomi gautais kitą darbo dieną. Nuolat atnaujinkite savo atsiskaitymo ir administracinius kontaktus — būtent ten siunčiami pranešimai."
      },
      {
        "h2": "25. Šių sąlygų pakeitimai"
      },
      {
        "p": "Esminius šių sąlygų pakeitimus galime atlikti įspėję ne vėliau kaip prieš 30 dienų el. paštu ir šiame puslapyje. Tolesnis naudojimasis po įsigaliojimo datos reiškia sutikimą. Jei esminis pakeitimas jums nepriimtinas, galite nutraukti prieš jam įsigaliojant, o mes grąžiname iš anksto sumokėtas įmokas už nepanaudotą laikotarpį."
      },
      {
        "h2": "26. Taikoma teisė ir jurisdikcija"
      },
      {
        "p": "Taikoma Lietuvos teisė, išskyrus jos kolizines normas ir JT konvenciją dėl tarptautinio prekių pirkimo–pardavimo sutarčių; Vilniaus teismai turi išimtinę jurisdikciją, nepažeidžiant imperatyvios vartotojų apsaugos jūsų gyvenamosios vietos šalyje. Kiekviena šalis vis tiek gali kreiptis dėl laikinųjų apsaugos priemonių į bet kurį kompetentingą teismą savo intelektinei nuosavybei ar konfidencialiai informacijai apsaugoti."
      },
      {
        "h2": "27. Bendrosios nuostatos"
      },
      {
        "p": "Jei kuri nors nuostata pripažįstama negaliojančia, likusi dalis lieka galioti, o negaliojanti dalis pakeičiama galiojančia, artimiausia jos tikslui. Teisės neįgyvendinimas nėra jos atsisakymas. Sutartis sudaro visą šalių susitarimą dėl jos dalyko ir pakeičia ankstesnius pasiūlymus bei pareiškimus. Niekas joje nesukuria partnerystės, atstovavimo ar darbo santykių ir nesukuria jokių teisių trečiosioms šalims. Skyriai, kurie dėl savo pobūdžio turėtų likti galioti po nutraukimo — įskaitant 9, 10, 11, 19, 20, 26 ir 27 — lieka galioti."
      }
    ]
  },
  "pl": {
    "title": "Warunki świadczenia usług",
    "label": "INFORMACJE PRAWNE",
    "updated": "sierpień 2026",
    "notice": "Niniejszy tekst stanowi tłumaczenie pomocnicze. W przypadku jakichkolwiek rozbieżności rozstrzygające znaczenie ma wersja angielska.",
    "blocks": [
      {
        "p": "Niniejsze warunki regulują dostęp do platformy Orbetra oraz korzystanie z niej; platformę prowadzi MB Dokigo, litewska mažoji bendrija, Krivių g. 5, LT-01204 Vilnius, Litwa, numer rejestrowy 307575857 („Orbetra”, „my”, „nas”). Zakładając konto, podpisując formularz zamówienia lub korzystając z usługi, akceptujesz je. Jeśli akceptujesz je w imieniu organizacji, potwierdzasz, że jesteś upoważniony do jej związania. Usługa jest świadczona przedsiębiorstwom i innym organizacjom, a nie konsumentom."
      },
      {
        "h2": "1. Definicje"
      },
      {
        "ul": [
          "**Umowa** — niniejsze warunki wraz z dokumentami wymienionymi w sekcji 2.",
          "**Klient**, **Ty** — organizacja, która subskrybuje usługę.",
          "**Usługa**, **platforma** — aplikacja internetowa Orbetra, interfejsy API, webhooki, punkty końcowe ingest oraz dokumentacja.",
          "**Obszar roboczy** — odizolowany najemca (tenant), w którym znajdują się Twoje urządzenia, użytkownicy i dane. Obszar roboczy resellera może zawierać subkonta.",
          "**Użytkownik** — osoba, którą upoważniasz do dostępu do Twojego obszaru roboczego.",
          "**Dane klienta** — wszystko, co Ty lub Twoje urządzenia wysyłacie do usługi lub generujecie w niej: telemetria, przejazdy, zdarzenia, rejestry kierowców i pojazdów, konfiguracja oraz dzienniki audytu.",
          "**Urządzenie** — jednostka śledząca GPS identyfikowana przez swój IMEI, którą podłączasz do usługi.",
          "**Reseller**, **TSP** — klient licencjonujący platformę white-label w celu obsługi własnych klientów końcowych.",
          "**Formularz zamówienia** — dowolne pisemne lub elektroniczne zamówienie, umowa pilotażowa lub umowa resellerska podpisana przez obie strony.",
          "**DPA** — [Aneks o powierzeniu przetwarzania danych](/dpa)."
        ]
      },
      {
        "h2": "2. Dokumenty Umowy i kolejność pierwszeństwa"
      },
      {
        "p": "Umowa składa się z, w malejącej kolejności pierwszeństwa: (a) podpisanego formularza zamówienia, umowy pilotażowej lub resellerskiej — w zakresie spraw, które wyraźnie obejmuje; (b) DPA, który ma pierwszeństwo we wszystkim, co dotyczy przetwarzania danych osobowych; (c) niniejszych warunków; (d) opublikowanej dokumentacji oraz opisów planów pod adresem [orbetra.com/pricing](/pricing). Warunki zamówienia zakupu, warunki portalu dostawcy lub podobne dokumenty wystawione przez Ciebie nie mają zastosowania, nawet jeśli potwierdzimy zamówienie."
      },
      {
        "h2": "3. Usługa"
      },
      {
        "p": "Orbetra to platforma do śledzenia floty GPS: śledzenie na żywo, przejazdy i odtwarzanie, geofences (strefy), reguły i alerty, raporty, monitorowanie poziomu paliwa, rejestry kierowców, przypomnienia o serwisie, polecenia urządzeń, webhooki oraz REST API. Resellerzy mogą dodatkowo licencjonować platformę white-label z własną marką, domenami i subkontami. Możemy ulepszać i zmieniać usługę; w trakcie opłaconego okresu nie ograniczymy w istotny sposób podstawowej funkcjonalności Twojego planu bez powiadomienia zgodnie z sekcją 25."
      },
      {
        "h2": "4. Konta i użytkownicy"
      },
      {
        "p": "Odpowiadasz za prawidłowość danych swojego konta, za wszystko, co Twoi użytkownicy robią w Twoim obszarze roboczym, oraz za zachowanie poufności danych logowania i kluczy API. Użytkownicy muszą mieć ukończone 18 lat. Musisz niezwłocznie odbierać dostęp osobom odchodzącym z Twojej organizacji i powiadomić nas pod adresem [hello@orbetra.com](mailto:hello@orbetra.com), jeśli podejrzewasz naruszenie danych logowania. Resellerzy odpowiadają wobec nas za swoje subkonta."
      },
      {
        "h2": "5. Wersje próbne i pilotaże"
      },
      {
        "p": "Bezpłatne wersje próbne trwają 30 dni bez karty. Po zakończeniu wersji próbnej obszar roboczy staje się tylko do odczytu, chyba że rozpocznie się płatną subskrypcję. Dane z wersji próbnej są usuwane 30 dni po jej zakończeniu, chyba że wykupisz subskrypcję. Pilotaże resellerskie prowadzone są przez zespół sprzedaży i trwają przez okres określony w umowie pilotażowej. Wersje próbne i pilotaże świadczone są w stanie „jak jest” (as-is), bez zobowiązania dotyczącego dostępności z sekcji 12."
      },
      {
        "h2": "6. Opłaty, rozliczenia i podatki"
      },
      {
        "p": "Subskrypcje są rozliczane miesięcznie lub rocznie z góry w EUR. Ceny to te opublikowane pod adresem [orbetra.com/pricing](/pricing) w momencie zakupu lub te z Twojego formularza zamówienia. Plany roczne są rozliczane za cały okres. Opłaty nie obejmują VAT ani innych podatków; klientom biznesowym z UE, którzy podadzą ważny numer VAT, wystawia się faktury w ramach mechanizmu odwrotnego obciążenia, tam gdzie ma on zastosowanie. Plany obejmują limit urządzeń; użycie powyżej tego limitu jest rozliczane jako nadwyżka według stawki opublikowanej dla Twojego planu, albo w każdej chwili możesz przejść na większy plan. Opóźnienie w płatności może prowadzić do zawieszenia po powiadomieniu zgodnie z sekcją 17. Opłaty już uiszczone nie podlegają zwrotowi, z wyjątkiem przypadków, gdy niniejsze warunki lub bezwzględnie obowiązujące prawo stanowią inaczej. Możemy zmieniać ceny cennikowe z co najmniej 30-dniowym wyprzedzeniem, ze skutkiem od kolejnego odnowienia."
      },
      {
        "h2": "7. Dopuszczalne użytkowanie"
      },
      {
        "ul": [
          "Żadnej niezgodnej z prawem inwigilacji. Musisz mieć podstawę prawną do śledzenia pojazdów i musisz informować kierowców zgodnie z wymogami prawa lokalnego.",
          "Żadnego śledzenia osób poza uzasadnionym celem zarządzania flotą ani używania usługi do nękania, śledzenia (stalkingu) lub potajemnego monitorowania osoby.",
          "Żadnej inżynierii wstecznej, odsprzedaży ani sublicencjonowania produktu bezpośredniego poza podpisaną umową resellerską.",
          "Żadnych prób zakłócania usługi, obchodzenia limitów zapytań (rate limits), sondowania lub skanowania infrastruktury ani dostępu do danych innych najemców.",
          "Żadnego przesyłania złośliwego oprogramowania ani używania platformy do przechowywania danych niezwiązanych z operacjami flotowymi.",
          "Klucze API muszą być utrzymywane w tajemnicy i rotowane w razie ujawnienia."
        ]
      },
      {
        "h2": "8. Twoje obowiązki jako pracodawcy i administratora"
      },
      {
        "p": "Śledzenie pojazdów to regulowany obszar prawa pracy i ochrony danych, a obowiązki te spoczywają na Tobie, a nie na nas. Przed podłączeniem urządzeń musisz, w stosownych przypadkach: ustalić i udokumentować podstawę prawną; poinformować kierowców i inne osoby, których to dotyczy, o śledzeniu, jego celu i okresie przechowywania; przeprowadzić wszelkie konsultacje i uzgodnienia z radą zakładową lub przedstawicielami pracowników (na przykład Betriebsvereinbarung w Niemczech lub konsultacje z przedstawicielami pracowników w Polsce i innych jurysdykcjach); przeprowadzić ocenę skutków dla ochrony danych, gdy jest wymagana; oraz skonfigurować ustawienia przechowywania, trybu prywatnego i geofences tak, aby odpowiadały temu, co powiedziałeś swoim kierowcom. Odpowiadasz za zgodność z prawem instrukcji, które nam przekazujesz za pośrednictwem platformy."
      },
      {
        "h2": "9. Własność intelektualna i licencja"
      },
      {
        "p": "Platforma, jej oprogramowanie, interfejsy, dokumentacja i marka pozostają własnością naszą i naszych licencjodawców. Z zastrzeżeniem Umowy i uiszczenia opłat udzielamy Ci niewyłącznego, nieprzenoszalnego, odwołalnego prawa do korzystania z usługi w okresie subskrypcji na Twoje wewnętrzne cele biznesowe — a w przypadku resellerów do odsprzedaży dostępu klientom końcowym na warunkach ich umowy resellerskiej. Nic nie przenosi własności. Zachowujesz wszelkie prawa do swoich danych, zasobów marki i treści; udzielasz nam jedynie ograniczonego prawa do ich hostowania, przetwarzania, przesyłania i wyświetlania w zakresie niezbędnym do świadczenia i wspierania usługi. Przesłane nam opinie możemy swobodnie wykorzystywać do ulepszania produktu, bez zobowiązań i bez identyfikowania Cię."
      },
      {
        "h2": "10. Twoje dane"
      },
      {
        "p": "Zachowujesz własność swoich danych. Zawarte w nich dane osobowe przetwarzamy na podstawie [Aneksu o powierzeniu przetwarzania danych](/dpa), jako podmiot przetwarzający na Twoje polecenie. W każdej chwili możesz je eksportować przez API albo jako CSV lub PDF. Telemetria jest domyślnie przechowywana przez 13 miesięcy. Nie sprzedajemy danych klienta i nie wykorzystujemy ich do trenowania modeli ani do reklamy."
      },
      {
        "h2": "11. Poufność"
      },
      {
        "p": "Każda ze stron może otrzymać od drugiej informacje niepubliczne — ceny i warunki zamówień, plany rozwoju produktu, szczegóły bezpieczeństwa, dane klienta. Każda strona będzie wykorzystywać informacje poufne drugiej strony wyłącznie w celu wykonania Umowy, chronić je z co najmniej należytą starannością i ujawniać je jedynie personelowi i podwykonawcom, którzy ich potrzebują i są związani równoważnymi obowiązkami. Obowiązek ten nie obejmuje informacji, które są publiczne bez naruszenia, opracowane niezależnie lub zgodnie z prawem otrzymane od osoby trzeciej, i nie stoi na przeszkodzie ujawnieniu wymaganemu przez prawo lub organ regulacyjny, przy czym druga strona jest powiadamiana, o ile jest to prawnie dozwolone. Zobowiązania te obowiązują przez trzy lata po rozwiązaniu, a w przypadku tajemnic przedsiębiorstwa — tak długo, jak prawo chroni te informacje."
      },
      {
        "h2": "12. Wsparcie i poziomy usług"
      },
      {
        "p": "Wsparcie świadczone jest pocztą elektroniczną pod adresem [hello@orbetra.com](mailto:hello@orbetra.com) w litewskie dni robocze. Poziom wsparcia i ewentualna wyznaczona osoba kontaktowa zależą od Twojego planu, jak opisano pod adresem [orbetra.com/pricing](/pricing); konkretne docelowe czasy odpowiedzi, tam gdzie się do nich zobowiązujemy, są określone w Twoim formularzu zamówienia. Umowne **zobowiązanie do dostępności na poziomie 99,9% miesięcznie wraz z kredytami serwisowymi ma zastosowanie wyłącznie do planów Scale i Enterprise**; harmonogram kredytów i metoda pomiaru są określone w formularzu zamówienia. O kredyty należy wystąpić na piśmie w ciągu 30 dni od końca miesiąca, którego dotyczą, i stanowią one jedyny i wyłączny środek zaradczy z tytułu niedotrzymanej dostępności. Wszystkie pozostałe plany są wspierane na zasadzie najlepszych starań (best-effort), bez umownego SLA."
      },
      {
        "h2": "13. Dostępność i konserwacja"
      },
      {
        "p": "Dążymy do wysokiej dostępności i powiadamiamy Cię o incydentach, które dotyczą Twojego obszaru roboczego. Planowana konserwacja jest zapowiadana z wyprzedzeniem, gdy jest to praktyczne, i planowana poza europejskimi godzinami pracy, gdy jest to możliwe. Konserwacja awaryjna może być przeprowadzana w dowolnym momencie; poinformujemy Cię tak szybko, jak będzie to rozsądnie możliwe. Przestój spowodowany przez Twoje systemy, Twoje urządzenia, sieci komórkowe, warunki GNSS lub przez zdarzenia z sekcji 21 nie jest wliczany do żadnego zobowiązania dotyczącego dostępności."
      },
      {
        "h2": "14. Funkcje beta i podglądowe"
      },
      {
        "p": "Funkcje oznaczone jako beta, podgląd (preview) lub wczesny dostęp (early access) są opcjonalne i świadczone w stanie „jak jest” (as-is), bez gwarancji, zobowiązania do wsparcia ani SLA. Mogą się zmieniać, przestać działać lub zostać wycofane w dowolnym momencie i są wyłączone z sekcji 12 i 13. Nie polegaj na nich przy podejmowaniu decyzji krytycznych operacyjnie i traktuj informacje o nich jako poufne."
      },
      {
        "h2": "15. Uczciwe użytkowanie i limity API"
      },
      {
        "p": "API i webhooki podlegają limitom zapytań (rate limits) określonym w dokumentacji oraz zasadzie uczciwego użytkowania. Możemy ograniczać przepustowość lub czasowo ograniczać żądania zagrażające stabilności platformy i skontaktujemy się z Tobą przed podjęciem takich działań, chyba że ryzyko jest natychmiastowe. Utrzymujące się użycie znacznie przekraczające Twój plan — liczba urządzeń powyżej uprawnień, masowe odpytywanie (polling) zamiast webhooków lub automatyczny ponowny eksport całego zbioru danych — może wymagać podniesienia planu. Nie używaj API do budowy konkurencyjnej usługi śledzenia."
      },
      {
        "h2": "16. Urządzenia i osoby trzecie"
      },
      {
        "p": "Orbetra zależy od Twojego sprzętu śledzącego, jego łączności SIM i dostępności GNSS. Nie odpowiadamy za luki lub nieścisłości spowodowane przez sprzęt, instalację, zasięg sieci lub warunki satelitarne. Tożsamość urządzenia opiera się na IMEI; usługa nie jest odporna na manipulacje i nie może być traktowana jako jedyny dowód."
      },
      {
        "h2": "17. Zawieszenie"
      },
      {
        "p": "Możemy zawiesić obszar roboczy, użytkownika lub klucz API, jeśli opłaty pozostają nieuiszczone po pisemnym przypomnieniu, jeśli naruszone zostają zasady dopuszczalnego użytkowania z sekcji 7, jeśli istnieje wiarygodne zagrożenie bezpieczeństwa platformy lub innych klientów, albo jeśli zawieszenie jest wymagane przez prawo. Poza przypadkami, gdy ryzyko jest natychmiastowe lub prawo stanowi inaczej, przekazujemy powiadomienie z co najmniej 7-dniowym wyprzedzeniem oraz możliwość usunięcia problemu. Zawieszenie ogranicza się do tego, co niezbędne — przywracamy dostęp, gdy tylko przyczyna zostanie usunięta. Zawieszenie nie zawiesza Twojego obowiązku zapłaty i samo w sobie nie usuwa danych: zasady przechowywania i usuwania z sekcji 19 mają zastosowanie dopiero przy rozwiązaniu."
      },
      {
        "h2": "18. Okres obowiązywania i rozwiązanie"
      },
      {
        "p": "Subskrypcje miesięczne można anulować w dowolnym momencie; kończą się one z upływem opłaconego okresu. Subskrypcje roczne odnawiają się na kolejny rok, chyba że jedna ze stron złoży wypowiedzenie co najmniej 30 dni przed datą odnowienia. Każda ze stron może rozwiązać umowę z powodu istotnego naruszenia nieusuniętego w ciągu 30 dni od pisemnego wezwania lub ze skutkiem natychmiastowym, jeśli druga strona stanie się niewypłacalna."
      },
      {
        "h2": "19. Eksport i usunięcie po rozwiązaniu"
      },
      {
        "p": "Po rozwiązaniu lub wygaśnięciu Twój obszar roboczy pozostaje dostępny w trybie tylko do odczytu przez 30 dni, abyś mógł wyeksportować dane przez aplikację i API. Po upływie tego okna usuwamy dane klienta z systemów produkcyjnych w ciągu 30 dni; pozostałe kopie w szyfrowanych kopiach zapasowych są nadpisywane w ramach normalnej rotacji kopii, w ciągu 30 dni od usunięcia. Przechowujemy tylko to, co prawo nakazuje nam przechowywać — głównie faktury i dokumentację księgową. Na pisemne żądanie potwierdzimy usunięcie. Resellerzy odpowiadają za zapewnienie własnym klientom końcowym równoważnego okna eksportu."
      },
      {
        "h2": "20. Odpowiedzialność"
      },
      {
        "p": "W maksymalnym zakresie dozwolonym przez prawo żadna ze stron nie ponosi odpowiedzialności za szkody pośrednie lub następcze, utratę zysku ani utratę danych. Nasza łączna odpowiedzialność w dowolnym okresie 12 miesięcy jest ograniczona do opłat uiszczonych przez Ciebie w tym okresie. Nic nie ogranicza odpowiedzialności za oszustwo, umyślne niewłaściwe postępowanie lub śmierć i szkodę na osobie. Ograniczenia te mają zastosowanie do całej Umowy, w tym do DPA."
      },
      {
        "h2": "21. Siła wyższa"
      },
      {
        "p": "Żadna ze stron nie ponosi odpowiedzialności za opóźnienie lub niewykonanie spowodowane zdarzeniami pozostającymi poza jej rozsądną kontrolą, w tym klęskami żywiołowymi, wojną, terroryzmem, niepokojami społecznymi, epidemiami, strajkami, awariami zasilania, sieci komórkowych, GNSS lub nadrzędnych dostawców internetu, cyberatakami na dużą skalę oraz działaniami organów władzy publicznej. Nie zwalnia to z obowiązków płatniczych. Jeśli zdarzenie trwa dłużej niż 30 dni, każda ze stron może rozwiązać dotkniętą subskrypcję, a my zwracamy opłacone z góry opłaty za niewykorzystany okres."
      },
      {
        "h2": "22. Podwykonawcy"
      },
      {
        "p": "Do świadczenia usługi możemy korzystać z podwykonawców i podmiotów podprzetwarzających — aktualna lista jest publikowana pod adresem [orbetra.com/subprocessors](/subprocessors) — i pozostajemy odpowiedzialni za ich działania jak za własne. Zmiany podmiotów podprzetwarzających podlegają 30-dniowemu procesowi powiadomienia i sprzeciwu określonemu w [DPA](/dpa)."
      },
      {
        "h2": "23. Cesja"
      },
      {
        "p": "Żadna ze stron nie może dokonać cesji Umowy bez pisemnej zgody drugiej strony, której nie można bezzasadnie odmówić. Każda ze stron może dokonać jej cesji w całości na rzecz podmiotu powiązanego lub następcy prawnego w ramach fuzji, reorganizacji lub sprzedaży zasadniczo całości swojego przedsiębiorstwa, za pisemnym powiadomieniem. Każda inna próba cesji jest nieważna."
      },
      {
        "h2": "24. Powiadomienia"
      },
      {
        "p": "Powiadomienia przekazujemy pocztą elektroniczną na adresy zarejestrowane w Twoim koncie, a w przypadku zmian dotyczących wszystkich klientów — publikując je na orbetra.com; powiadomienia serwisowe, takie jak incydenty i konserwacja, mogą też pojawiać się w aplikacji. Ty przekazujesz powiadomienia na adres [hello@orbetra.com](mailto:hello@orbetra.com); powiadomienia o rozwiązaniu lub o roszczeniu prawnym muszą być również wysłane pocztą na adres MB Dokigo, Krivių g. 5, LT-01204 Vilnius, Litwa. Powiadomienia e-mail uważa się za doręczone następnego dnia roboczego. Utrzymuj aktualne kontakty rozliczeniowe i administracyjne — to tam trafiają powiadomienia."
      },
      {
        "h2": "25. Zmiany niniejszych warunków"
      },
      {
        "p": "Możemy aktualizować niniejsze warunki z co najmniej 30-dniowym wyprzedzeniem w przypadku istotnych zmian, przekazanym pocztą elektroniczną i na tej stronie. Dalsze korzystanie po dacie wejścia w życie oznacza akceptację. Jeśli istotna zmiana jest dla Ciebie nie do przyjęcia, możesz rozwiązać umowę przed jej wejściem w życie, a my zwracamy opłacone z góry opłaty za niewykorzystany okres."
      },
      {
        "h2": "26. Prawo właściwe i jurysdykcja"
      },
      {
        "p": "Stosuje się prawo litewskie, z wyłączeniem jego norm kolizyjnych oraz Konwencji Narodów Zjednoczonych o umowach międzynarodowej sprzedaży towarów; sądy w Wilnie mają wyłączną jurysdykcję, bez uszczerbku dla bezwzględnie obowiązujących zabezpieczeń konsumenckich w kraju Twojego zamieszkania. Każda ze stron może mimo to wystąpić o środek zabezpieczający do dowolnego właściwego sądu w celu ochrony swojej własności intelektualnej lub informacji poufnych."
      },
      {
        "h2": "27. Postanowienia ogólne"
      },
      {
        "p": "Jeśli którekolwiek postanowienie zostanie uznane za nieważne, pozostała część pozostaje w mocy, a nieważna część zostaje zastąpiona ważną, najbliższą jej zamierzeniu. Niewyegzekwowanie prawa nie stanowi zrzeczenia się go. Umowa stanowi całość porozumienia między stronami w jej przedmiocie i zastępuje wcześniejsze propozycje i oświadczenia. Nic w niej nie tworzy spółki, przedstawicielstwa ani stosunku pracy i nie tworzy żadnych praw dla osób trzecich. Sekcje, które ze swojej natury powinny obowiązywać po rozwiązaniu — w tym 9, 10, 11, 19, 20, 26 i 27 — obowiązują nadal."
      }
    ]
  },
  "de": {
    "title": "Nutzungsbedingungen",
    "label": "RECHTLICHES",
    "updated": "August 2026",
    "notice": "Dies ist eine Übersetzung zu Informationszwecken. Bei Abweichungen ist die englische Fassung maßgeblich.",
    "blocks": [
      {
        "p": "Diese Bedingungen regeln den Zugang zur Orbetra-Plattform und deren Nutzung; betrieben wird die Plattform von MB Dokigo, einer litauischen mažoji bendrija, Krivių g. 5, LT-01204 Vilnius, Litauen, Unternehmenscode 307575857 („Orbetra“, „wir“, „uns“). Mit der Erstellung eines Kontos, der Unterzeichnung eines Bestellformulars oder der Nutzung des Dienstes akzeptieren Sie diese Bedingungen. Wenn Sie im Namen einer Organisation zustimmen, bestätigen Sie, dass Sie berechtigt sind, diese zu binden. Der Dienst wird Unternehmen und anderen Organisationen bereitgestellt, nicht Verbrauchern."
      },
      {
        "h2": "1. Definitionen"
      },
      {
        "ul": [
          "**Vertrag** — diese Bedingungen zusammen mit den in Abschnitt 2 aufgeführten Dokumenten.",
          "**Kunde**, **Sie** — die Organisation, die den Dienst abonniert.",
          "**Dienst**, **Plattform** — die Orbetra-Webanwendung, APIs, Webhooks, Ingest-Endpunkte und Dokumentation.",
          "**Arbeitsbereich** — der isolierte Mandant, in dem Ihre Geräte, Nutzer und Daten liegen. Ein Reseller-Arbeitsbereich kann Unterkonten enthalten.",
          "**Nutzer** — eine Person, der Sie den Zugang zu Ihrem Arbeitsbereich gestatten.",
          "**Kundendaten** — alles, was Sie oder Ihre Geräte an den Dienst senden oder darin erzeugen: Telemetrie, Fahrten, Ereignisse, Fahrer- und Fahrzeugdatensätze, Konfiguration und Audit-Protokolle.",
          "**Gerät** — eine über ihre IMEI identifizierte GPS-Ortungseinheit, die Sie mit dem Dienst verbinden.",
          "**Reseller**, **TSP** — ein Kunde, der die White-Label-Plattform lizenziert, um seine eigenen Endkunden zu bedienen.",
          "**Bestellformular** — jede von beiden Parteien unterzeichnete schriftliche oder elektronische Bestellung, Pilot- oder Reseller-Vereinbarung.",
          "**DPA** — der [Auftragsverarbeitungsvertrag](/dpa)."
        ]
      },
      {
        "h2": "2. Vertragsdokumente und Rangfolge"
      },
      {
        "p": "Der Vertrag besteht aus, in absteigender Rangfolge: (a) einem unterzeichneten Bestellformular, einer Pilot- oder Reseller-Vereinbarung — für die darin ausdrücklich geregelten Angelegenheiten; (b) dem DPA, das in allem Vorrang hat, was die Verarbeitung personenbezogener Daten betrifft; (c) diesen Bedingungen; (d) der veröffentlichten Dokumentation und den Planbeschreibungen unter [orbetra.com/pricing](/pricing). Von Ihnen ausgestellte Bestellbedingungen, Lieferantenportal-Bedingungen oder ähnliche Dokumente gelten nicht, auch wenn wir die Bestellung bestätigen."
      },
      {
        "h2": "3. Der Dienst"
      },
      {
        "p": "Orbetra ist eine GPS-Flottenortungsplattform: Live-Ortung, Fahrten und Wiedergabe, Geofences, Regeln und Warnungen, Berichte, Tankfüllstandsüberwachung, Fahrerdatensätze, Wartungserinnerungen, Gerätebefehle, Webhooks und eine REST-API. Reseller können zusätzlich die White-Label-Plattform mit eigenem Branding, eigenen Domains und Unterkonten lizenzieren. Wir dürfen den Dienst verbessern und ändern; wir werden die Kernfunktionalität Ihres Plans während einer bezahlten Laufzeit nicht wesentlich reduzieren, ohne dies gemäß Abschnitt 25 anzukündigen."
      },
      {
        "h2": "4. Konten und Nutzer"
      },
      {
        "p": "Sie sind verantwortlich für die Richtigkeit Ihrer Kontodaten, für alles, was Ihre Nutzer in Ihrem Arbeitsbereich tun, und für die Vertraulichkeit von Zugangsdaten und API-Schlüsseln. Nutzer müssen mindestens 18 Jahre alt sein. Sie müssen den Zugang für Personen, die Ihre Organisation verlassen, unverzüglich entziehen und uns unter [hello@orbetra.com](mailto:hello@orbetra.com) benachrichtigen, wenn Sie einen Missbrauch von Zugangsdaten vermuten. Reseller sind uns gegenüber für ihre Unterkonten verantwortlich."
      },
      {
        "h2": "5. Testphasen und Pilotprojekte"
      },
      {
        "p": "Kostenlose Testphasen laufen 30 Tage ohne Karte. Am Ende einer Testphase wird der Arbeitsbereich schreibgeschützt, sofern kein kostenpflichtiges Abonnement gestartet wird. Testdaten werden 30 Tage nach Ende der Testphase gelöscht, sofern Sie kein Abonnement abschließen. Reseller-Pilotprojekte sind vertriebsgeführt und laufen für den in der Pilotvereinbarung genannten Zeitraum. Testphasen und Pilotprojekte werden ohne Mängelgewähr (as-is) bereitgestellt, ohne die Verfügbarkeitszusage aus Abschnitt 12."
      },
      {
        "h2": "6. Gebühren, Abrechnung und Steuern"
      },
      {
        "p": "Abonnements werden monatlich oder jährlich im Voraus in EUR abgerechnet. Es gelten die zum Zeitpunkt des Kaufs unter [orbetra.com/pricing](/pricing) veröffentlichten Preise oder die in Ihrem Bestellformular. Jahrespläne werden für die gesamte Laufzeit abgerechnet. Die Gebühren verstehen sich zzgl. USt. und sonstiger Steuern; EU-Geschäftskunden, die eine gültige USt-IdNr. angeben, wird nach dem Reverse-Charge-Verfahren fakturiert, soweit es anwendbar ist. Pläne enthalten ein Gerätekontingent; die Nutzung über dieses Kontingent hinaus wird als Mehrverbrauch zum für Ihren Plan veröffentlichten Satz abgerechnet, oder Sie können jederzeit auf einen größeren Plan wechseln. Zahlungsverzug kann nach Ankündigung gemäß Abschnitt 17 zu einer Sperrung führen. Bereits gezahlte Gebühren sind nicht erstattungsfähig, außer wenn diese Bedingungen oder zwingendes Recht etwas anderes vorsehen. Wir dürfen Listenpreise mit einer Frist von mindestens 30 Tagen ändern, wirksam zu Ihrer nächsten Verlängerung."
      },
      {
        "h2": "7. Zulässige Nutzung"
      },
      {
        "ul": [
          "Keine rechtswidrige Überwachung. Sie müssen eine Rechtsgrundlage für die Ortung von Fahrzeugen haben und die Fahrer wie nach lokalem Recht erforderlich informieren.",
          "Keine Ortung von Einzelpersonen außerhalb eines legitimen Flottenmanagementzwecks und keine Nutzung des Dienstes, um eine Person zu belästigen, zu verfolgen (Stalking) oder heimlich zu überwachen.",
          "Kein Reverse Engineering, kein Weiterverkauf und keine Unterlizenzierung des Direktprodukts außerhalb einer unterzeichneten Reseller-Vereinbarung.",
          "Keine Versuche, den Dienst zu stören, Ratenbegrenzungen (Rate Limits) zu umgehen, die Infrastruktur zu sondieren oder zu scannen oder auf Daten anderer Mandanten zuzugreifen.",
          "Kein Hochladen von Schadsoftware und keine Nutzung der Plattform zur Speicherung von Daten, die nicht mit dem Flottenbetrieb zusammenhängen.",
          "API-Schlüssel müssen geheim gehalten und bei Offenlegung rotiert werden."
        ]
      },
      {
        "h2": "8. Ihre Pflichten als Arbeitgeber und Verantwortlicher"
      },
      {
        "p": "Die Fahrzeugortung ist ein reguliertes arbeits- und datenschutzrechtliches Feld, und diese Pflichten liegen bei Ihnen, nicht bei uns. Vor dem Verbinden von Geräten müssen Sie, soweit zutreffend: eine Rechtsgrundlage schaffen und dokumentieren; Fahrer und andere betroffene Personen über die Ortung, ihren Zweck und ihre Aufbewahrung informieren; jegliche Konsultation und Einigung mit dem Betriebsrat oder der Arbeitnehmervertretung durchführen (zum Beispiel eine Betriebsvereinbarung in Deutschland oder eine Konsultation mit Arbeitnehmervertretern in Polen und anderen Rechtsordnungen); eine Datenschutz-Folgenabschätzung durchführen, wo eine erforderlich ist; und die Einstellungen für Aufbewahrung, Privatmodus und Geofences so konfigurieren, dass sie dem entsprechen, was Sie Ihren Fahrern mitgeteilt haben. Sie sind für die Rechtmäßigkeit der Weisungen verantwortlich, die Sie uns über die Plattform erteilen."
      },
      {
        "h2": "9. Geistiges Eigentum und Lizenz"
      },
      {
        "p": "Die Plattform, ihre Software, Schnittstellen, Dokumentation und ihr Branding bleiben unser Eigentum und das unserer Lizenzgeber. Vorbehaltlich des Vertrags und der Zahlung der Gebühren gewähren wir Ihnen ein nicht ausschließliches, nicht übertragbares, widerrufliches Recht, den Dienst während der Abonnementlaufzeit für Ihre internen Geschäftszwecke zu nutzen — und für Reseller, den Zugang zu den Bedingungen ihrer Reseller-Vereinbarung an ihre Endkunden weiterzuverkaufen. Nichts überträgt Eigentum. Sie behalten alle Rechte an Ihren Daten, Ihren Markenwerten und Ihren Inhalten; Sie gewähren uns lediglich das beschränkte Recht, diese zu hosten, zu verarbeiten, zu übertragen und anzuzeigen, soweit dies zur Erbringung und Unterstützung des Dienstes erforderlich ist. Rückmeldungen, die Sie uns senden, dürfen wir frei zur Verbesserung des Produkts verwenden, ohne Verpflichtung und ohne Sie zu identifizieren."
      },
      {
        "h2": "10. Ihre Daten"
      },
      {
        "p": "Sie behalten das Eigentum an Ihren Daten. Darin enthaltene personenbezogene Daten verarbeiten wir gemäß dem [Auftragsverarbeitungsvertrag](/dpa) als Auftragsverarbeiter nach Ihren Weisungen. Sie können jederzeit über die API oder als CSV oder PDF exportieren. Telemetrie wird standardmäßig 13 Monate aufbewahrt. Wir verkaufen keine Kundendaten und verwenden sie nicht zum Training von Modellen oder für Werbung."
      },
      {
        "h2": "11. Vertraulichkeit"
      },
      {
        "p": "Jede Partei kann von der anderen nicht öffentliche Informationen erhalten — Preis- und Bestellkonditionen, Produkt-Roadmaps, Sicherheitsdetails, Kundendaten. Jede Partei wird die vertraulichen Informationen der anderen nur zur Erfüllung des Vertrags verwenden, sie mit mindestens angemessener Sorgfalt schützen und sie nur an Personal und Subunternehmer offenlegen, die sie benötigen und durch gleichwertige Pflichten gebunden sind. Die Pflicht erstreckt sich nicht auf Informationen, die ohne Verstoß öffentlich sind, unabhängig entwickelt oder rechtmäßig von einem Dritten erhalten wurden, und sie steht einer gesetzlich oder von einer Behörde geforderten Offenlegung nicht entgegen, wobei die andere Partei benachrichtigt wird, sofern dies rechtlich zulässig ist. Diese Pflichten bestehen für drei Jahre nach Beendigung fort und im Fall von Geschäftsgeheimnissen so lange, wie das Gesetz die Informationen schützt."
      },
      {
        "h2": "12. Support und Service-Level"
      },
      {
        "p": "Support wird per E-Mail unter [hello@orbetra.com](mailto:hello@orbetra.com) an litauischen Werktagen geleistet. Das Support-Level und ein etwaiger benannter Ansprechpartner hängen von Ihrem Plan ab, wie unter [orbetra.com/pricing](/pricing) beschrieben; konkrete Reaktionszeiten, sofern wir uns dazu verpflichten, sind in Ihrem Bestellformular angegeben. Eine vertragliche **Verfügbarkeitszusage von 99,9 % pro Monat mit Servicegutschriften gilt nur für die Pläne Scale und Enterprise**; der Gutschriftenplan und die Messmethode sind im Bestellformular festgelegt. Gutschriften müssen innerhalb von 30 Tagen nach Ende des betroffenen Monats schriftlich beantragt werden und sind der einzige und ausschließliche Rechtsbehelf für verfehlte Verfügbarkeit. Alle anderen Pläne werden nach bestem Bemühen (best-effort) ohne vertragliches SLA unterstützt."
      },
      {
        "h2": "13. Verfügbarkeit und Wartung"
      },
      {
        "p": "Wir streben eine hohe Verfügbarkeit an und benachrichtigen Sie über Vorfälle, die Ihren Arbeitsbereich betreffen. Geplante Wartung wird, soweit praktikabel, im Voraus angekündigt und, soweit möglich, außerhalb europäischer Geschäftszeiten geplant. Notfallwartung kann jederzeit durchgeführt werden; wir informieren Sie, sobald wir es vernünftigerweise können. Ausfallzeiten, die durch Ihre Systeme, Ihre Geräte, Mobilfunknetze, GNSS-Bedingungen oder durch Ereignisse gemäß Abschnitt 21 verursacht werden, zählen nicht gegen eine Verfügbarkeitszusage."
      },
      {
        "h2": "14. Beta- und Vorschaufunktionen"
      },
      {
        "p": "Als Beta, Vorschau (Preview) oder Early Access gekennzeichnete Funktionen sind optional und werden ohne Mängelgewähr (as-is) bereitgestellt, ohne Garantie, Support-Zusage oder SLA. Sie können sich jederzeit ändern, ausfallen oder zurückgezogen werden und sind von den Abschnitten 12 und 13 ausgenommen. Verlassen Sie sich bei betrieblich kritischen Entscheidungen nicht auf sie und behandeln Sie Informationen darüber als vertraulich."
      },
      {
        "h2": "15. Faire Nutzung und API-Grenzen"
      },
      {
        "p": "Die API und Webhooks unterliegen den in der Dokumentation angegebenen Ratenbegrenzungen (Rate Limits) und der fairen Nutzung. Wir dürfen Anfragen drosseln oder vorübergehend einschränken, die die Stabilität der Plattform gefährden, und wir werden Sie zuvor kontaktieren, sofern das Risiko nicht unmittelbar ist. Anhaltende Nutzung weit über Ihren Plan hinaus — Gerätezahlen über Ihrem Anspruch, massenhaftes Polling anstelle von Webhooks oder automatischer Re-Export des gesamten Datenbestands — kann ein Upgrade erfordern. Verwenden Sie die API nicht, um einen konkurrierenden Ortungsdienst aufzubauen."
      },
      {
        "h2": "16. Geräte und Dritte"
      },
      {
        "p": "Orbetra hängt von Ihrer Ortungshardware, ihrer SIM-Konnektivität und der GNSS-Verfügbarkeit ab. Wir sind nicht verantwortlich für Lücken oder Ungenauigkeiten, die durch Hardware, Installation, Netzabdeckung oder Satellitenbedingungen verursacht werden. Die Geräteidentität beruht auf der IMEI; der Dienst ist nicht manipulationssicher und darf nicht als alleiniger Beweis herangezogen werden."
      },
      {
        "h2": "17. Sperrung"
      },
      {
        "p": "Wir dürfen einen Arbeitsbereich, einen Nutzer oder einen API-Schlüssel sperren, wenn Gebühren nach schriftlicher Mahnung unbezahlt bleiben, wenn die Regeln zur zulässigen Nutzung aus Abschnitt 7 verletzt werden, wenn eine glaubhafte Sicherheitsbedrohung für die Plattform oder andere Kunden besteht oder wenn die Sperrung gesetzlich vorgeschrieben ist. Außer wenn das Risiko unmittelbar ist oder das Gesetz etwas anderes verlangt, gewähren wir eine Frist von mindestens 7 Tagen und die Gelegenheit, das Problem zu beheben. Die Sperrung beschränkt sich auf das Notwendige — wir stellen den Zugang wieder her, sobald die Ursache behoben ist. Die Sperrung setzt Ihre Zahlungspflicht nicht aus und löscht für sich genommen keine Daten: Die Aufbewahrungs- und Löschregeln aus Abschnitt 19 gelten erst bei Beendigung."
      },
      {
        "h2": "18. Laufzeit und Beendigung"
      },
      {
        "p": "Monatsabonnements können jederzeit gekündigt werden und enden mit Ablauf des bezahlten Zeitraums. Jahresabonnements verlängern sich um ein weiteres Jahr, sofern nicht eine Partei mindestens 30 Tage vor dem Verlängerungsdatum kündigt. Jede Partei kann bei einem wesentlichen Verstoß, der nicht innerhalb von 30 Tagen nach schriftlicher Aufforderung behoben wird, kündigen oder mit sofortiger Wirkung, wenn die andere Partei zahlungsunfähig wird."
      },
      {
        "h2": "19. Export und Löschung nach Beendigung"
      },
      {
        "p": "Nach Beendigung oder Ablauf bleibt Ihr Arbeitsbereich 30 Tage im schreibgeschützten Modus verfügbar, damit Sie Daten über die App und die API exportieren können. Nach diesem Zeitfenster löschen wir Kundendaten innerhalb von 30 Tagen aus den Produktivsystemen; verbleibende Kopien in verschlüsselten Backups werden im Rahmen der normalen Backup-Rotation innerhalb von 30 Tagen nach der Löschung überschrieben. Wir behalten nur, was das Gesetz uns aufzubewahren vorschreibt — hauptsächlich Rechnungen und Buchhaltungsunterlagen. Auf schriftliche Anfrage bestätigen wir die Löschung. Reseller sind dafür verantwortlich, ihren eigenen Endkunden ein gleichwertiges Exportfenster zu gewähren."
      },
      {
        "h2": "20. Haftung"
      },
      {
        "p": "Soweit gesetzlich zulässig, haftet keine Partei für indirekte oder Folgeschäden, entgangenen Gewinn oder Datenverlust. Unsere Gesamthaftung in einem beliebigen Zeitraum von 12 Monaten ist auf die Gebühren beschränkt, die Sie in diesem Zeitraum gezahlt haben. Nichts beschränkt die Haftung für Betrug, vorsätzliches Fehlverhalten oder Tod und Körperverletzung. Diese Grenzen gelten für den gesamten Vertrag, einschließlich des DPA."
      },
      {
        "h2": "21. Höhere Gewalt"
      },
      {
        "p": "Keine Partei haftet für Verzögerung oder Nichterfüllung aufgrund von Ereignissen außerhalb ihrer angemessenen Kontrolle, einschließlich Naturkatastrophen, Krieg, Terrorismus, zivilen Unruhen, Epidemien, Streiks, Ausfällen von Strom, Mobilfunknetzen, GNSS oder vorgelagerten Internetanbietern, groß angelegten Cyberangriffen und Handlungen von Behörden. Zahlungspflichten sind davon nicht ausgenommen. Dauert das Ereignis länger als 30 Tage, kann jede Partei das betroffene Abonnement kündigen, und wir erstatten im Voraus gezahlte Gebühren für den ungenutzten Zeitraum."
      },
      {
        "h2": "22. Subunternehmer"
      },
      {
        "p": "Zur Erbringung des Dienstes dürfen wir Subunternehmer und Unterauftragsverarbeiter einsetzen — die aktuelle Liste ist unter [orbetra.com/subprocessors](/subprocessors) veröffentlicht — und wir bleiben für deren Leistung verantwortlich, als wäre es unsere eigene. Änderungen bei Unterauftragsverarbeitern folgen dem 30-tägigen Ankündigungs- und Widerspruchsverfahren im [DPA](/dpa)."
      },
      {
        "h2": "23. Abtretung"
      },
      {
        "p": "Keine Partei darf den Vertrag ohne die schriftliche Zustimmung der anderen abtreten, die nicht unbillig verweigert werden darf. Jede Partei darf ihn vollständig an ein verbundenes Unternehmen oder an einen Rechtsnachfolger im Rahmen einer Fusion, Umstrukturierung oder eines Verkaufs im Wesentlichen ihres gesamten Geschäfts abtreten, unter schriftlicher Mitteilung. Jeder andere Abtretungsversuch ist nichtig."
      },
      {
        "h2": "24. Mitteilungen"
      },
      {
        "p": "Wir übermitteln Mitteilungen per E-Mail an die in Ihrem Konto registrierten Adressen und, bei Änderungen, die alle Kunden betreffen, durch Veröffentlichung auf orbetra.com; Servicemitteilungen wie Vorfälle und Wartung können auch in der App erscheinen. Sie übermitteln Mitteilungen an [hello@orbetra.com](mailto:hello@orbetra.com); Mitteilungen über eine Kündigung oder einen rechtlichen Anspruch müssen zusätzlich per Post an MB Dokigo, Krivių g. 5, LT-01204 Vilnius, Litauen, gesendet werden. E-Mail-Mitteilungen gelten am nächsten Werktag als zugegangen. Halten Sie Ihre Abrechnungs- und Verwaltungskontakte aktuell — dorthin gehen die Mitteilungen."
      },
      {
        "h2": "25. Änderungen dieser Bedingungen"
      },
      {
        "p": "Wir dürfen diese Bedingungen bei wesentlichen Änderungen mit einer Frist von mindestens 30 Tagen aktualisieren, mitgeteilt per E-Mail und auf dieser Seite. Die fortgesetzte Nutzung nach dem Wirksamkeitsdatum gilt als Annahme. Ist eine wesentliche Änderung für Sie nicht akzeptabel, können Sie vor ihrem Inkrafttreten kündigen, und wir erstatten im Voraus gezahlte Gebühren für den ungenutzten Zeitraum."
      },
      {
        "h2": "26. Anwendbares Recht und Gerichtsstand"
      },
      {
        "p": "Es gilt litauisches Recht unter Ausschluss seiner Kollisionsnormen und des UN-Übereinkommens über Verträge über den internationalen Warenkauf; die Gerichte von Vilnius sind ausschließlich zuständig, unbeschadet zwingender Verbraucherschutzvorschriften in Ihrem Wohnsitzland. Jede Partei kann dennoch bei jedem zuständigen Gericht einstweiligen Rechtsschutz beantragen, um ihr geistiges Eigentum oder ihre vertraulichen Informationen zu schützen."
      },
      {
        "h2": "27. Allgemeines"
      },
      {
        "p": "Ist eine Bestimmung unwirksam, bleibt der Rest in Kraft, und der unwirksame Teil wird durch einen wirksamen ersetzt, der seinem Zweck am nächsten kommt. Die Nichtdurchsetzung eines Rechts ist kein Verzicht darauf. Der Vertrag ist die gesamte Vereinbarung zwischen den Parteien über seinen Gegenstand und ersetzt frühere Vorschläge und Erklärungen. Nichts darin begründet eine Partnerschaft, Vertretung oder ein Arbeitsverhältnis, und er begründet keine Rechte für Dritte. Abschnitte, die ihrer Natur nach die Beendigung überdauern sollten — einschließlich 9, 10, 11, 19, 20, 26 und 27 — tun dies."
      }
    ]
  }
};
