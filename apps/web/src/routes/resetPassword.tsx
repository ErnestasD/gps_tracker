import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthShell } from '@/components/AuthShell'
import { resetPassword } from '@/lib/auth'
import { ApiError } from '@/lib/http'

const MIN_PW = 8

/**
 * Reset password — step 2 (ADR-031). Redeems the emailed `?token=` and sets a new password. The
 * token is single-use + short-lived server-side; an invalid/expired one comes back 400 and we point
 * the user back to request a fresh link. On success every session is revoked server-side, so we
 * simply send them to /login to sign in with the new password.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token } = useSearch({ from: '/reset-password' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PW) return setError(t('reset.tooShort', { min: MIN_PW }))
    if (password !== confirm) return setError(t('reset.mismatch'))
    setBusy(true)
    setError(null)
    resetPassword(token ?? '', password)
      .then(() => setDone(true))
      .catch((err: unknown) => setError(t(err instanceof ApiError && err.status === 400 ? 'reset.invalidToken' : 'forgot.error')))
      .finally(() => setBusy(false))
  }

  return (
    <AuthShell label={t('reset.label')} title={t('reset.title')}>
      {done ? (
        <div className="space-y-4 text-center" data-testid="reset-done">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('reset.done')}</p>
          <button className="auth-submit" onClick={() => void navigate({ to: '/login' })} data-testid="reset-to-login">
            {t('reset.toLogin')}
          </button>
        </div>
      ) : token === undefined || token === '' ? (
        <div className="space-y-4 text-center" data-testid="reset-no-token">
          <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{t('reset.invalidToken')}</p>
          <Link to="/forgot-password" className="inline-block text-sm underline-offset-2 hover:underline" style={{ color: 'var(--accent)' }} data-testid="reset-request-new">
            {t('reset.requestNew')}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="password" className="auth-field">
              {t('reset.newPassword')}
            </label>
            <input
              className="auth-input"
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="reset-password"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirm" className="auth-field">
              {t('reset.confirmPassword')}
            </label>
            <input
              className="auth-input"
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              data-testid="reset-confirm"
            />
          </div>
          {error !== null && (
            <p role="alert" data-testid="reset-error" className="text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={busy || password === '' || confirm === ''} data-testid="reset-submit">
            {t('reset.submit')}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
