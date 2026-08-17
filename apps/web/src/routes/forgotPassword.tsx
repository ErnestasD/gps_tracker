import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthShell } from '@/components/AuthShell'
import { requestPasswordReset } from '@/lib/auth'
import { ApiError } from '@/lib/http'

/**
 * Forgot password — step 1 (ADR-031). Emails a reset link. The server never reveals whether the
 * address exists (no enumeration), so on success we ALWAYS show the same neutral confirmation
 * regardless of whether an account matched. Only a 429 (rate-limited) surfaces as an error.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // read the input, not the state — Chrome autofill fills the DOM without events React
    // sees, and submitting state made the button act on an email that "wasn't there"
    const emailValue = ((e.currentTarget.elements.namedItem('email') as HTMLInputElement | null)?.value ?? email).trim()
    setEmail(emailValue)
    setBusy(true)
    setError(null)
    requestPasswordReset(emailValue)
      .then(() => setSent(true))
      .catch((err: unknown) => setError(t(err instanceof ApiError && err.status === 429 ? 'login.tooManyAttempts' : 'forgot.error')))
      .finally(() => setBusy(false))
  }

  return (
    <AuthShell label={t('forgot.label')} title={t('forgot.title')}>
      {sent ? (
        <div className="space-y-4 text-center" data-testid="forgot-sent">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('forgot.sent', { email: email.trim() })}</p>
          <Link to="/login" className="inline-block text-sm underline-offset-2 hover:underline" style={{ color: 'var(--accent)' }} data-testid="forgot-back">
            {t('forgot.backToLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('forgot.intro')}</p>
          <div className="space-y-1.5">
            <label htmlFor="email" className="auth-field">
              {t('login.emailLabel')}
            </label>
            <input
              className="auth-input"
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="forgot-email"
            />
          </div>
          {error !== null && (
            <p role="alert" data-testid="forgot-error" className="text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={busy} data-testid="forgot-submit">
            {t('forgot.submit')}
          </button>
          <p className="text-center text-xs">
            <Link to="/login" className="text-muted underline-offset-2 hover:text-text hover:underline" data-testid="forgot-back">
              {t('forgot.backToLogin')}
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}
