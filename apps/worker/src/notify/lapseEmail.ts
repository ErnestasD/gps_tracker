import { emailButton, emailFallbackLink, emailNote, escapeHtml, renderBrandedEmail, type Branding } from '@orbetra/shared'

/**
 * The lapse ladder: three warnings, then the notice that service stopped (audit MED #22, founder
 * policy 2026-08-06 — warn when the grace period ends, again after one and two days, suspend on the
 * third).
 *
 * These are the only mails in the product that can cost a customer their live map, so the copy owes
 * them three things and says all three: exactly WHEN it stops, exactly WHAT survives (all of it —
 * suspension stops new data, it deletes nothing), and one button that fixes it. The final notice
 * says the same about restoring, because a customer reading it has already lost the feed and needs
 * to know that paying brings it back rather than starting them over.
 *
 * `daysLeft: 0` is the suspended notice; 1–3 are the warnings.
 */
export interface LapseEmailOpts {
  billingUrl: string
  /** days until the fleet stops reporting; 0 = it already has */
  daysLeft: number
  locale: string
  brand: string
  branding?: Branding | undefined
  tenantName?: string | undefined
}

interface Strings {
  subjectWarn: (d: number) => string
  subjectStopped: string
  headingWarn: (d: number) => string
  headingStopped: string
  introWarn: (d: number) => string
  introStopped: string
  keeps: string
  button: string
  fallback: string
}

const LOCALES: Record<string, Strings> = {
  en: {
    subjectWarn: (d) => (d === 1 ? 'Your fleet stops reporting tomorrow' : `Your fleet stops reporting in ${d} days`),
    subjectStopped: 'Your fleet has stopped reporting',
    headingWarn: (d) => (d === 1 ? 'Tomorrow your devices stop reporting' : `In ${d} days your devices stop reporting`),
    headingStopped: 'Your devices have stopped reporting',
    introWarn: (d) =>
      `Your subscription has ended and the grace period is over. In ${d === 1 ? 'one day' : `${d} days`} we will stop accepting data from your devices — the live map goes quiet and no new trips, alerts or reports are produced. Renewing before then changes nothing about your service.`,
    introStopped:
      'We have stopped accepting data from your devices. Renewing restores them within a minute — the same devices, the same settings, nothing to set up again.',
    keeps: 'Nothing has been deleted. Your history, trips, reports and settings are all still here, and you can sign in and export them at any time.',
    button: 'Renew my subscription',
    fallback: 'If the button does not work, copy and paste this link into your browser:',
  },
  lt: {
    subjectWarn: (d) => (d === 1 ? 'Rytoj jūsų įrenginiai nustos siųsti duomenis' : `Po ${d} d. jūsų įrenginiai nustos siųsti duomenis`),
    subjectStopped: 'Jūsų įrenginiai nustojo siųsti duomenis',
    headingWarn: (d) => (d === 1 ? 'Rytoj įrenginiai nustos siųsti duomenis' : `Po ${d} d. įrenginiai nustos siųsti duomenis`),
    headingStopped: 'Jūsų įrenginiai nustojo siųsti duomenis',
    introWarn: (d) =>
      `Jūsų prenumerata pasibaigė, o lengvatinis laikotarpis jau praėjo. Po ${d === 1 ? 'vienos dienos' : `${d} d.`} nustosime priimti duomenis iš jūsų įrenginių — gyvas žemėlapis nutils, nebebus naujų kelionių, pranešimų ir ataskaitų. Atnaujinus prenumeratą iki tol niekas nepasikeis.`,
    introStopped:
      'Nustojome priimti duomenis iš jūsų įrenginių. Atnaujinus prenumeratą jie atsistato per minutę — tie patys įrenginiai, tie patys nustatymai, iš naujo nieko daryti nereikės.',
    keeps: 'Niekas neištrinta. Jūsų istorija, kelionės, ataskaitos ir nustatymai tebėra vietoje — galite prisijungti ir juos eksportuoti bet kada.',
    button: 'Atnaujinti prenumeratą',
    fallback: 'Jei mygtukas neveikia, nukopijuokite šią nuorodą į naršyklę:',
  },
  de: {
    subjectWarn: (d) => (d === 1 ? 'Morgen senden Ihre Geräte keine Daten mehr' : `In ${d} Tagen senden Ihre Geräte keine Daten mehr`),
    subjectStopped: 'Ihre Geräte senden keine Daten mehr',
    headingWarn: (d) => (d === 1 ? 'Morgen senden Ihre Geräte keine Daten mehr' : `In ${d} Tagen senden Ihre Geräte keine Daten mehr`),
    headingStopped: 'Ihre Geräte senden keine Daten mehr',
    introWarn: (d) =>
      `Ihr Abonnement ist beendet und die Kulanzfrist abgelaufen. In ${d === 1 ? 'einem Tag' : `${d} Tagen`} nehmen wir keine Daten Ihrer Geräte mehr an — die Live-Karte bleibt stehen, es entstehen keine neuen Fahrten, Meldungen und Berichte. Eine Verlängerung davor ändert nichts an Ihrem Dienst.`,
    introStopped:
      'Wir nehmen keine Daten Ihrer Geräte mehr an. Eine Verlängerung stellt sie binnen einer Minute wieder her — dieselben Geräte, dieselben Einstellungen, nichts neu einzurichten.',
    keeps: 'Es wurde nichts gelöscht. Ihre Historie, Fahrten, Berichte und Einstellungen sind vollständig vorhanden; Sie können sich jederzeit anmelden und exportieren.',
    button: 'Abonnement verlängern',
    fallback: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
  },
  pl: {
    subjectWarn: (d) => (d === 1 ? 'Jutro urządzenia przestaną przesyłać dane' : `Za ${d} dni urządzenia przestaną przesyłać dane`),
    subjectStopped: 'Urządzenia przestały przesyłać dane',
    headingWarn: (d) => (d === 1 ? 'Jutro urządzenia przestaną przesyłać dane' : `Za ${d} dni urządzenia przestaną przesyłać dane`),
    headingStopped: 'Urządzenia przestały przesyłać dane',
    introWarn: (d) =>
      `Subskrypcja wygasła, a okres karencji minął. Za ${d === 1 ? 'jeden dzień' : `${d} dni`} przestaniemy przyjmować dane z urządzeń — mapa na żywo zamilknie, nie powstaną nowe trasy, alerty ani raporty. Odnowienie przed tym terminem niczego nie zmienia w usłudze.`,
    introStopped:
      'Przestaliśmy przyjmować dane z urządzeń. Odnowienie przywraca je w ciągu minuty — te same urządzenia, te same ustawienia, nic nie trzeba konfigurować od nowa.',
    keeps: 'Nic nie zostało usunięte. Historia, trasy, raporty i ustawienia są na miejscu — można się zalogować i wyeksportować je w każdej chwili.',
    button: 'Odnów subskrypcję',
    fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
  },
}

export function renderLapseEmail(opts: LapseEmailOpts): { subject: string; text: string; html: string } {
  const s = LOCALES[opts.locale] ?? LOCALES['en']!
  const stopped = opts.daysLeft <= 0
  const subject = stopped ? s.subjectStopped : s.subjectWarn(opts.daysLeft)
  const heading = stopped ? s.headingStopped : s.headingWarn(opts.daysLeft)
  const intro = stopped ? s.introStopped : s.introWarn(opts.daysLeft)
  const accent = opts.branding?.primary
  const bodyHtml = [
    `<h1 style="margin:0 0 12px;font-size:21px;font-weight:700;letter-spacing:-0.01em;color:#0f172a">${escapeHtml(heading)}</h1>`,
    `<p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.6">${escapeHtml(intro)}</p>`,
    emailButton(opts.billingUrl, s.button, accent),
    emailNote(s.keeps),
    emailFallbackLink(s.fallback, opts.billingUrl, accent),
  ].join('')
  const html = renderBrandedEmail(opts.branding ?? {}, opts.tenantName && opts.tenantName.trim() !== '' ? opts.tenantName : opts.brand, { subject, bodyHtml, preheader: intro, locale: opts.locale })
  const text = [heading, '', intro, '', `${s.button}: ${opts.billingUrl}`, '', s.keeps, '', `— ${opts.brand}`].join('\n')
  return { subject, text, html }
}
