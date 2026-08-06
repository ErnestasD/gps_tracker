import type { Branding } from './entities.js'

/**
 * Branded transactional email layout (E03-5; moved here in E05-4 so the WORKER — which owns the
 * whole outbound send path — can import it, since apps/api cannot).
 *
 * WHY IT LOOKS THE WAY IT DOES. Mail clients are not browsers: no external CSS, no web fonts, no
 * flexbox in Outlook, images blocked by default in most of them, and Gmail/Apple Mail may invert
 * colours in dark mode. So this is deliberately not the app's dark UI in an inbox — a dark-background
 * email is the single most reliable way to look like spam and to break in Outlook. It is a light,
 * table-based, 600 px card in the product's palette, which is what every transactional mail people
 * trust looks like.
 *
 * The rules encoded here, each for a concrete reason:
 *  - TABLES with `role="presentation"`, not divs — Outlook (Word engine) ignores max-width on divs.
 *  - Inline styles only — every client strips <style> from at least some contexts.
 *  - The BUTTON is a table cell with padding, not a padded <a> — Outlook drops padding on inline
 *    elements, which would leave a bare blue word where the call to action should be.
 *  - A PREHEADER: the hidden first line the inbox shows next to the subject. Left empty, clients
 *    scrape the first visible text, which is the logo alt or "View in browser" — the difference
 *    between a mail that reads as ours and one that reads as machine spam.
 *  - `color-scheme` + `supported-color-schemes` so dark-mode clients tint rather than invert, which
 *    is what turns hand-picked greys into unreadable mud.
 *  - No web fonts, no background images, no `!important` — all of them are spam-filter signals.
 *
 * Every tenant-controlled string is HTML-escaped; `logoUrl` is validated https at write time
 * (brandingSchema) and re-validated here. Snapshot-tested in apps/api — the output is byte-stable,
 * so a deliberate design change means re-snapshotting, and an accidental one fails the build.
 */

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

// Defense in depth: brandingSchema already pins #rrggbb at write time, but a colour goes into
// unescaped style/attribute contexts below. Re-validate at render so a future writer that bypasses
// the schema can never inject CSS/HTML here.
const HEX = /^#[0-9a-fA-F]{6}$/
/** The product accent — the same `--accent` the app uses, so a mail and the dashboard it links to
 *  are recognisably one product. */
const DEFAULT_ACCENT = '#5253DA'
const safeColor = (c: string | undefined): string => (c !== undefined && HEX.test(c) ? c : DEFAULT_ACCENT)

/** Light-mode palette, derived from the app's tokens but inverted for the inbox — see the note above. */
const INK = '#0f172a'
const INK_SOFT = '#475569'
const INK_FAINT = '#94a3b8'
const HAIRLINE = '#e2e8f0'
const CANVAS = '#f1f5f9'

export interface EmailContent {
  subject: string
  /** Pre-built, trusted HTML body (caller-owned templates, not tenant input). */
  bodyHtml: string
  /**
   * The one-line summary the inbox shows beside the subject. Plain text, ~90 chars.
   * Omitted ⇒ the client scrapes the first visible text, which is never what you want.
   */
  preheader?: string | undefined
}

/**
 * A call-to-action button that survives Outlook.
 *
 * Exported so every template renders the SAME button: three templates hand-rolling an anchor is how
 * a product ends up with three different buttons in three different emails, and the one in the
 * activation mail — the only thing standing between a new customer and a usable account — is the one
 * that must never be a bare link.
 */
export function emailButton(href: string, label: string, accent?: string): string {
  const url = escapeHtml(href)
  const bg = safeColor(accent)
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">',
    '<tr>',
    `<td align="center" bgcolor="${bg}" style="border-radius:10px">`,
    `<a href="${url}" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(label)}</a>`,
    '</td>',
    '</tr>',
    '</table>',
  ].join('')
}

/** A muted paragraph — the small print under a button. */
export function emailNote(text: string): string {
  return `<p style="margin:0 0 10px;color:${INK_SOFT};font-size:13px;line-height:1.6">${escapeHtml(text)}</p>`
}

/** The link repeated as text, for clients that strip the button or people who paste it. */
export function emailFallbackLink(intro: string, href: string, accent?: string): string {
  const url = escapeHtml(href)
  return [
    `<p style="margin:20px 0 4px;color:${INK_FAINT};font-size:12px;line-height:1.5">${escapeHtml(intro)}</p>`,
    `<p style="margin:0;word-break:break-all"><a href="${url}" style="color:${safeColor(accent)};font-size:12px">${url}</a></p>`,
  ].join('')
}

export function renderBrandedEmail(branding: Branding, tenantName: string, content: EmailContent): string {
  const product = escapeHtml(branding.productName ?? tenantName)
  const accent = safeColor(branding.primary)
  const logo = branding.logoUrl // brandingSchema guarantees https URL or undefined
  const supportEmail = branding.supportEmail
  // A white-label tenant's logo when it has one; otherwise the product name set in the accent — NOT
  // an <img> of ours. Most clients block remote images by default, so a logo-only header renders as
  // an empty box on first open, on the one line that has to say who this is from.
  const header =
    logo !== undefined
      ? `<img src="${escapeHtml(logo)}" alt="${product}" height="28" style="height:28px;display:block;border:0" />`
      : `<span style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${accent}">${product}</span>`
  const support =
    supportEmail !== undefined
      ? ` · <a href="mailto:${escapeHtml(supportEmail)}" style="color:${INK_FAINT};text-decoration:underline">${escapeHtml(supportEmail)}</a>`
      : ''
  // Hidden, but present: the preview line, then enough zero-width space that the client does not
  // continue scraping the visible body into the preview (the standard trick, and the reason a good
  // transactional mail's inbox row reads as a sentence rather than as markup).
  const preheader =
    content.preheader !== undefined && content.preheader !== ''
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${escapeHtml(content.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>`
      : ''

  return [
    '<!doctype html>',
    '<html lang="en" style="color-scheme:light;supported-color-schemes:light">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    '<meta name="color-scheme" content="light" />',
    '<meta name="supported-color-schemes" content="light" />',
    `<title>${escapeHtml(content.subject)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased">`,
    preheader,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS}">`,
    '<tr>',
    '<td align="center" style="padding:32px 16px">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">',
    // header band — brand only, no navigation, no images to block
    `<tr><td style="padding:0 0 20px">${header}</td></tr>`,
    // the card
    '<tr><td>',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${HAIRLINE};border-radius:14px">`,
    `<tr><td style="height:4px;background:${accent};border-radius:14px 14px 0 0;line-height:4px;font-size:0">&nbsp;</td></tr>`,
    `<tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:${INK};font-size:15px;line-height:1.6">`,
    content.bodyHtml,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    // footer — who sent this and why, which is what a transactional mail owes the reader
    `<tr><td style="padding:20px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:${INK_FAINT};font-size:12px;line-height:1.6">`,
    `<p style="margin:0 0 4px">${product}${support}</p>`,
    '<p style="margin:0">You received this because someone used this address on our service. It is a one-off message about your account, not marketing.</p>',
    '</td></tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body></html>',
  ].join('')
}
