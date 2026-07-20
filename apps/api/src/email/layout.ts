/**
 * Branded email layout (E03-5). MOVED to @orbetra/shared in E05-4 so the worker (which owns the
 * outbound send path) can import the same renderer. This module re-exports it for API callers and
 * to keep the E03-5 AC[3] snapshot test (apps/api/__tests__/email.spec.ts) green — the render
 * output is unchanged. New code should import from '@orbetra/shared' directly.
 */
export { renderBrandedEmail, escapeHtml } from '@orbetra/shared'
export type { EmailContent } from '@orbetra/shared'
