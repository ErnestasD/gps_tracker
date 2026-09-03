import { emailButton, emailFallbackLink, emailHeading, emailNote, emailText, renderBrandedEmail, type Branding } from '@orbetra/shared'

/**
 * "Someone tried to sign up with your address" (audit MED #67).
 *
 * Public signup used to answer a duplicate email with `409 email_in_use` — a platform-wide,
 * unauthenticated account-existence oracle in a status code, in a codebase that burns a dummy argon2
 * verify on login and fabricates a DB write on forgot-password specifically so neither reveals
 * whether an address exists. Signup now returns the SAME 201 either way, and the truth is delivered
 * out of band, to the one person entitled to it: the address's actual owner.
 *
 * So this mail carries information the recipient already has (that they have an account) and nothing
 * else — no attacker-supplied name, company or referral code, because the recipient cannot tell
 * whether the attempt was a stranger or their own forgotten signup, and quoting the attempt back
 * would make the message a free text channel into their inbox.
 */
export interface SignupExistsEmailOpts {
  loginUrl: string
  resetUrl: string
  locale: string
  brand: string
  branding?: Branding | undefined
  tenantName?: string | undefined
}

interface Strings {
  /** takes the tenant's BRAND — `authEmailWorker` resolves it, and a TSP's end user must never
   *  receive a mail naming their supplier. The subject is the one line branding cannot cover up. */
  subject: (brand: string) => string
  heading: string
  intro: string
  button: string
  forgot: string
  ignore: string
  fallback: string
}

const LOCALES: Record<string, Strings> = {
  en: {
    subject: (brand: string) => `Your ${brand} account already exists`,
    heading: 'This address already has an account',
    intro: 'Someone just filled in the sign-up form with this address — possibly you. There is already an account on it, so we did not create a second one and nothing about the existing account changed. Sign in with the password you already use.',
    button: 'Sign in',
    forgot: "Don't remember the password? Set a new one here:",
    ignore: 'If it was not you, there is nothing to do. Nobody got into your account, and whoever filled in that form was not told whether an account exists.',
    fallback: 'If the button does not work, copy and paste this link into your browser:',
  },
  lt: {
    subject: (brand: string) => `Su šiuo adresu ${brand} paskyra jau yra`,
    heading: 'Su šiuo adresu paskyra jau sukurta',
    intro: 'Kažkas ką tik užpildė registracijos formą su šiuo adresu — galbūt jūs. Paskyra su juo jau yra, tad antros nekūrėme ir esamoje niekas nepasikeitė. Tiesiog prisijunkite su turimu slaptažodžiu.',
    button: 'Prisijungti',
    forgot: 'Nepamenate slaptažodžio? Susikurkite naują čia:',
    ignore: 'Jei tai buvote ne jūs, daryti nieko nereikia. Niekas į jūsų paskyrą nepateko, o formą užpildžiusiam žmogui nebuvo pasakyta, ar tokia paskyra egzistuoja.',
    fallback: 'Jei mygtukas neveikia, nukopijuokite šią nuorodą į naršyklę:',
  },
  de: {
    subject: (brand: string) => `Für diese Adresse besteht bereits ein ${brand}-Konto`,
    heading: 'Für diese Adresse besteht bereits ein Konto',
    intro: 'Soeben wurde das Registrierungsformular mit dieser Adresse ausgefüllt — möglicherweise von Ihnen. Es besteht bereits ein Konto dafür, wir haben also kein zweites angelegt und am bestehenden nichts geändert. Melden Sie sich einfach mit Ihrem bisherigen Passwort an.',
    button: 'Anmelden',
    forgot: 'Passwort nicht zur Hand? Hier ein neues setzen:',
    ignore: 'Waren Sie das nicht, ist nichts zu tun. Niemand hat Zugriff auf Ihr Konto erhalten, und wer das Formular ausgefüllt hat, hat nicht erfahren, ob ein Konto existiert.',
    fallback: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
  },
  pl: {
    subject: (brand: string) => `Dla tego adresu istnieje już konto ${brand}`,
    heading: 'Dla tego adresu istnieje już konto',
    intro: 'Ktoś właśnie wypełnił formularz rejestracji tym adresem — być może Ty. Konto dla niego już istnieje, więc nie założyliśmy drugiego i nic w istniejącym się nie zmieniło. Po prostu zaloguj się dotychczasowym hasłem.',
    button: 'Zaloguj się',
    forgot: 'Nie pamiętasz hasła? Ustaw nowe tutaj:',
    ignore: 'Jeśli to nie byłeś Ty, nie musisz nic robić. Nikt nie dostał się do Twojego konta, a osoba wypełniająca formularz nie dowiedziała się, czy konto istnieje.',
    fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
  },
}

export function renderSignupExistsEmail(opts: SignupExistsEmailOpts): { subject: string; text: string; html: string } {
  const s = LOCALES[opts.locale] ?? LOCALES['en']!
  const subject = s.subject(opts.brand)
  const accent = opts.branding?.primary
  const bodyHtml = [
    emailHeading(s.heading),
    emailText(s.intro),
    emailButton(opts.loginUrl, s.button, accent),
    emailFallbackLink(s.forgot, opts.resetUrl, accent),
    emailNote(s.ignore),
    emailFallbackLink(s.fallback, opts.loginUrl, accent),
  ].join('')
  const html = renderBrandedEmail(opts.branding ?? {}, opts.tenantName && opts.tenantName.trim() !== '' ? opts.tenantName : opts.brand, { subject, bodyHtml, preheader: s.intro, locale: opts.locale })
  const text = [s.heading, '', s.intro, '', `${s.button}: ${opts.loginUrl}`, '', `${s.forgot} ${opts.resetUrl}`, '', s.ignore, '', `— ${opts.brand}`].join('\n')
  return { subject, text, html }
}
