import { escapeHtml, renderBrandedEmail, type Branding } from '@orbetra/shared'

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
  subject: string
  heading: string
  intro: string
  button: string
  forgot: string
  ignore: string
  fallback: string
}

const LOCALES: Record<string, Strings> = {
  en: {
    subject: 'You already have an account',
    heading: 'You already have an account',
    intro: 'Someone just tried to create an account with this email address. One already exists, so nothing was changed — sign in instead.',
    button: 'Sign in',
    forgot: 'Forgot your password? Reset it here:',
    ignore: "If this wasn't you, you can ignore this email. Nobody gained access to your account, and nothing about it was revealed.",
    fallback: 'If the button does not work, copy and paste this link into your browser:',
  },
  lt: {
    subject: 'Paskyra su šiuo el. paštu jau yra',
    heading: 'Paskyra su šiuo el. paštu jau yra',
    intro: 'Kažkas ką tik bandė sukurti paskyrą su šiuo el. pašto adresu. Tokia paskyra jau egzistuoja, tad niekas nepasikeitė — tiesiog prisijunkite.',
    button: 'Prisijungti',
    forgot: 'Pamiršote slaptažodį? Atstatykite jį čia:',
    ignore: 'Jei tai buvote ne jūs, šį laišką galite ignoruoti. Niekas negavo prieigos prie jūsų paskyros ir nieko apie ją nesužinojo.',
    fallback: 'Jei mygtukas neveikia, nukopijuokite šią nuorodą į naršyklę:',
  },
  de: {
    subject: 'Sie haben bereits ein Konto',
    heading: 'Sie haben bereits ein Konto',
    intro: 'Jemand hat gerade versucht, mit dieser E-Mail-Adresse ein Konto zu erstellen. Es existiert bereits eines, es wurde nichts geändert — melden Sie sich stattdessen an.',
    button: 'Anmelden',
    forgot: 'Passwort vergessen? Hier zurücksetzen:',
    ignore: 'Waren Sie das nicht, können Sie diese E-Mail ignorieren. Niemand hat Zugriff auf Ihr Konto erhalten, und es wurde nichts darüber preisgegeben.',
    fallback: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
  },
  pl: {
    subject: 'Masz już konto',
    heading: 'Masz już konto',
    intro: 'Ktoś właśnie próbował założyć konto z tym adresem e-mail. Konto już istnieje, więc nic nie zostało zmienione — po prostu się zaloguj.',
    button: 'Zaloguj się',
    forgot: 'Nie pamiętasz hasła? Zresetuj je tutaj:',
    ignore: 'Jeśli to nie byłeś Ty, zignoruj tę wiadomość. Nikt nie uzyskał dostępu do Twojego konta ani niczego się o nim nie dowiedział.',
    fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
  },
}

export function renderSignupExistsEmail(opts: SignupExistsEmailOpts): { subject: string; text: string; html: string } {
  const s = LOCALES[opts.locale] ?? LOCALES['en']!
  const login = escapeHtml(opts.loginUrl)
  const reset = escapeHtml(opts.resetUrl)
  const accent = opts.branding?.primary && /^#[0-9a-fA-F]{6}$/.test(opts.branding.primary) ? opts.branding.primary : '#4DA3FF'
  const bodyHtml = [
    `<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${escapeHtml(s.heading)}</h1>`,
    `<p style="margin:0 0 20px;color:#334155;font-size:14px;line-height:1.5">${escapeHtml(s.intro)}</p>`,
    `<p style="margin:0 0 20px"><a href="${login}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(s.button)}</a></p>`,
    `<p style="margin:0 0 4px;color:#64748b;font-size:12px">${escapeHtml(s.forgot)}</p>`,
    `<p style="margin:0 0 16px;word-break:break-all"><a href="${reset}" style="color:${accent};font-size:12px">${reset}</a></p>`,
    `<p style="margin:0 0 16px;color:#64748b;font-size:12px">${escapeHtml(s.ignore)}</p>`,
    `<p style="margin:0 0 4px;color:#94a3b8;font-size:12px">${escapeHtml(s.fallback)}</p>`,
    `<p style="margin:0 0 16px;word-break:break-all"><a href="${login}" style="color:${accent};font-size:12px">${login}</a></p>`,
  ].join('')
  const html = renderBrandedEmail(opts.branding ?? {}, opts.tenantName && opts.tenantName.trim() !== '' ? opts.tenantName : opts.brand, { subject: s.subject, bodyHtml })
  const text = [s.heading, '', s.intro, '', `${s.button}: ${opts.loginUrl}`, '', `${s.forgot} ${opts.resetUrl}`, '', s.ignore, '', `— ${opts.brand}`].join('\n')
  return { subject: s.subject, text, html }
}
