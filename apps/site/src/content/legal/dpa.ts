import type { LocalizedDoc } from "./types";

/**
 * dpa — long-form content authored EN (source of truth) + LT/PL/DE translations (W9 i18n).
 * Generated from the extraction/translation workflow; edit the prose here directly going forward.
 */
export const dpa: LocalizedDoc = {
  "en": {
    "title": "Data Processing Addendum",
    "label": "LEGAL",
    "updated": "August 2026",
    "blocks": [
      {
        "p": "This Data Processing Addendum (\"DPA\") is agreed between the customer identified in the account registration or order form (\"Controller\") and **MB Dokigo**, a Lithuanian mažoji bendrija, company code 307575857, Krivių g. 5, LT-01204 Vilnius, Lithuania, trading as Orbetra (\"Processor\"). For white-label resellers, the reseller is the Controller towards its own end customers and Orbetra remains the Processor. A signable copy is available on request at [hello@orbetra.com](mailto:hello@orbetra.com)."
      },
      {
        "h2": "1. Effect and precedence"
      },
      {
        "p": "This DPA takes effect on the date the Controller first accepts the [Terms of Service](/terms) or signs an order form, and stays in force for as long as Orbetra processes personal data on the Controller's behalf. It forms part of the agreement between the parties. Where it conflicts with the Terms or an order form on the processing of personal data, this DPA prevails; on all other matters the Terms prevail. Terms defined in the Terms of Service have the same meaning here. Where the EU Standard Contractual Clauses apply, they prevail over this DPA in the event of conflict."
      },
      {
        "h2": "2. Roles of the parties"
      },
      {
        "p": "The Controller determines the purposes and means of the processing of personal data in its workspace — which vehicles are tracked, which drivers are recorded, what rules run and what the data is used for. Orbetra processes that data solely to provide the service. Each party complies with the GDPR in respect of its own role. The Controller is responsible for the lawfulness of the processing it instructs, including informing drivers and completing any employee-representative consultation."
      },
      {
        "h2": "3. Subject matter, duration and scope"
      },
      {
        "p": "Processing of personal data by Orbetra to provide the fleet-tracking service, for the term of the subscription plus the deletion periods in section 11. The details required by GDPR Art. 28(3) are set out in Annex I."
      },
      {
        "h2": "4. Nature and purpose"
      },
      {
        "p": "Collection, storage, structuring, analysis, display and export of vehicle telemetry and related records for the purpose of fleet management by the Controller."
      },
      {
        "h2": "5. Controller instructions"
      },
      {
        "p": "Orbetra processes personal data only on documented instructions from the Controller, including with regard to transfers, unless required by EU or member-state law — in which case Orbetra informs the Controller before processing, unless the law forbids it. The Terms, this DPA, the product documentation and the Controller's configuration and use of the platform are the complete documented instructions. Orbetra informs the Controller if, in its opinion, an instruction infringes data protection law."
      },
      {
        "h2": "6. Confidentiality"
      },
      {
        "p": "Personnel with access are bound by confidentiality and are granted least-privilege access."
      },
      {
        "h2": "7. Security measures"
      },
      {
        "p": "Orbetra implements the technical and organisational measures set out in **Annex II**, taking into account the state of the art, the costs of implementation and the risks to data subjects (GDPR Art. 32). Measures may be updated as the platform evolves, provided the level of protection is not reduced."
      },
      {
        "h2": "8. Sub-processors"
      },
      {
        "p": "The Controller grants general authorisation for the sub-processors listed at [orbetra.com/subprocessors](/subprocessors). Orbetra imposes data protection obligations on each sub-processor that are no less protective than this DPA, and remains fully liable to the Controller for their performance."
      },
      {
        "p": "**Change notification.** Before adding or replacing a sub-processor, Orbetra updates that page and notifies Controllers by email at least **30 days** in advance. To be added to the notification list, email [hello@orbetra.com](mailto:hello@orbetra.com)."
      },
      {
        "p": "**Objection.** The Controller may object in writing within the 30-day notice period on reasonable data-protection grounds. The parties will discuss the objection in good faith and Orbetra will use reasonable efforts to offer an alternative or a change of configuration. If no resolution is reached, the Controller may terminate the affected part of the service without penalty, and Orbetra refunds prepaid fees for the unused period."
      },
      {
        "h2": "9. International transfers"
      },
      {
        "p": "Hosting and storage are in the European Union. Where a sub-processor processes limited request metadata outside the EEA — currently Mapbox for product map tiles and CARTO for the marketing-site basemap — transfers rely on the EU Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914), Module Three (processor to processor), together with a transfer impact assessment and supplementary measures such as encryption in transit and data minimisation. No fleet telemetry or account data is transferred outside the EEA for storage."
      },
      {
        "h2": "10. Assistance"
      },
      {
        "p": "Orbetra assists the Controller in meeting its obligations under GDPR Art. 32–36 and in responding to data-subject requests, taking into account the nature of the processing and the information available to it:"
      },
      {
        "ul": [
          "The platform's export, correction and erasure tooling and the REST API let the Controller answer most requests without our involvement.",
          "If a data subject contacts Orbetra directly about data in a Controller's workspace, Orbetra does not respond on the substance and forwards the request to the Controller within **5 business days**.",
          "Where the Controller needs our help, we respond to a written assistance request within **10 business days**, and faster where needed for the Controller to meet its own one-month deadline.",
          "Orbetra notifies the Controller of a personal data breach affecting the Controller's data without undue delay and within **72 hours** of becoming aware, with the information available to us for the Controller's own notification.",
          "Orbetra provides reasonable information for data protection impact assessments and prior consultations with a supervisory authority."
        ]
      },
      {
        "h2": "11. Deletion and return"
      },
      {
        "p": "Telemetry is deleted after the 13-month retention window, and the start/end coordinates of trip records are erased at the same point (the trip's distance, times and driver are kept for the Controller's own historical reporting and cannot be resolved back to a location). On termination or expiry the Controller has 30 days to export data through the app and the API. Orbetra then deletes personal data from live systems within 30 days; residual copies in encrypted backups are overwritten on the normal backup rotation, within 30 days of that deletion. Orbetra keeps only what EU or member-state law requires it to keep, and protects it under this DPA for as long as it is kept. Orbetra confirms deletion in writing on request."
      },
      {
        "h2": "12. Audit"
      },
      {
        "p": "Orbetra makes available the information needed to demonstrate compliance with Art. 28 and permits audits by the Controller or an independent auditor, once per year and on at least 30 days' notice, during business hours, without unreasonable disruption and subject to confidentiality. Additional audits may be carried out after a personal data breach or when a supervisory authority requires it. The Controller bears its own audit costs."
      },
      {
        "h2": "13. Liability"
      },
      {
        "p": "The limitations and exclusions of liability in the [Terms of Service](/terms) apply to claims under this DPA, to the extent permitted by law. Nothing in this DPA limits the rights of data subjects or the liability of either party under GDPR Art. 82."
      },
      {
        "h2": "Annex I — Description of the processing"
      },
      {
        "p": "**A. Parties.**"
      },
      {
        "ul": [
          "**Data exporter / Controller:** the customer identified in the account registration or order form, acting as controller for the personal data in its workspace. For white-label deployments, the reseller.",
          "**Data importer / Processor:** MB Dokigo (Orbetra), Krivių g. 5, LT-01204 Vilnius, Lithuania, company code 307575857. Contact: [hello@orbetra.com](mailto:hello@orbetra.com)."
        ]
      },
      {
        "p": "**B. Description of processing.**"
      },
      {
        "ul": [
          "**Categories of data subjects:** the Controller's drivers and other vehicle occupants, employees and workspace users; for resellers, their end customers' users and drivers.",
          "**Categories of personal data:** names, work emails, roles and permissions, driver identifiers and licence data entered by the Controller, vehicle assignments, positions and routes, speed and driving events, ignition and working hours, fuel and maintenance records, device commands, and audit logs. Device identity is IMEI-based.",
          "**Special categories:** none. No special-category data is intentionally processed; the Controller must not enter it into free-text fields.",
          "**Frequency:** continuous — telemetry arrives from devices in near real time; account and configuration data on use.",
          "**Nature and purpose:** hosting, storing, structuring, analysing, displaying and exporting the above so the Controller can manage its fleet, as described in sections 3 and 4.",
          "**Duration:** the term of the subscription, plus the retention and deletion periods in section 11 (telemetry 13 months by default; deletion after the 30-day export window on termination).",
          "**Sub-processors:** as listed at [orbetra.com/subprocessors](/subprocessors), for the purposes and durations stated there."
        ]
      },
      {
        "p": "**C. Competent supervisory authority.** Orbetra is established in Lithuania, so the competent authority is the Lithuanian State Data Protection Inspectorate (Valstybinė duomenų apsaugos inspekcija, VDAI), Vilnius. Where the Controller is established in another EU member state, its own supervisory authority is competent for its processing."
      },
      {
        "h2": "Annex II — Technical and organisational measures"
      },
      {
        "ul": [
          "TLS 1.2+ for data in transit; encryption at rest for databases and backups.",
          "Tenant isolation enforced in the data layer, and role-based access control; SSO available on Scale and Enterprise.",
          "Audit logging of administrative and data-access actions.",
          "Automated backups with tested restore procedures.",
          "Segregated environments, code review, dependency scanning and least-privilege infrastructure access.",
          "Access to production data limited to personnel who need it, bound by confidentiality, over authenticated and logged channels.",
          "Pseudonymisation where practical: devices are identified by IMEI, and driver identity is only what the Controller enters.",
          "Data minimisation and retention limits enforced by the platform (13-month telemetry default).",
          "Incident response with notification to the Controller without undue delay and within 72 hours of becoming aware of a personal data breach.",
          "Business continuity: EU-hosted infrastructure with monitored ingest pipeline and restore procedures exercised against backups."
        ]
      }
    ]
  },
  "lt": {
    "title": "Duomenų tvarkymo priedas",
    "label": "TEISINĖ INFORMACIJA",
    "updated": "2026 m. rugpjūtis",
    "notice": "Tai yra vertimas patogumui. Esant neatitikimų, pirmenybė teikiama versijai anglų kalba.",
    "blocks": [
      {
        "p": "Šis duomenų tvarkymo priedas („DPA“) sudaromas tarp kliento, nurodyto paskyros registracijoje arba užsakymo formoje („Valdytojas“), ir **MB Dokigo**, Lietuvos mažosios bendrijos, įmonės kodas 307575857, Krivių g. 5, LT-01204 Vilnius, Lietuva, vykdančios veiklą Orbetra prekės ženklu („Tvarkytojas“). White-label perpardavėjų atveju perpardavėjas yra Valdytojas savo galutinių klientų atžvilgiu, o Orbetra lieka Tvarkytoju. Pasirašytiną kopiją galima gauti paprašius adresu [hello@orbetra.com](mailto:hello@orbetra.com)."
      },
      {
        "h2": "1. Įsigaliojimas ir viršenybė"
      },
      {
        "p": "Šis DPA įsigalioja tą dieną, kai Valdytojas pirmą kartą sutinka su [Paslaugų teikimo sąlygomis](/terms) arba pasirašo užsakymo formą, ir galioja tol, kol Orbetra tvarko asmens duomenis Valdytojo vardu. Jis sudaro šalių susitarimo dalį. Jei jis prieštarauja Sąlygoms ar užsakymo formai dėl asmens duomenų tvarkymo, pirmenybė teikiama šiam DPA; visais kitais klausimais pirmenybė teikiama Sąlygoms. Paslaugų teikimo sąlygose apibrėžti terminai čia turi tą pačią reikšmę. Kai taikomos ES standartinės sutarčių sąlygos, kilus prieštaravimui jos turi viršenybę prieš šį DPA."
      },
      {
        "h2": "2. Šalių vaidmenys"
      },
      {
        "p": "Valdytojas nustato asmens duomenų tvarkymo savo darbo aplinkoje tikslus ir priemones — kokios transporto priemonės sekamos, kokie vairuotojai registruojami, kokios taisyklės vykdomos ir kam duomenys naudojami. Orbetra tvarko tuos duomenis tik paslaugai teikti. Kiekviena šalis laikosi BDAR, kiek tai susiję su jos pačios vaidmeniu. Valdytojas atsako už savo nurodyto tvarkymo teisėtumą, įskaitant vairuotojų informavimą ir bet kokių konsultacijų su darbuotojų atstovais atlikimą."
      },
      {
        "h2": "3. Dalykas, trukmė ir apimtis"
      },
      {
        "p": "Orbetra tvarko asmens duomenis tam, kad teiktų autoparko sekimo paslaugą; tvarkymas trunka prenumeratos laikotarpį ir 11 skirsnyje nurodytus ištrynimo laikotarpius. Informacija, kurios reikalaujama BDAR 28 straipsnio 3 dalyje, pateikiama I priede."
      },
      {
        "h2": "4. Pobūdis ir tikslas"
      },
      {
        "p": "Transporto priemonių telemetrijos ir susijusių įrašų rinkimas, saugojimas, struktūrizavimas, analizė, rodymas ir eksportavimas Valdytojo autoparko valdymo tikslu."
      },
      {
        "h2": "5. Valdytojo nurodymai"
      },
      {
        "p": "Orbetra tvarko asmens duomenis tik pagal dokumentuotus Valdytojo nurodymus, įskaitant susijusius su duomenų perdavimais, nebent to reikalauja ES ar valstybės narės teisė — tokiu atveju Orbetra informuoja Valdytoją prieš tvarkymą, nebent tai draudžia teisė. Sąlygos, šis DPA, produkto dokumentacija bei Valdytojo atliekamas platformos konfigūravimas ir naudojimas sudaro visus dokumentuotus nurodymus. Orbetra informuoja Valdytoją, jei, jos nuomone, nurodymas pažeidžia duomenų apsaugos teisę."
      },
      {
        "h2": "6. Konfidencialumas"
      },
      {
        "p": "Prieigą turintys darbuotojai yra įpareigoti laikytis konfidencialumo ir jiems suteikiama mažiausių privilegijų prieiga."
      },
      {
        "h2": "7. Saugumo priemonės"
      },
      {
        "p": "Orbetra įgyvendina technines ir organizacines priemones, nurodytas **II priede**, atsižvelgdama į techninių galimybių išsivystymo lygį, įgyvendinimo sąnaudas ir riziką duomenų subjektams (BDAR 32 str.). Priemonės gali būti atnaujinamos platformai tobulėjant, su sąlyga, kad apsaugos lygis nebūtų sumažintas."
      },
      {
        "h2": "8. Subtvarkytojai"
      },
      {
        "p": "Valdytojas suteikia bendrą leidimą [orbetra.com/subprocessors](/subprocessors) išvardytiems subtvarkytojams. Orbetra kiekvienam subtvarkytojui nustato duomenų apsaugos įpareigojimus, kurie užtikrina ne mažesnę apsaugą nei šis DPA, ir lieka visiškai atsakinga Valdytojui už jų veiklą."
      },
      {
        "p": "**Pranešimas apie pakeitimus.** Prieš pridėdama ar pakeisdama subtvarkytoją, Orbetra atnaujina tą puslapį ir el. paštu praneša Valdytojams ne vėliau kaip prieš **30 dienų**. Norėdami būti įtraukti į pranešimų sąrašą, rašykite [hello@orbetra.com](mailto:hello@orbetra.com)."
      },
      {
        "p": "**Prieštaravimas.** Valdytojas gali per 30 dienų pranešimo laikotarpį raštu pareikšti prieštaravimą dėl pagrįstų duomenų apsaugos priežasčių. Šalys sąžiningai aptars prieštaravimą, o Orbetra dės pagrįstas pastangas pasiūlyti alternatyvą arba konfigūracijos pakeitimą. Nepavykus rasti sprendimo, Valdytojas gali be baudos nutraukti atitinkamą paslaugos dalį, o Orbetra grąžina iš anksto sumokėtus mokesčius už nepanaudotą laikotarpį."
      },
      {
        "h2": "9. Tarptautiniai perdavimai"
      },
      {
        "p": "Prieglobos ir saugojimo paslaugos teikiamos Europos Sąjungoje. Kai subtvarkytojas tvarko ribotus užklausų metaduomenis už EEE ribų — šiuo metu Mapbox produkto žemėlapio išklotinėms ir CARTO rinkodaros svetainės baziniam žemėlapiui — perdavimai grindžiami ES standartinėmis sutarčių sąlygomis (Komisijos įgyvendinimo sprendimas (ES) 2021/914), trečiuoju moduliu (tvarkytojas tvarkytojui), kartu su perdavimo poveikio vertinimu ir papildomomis priemonėmis, tokiomis kaip šifravimas perdavimo metu ir duomenų kiekio mažinimas. Jokia autoparko telemetrija ir jokie paskyros duomenys nėra perduodami saugoti už EEE ribų."
      },
      {
        "h2": "10. Pagalba"
      },
      {
        "p": "Orbetra padeda Valdytojui vykdyti jo pareigas pagal BDAR 32–36 str. ir atsakyti į duomenų subjektų prašymus, atsižvelgdama į tvarkymo pobūdį ir jai prieinamą informaciją:"
      },
      {
        "ul": [
          "Platformos eksportavimo, taisymo ir ištrynimo įrankiai bei REST API leidžia Valdytojui atsakyti į daugumą prašymų be mūsų įsitraukimo.",
          "Jei duomenų subjektas tiesiogiai kreipiasi į Orbetra dėl duomenų Valdytojo darbo aplinkoje, Orbetra neatsako iš esmės ir per **5 darbo dienas** persiunčia prašymą Valdytojui.",
          "Kai Valdytojui reikia mūsų pagalbos, į rašytinį pagalbos prašymą atsakome per **10 darbo dienų**, o prireikus greičiau, kad Valdytojas galėtų laikytis savo vieno mėnesio termino.",
          "Orbetra be nepagrįsto delsimo ir per **72 valandas** nuo sužinojimo praneša Valdytojui apie asmens duomenų saugumo pažeidimą, paveikiantį Valdytojo duomenis, pateikdama jai prieinamą informaciją, reikalingą Valdytojo pranešimui.",
          "Orbetra teikia pagrįstą informaciją poveikio duomenų apsaugai vertinimams ir išankstinėms konsultacijoms su priežiūros institucija."
        ]
      },
      {
        "h2": "11. Ištrynimas ir grąžinimas"
      },
      {
        "p": "Telemetrija ištrinama po 13 mėnesių saugojimo laikotarpio, o kelionių įrašų pradžios / pabaigos koordinatės ištrinamos tuo pačiu metu (kelionės atstumas, laikai ir vairuotojas išsaugomi Valdytojo istorinėms ataskaitoms ir negali būti susieti su vieta). Nutraukus ar pasibaigus sutarčiai, Valdytojas turi 30 dienų eksportuoti duomenis per programėlę ir API. Tada Orbetra per 30 dienų ištrina asmens duomenis iš veikiančių sistemų; šifruotose atsarginėse kopijose likę duomenys perrašomi įprastos atsarginių kopijų rotacijos metu, per 30 dienų nuo to ištrynimo. Orbetra saugo tik tai, ką saugoti įpareigoja ES ar valstybės narės teisė, ir visą saugojimo laiką tiems duomenims taiko šio DPA apsaugą. Orbetra paprašius raštu patvirtina ištrynimą."
      },
      {
        "h2": "12. Auditas"
      },
      {
        "p": "Orbetra pateikia informaciją, reikalingą įrodyti atitiktį BDAR 28 str., ir leidžia Valdytojui ar nepriklausomam auditoriui atlikti auditus kartą per metus, įspėjus ne vėliau kaip prieš 30 dienų, darbo valandomis, nepagrįstai netrikdant veiklos ir laikantis konfidencialumo. Papildomi auditai gali būti atliekami įvykus asmens duomenų saugumo pažeidimui arba to pareikalavus priežiūros institucijai. Valdytojas padengia savo audito išlaidas."
      },
      {
        "h2": "13. Atsakomybė"
      },
      {
        "p": "[Paslaugų teikimo sąlygose](/terms) nustatyti atsakomybės apribojimai ir išimtys taikomi pretenzijoms pagal šį DPA, kiek tai leidžia teisė. Niekas šiame DPA neriboja duomenų subjektų teisių ar kurios nors šalies atsakomybės pagal BDAR 82 str."
      },
      {
        "h2": "I priedas — Tvarkymo aprašymas"
      },
      {
        "p": "**A. Šalys.**"
      },
      {
        "ul": [
          "**Duomenų eksportuotojas / Valdytojas:** klientas, nurodytas paskyros registracijoje arba užsakymo formoje, veikiantis kaip savo darbo aplinkos asmens duomenų valdytojas. White-label diegimų atveju — perpardavėjas.",
          "**Duomenų importuotojas / Tvarkytojas:** MB Dokigo (Orbetra), Krivių g. 5, LT-01204 Vilnius, Lietuva, įmonės kodas 307575857. Kontaktai: [hello@orbetra.com](mailto:hello@orbetra.com)."
        ]
      },
      {
        "p": "**B. Tvarkymo aprašymas.**"
      },
      {
        "ul": [
          "**Duomenų subjektų kategorijos:** Valdytojo vairuotojai ir kiti transporto priemonių keleiviai, darbuotojai ir darbo aplinkos naudotojai; perpardavėjų atveju — jų galutinių klientų naudotojai ir vairuotojai.",
          "**Asmens duomenų kategorijos:** vardai, darbo el. paštai, vaidmenys ir teisės, vairuotojų identifikatoriai ir Valdytojo įvesti vairuotojo pažymėjimo duomenys, transporto priemonių priskyrimai, pozicijos ir maršrutai, greitis ir vairavimo įvykiai, degimas ir darbo valandos, kuro ir techninės priežiūros įrašai, įrenginiams siųstos komandos bei audito žurnalai. Įrenginio tapatybė grindžiama IMEI.",
          "**Specialios kategorijos:** nėra. Specialių kategorijų duomenys sąmoningai netvarkomi; Valdytojas neturi jų įvesti į laisvo teksto laukus.",
          "**Dažnumas:** nuolatinis — telemetrija iš įrenginių ateina beveik realiuoju laiku; paskyros ir konfigūracijos duomenys — naudojimo metu.",
          "**Pobūdis ir tikslas:** pirmiau nurodytų duomenų priegloba, saugojimas, struktūrizavimas, analizė, rodymas ir eksportavimas, kad Valdytojas galėtų valdyti savo autoparką, kaip aprašyta 3 ir 4 skirsniuose.",
          "**Trukmė:** prenumeratos laikotarpis ir 11 skirsnyje nurodyti saugojimo bei ištrynimo laikotarpiai (telemetrija pagal numatytuosius nustatymus 13 mėnesių; ištrynimas po 30 dienų eksportavimo laikotarpio nutraukus sutartį).",
          "**Subtvarkytojai:** kaip išvardyta [orbetra.com/subprocessors](/subprocessors), ten nurodytais tikslais ir laikotarpiais."
        ]
      },
      {
        "p": "**C. Kompetentinga priežiūros institucija.** Orbetra įsteigta Lietuvoje, todėl kompetentinga institucija yra Valstybinė duomenų apsaugos inspekcija (VDAI), Vilnius. Kai Valdytojas įsteigtas kitoje ES valstybėje narėje, jo paties priežiūros institucija yra kompetentinga jo tvarkymo atžvilgiu."
      },
      {
        "h2": "II priedas — Techninės ir organizacinės priemonės"
      },
      {
        "ul": [
          "TLS 1.2+ perduodamiems duomenims; duomenų bazių ir atsarginių kopijų šifravimas saugojimo metu.",
          "Klientų aplinkų atskyrimas, įgyvendintas duomenų sluoksnyje, ir vaidmenimis grindžiama prieigos kontrolė; SSO galimas Scale ir Enterprise planuose.",
          "Administracinių ir duomenų prieigos veiksmų audito registravimas.",
          "Automatinės atsarginės kopijos su išbandytomis atkūrimo procedūromis.",
          "Atskirtos aplinkos, kodo peržiūra, priklausomybių skenavimas ir mažiausių privilegijų prieiga prie infrastruktūros.",
          "Prieiga prie gamybinės aplinkos duomenų suteikiama tik tiems darbuotojams, kuriems ji būtina ir kuriuos saisto konfidencialumo pareiga, per autentifikuotus ir registruojamus kanalus.",
          "Pseudonimizavimas, kai tai praktiška: įrenginiai identifikuojami pagal IMEI, o vairuotojo tapatybė yra tik tai, ką įveda Valdytojas.",
          "Platformoje įdiegtas duomenų kiekio mažinimas ir saugojimo terminų ribojimas (telemetrijai numatytieji 13 mėnesių).",
          "Reagavimas į incidentus su pranešimu Valdytojui be nepagrįsto delsimo ir per 72 valandas nuo sužinojimo apie asmens duomenų saugumo pažeidimą.",
          "Veiklos tęstinumas: ES teritorijoje talpinama infrastruktūra su stebimu duomenų priėmimo srautu ir atkūrimo procedūromis, tikrinamomis su atsarginėmis kopijomis."
        ]
      }
    ]
  },
  "pl": {
    "title": "Aneks dotyczący przetwarzania danych",
    "label": "INFORMACJE PRAWNE",
    "updated": "sierpień 2026",
    "notice": "To jest tłumaczenie pomocnicze. W przypadku jakichkolwiek rozbieżności rozstrzygająca jest wersja angielska.",
    "blocks": [
      {
        "p": "Niniejszy Aneks dotyczący przetwarzania danych („DPA“) zostaje zawarty pomiędzy klientem wskazanym w rejestracji konta lub formularzu zamówienia („Administrator“) a **MB Dokigo**, litewską mažoji bendrija, numer rejestrowy 307575857, Krivių g. 5, LT-01204 Vilnius, Litwa, działającą pod marką Orbetra („Podmiot przetwarzający“). W przypadku resellerów white-label reseller jest Administratorem wobec swoich klientów końcowych, a Orbetra pozostaje Podmiotem przetwarzającym. Kopię do podpisania można otrzymać na żądanie pod adresem [hello@orbetra.com](mailto:hello@orbetra.com)."
      },
      {
        "h2": "1. Wejście w życie i pierwszeństwo"
      },
      {
        "p": "Niniejszy DPA wchodzi w życie z dniem, w którym Administrator po raz pierwszy akceptuje [Regulamin](/terms) lub podpisuje formularz zamówienia, i obowiązuje tak długo, jak Orbetra przetwarza dane osobowe w imieniu Administratora. Stanowi część umowy między stronami. W razie sprzeczności z Regulaminem lub formularzem zamówienia w zakresie przetwarzania danych osobowych pierwszeństwo ma niniejszy DPA; we wszystkich pozostałych kwestiach pierwszeństwo ma Regulamin. Terminy zdefiniowane w Regulaminie mają tutaj to samo znaczenie. Tam, gdzie zastosowanie mają standardowe klauzule umowne UE, w razie sprzeczności mają one pierwszeństwo przed niniejszym DPA."
      },
      {
        "h2": "2. Role stron"
      },
      {
        "p": "Administrator określa cele i sposoby przetwarzania danych osobowych w swoim środowisku roboczym — które pojazdy są śledzone, którzy kierowcy są rejestrowani, jakie reguły są uruchamiane i do czego dane są wykorzystywane. Orbetra przetwarza te dane wyłącznie w celu świadczenia usługi. Każda ze stron przestrzega RODO w zakresie własnej roli. Administrator odpowiada za zgodność z prawem przetwarzania, które zleca, w tym za poinformowanie kierowców i przeprowadzenie wszelkich konsultacji z przedstawicielami pracowników."
      },
      {
        "h2": "3. Przedmiot, czas trwania i zakres"
      },
      {
        "p": "Przetwarzanie danych osobowych przez Orbetra w celu świadczenia usługi śledzenia floty, na czas trwania subskrypcji oraz okresy usunięcia określone w sekcji 11. Informacje wymagane przez RODO Art. 28(3) są określone w Załączniku I."
      },
      {
        "h2": "4. Charakter i cel"
      },
      {
        "p": "Zbieranie, przechowywanie, porządkowanie, analiza, wyświetlanie i eksport telemetrii pojazdów oraz powiązanych zapisów w celu zarządzania flotą przez Administratora."
      },
      {
        "h2": "5. Instrukcje Administratora"
      },
      {
        "p": "Orbetra przetwarza dane osobowe wyłącznie na udokumentowane polecenie Administratora, w tym w odniesieniu do przekazywania danych, chyba że wymaga tego prawo UE lub państwa członkowskiego — w takim przypadku Orbetra informuje Administratora przed przetwarzaniem, chyba że prawo tego zakazuje. Regulamin, niniejszy DPA, dokumentacja produktu oraz konfiguracja i korzystanie z platformy przez Administratora stanowią pełne udokumentowane instrukcje. Orbetra informuje Administratora, jeżeli jej zdaniem polecenie narusza prawo ochrony danych."
      },
      {
        "h2": "6. Poufność"
      },
      {
        "p": "Osoby mające dostęp są zobowiązane do zachowania poufności i otrzymują dostęp zgodny z zasadą najmniejszych uprawnień."
      },
      {
        "h2": "7. Środki bezpieczeństwa"
      },
      {
        "p": "Orbetra wdraża środki techniczne i organizacyjne określone w **Załączniku II**, uwzględniając stan wiedzy technicznej, koszty wdrożenia oraz ryzyko dla osób, których dane dotyczą (RODO Art. 32). Środki mogą być aktualizowane w miarę rozwoju platformy, pod warunkiem że poziom ochrony nie ulegnie obniżeniu."
      },
      {
        "h2": "8. Podmioty podprzetwarzające"
      },
      {
        "p": "Administrator udziela ogólnej zgody na podmioty podprzetwarzające wymienione pod adresem [orbetra.com/subprocessors](/subprocessors). Orbetra nakłada na każdy podmiot podprzetwarzający obowiązki w zakresie ochrony danych nie mniej rygorystyczne niż niniejszy DPA i pozostaje w pełni odpowiedzialna wobec Administratora za ich działanie."
      },
      {
        "p": "**Powiadomienie o zmianie.** Przed dodaniem lub zmianą podmiotu podprzetwarzającego Orbetra aktualizuje tę stronę i powiadamia Administratorów pocztą elektroniczną z co najmniej **30-dniowym** wyprzedzeniem. Aby zostać dodanym do listy powiadomień, napisz na adres [hello@orbetra.com](mailto:hello@orbetra.com)."
      },
      {
        "p": "**Sprzeciw.** Administrator może w formie pisemnej wnieść sprzeciw w 30-dniowym okresie powiadomienia z uzasadnionych powodów dotyczących ochrony danych. Strony w dobrej wierze omówią sprzeciw, a Orbetra dołoży uzasadnionych starań, aby zaproponować alternatywę lub zmianę konfiguracji. W razie nieosiągnięcia rozwiązania Administrator może bez kar rozwiązać dotkniętą część usługi, a Orbetra zwróci opłaty uiszczone z góry za niewykorzystany okres."
      },
      {
        "h2": "9. Przekazywanie międzynarodowe"
      },
      {
        "p": "Hosting i przechowywanie odbywają się w Unii Europejskiej. Gdy podmiot podprzetwarzający przetwarza ograniczone metadane żądań poza EOG — obecnie Mapbox dla kafelków map produktu i CARTO dla mapy podkładowej witryny marketingowej — przekazywanie opiera się na standardowych klauzulach umownych UE (decyzja wykonawcza Komisji (UE) 2021/914), Moduł Trzeci (podmiot przetwarzający do podmiotu przetwarzającego), wraz z oceną skutków przekazania oraz dodatkowymi środkami, takimi jak szyfrowanie podczas przesyłania i minimalizacja danych. Żadna telemetria floty ani dane konta nie są przekazywane do przechowywania poza EOG."
      },
      {
        "h2": "10. Pomoc"
      },
      {
        "p": "Orbetra pomaga Administratorowi w wypełnianiu jego obowiązków wynikających z RODO Art. 32–36 oraz w odpowiadaniu na żądania osób, których dane dotyczą, uwzględniając charakter przetwarzania i dostępne jej informacje:"
      },
      {
        "ul": [
          "Narzędzia platformy do eksportu, sprostowania i usuwania oraz interfejs REST API pozwalają Administratorowi odpowiedzieć na większość żądań bez naszego udziału.",
          "Jeżeli osoba, której dane dotyczą, skontaktuje się bezpośrednio z Orbetra w sprawie danych w środowisku roboczym Administratora, Orbetra nie odpowiada co do meritum i przekazuje żądanie Administratorowi w ciągu **5 dni roboczych**.",
          "Gdy Administrator potrzebuje naszej pomocy, odpowiadamy na pisemne żądanie pomocy w ciągu **10 dni roboczych**, a szybciej, gdy jest to potrzebne, aby Administrator dotrzymał własnego jednomiesięcznego terminu.",
          "Orbetra powiadamia Administratora o naruszeniu ochrony danych osobowych dotyczącym danych Administratora bez zbędnej zwłoki i w ciągu **72 godzin** od powzięcia wiadomości, przekazując dostępne nam informacje na potrzeby własnego powiadomienia Administratora.",
          "Orbetra dostarcza uzasadnionych informacji na potrzeby ocen skutków dla ochrony danych oraz uprzednich konsultacji z organem nadzorczym."
        ]
      },
      {
        "h2": "11. Usunięcie i zwrot"
      },
      {
        "p": "Telemetria jest usuwana po 13-miesięcznym okresie przechowywania, a współrzędne początkowe/końcowe zapisów tras są usuwane w tym samym momencie (dystans trasy, czasy i kierowca są zachowywane na potrzeby własnej sprawozdawczości historycznej Administratora i nie mogą zostać powiązane z lokalizacją). Po rozwiązaniu lub wygaśnięciu umowy Administrator ma 30 dni na eksport danych przez aplikację i API. Następnie Orbetra usuwa dane osobowe z systemów produkcyjnych w ciągu 30 dni; szczątkowe kopie w zaszyfrowanych kopiach zapasowych są nadpisywane podczas normalnej rotacji kopii zapasowych, w ciągu 30 dni od tego usunięcia. Orbetra przechowuje wyłącznie to, co nakazuje przechowywać prawo UE lub państwa członkowskiego, i chroni to zgodnie z niniejszym DPA tak długo, jak jest ono przechowywane. Orbetra na żądanie potwierdza usunięcie na piśmie."
      },
      {
        "h2": "12. Audyt"
      },
      {
        "p": "Orbetra udostępnia informacje niezbędne do wykazania zgodności z Art. 28 i umożliwia przeprowadzanie audytów przez Administratora lub niezależnego audytora, raz w roku i z co najmniej 30-dniowym wyprzedzeniem, w godzinach pracy, bez nieuzasadnionych zakłóceń i z zachowaniem poufności. Dodatkowe audyty mogą być przeprowadzane po naruszeniu ochrony danych osobowych lub gdy wymaga tego organ nadzorczy. Administrator ponosi własne koszty audytu."
      },
      {
        "h2": "13. Odpowiedzialność"
      },
      {
        "p": "Ograniczenia i wyłączenia odpowiedzialności zawarte w [Regulaminie](/terms) mają zastosowanie do roszczeń na podstawie niniejszego DPA, w zakresie dozwolonym przez prawo. Nic w niniejszym DPA nie ogranicza praw osób, których dane dotyczą, ani odpowiedzialności którejkolwiek ze stron na podstawie RODO Art. 82."
      },
      {
        "h2": "Załącznik I — Opis przetwarzania"
      },
      {
        "p": "**A. Strony.**"
      },
      {
        "ul": [
          "**Podmiot eksportujący dane / Administrator:** klient wskazany w rejestracji konta lub formularzu zamówienia, działający jako administrator danych osobowych w swoim środowisku roboczym. W przypadku wdrożeń white-label — reseller.",
          "**Podmiot importujący dane / Podmiot przetwarzający:** MB Dokigo (Orbetra), Krivių g. 5, LT-01204 Vilnius, Litwa, numer rejestrowy 307575857. Kontakt: [hello@orbetra.com](mailto:hello@orbetra.com)."
        ]
      },
      {
        "p": "**B. Opis przetwarzania.**"
      },
      {
        "ul": [
          "**Kategorie osób, których dane dotyczą:** kierowcy Administratora i inne osoby przebywające w pojazdach, pracownicy i użytkownicy środowiska roboczego; w przypadku resellerów — użytkownicy i kierowcy ich klientów końcowych.",
          "**Kategorie danych osobowych:** imiona i nazwiska, służbowe adresy e-mail, role i uprawnienia, identyfikatory kierowców oraz dane prawa jazdy wprowadzone przez Administratora, przypisania pojazdów, pozycje i trasy, prędkość i zdarzenia jazdy, zapłon i godziny pracy, zapisy dotyczące paliwa i konserwacji, polecenia urządzeń oraz dzienniki audytu. Tożsamość urządzenia oparta jest na IMEI.",
          "**Szczególne kategorie:** brak. Żadne dane szczególnych kategorii nie są celowo przetwarzane; Administrator nie może ich wprowadzać do pól tekstowych.",
          "**Częstotliwość:** ciągła — telemetria napływa z urządzeń niemal w czasie rzeczywistym; dane konta i konfiguracji — w trakcie korzystania.",
          "**Charakter i cel:** hosting, przechowywanie, porządkowanie, analiza, wyświetlanie i eksport powyższych danych, aby Administrator mógł zarządzać swoją flotą, zgodnie z opisem w sekcjach 3 i 4.",
          "**Czas trwania:** czas trwania subskrypcji oraz okresy przechowywania i usunięcia określone w sekcji 11 (telemetria domyślnie 13 miesięcy; usunięcie po 30-dniowym okresie eksportu w momencie rozwiązania umowy).",
          "**Podmioty podprzetwarzające:** jak wymieniono pod adresem [orbetra.com/subprocessors](/subprocessors), w celach i na okresy tam wskazane."
        ]
      },
      {
        "p": "**C. Właściwy organ nadzorczy.** Orbetra ma siedzibę na Litwie, dlatego właściwym organem jest litewski Państwowy Inspektorat Ochrony Danych (Valstybinė duomenų apsaugos inspekcija, VDAI), Wilno. Gdy Administrator ma siedzibę w innym państwie członkowskim UE, właściwy dla jego przetwarzania jest jego własny organ nadzorczy."
      },
      {
        "h2": "Załącznik II — Środki techniczne i organizacyjne"
      },
      {
        "ul": [
          "TLS 1.2+ dla danych w tranzycie; szyfrowanie w spoczynku dla baz danych i kopii zapasowych.",
          "Izolacja najemców egzekwowana w warstwie danych oraz kontrola dostępu oparta na rolach; SSO dostępne w planach Scale i Enterprise.",
          "Rejestrowanie audytowe działań administracyjnych i dostępu do danych.",
          "Automatyczne kopie zapasowe z przetestowanymi procedurami odtwarzania.",
          "Rozdzielone środowiska, przegląd kodu, skanowanie zależności i dostęp do infrastruktury zgodny z zasadą najmniejszych uprawnień.",
          "Dostęp do danych produkcyjnych ograniczony do osób, które go potrzebują, zobowiązanych do zachowania poufności, poprzez uwierzytelnione i rejestrowane kanały.",
          "Pseudonimizacja tam, gdzie jest to praktyczne: urządzenia są identyfikowane po IMEI, a tożsamość kierowcy to wyłącznie to, co wprowadza Administrator.",
          "Minimalizacja danych i limity przechowywania egzekwowane przez platformę (domyślnie 13 miesięcy telemetrii).",
          "Reagowanie na incydenty z powiadomieniem Administratora bez zbędnej zwłoki i w ciągu 72 godzin od powzięcia wiadomości o naruszeniu ochrony danych osobowych.",
          "Ciągłość działania: infrastruktura hostowana w UE z monitorowanym potokiem przyjmowania danych i procedurami odtwarzania testowanymi na kopiach zapasowych."
        ]
      }
    ]
  },
  "de": {
    "title": "Zusatzvereinbarung zur Auftragsverarbeitung",
    "label": "RECHTLICHES",
    "updated": "August 2026",
    "notice": "Dies ist eine Übersetzung zu Informationszwecken. Bei etwaigen Abweichungen ist die englische Fassung maßgeblich.",
    "blocks": [
      {
        "p": "Diese Zusatzvereinbarung zur Auftragsverarbeitung („DPA“) wird zwischen dem in der Kontoregistrierung oder im Bestellformular genannten Kunden („Verantwortlicher“) und **MB Dokigo**, einer litauischen mažoji bendrija, Unternehmenscode 307575857, Krivių g. 5, LT-01204 Vilnius, Litauen, tätig unter dem Namen Orbetra („Auftragsverarbeiter“), geschlossen. Bei White-Label-Wiederverkäufern ist der Wiederverkäufer gegenüber seinen eigenen Endkunden der Verantwortliche und Orbetra bleibt der Auftragsverarbeiter. Eine unterschriftsfähige Kopie ist auf Anfrage unter [hello@orbetra.com](mailto:hello@orbetra.com) erhältlich."
      },
      {
        "h2": "1. Wirksamkeit und Vorrang"
      },
      {
        "p": "Dieser DPA wird an dem Tag wirksam, an dem der Verantwortliche erstmals die [Nutzungsbedingungen](/terms) akzeptiert oder ein Bestellformular unterzeichnet, und bleibt so lange in Kraft, wie Orbetra personenbezogene Daten im Auftrag des Verantwortlichen verarbeitet. Er ist Bestandteil der Vereinbarung zwischen den Parteien. Soweit er hinsichtlich der Verarbeitung personenbezogener Daten im Widerspruch zu den Nutzungsbedingungen oder einem Bestellformular steht, hat dieser DPA Vorrang; in allen übrigen Angelegenheiten haben die Nutzungsbedingungen Vorrang. In den Nutzungsbedingungen definierte Begriffe haben hier dieselbe Bedeutung. Soweit die EU-Standardvertragsklauseln Anwendung finden, haben sie im Konfliktfall Vorrang vor diesem DPA."
      },
      {
        "h2": "2. Rollen der Parteien"
      },
      {
        "p": "Der Verantwortliche bestimmt die Zwecke und Mittel der Verarbeitung personenbezogener Daten in seinem Arbeitsbereich — welche Fahrzeuge verfolgt werden, welche Fahrer erfasst werden, welche Regeln ausgeführt werden und wofür die Daten verwendet werden. Orbetra verarbeitet diese Daten ausschließlich zur Erbringung des Dienstes. Jede Partei hält die DSGVO in Bezug auf ihre eigene Rolle ein. Der Verantwortliche ist für die Rechtmäßigkeit der von ihm angewiesenen Verarbeitung verantwortlich, einschließlich der Information der Fahrer und der Durchführung etwaiger Konsultationen mit Arbeitnehmervertretern."
      },
      {
        "h2": "3. Gegenstand, Dauer und Umfang"
      },
      {
        "p": "Verarbeitung personenbezogener Daten durch Orbetra zur Erbringung des Flottenverfolgungsdienstes, für die Laufzeit des Abonnements zuzüglich der Löschfristen in Abschnitt 11. Die nach DSGVO Art. 28(3) erforderlichen Angaben sind in Anhang I aufgeführt."
      },
      {
        "h2": "4. Art und Zweck"
      },
      {
        "p": "Erhebung, Speicherung, Strukturierung, Analyse, Anzeige und Export von Fahrzeugtelemetrie und zugehörigen Aufzeichnungen zum Zweck der Flottenverwaltung durch den Verantwortlichen."
      },
      {
        "h2": "5. Weisungen des Verantwortlichen"
      },
      {
        "p": "Orbetra verarbeitet personenbezogene Daten nur auf dokumentierte Weisung des Verantwortlichen, auch in Bezug auf Übermittlungen, es sei denn, dies ist nach dem Recht der EU oder eines Mitgliedstaats erforderlich — in diesem Fall informiert Orbetra den Verantwortlichen vor der Verarbeitung, sofern das Recht dies nicht verbietet. Die Nutzungsbedingungen, dieser DPA, die Produktdokumentation sowie die Konfiguration und Nutzung der Plattform durch den Verantwortlichen bilden die vollständigen dokumentierten Weisungen. Orbetra informiert den Verantwortlichen, wenn eine Weisung ihrer Auffassung nach gegen das Datenschutzrecht verstößt."
      },
      {
        "h2": "6. Vertraulichkeit"
      },
      {
        "p": "Personen mit Zugang sind zur Vertraulichkeit verpflichtet und erhalten Zugang nach dem Least-Privilege-Prinzip."
      },
      {
        "h2": "7. Sicherheitsmaßnahmen"
      },
      {
        "p": "Orbetra setzt die in **Anhang II** dargelegten technischen und organisatorischen Maßnahmen um und berücksichtigt dabei den Stand der Technik, die Implementierungskosten und die Risiken für die betroffenen Personen (DSGVO Art. 32). Die Maßnahmen können mit der Weiterentwicklung der Plattform aktualisiert werden, sofern das Schutzniveau nicht verringert wird."
      },
      {
        "h2": "8. Unterauftragsverarbeiter"
      },
      {
        "p": "Der Verantwortliche erteilt eine allgemeine Genehmigung für die unter [orbetra.com/subprocessors](/subprocessors) aufgeführten Unterauftragsverarbeiter. Orbetra erlegt jedem Unterauftragsverarbeiter Datenschutzpflichten auf, die nicht weniger schützend sind als dieser DPA, und bleibt dem Verantwortlichen gegenüber für deren Leistung vollständig haftbar."
      },
      {
        "p": "**Änderungsmitteilung.** Vor dem Hinzufügen oder Ersetzen eines Unterauftragsverarbeiters aktualisiert Orbetra diese Seite und benachrichtigt die Verantwortlichen mindestens **30 Tage** im Voraus per E-Mail. Um in die Benachrichtigungsliste aufgenommen zu werden, senden Sie eine E-Mail an [hello@orbetra.com](mailto:hello@orbetra.com)."
      },
      {
        "p": "**Widerspruch.** Der Verantwortliche kann innerhalb der 30-tägigen Mitteilungsfrist aus berechtigten Datenschutzgründen schriftlich Widerspruch einlegen. Die Parteien erörtern den Widerspruch nach Treu und Glauben, und Orbetra unternimmt angemessene Anstrengungen, um eine Alternative oder eine Änderung der Konfiguration anzubieten. Wird keine Lösung erzielt, kann der Verantwortliche den betroffenen Teil des Dienstes ohne Vertragsstrafe kündigen, und Orbetra erstattet im Voraus gezahlte Gebühren für den nicht genutzten Zeitraum."
      },
      {
        "h2": "9. Internationale Übermittlungen"
      },
      {
        "p": "Hosting und Speicherung erfolgen in der Europäischen Union. Soweit ein Unterauftragsverarbeiter begrenzte Anfrage-Metadaten außerhalb des EWR verarbeitet — derzeit Mapbox für Produktkartenkacheln und CARTO für die Basiskarte der Marketing-Website — stützen sich die Übermittlungen auf die EU-Standardvertragsklauseln (Durchführungsbeschluss (EU) 2021/914 der Kommission), Modul Drei (Auftragsverarbeiter an Auftragsverarbeiter), zusammen mit einer Übermittlungs-Folgenabschätzung und ergänzenden Maßnahmen wie Verschlüsselung während der Übertragung und Datenminimierung. Es werden keine Flottentelemetrie oder Kontodaten zur Speicherung außerhalb des EWR übermittelt."
      },
      {
        "h2": "10. Unterstützung"
      },
      {
        "p": "Orbetra unterstützt den Verantwortlichen bei der Erfüllung seiner Pflichten nach DSGVO Art. 32–36 und bei der Beantwortung von Anfragen betroffener Personen, unter Berücksichtigung der Art der Verarbeitung und der ihr zur Verfügung stehenden Informationen:"
      },
      {
        "ul": [
          "Die Export-, Berichtigungs- und Löschwerkzeuge der Plattform sowie die REST API ermöglichen es dem Verantwortlichen, die meisten Anfragen ohne unsere Beteiligung zu beantworten.",
          "Wendet sich eine betroffene Person direkt an Orbetra bezüglich Daten im Arbeitsbereich eines Verantwortlichen, äußert sich Orbetra nicht inhaltlich und leitet die Anfrage innerhalb von **5 Werktagen** an den Verantwortlichen weiter.",
          "Wenn der Verantwortliche unsere Hilfe benötigt, beantworten wir eine schriftliche Unterstützungsanfrage innerhalb von **10 Werktagen** und schneller, sofern dies erforderlich ist, damit der Verantwortliche seine eigene Frist von einem Monat einhalten kann.",
          "Orbetra benachrichtigt den Verantwortlichen unverzüglich und innerhalb von **72 Stunden** nach Bekanntwerden über eine Verletzung des Schutzes personenbezogener Daten, die die Daten des Verantwortlichen betrifft, mit den uns für die eigene Meldung des Verantwortlichen zur Verfügung stehenden Informationen.",
          "Orbetra stellt angemessene Informationen für Datenschutz-Folgenabschätzungen und vorherige Konsultationen mit einer Aufsichtsbehörde bereit."
        ]
      },
      {
        "h2": "11. Löschung und Rückgabe"
      },
      {
        "p": "Telemetrie wird nach dem 13-monatigen Aufbewahrungszeitraum gelöscht, und die Start-/Endkoordinaten von Fahrtaufzeichnungen werden zum selben Zeitpunkt gelöscht (Fahrtstrecke, Zeiten und Fahrer bleiben für die eigene historische Berichterstattung des Verantwortlichen erhalten und können nicht auf einen Standort zurückgeführt werden). Bei Kündigung oder Ablauf hat der Verantwortliche 30 Tage Zeit, Daten über die App und die API zu exportieren. Orbetra löscht personenbezogene Daten anschließend innerhalb von 30 Tagen aus den Produktivsystemen; Restkopien in verschlüsselten Backups werden im Zuge der normalen Backup-Rotation innerhalb von 30 Tagen nach dieser Löschung überschrieben. Orbetra bewahrt nur das auf, was das Recht der EU oder eines Mitgliedstaats zu bewahren vorschreibt, und schützt es nach diesem DPA, solange es aufbewahrt wird. Orbetra bestätigt die Löschung auf Anfrage schriftlich."
      },
      {
        "h2": "12. Audit"
      },
      {
        "p": "Orbetra stellt die zum Nachweis der Einhaltung von Art. 28 erforderlichen Informationen bereit und ermöglicht Überprüfungen durch den Verantwortlichen oder einen unabhängigen Prüfer, einmal jährlich und mit einer Frist von mindestens 30 Tagen, während der Geschäftszeiten, ohne unangemessene Störung und unter Wahrung der Vertraulichkeit. Zusätzliche Überprüfungen können nach einer Verletzung des Schutzes personenbezogener Daten oder auf Verlangen einer Aufsichtsbehörde durchgeführt werden. Der Verantwortliche trägt seine eigenen Auditkosten."
      },
      {
        "h2": "13. Haftung"
      },
      {
        "p": "Die Haftungsbeschränkungen und -ausschlüsse in den [Nutzungsbedingungen](/terms) gelten für Ansprüche aus diesem DPA, soweit gesetzlich zulässig. Nichts in diesem DPA beschränkt die Rechte betroffener Personen oder die Haftung einer der Parteien nach DSGVO Art. 82."
      },
      {
        "h2": "Anhang I — Beschreibung der Verarbeitung"
      },
      {
        "p": "**A. Parteien.**"
      },
      {
        "ul": [
          "**Datenexporteur / Verantwortlicher:** der in der Kontoregistrierung oder im Bestellformular genannte Kunde, der als Verantwortlicher für die personenbezogenen Daten in seinem Arbeitsbereich handelt. Bei White-Label-Bereitstellungen der Wiederverkäufer.",
          "**Datenimporteur / Auftragsverarbeiter:** MB Dokigo (Orbetra), Krivių g. 5, LT-01204 Vilnius, Litauen, Unternehmenscode 307575857. Kontakt: [hello@orbetra.com](mailto:hello@orbetra.com)."
        ]
      },
      {
        "p": "**B. Beschreibung der Verarbeitung.**"
      },
      {
        "ul": [
          "**Kategorien betroffener Personen:** die Fahrer des Verantwortlichen und andere Fahrzeuginsassen, Mitarbeiter und Arbeitsbereichsnutzer; bei Wiederverkäufern die Nutzer und Fahrer ihrer Endkunden.",
          "**Kategorien personenbezogener Daten:** Namen, geschäftliche E-Mail-Adressen, Rollen und Berechtigungen, vom Verantwortlichen eingegebene Fahrerkennungen und Führerscheindaten, Fahrzeugzuordnungen, Positionen und Routen, Geschwindigkeit und Fahrereignisse, Zündung und Arbeitszeiten, Kraftstoff- und Wartungsaufzeichnungen, Gerätebefehle sowie Audit-Protokolle. Die Geräteidentität basiert auf der IMEI.",
          "**Besondere Kategorien:** keine. Es werden keine Daten besonderer Kategorien absichtlich verarbeitet; der Verantwortliche darf sie nicht in Freitextfelder eingeben.",
          "**Häufigkeit:** kontinuierlich — Telemetrie trifft nahezu in Echtzeit von den Geräten ein; Konto- und Konfigurationsdaten bei Nutzung.",
          "**Art und Zweck:** Hosting, Speicherung, Strukturierung, Analyse, Anzeige und Export der oben genannten Daten, damit der Verantwortliche seine Flotte verwalten kann, wie in den Abschnitten 3 und 4 beschrieben.",
          "**Dauer:** die Laufzeit des Abonnements zuzüglich der Aufbewahrungs- und Löschfristen in Abschnitt 11 (Telemetrie standardmäßig 13 Monate; Löschung nach dem 30-tägigen Exportzeitraum bei Kündigung).",
          "**Unterauftragsverarbeiter:** wie unter [orbetra.com/subprocessors](/subprocessors) aufgeführt, zu den dort angegebenen Zwecken und Dauern."
        ]
      },
      {
        "p": "**C. Zuständige Aufsichtsbehörde.** Orbetra ist in Litauen niedergelassen, daher ist die zuständige Behörde die litauische staatliche Datenschutzaufsicht (Valstybinė duomenų apsaugos inspekcija, VDAI), Vilnius. Ist der Verantwortliche in einem anderen EU-Mitgliedstaat niedergelassen, ist seine eigene Aufsichtsbehörde für seine Verarbeitung zuständig."
      },
      {
        "h2": "Anhang II — Technische und organisatorische Maßnahmen"
      },
      {
        "ul": [
          "TLS 1.2+ für Daten während der Übertragung; Verschlüsselung im Ruhezustand für Datenbanken und Backups.",
          "Mandantentrennung, durchgesetzt in der Datenschicht, und rollenbasierte Zugriffskontrolle; SSO verfügbar in Scale und Enterprise.",
          "Audit-Protokollierung von administrativen und datenzugriffsbezogenen Aktionen.",
          "Automatisierte Backups mit getesteten Wiederherstellungsverfahren.",
          "Getrennte Umgebungen, Code-Review, Abhängigkeitsscans und Infrastrukturzugang nach dem Least-Privilege-Prinzip.",
          "Zugriff auf Produktionsdaten beschränkt auf Personen, die ihn benötigen, zur Vertraulichkeit verpflichtet, über authentifizierte und protokollierte Kanäle.",
          "Pseudonymisierung, soweit praktikabel: Geräte werden über die IMEI identifiziert, und die Fahreridentität ist nur das, was der Verantwortliche eingibt.",
          "Datenminimierung und Aufbewahrungsgrenzen, durchgesetzt durch die Plattform (13 Monate Telemetrie-Standard).",
          "Reaktion auf Vorfälle mit Benachrichtigung des Verantwortlichen unverzüglich und innerhalb von 72 Stunden nach Bekanntwerden einer Verletzung des Schutzes personenbezogener Daten.",
          "Geschäftskontinuität: in der EU gehostete Infrastruktur mit überwachter Ingest-Pipeline und gegen Backups geprüften Wiederherstellungsverfahren."
        ]
      }
    ]
  }
};
