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

## 6. Not done — the remaining prose tail

The per-language reviewers also returned roughly 600 style-level findings: calqued idiom, awkward
government and word order, and ad-hoc compounds. None of them state anything false and none name a
wrong button; they read as translated rather than written. They are catalogued in the reviewers'
reports and are a separate editing pass, ideally by a native speaker per language.

One item is outside this package and needs a decision: `apps/site/src/content/legal/subprocessors.ts`
names **Postmark** while the product sends through **AWS SES**, and **Twilio** is absent entirely.
That is a DPA-level mismatch, not a knowledge-base one.
