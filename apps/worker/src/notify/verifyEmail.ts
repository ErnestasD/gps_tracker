import { emailButton, emailFallbackLink, emailNote, escapeHtml, renderBrandedEmail, type Branding } from '@orbetra/shared'

/**
 * The welcome mail that ACTIVATES a self-serve signup (audit MED #67).
 *
 * Unlike the reset mail this one is not a recovery path — it is the only way the account becomes
 * usable at all, so the copy has to carry that plainly: nothing works until the button is clicked.
 * The recipient may also be someone who did NOT sign up (a stranger can type any address), so it
 * says what happens if they ignore it: the account stays inert and expires by itself.
 */
export interface VerifyEmailOpts {
  verifyUrl: string
  expiresHours: number
  locale: string
  brand: string
  branding?: Branding | undefined
  tenantName?: string | undefined
}

interface Strings {
  subject: string
  heading: string
  intro: string
  button: string
  expires: (h: number) => string
  ignore: string
  fallback: string
}

const LOCALES: Record<string, Strings> = {
  en: {
    subject: 'Confirm your email to activate your account',
    heading: 'One click to activate',
    intro: 'Welcome. Confirm this address to activate your account — until you do, it cannot be signed in to.',
    button: 'Activate my account',
    expires: (h) => `This link works once and expires in ${h} hours.`,
    ignore: "If you didn't sign up, ignore this email. The account stays inactive and is removed by itself — nobody can use it, and your address is not registered with us.",
    fallback: 'If the button does not work, copy and paste this link into your browser:',
  },
  lt: {
    subject: 'Patvirtinkite el. paštą, kad aktyvuotumėte paskyrą',
    heading: 'Vienas paspaudimas iki aktyvavimo',
    intro: 'Sveiki. Patvirtinkite šį adresą, kad aktyvuotumėte paskyrą — kol to nepadarysite, prisijungti prie jos neįmanoma.',
    button: 'Aktyvuoti paskyrą',
    expires: (h) => `Nuoroda galioja vieną kartą ir baigia galioti po ${h} val.`,
    ignore: 'Jei neregistravote paskyros, šį laišką ignoruokite. Paskyra liks neaktyvi ir bus pašalinta savaime — niekas ja pasinaudoti negalės, o jūsų adresas pas mus neužregistruotas.',
    fallback: 'Jei mygtukas neveikia, nukopijuokite šią nuorodą į naršyklę:',
  },
  de: {
    subject: 'Bestätigen Sie Ihre E-Mail, um Ihr Konto zu aktivieren',
    heading: 'Ein Klick zur Aktivierung',
    intro: 'Willkommen. Bestätigen Sie diese Adresse, um Ihr Konto zu aktivieren — bis dahin ist keine Anmeldung möglich.',
    button: 'Konto aktivieren',
    expires: (h) => `Dieser Link funktioniert einmal und läuft in ${h} Stunden ab.`,
    ignore: 'Falls Sie sich nicht registriert haben, ignorieren Sie diese E-Mail. Das Konto bleibt inaktiv und wird von selbst entfernt — niemand kann es nutzen, und Ihre Adresse ist bei uns nicht registriert.',
    fallback: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
  },
  pl: {
    subject: 'Potwierdź adres e-mail, aby aktywować konto',
    heading: 'Jedno kliknięcie do aktywacji',
    intro: 'Witamy. Proszę potwierdzić ten adres, aby aktywować konto — do tego czasu logowanie nie jest możliwe.',
    button: 'Aktywuj konto',
    expires: (h) => `Link działa jeden raz i wygasa za ${h} godz.`,
    ignore: 'Jeśli nie zakładałeś konta, zignoruj tę wiadomość. Konto pozostanie nieaktywne i zostanie samo usunięte — nikt go nie użyje, a Twój adres nie jest u nas zarejestrowany.',
    fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
  },
}

export function renderVerifyEmail(opts: VerifyEmailOpts): { subject: string; text: string; html: string } {
  const s = LOCALES[opts.locale] ?? LOCALES['en']!
  const accent = opts.branding?.primary
  const bodyHtml = [
    `<h1 style="margin:0 0 12px;font-size:21px;font-weight:700;letter-spacing:-0.01em;color:#0f172a">${escapeHtml(s.heading)}</h1>`,
    `<p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.6">${escapeHtml(s.intro)}</p>`,
    emailButton(opts.verifyUrl, s.button, accent),
    emailNote(s.expires(opts.expiresHours)),
    emailNote(s.ignore),
    emailFallbackLink(s.fallback, opts.verifyUrl, accent),
  ].join('')
  const html = renderBrandedEmail(opts.branding ?? {}, opts.tenantName && opts.tenantName.trim() !== '' ? opts.tenantName : opts.brand, { subject: s.subject, bodyHtml, preheader: s.intro, locale: opts.locale })
  const text = [s.heading, '', s.intro, '', `${s.button}: ${opts.verifyUrl}`, '', s.expires(opts.expiresHours), s.ignore, '', `— ${opts.brand}`].join('\n')
  return { subject: s.subject, text, html }
}
