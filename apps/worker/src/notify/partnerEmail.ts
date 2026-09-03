import { emailButton, emailFallbackLink, emailHeading, emailNote, emailText, renderBrandedEmail } from '@orbetra/shared'

/**
 * The mail a partner gets when something happens on their referral link.
 *
 * A partner used to receive NOTHING — not one message, ever. They were handed a link and had to log
 * in on a hunch to discover whether it had worked. The two events here are the ones that make
 * someone refer a second time: a name appeared, and money was earned.
 *
 * ALWAYS PLATFORM-BRANDED, deliberately, and this is the one place in the mail path where that is
 * true. Every other transactional mail resolves the recipient's tenant branding, because the
 * recipient is a reseller's end customer who must never see our name. A partner is OUR partner: the
 * agreement is with us, the money comes from us, and branding this mail with a tenant's white label
 * would both misattribute the sender and leak that tenant's identity to a third party.
 *
 * The referred CUSTOMER'S NAME is in the body. That is the same boundary the portal draws: the
 * company name is the basis of the money owed, so the partner is entitled to it — nothing else about
 * that tenant travels in this mail.
 */
export type PartnerEmailKind = 'referral' | 'commission' | 'payout-request'

export interface PartnerEmailOpts {
  kind: PartnerEmailKind
  /** the referred company, as it will appear in the partner's portal */
  customer: string
  /** commission mails only: the amount earned, already formatted with its currency */
  amount?: string | undefined
  /** where the portal lives, for the button */
  portalUrl: string
  locale: string
}

interface Strings {
  referralSubject: (customer: string) => string
  referralHeading: string
  referralIntro: (customer: string) => string
  referralNote: string
  commissionSubject: (amount: string) => string
  commissionHeading: string
  commissionIntro: (customer: string, amount: string) => string
  commissionNote: string
  button: string
  fallback: string
}

const LOCALES: Record<string, Strings> = {
  en: {
    referralSubject: (c) => `${c} signed up through your link`,
    referralHeading: 'A new sign-up',
    referralIntro: (c) => `${c} created an account through your referral link. Nothing is owed yet — commission starts when they pay their first invoice.`,
    referralNote: 'Their trial has to convert first. You will get another message the moment it does.',
    commissionSubject: (a) => `You earned ${a}`,
    commissionHeading: 'Commission earned',
    commissionIntro: (c, a) => `${c} paid an invoice, so ${a} has been added to your balance.`,
    commissionNote: 'It shows as awaiting payout until we transfer it. The portal shows what it was calculated from.',
    button: 'Open your partner dashboard',
    fallback: 'If the button does not work, copy and paste this link into your browser:',
  },
  lt: {
    referralSubject: (c) => `${c} užsiregistravo per jūsų nuorodą`,
    referralHeading: 'Nauja registracija',
    referralIntro: (c) => `${c} susikūrė paskyrą per jūsų rekomendacijos nuorodą. Kol kas nieko nepriklauso — komisiniai prasideda nuo pirmo jų mokėjimo.`,
    referralNote: 'Pirmiausia turi baigtis bandomasis laikotarpis. Kai tik jie sumokės, atsiųsime dar vieną žinutę.',
    commissionSubject: (a) => `Uždirbote ${a}`,
    commissionHeading: 'Priskaičiuoti komisiniai',
    commissionIntro: (c, a) => `${c} apmokėjo sąskaitą, tad prie jūsų balanso pridėta ${a}.`,
    commissionNote: 'Kol nepervedėme, rodoma kaip laukianti išmokėjimo. Skydelyje matysite, nuo ko tai skaičiuota.',
    button: 'Atidaryti partnerio skydelį',
    fallback: 'Jei mygtukas neveikia, nukopijuokite šią nuorodą į naršyklę:',
  },
  de: {
    referralSubject: (c) => `${c} hat sich über Ihren Link registriert`,
    referralHeading: 'Neue Registrierung',
    referralIntro: (c) => `${c} hat über Ihren Empfehlungslink ein Konto angelegt. Noch ist nichts fällig — die Provision beginnt mit der ersten bezahlten Rechnung.`,
    referralNote: 'Zuerst muss die Testphase übergehen. Sobald das passiert, melden wir uns erneut.',
    commissionSubject: (a) => `Sie haben ${a} verdient`,
    commissionHeading: 'Provision gutgeschrieben',
    commissionIntro: (c, a) => `${c} hat eine Rechnung bezahlt, daher wurden ${a} Ihrem Guthaben gutgeschrieben.`,
    commissionNote: 'Bis zur Überweisung steht sie als offen. Im Portal sehen Sie, worauf sie berechnet wurde.',
    button: 'Partner-Dashboard öffnen',
    fallback: 'Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
  },
  pl: {
    referralSubject: (c) => `${c} zarejestrował się z Twojego linku`,
    referralHeading: 'Nowa rejestracja',
    referralIntro: (c) => `${c} założył konto z Twojego linku polecającego. Na razie nic się nie należy — prowizja zaczyna się od pierwszej opłaconej faktury.`,
    referralNote: 'Najpierw musi skończyć się okres próbny. Gdy tylko zapłacą, wyślemy kolejną wiadomość.',
    commissionSubject: (a) => `Zarobiono ${a}`,
    commissionHeading: 'Naliczona prowizja',
    commissionIntro: (c, a) => `${c} opłacił fakturę, więc do Twojego salda dodano ${a}.`,
    commissionNote: 'Do czasu przelewu widnieje jako oczekująca. W portalu zobaczysz, od czego ją naliczono.',
    button: 'Otwórz panel partnera',
    fallback: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
  },
}

export function renderPartnerEmail(opts: PartnerEmailOpts): { subject: string; text: string; html: string } {
  const s = LOCALES[opts.locale] ?? LOCALES['en']!
  /**
   * The ONE message here whose recipient is not the partner: a payout request goes to us.
   *
   * Not localised, because the reader is our own ops desk and not a partner — and deliberately
   * plain: everything needed to act on it is in the subject line, so it can be triaged from a phone
   * without opening anything.
   */
  if (opts.kind === 'payout-request') {
    const who = opts.customer // "Partner Name (CODE)" — assembled by the caller
    const amount = opts.amount ?? '0.00'
    const subject = `Payout requested: ${who} — ${amount}`
    const intro = `${who} has asked to be paid. Outstanding balance at the time of the request: ${amount}.`
    const note = 'Open Admin → Affiliates to review the lines and mark them paid once the transfer is out.'
    const bodyHtml = [
      emailHeading('Payout requested'),
      emailText(intro),
      emailNote(note),
    ].join('')
    return {
      subject,
      text: [subject, '', intro, '', note].join('\n'),
      html: renderBrandedEmail({}, 'Orbetra', { subject, bodyHtml, preheader: intro, locale: 'en' }),
    }
  }
  const isCommission = opts.kind === 'commission'
  // a commission mail with no amount is a bug upstream, but rendering "You earned undefined" is a
  // worse outcome than degrading to the referral wording
  const amount = opts.amount ?? ''
  const subject = isCommission && amount !== '' ? s.commissionSubject(amount) : s.referralSubject(opts.customer)
  const heading = isCommission && amount !== '' ? s.commissionHeading : s.referralHeading
  const intro = isCommission && amount !== '' ? s.commissionIntro(opts.customer, amount) : s.referralIntro(opts.customer)
  const note = isCommission && amount !== '' ? s.commissionNote : s.referralNote

  const bodyHtml = [
    emailHeading(heading),
    emailText(intro),
    emailButton(opts.portalUrl, s.button),
    emailNote(note),
    emailFallbackLink(s.fallback, opts.portalUrl),
  ].join('')
  // EMPTY branding + the platform name: renderBrandedEmail treats "no branding fields" as "this is
  // ours", which is exactly right here and is the one mail where we WANT that branch unconditionally
  const html = renderBrandedEmail({}, 'Orbetra', { subject, bodyHtml, preheader: intro, locale: opts.locale })
  const text = [heading, '', intro, '', `${s.button}: ${opts.portalUrl}`, '', note, '', '— Orbetra'].join('\n')
  return { subject, text, html }
}
