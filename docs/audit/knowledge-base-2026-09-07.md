# Knowledge base audit — 2026-09-07

Scope: `packages/kb` (48 articles × 4 languages = 192 documents), both renderers
(`apps/web/src/routes/app/learn`, `apps/site/src/routes/learn.*`), and every contextual `HelpLink`.

Method: nine parallel reviewers — one structural pass over the package and the two renderers, one
fact-checking pass against the code, and per-language prose passes (EN, LT, PL, DE) reading each
article against the product's own locale files. **Every factual finding below was then re-verified
by hand against the implementation**; three reviewer claims did not survive that check and are
recorded at the bottom.

Verdict on the first draft: structurally sound, factually unreliable, and not written in the
product's own vocabulary. The root cause is single and worth naming — the content was written from
schemas, i18n key names and inference rather than from tracing behaviour and reading the locale
files. Every defect below reads perfectly and is invisible to a structural test.

---

## 1. False statements about the product — all six verified in code, all six fixed

| Article | Claimed | Actually | Source of truth |
|---|---|---|---|
| `unpaid-what-happens` | fleet stops **three days** after the final warning | **one day** — notice 3 lands at grace+2, suspension at grace+3, and notice 3 itself says "1 day" | `apps/worker/src/jobs/lapseSweepWorker.ts` (`SUSPEND_AFTER_DAYS = 3`, ladder comment) |
| `plans-and-limits` | "nothing is charged in the moment of switching" | an **upgrade is invoiced immediately** (`always_invoice`); only a downgrade defers | `apps/api/src/billing/stripe.ts:314-323` |
| `report-types` | five reports listed as per-event rows; geofence "per zone"; trips "with driver" | **five of six are daily aggregates** (one row per vehicle per day); geofence has **no per-zone breakdown**; the trips report has **no driver column** and caps at 5 000 rows | `packages/db/src/reports.ts` (`GROUP BY 1,2,3,4`, `TripRow`, `TRIP_LIST_CAP`) |
| `webhooks` | "It must be HTTPS" | `webhookCreateSchema.url` is `z.string().url()` — **plain HTTP is accepted** | `packages/shared/src/entities.ts:610` |
| `geofences` | a transition needs one trusted position on the far side | it needs **two consecutive** — `enterStreak = exitStreak = 2` | `apps/worker/src/geofence/engine.ts:48-49,160` |
| `notification-channels` | "the four channels", implying a rule carries all four | a rule carries **three** (email, telegram, webpush); a webhook is configured separately and subscribes to event kinds | `packages/shared/src/entities.ts` (`notificationChannelSchema`) |

**Left open for the product, not the docs:** the webhook URL accepts `http://`. The article now says
so plainly instead of claiming otherwise, but pinning `https://` in `webhookCreateSchema` is the
better fix and belongs in its own change.

## 2. The articles did not speak the product's language

Every bolded UI label is a claim about what is on screen, and none of them were checked.

- **Lithuanian, 112 occurrences across 23 articles:** the hardware was called `seklys` — a *sleuth* —
  where the product says `sekiklis` (0 uses of the wrong word in `lt.json`; `devices.waitingHint`
  uses the right one). Three article titles carried it.
- **Lithuanian status vocabulary:** four of the six labels in the article whose entire purpose is
  teaching that vocabulary were wrong — `Neprisijungęs`/`Nėra ryšio`/`Niekada nesiuntė`/`Nurašytas`
  against the product's `Atsijungęs`/`Nepasiekiamas`/`Niekada nepranešė`/`Išregistruotas`. Plus
  24 uses of `nurašyti` where the button says `Išregistruoti`.
- **Polish:** `komenda` (37×) for `Polecenie`, `endpoint` for `punkt końcowy`, `Cooldown` for
  `Odstęp`, `Nigdy nie raportowało` for `Nigdy nie zgłosił`, `favikona` for `favicona`,
  `**Znaleziony**`/`**Zweryfikowana**` for `Znaleziono`/`Zweryfikowano`, `**Bezpośrednia**` for the
  plan track literally named **Direct**, three of six report names, three rule kinds.
- **German:** `Historie` for `Verlauf` (shell.history), `Replay` for `Wiedergabe`, `Sendeintervall`
  for `Meldeintervall`, `Notruf` for `Panik`, `Abo` for `Abonnement`, `Halte` for `Stopps`,
  `Tempoüberschreitung` for `Tempo`/`Geschwindigkeit`, and — worst — a rule named
  **Kein Kontakt**, which is the connection *status* label, in direct contradiction of
  `device-status`, whose whole argument is that those two vocabularies must never share a word.

All fixed. The guard is `apps/web/__tests__/kbUiLabels.spec.ts`: a registry of words the product does
not use, each paired with the i18n key holding the word it does — so the replacement is read from the
locale and a product rename breaks the test rather than quietly re-permitting the wrong article.

## 3. Typography and consistency

- **Every quotation in the corpus closed with an ASCII `"`** — 331 of them, in all four languages,
  while the product's own locales get it right. Fixed per language: `„…“` (lt, de), `„…”` (pl),
  `“…”` (en).
- **Six cross-link targets were linked under two or three different names**, in all four languages
  — a reader could not tell they were the same page. Now guarded by a test in
  `packages/kb/__tests__/prose.spec.ts` (one destination, one name, per language).
- **51 German colons** were followed by a lowercase complete sentence (Duden D 26), plus three
  2nd-person-singular imperatives in a document contracted to `Sie`.

## 4. Structural defects found and fixed

1. `kbViewer` derived "is a tenant admin" from the role alone. A reseller can mint an
   account-pinned `tsp_admin` (`canGrantRole` is at-or-below), so that admin would have been shown
   the platform's own billing help on a white-label host. Now uses `isOverseer()`.
2. The service worker precached all 48 articles into every dashboard install (`globIgnores`).
3. Article anchors never scrolled — `scrollRestoration` gates the hash handler in router-core.
4. `HelpLink` inside `<h1>`/`<h2>` polluted the heading accessible name.
5. Duplicate `learn-card-<slug>` testids where an article appears in two shelves.

## 5. Reviewer claims that did NOT survive verification

Recorded because the next reader deserves to know the reviewers were not always right:

- **"German `Kein Kontakt` is a misused status label."** Half right. `status.offline` **is**
  `Kein Kontakt`, so the status table was correct; the defect was the *rule* named with it.
- **"Polish `geofences.polygon` should be Poligon."** No — `pl.json` says `Wielokąt`, and the
  article already said that. (The Lithuanian equivalent *was* wrong.)
- **"German cooldown field is `Abklingzeit`, low battery is `Schwache Batterie`."** Both true of the
  product, but the reviewer had not checked which of `rules.kind.*` vs `events.k.*` the article's
  table was quoting; two of the proposed replacements would have introduced a new mismatch.

## 6. Round two — the prose pass (same day)

Six more reviewers read every article again, this time for fluency alone, and returned exact
old→new pairs: **EN 253, LT 535, PL ~190, DE ~200** — about 1 180 edits, all applied. Nothing was
deferred.

Three of those "style" findings turned out to be factual, which is why the pass was worth running:

- **`commands`** told the reader to "deal with it before the device reconnects". There is no cancel
  route and no cancel control — a queued command cannot be recalled. The article now says so.
- **`drivers`** told the reader to read an iButton id "from the vehicle panel". No screen shows an
  unregistered fob's id; the sentence now points only at the fob itself.
- **`scheduled-reports` (LT only)** had the UTC offsets for Lithuania swapped — "two hours in summer
  and three in winter" against a correct worked example in the same sentence. EN, PL and DE state
  Central Europe correctly and were untouched.

And one more retention claim did not survive checking: `where-your-data-lives` gave the audit log's
retention as "kept as the record of who changed what", which is not a duration. `audit_log` is
append-only and appears in no sweep, so it is kept for the life of the account — now stated. The
same table said trips and events follow their positions; true for events and for a trip's route,
but a trip's SUMMARY outlives both, which matters to anyone planning year-on-year reporting.

The recurring patterns, which are the same in all four languages and worth remembering: English
idiom carried over intact (`sėdi ant vardo`, `gyvena Stripe portale`, `mieszka w portalu`,
`Historie`, `a blank is a blank`); objects and head nouns dropped where English may elide and the
other three languages may not; and list or table columns whose grammatical shape changes row to row.

## 7. Product changes this audit forced

- **`webhookCreateSchema.url` now pins `https://`** (`packages/shared/src/entities.ts`), on create and
  on update, with a test in `apps/api/__tests__/webhooks.spec.ts`. The article had claimed this was
  already true; rather than weaken the article, the schema was made to match it.
- **`apps/site/src/content/legal/subprocessors.ts` and `privacy.ts`** named **Postmark**, which the
  codebase does not use anywhere. Transactional mail goes through **Amazon SES**
  (`email-smtp.eu-central-1.amazonaws.com`) and the onboarding configuration SMS through **Twilio**,
  which was absent from the list entirely. Both documents corrected in all four languages.
  **The legal entity names and transfer bases still need checking against the signed DPAs** — the
  service and the data flow are now right, the contracting entity is stated generically.

## 8. Still open

- **Fixed, in the product rather than the articles:** three locale keys disagreed with the rest of
  their own language. German said **Geofence** in `reports.t.geofence`, `events.k.geofence` and
  `geofences.deleteError` while everything else said **Geozone**; Polish said **Komendy** in
  `shell.commands` alone against **Polecenia** on four other screens; English said
  **Organization admin** in `roles.tsp_admin` against **Organisation admin** two keys away, in a
  product that is British throughout. All three corrected in `apps/web/src/i18n/` and in the site's
  `admin-locales/` mirror, and the German report table in the KB follows the corrected label.
- The KB narrates as `{product}`, "the platform" and "we" — sometimes within one article. Harmless,
  but a single voice would read better.
