import type { Branding } from './entities.js'

/**
 * Branded email layout (E03-5, moved to @orbetra/shared in E05-4 so the WORKER — which owns the
 * whole outbound send path — can import it; apps/api cannot be imported by the worker). Wraps a
 * message body in the tenant's product name, logo, and accent color. All tenant-controlled strings
 * are HTML-escaped; logoUrl is validated https at write time (brandingSchema). Snapshot-tested in
 * apps/api (the render output is byte-stable — do not change it without re-snapshotting).
 */

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

// Defense in depth: brandingSchema already pins #rrggbb at write time, but a color
// goes into unescaped style/attribute contexts below. Re-validate at render so a
// future writer that bypasses the schema can never inject CSS/HTML here.
const HEX = /^#[0-9a-fA-F]{6}$/
const safeColor = (c: string | undefined): string => (c !== undefined && HEX.test(c) ? c : '#4DA3FF')

export interface EmailContent {
  subject: string
  /** Pre-built, trusted HTML body (caller-owned templates, not tenant input). */
  bodyHtml: string
}

export function renderBrandedEmail(branding: Branding, tenantName: string, content: EmailContent): string {
  const product = escapeHtml(branding.productName ?? tenantName)
  const accent = safeColor(branding.primary)
  const logo = branding.logoUrl // brandingSchema guarantees https URL or undefined
  const supportEmail = branding.supportEmail
  const header = logo !== undefined
    ? `<img src="${escapeHtml(logo)}" alt="${product}" height="32" style="height:32px" />`
    : `<span style="font-size:18px;font-weight:600;color:${accent}">${product}</span>`
  const footer = supportEmail !== undefined
    ? `<p style="color:#93a1b7;font-size:12px">${product} · <a href="mailto:${escapeHtml(supportEmail)}" style="color:${accent}">${escapeHtml(supportEmail)}</a></p>`
    : `<p style="color:#93a1b7;font-size:12px">${product}</p>`
  return [
    '<!doctype html><html><body style="margin:0;background:#f7f9fc;font-family:Inter,Arial,sans-serif">',
    '<div style="max-width:560px;margin:0 auto;padding:24px">',
    `<div style="border-top:3px solid ${accent};background:#fff;border-radius:10px;padding:24px">`,
    `<div style="padding-bottom:16px">${header}</div>`,
    content.bodyHtml,
    footer,
    '</div></div></body></html>',
  ].join('')
}
