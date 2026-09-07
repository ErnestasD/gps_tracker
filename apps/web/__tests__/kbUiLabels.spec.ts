import { describe, expect, it } from 'vitest'

import { KB_LANGS, type KbLang } from '@orbetra/kb'
import { KB_ARTICLES } from '@orbetra/kb/content'
import { bodyText } from '@orbetra/kb'

import de from '../src/i18n/de.json'
import en from '../src/i18n/en.json'
import lt from '../src/i18n/lt.json'
import pl from '../src/i18n/pl.json'

/**
 * The guard the knowledge base did not have, and the reason it needed one.
 *
 * An article that quotes a button, a status or a field name is making a claim about the product's
 * own words, and nothing checked it. A 2026-09-07 audit found the Lithuanian corpus calling the
 * hardware `seklys` (a sleuth) 108 times where the product says `sekiklis` — zero times the right
 * word — and the article whose entire purpose is teaching the status vocabulary getting four of its
 * six labels wrong. Every one of those reads perfectly and sends the reader looking for a string
 * that is not on the screen.
 *
 * The check is a REGISTRY, not a heuristic. Scanning every `**bold**` and demanding it exist in the
 * i18n would drown in false positives — most bold in these articles is emphasis, not a label. So
 * each entry is a word we know the product does not use, paired with the i18n key that holds the
 * word it does. Two assertions per entry, and the second is what keeps the file honest: the
 * replacement is read from the locale, so a product rename breaks this test instead of silently
 * making the articles wrong again.
 */
const LOCALES: Record<KbLang, unknown> = { en, lt, pl, de }

/** Resolve a dotted i18n key, or fail loudly — a stale key here would disable an assertion. */
function label(lang: KbLang, key: string): string {
  let cur: unknown = LOCALES[lang]
  for (const part of key.split('.')) {
    expect(typeof cur === 'object' && cur !== null, `${lang}: ${key} — path breaks at "${part}"`).toBe(true)
    cur = (cur as Record<string, unknown>)[part]
  }
  expect(typeof cur, `${lang}: ${key} is not a string`).toBe('string')
  return cur as string
}

interface Banned {
  /** what an article must not say — a word or phrase the product never shows */
  wrong: RegExp
  /** what the product says instead */
  right: string
  /** an i18n key whose value contains `right` — the proof that `right` is really the product's word */
  key: string
  /** why, in one line, for whoever hits this */
  why: string
}

const BANNED: Partial<Record<KbLang, Banned[]>> = {
  lt: [
    { wrong: /\bsekl(?:ys|io|iui|į|iai|ių|iams|iais|yje)\b/i, right: 'sekikl', key: 'devices.canSettings.intro', why: '"seklys" is a sleuth, and the product never uses it' },
    { wrong: /\bNeprisijungęs\b/, right: 'Atsijungęs', key: 'status.stale', why: 'this is the status for a device quiet for a few minutes' },
    { wrong: /\bNėra ryšio\b/, right: 'Nepasiekiamas', key: 'status.offline', why: 'this is the status for a long silence' },
    { wrong: /\bNiekada nesiuntė\b/, right: 'Niekada nepranešė', key: 'devices.waiting', why: 'this is the never-reported status' },
    { wrong: /\bNurašyt(?:as|a|i|ų|ą)\b/, right: 'Išregistruotas', key: 'devices.retired', why: 'this is the lifecycle status' },
    { wrong: /\bDaugiakampis\b/, right: 'Poligonas', key: 'geofences.polygon', why: 'this is the shape\'s name on screen' },
    { wrong: /\bDalintis\b/, right: 'Bendrinti', key: 'devices.share.button', why: 'this is the button, and "dalintis" is substandard for "dalytis"' },
  ],
  pl: [
    { wrong: /\bkomend[aęąyi]?\b/i, right: 'Polecenie', key: 'devices.cmd.command', why: 'only the sidebar says "Komendy"; every other screen says this' },
    { wrong: /\bendpoint\w*\b/i, right: 'punktu końcowego', key: 'webhooks.url', why: 'the field is named in Polish' },
    { wrong: /\bCooldown\b/i, right: 'Odstęp', key: 'rules.cooldown', why: 'the rule field has a Polish name' },
    { wrong: /Nigdy nie raportowa\w+/, right: 'Nigdy nie zgłosił', key: 'devices.waiting', why: 'this is the never-reported status' },
    { wrong: /\*\*Brak kontaktu\*\*/, right: 'Urządzenie offline', key: 'rules.kind.device_offline', why: 'this is the rule kind; "brak kontaktu" is not a label here' },
    { wrong: /\bfavikon\w*/i, right: 'favicony', key: 'branding.faviconUrl', why: 'the product spells it with a c' },
    { wrong: /\bpasku bocznym\b/, right: 'panelu bocznym', key: 'branding.logoHint', why: 'the shell calls it a panel, not a bar' },
  ],
  de: [
    { wrong: /\bHistorie\b/, right: 'Verlauf', key: 'shell.history', why: 'the navigation item is named this' },
    { wrong: /\bReplay\b/, right: 'Wiedergabe', key: 'playback.title', why: 'the screen has a German name' },
    { wrong: /\bSendeintervall\w*/, right: 'Meldeintervall', key: 'devices.settings.key.movingSendPeriod', why: 'the slider is named this' },
    { wrong: /\bAbo\b/, right: 'Abonnement', key: 'billing.subscription', why: 'the billing screen writes it out' },
    { wrong: /\*\*Kein Kontakt\*\* für das ganze Konto/, right: 'Gerät offline', key: 'rules.kind.device_offline', why: 'that is the rule kind; "Kein Kontakt" is the connection STATUS and the two must not share a word' },
    { wrong: /\*\*Notruf\*\*/, right: 'Panik', key: 'rules.kind.panic', why: 'this is the rule kind' },
    { wrong: /\*\*Halte\*\*/, right: 'Stopps', key: 'reports.t.stops', why: 'this is the report name' },
    { wrong: /\*\*Tempoüberschreitung\w*\*\*/, right: 'Tempo', key: 'reports.t.overspeed', why: 'this is the report name' },
  ],
}

describe('articles quote the product\'s own words', () => {
  it('every replacement really is the product\'s word — a rename breaks this, not the articles', () => {
    for (const [lang, rules] of Object.entries(BANNED) as [KbLang, Banned[]][]) {
      for (const r of rules) {
        expect(
          label(lang, r.key).toLowerCase(),
          `${lang}: ${r.key} no longer contains "${r.right}" — the product was renamed, so this rule is stale`,
        ).toContain(r.right.toLowerCase())
      }
    }
  })

  it('no article uses a word the product does not', () => {
    for (const [lang, rules] of Object.entries(BANNED) as [KbLang, Banned[]][]) {
      for (const a of KB_ARTICLES) {
        const doc = a.doc[lang]
        const hay = `${doc.title}\n${doc.summary}\n${doc.keywords.join('\n')}\n${bodyText(doc)}`
        for (const r of rules) {
          const hit = r.wrong.exec(hay)
          expect(
            hit,
            `${a.slug}/${lang}: "${hit?.[0] ?? ''}" — ${r.why}. The product says "${r.right}" (${r.key}).`,
          ).toBeNull()
        }
      }
    }
  })

  it('covers every language the articles are written in', () => {
    // Not every language has rules yet — but the map must not name one that does not exist.
    for (const lang of Object.keys(BANNED)) expect(KB_LANGS as readonly string[]).toContain(lang)
  })
})
