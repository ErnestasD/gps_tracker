import { escapeHtml, renderBrandedEmail, type Branding } from '@orbetra/shared'

/**
 * Password-reset email template (ADR-031). Renders a tenant-branded HTML message + a plain-text
 * fallback, localized to the recipient's app language (en|lt|de|pl → en fallback). The reset link
 * is caller-built and trusted; it is the ONLY place the raw token appears. All tenant-controlled
 * strings (brand/product name) are escaped by renderBrandedEmail; `resetUrl` is escaped here before
 * it enters href/text contexts.
 */
export interface ResetEmailOpts {
  resetUrl: string
  expiresMinutes: number
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
  expires: (min: number) => string
  ignore: string
  fallback: string
}

const LOCALES: Record<string, Strings> = {
  en: {
    subject: 'Reset your password',
    heading: 'Reset your password',
    intro: 'We received a request to reset the password for your account. Click the button below to choose a new one.',
    button: 'Reset password',
    expires: (m) => `This link expires in ${m} minutes and can be used once.`,
    ignore: "If you didn't request this, you can safely ignore this email — your password stays unchanged.",
    fallback: 'If the button does not work, copy and paste this link into your browser:',
  },
  lt: {
    subject: 'Atstatykite slaptažodį',
    heading: 'Atstatykite slaptažodį',
    intro: 'Gavome prašymą atstatyti jūsų paskyros slaptažodį. Spustelėkite mygtuką žemiau ir pasirinkite naują.',
    button: 'Atstatyti slaptažodį',
    expires: (m) => `Ši nuoroda galioja ${m} min. ir gali būti panaudota vieną kartą.`,
    ignore: 'Jei to neprašėte, šį laišką galite ignoruoti — slaptažodis nepasikeis.',
    fallback: 'Jei mygtukas neveikia, nukopijuokite šią nuorodą į naršyklę:',
  },
  de: {
    subject: 'Passwort zurücksetzen',
    heading: 'Passwort zurücksetzen',
    intro: 'Wir haben eine Anfrage zum Zurücksetzen des Passworts für Ihr Konto erhalten. Klicken Sie unten, um ein neues zu wählen.',
    button: 'Passwort zurücksetzen',
    expires: (m) => `Dieser Link läuft in ${m} Minuten ab und kann einmal verwendet werden.`,
    ignore: 'Falls Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren — Ihr Passwort bleibt unverändert.',
    fallback: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
  },
  pl: {
    subject: 'Zresetuj hasło',
    heading: 'Zresetuj hasło',
    intro: 'Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Kliknij przycisk poniżej, aby wybrać nowe.',
    button: 'Zresetuj hasło',
    expires: (m) => `Ten link wygasa za ${m} min i można go użyć jeden raz.`,
    ignore: 'Jeśli nie prosiłeś o to, zignoruj tę wiadomość — Twoje hasło pozostanie bez zmian.',
    fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
  },
}

export function renderResetEmail(opts: ResetEmailOpts): { subject: string; text: string; html: string } {
  const s = LOCALES[opts.locale] ?? LOCALES['en']!
  const url = escapeHtml(opts.resetUrl)
  const accent = opts.branding?.primary && /^#[0-9a-fA-F]{6}$/.test(opts.branding.primary) ? opts.branding.primary : '#4DA3FF'
  const bodyHtml = [
    `<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${escapeHtml(s.heading)}</h1>`,
    `<p style="margin:0 0 20px;color:#334155;font-size:14px;line-height:1.5">${escapeHtml(s.intro)}</p>`,
    `<p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(s.button)}</a></p>`,
    `<p style="margin:0 0 8px;color:#64748b;font-size:12px">${escapeHtml(s.expires(opts.expiresMinutes))}</p>`,
    `<p style="margin:0 0 16px;color:#64748b;font-size:12px">${escapeHtml(s.ignore)}</p>`,
    `<p style="margin:0 0 4px;color:#94a3b8;font-size:12px">${escapeHtml(s.fallback)}</p>`,
    `<p style="margin:0 0 16px;word-break:break-all"><a href="${url}" style="color:${accent};font-size:12px">${url}</a></p>`,
  ].join('')
  const html = renderBrandedEmail(opts.branding ?? {}, opts.tenantName && opts.tenantName.trim() !== '' ? opts.tenantName : opts.brand, { subject: s.subject, bodyHtml })
  const text = [
    s.heading,
    '',
    s.intro,
    '',
    `${s.button}: ${opts.resetUrl}`,
    '',
    s.expires(opts.expiresMinutes),
    s.ignore,
    '',
    `— ${opts.brand}`,
  ].join('\n')
  return { subject: s.subject, text, html }
}
