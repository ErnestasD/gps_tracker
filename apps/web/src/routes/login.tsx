import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthField, AuthShell } from '@/components/AuthShell'
import { getLastPositions } from '@/lib/api'
import { login } from '@/lib/auth'
import { ApiError } from '@/lib/http'
import { liveStore } from '@/lib/liveStore'

/**
 * Login (E03-1, spec §4 Auth screens): email + password against POST /v1/auth/login.
 * Tenant branding by Host arrives with E03-5; self-service password reset (ADR-031) is
 * reached via the "forgot password" link below the form (→ /forgot-password).
 */
export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const search = useSearch({ from: '/login' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const errorKey = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.status === 401) return 'login.invalidCredentials'
      if (err.status === 429) return 'login.tooManyAttempts'
      if (err.status === 409) return 'login.ambiguousIdentity'
      if (err.status >= 500) return 'login.serverError' // API reached but erroring — not a connectivity problem
    }
    return 'login.networkError' // fetch threw (no response): offline / DNS / TLS — a real connectivity failure
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Chrome autofill writes into the DOM without events React sees, so `email`/`password`
    // state can be empty while the fields visibly hold credentials — submitting state made
    // an autofilled login send nothing. The inputs themselves are the truth; state only
    // mirrors what the user typed.
    const form = e.currentTarget
    const emailValue = (form.elements.namedItem('email') as HTMLInputElement | null)?.value ?? email
    const passwordValue = (form.elements.namedItem('password') as HTMLInputElement | null)?.value ?? password
    setBusy(true)
    setError(null)
    liveStore.reset() // no stale prior-session devices (E02-6 review HIGH)
    qc.clear() // and no stale prior-session query cache (R4 HIGH cross-tenant leak) before a new login
    login(emailValue, passwordValue)
      .then(async (user) => {
        // A PLATFORM ADMIN lands in the console, not on a fleet map. They run the business the
        // customers are on; their user row lives in some tenant only because it has to live
        // somewhere, and sending them to that tenant's map showed them either an empty screen or,
        // worse, a real customer's vehicles as though they were their own. An explicit `?redirect`
        // still wins — a deep link the user followed is a stronger signal than their role.
        if (search.redirect !== undefined) {
          void navigate({ to: search.redirect })
          return
        }
        if (user.role === 'platform_admin') {
          void navigate({ to: '/platform' })
          return
        }
        // best-effort map warm-up: a failed snapshot must NOT block navigation or surface a
        // misleading credentials/network error — the user is already authenticated, and the WS
        // delivers positions anyway (map.tsx treats the same call as best-effort)
        liveStore.seed(await getLastPositions().catch(() => []))
        void navigate({ to: '/app/map' })
      })
      .catch((err: unknown) => setError(t(errorKey(err))))
      .finally(() => setBusy(false))
  }

  return (
    <AuthShell label={t('login.label')} title={t('login.title')}>
      <form onSubmit={submit} className="grid gap-4">
        <AuthField
          id="email"
          name="email"
          label={t('login.emailLabel')}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          data-testid="email-input"
        />
        <AuthField
          id="password"
          name="password"
          label={t('login.passwordLabel')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          data-testid="password-input"
        />
        {error !== null && (
          <>
            <p role="alert" data-testid="login-error" className="text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
            {/*
              A 401 covers TWO things the server deliberately refuses to tell apart: a wrong
              password, and an account whose address was never activated (audit MED #67 — any
              distinguishable answer here reopens the signup oracle for the price of one extra
              request). So the hint is shown on EVERY 401, phrased conditionally: it helps the
              person who just signed up without confirming anything to the person who did not.
            */}
            {error === t('login.invalidCredentials') && (
              <p className="text-sm" style={{ color: 'var(--muted)' }} data-testid="login-verify-hint">
                {t('login.invalidHint')}{' '}
                <Link to="/verify-email" className="underline-offset-2 hover:underline" style={{ color: 'var(--accent)' }} data-testid="login-to-verify">
                  {t('verify.resend')}
                </Link>
              </p>
            )}
          </>
        )}
        {/* busy-only: gating on state left the button silently dead when Chrome autofill
            filled the fields without updating state; truly empty fields are caught by the
            inputs' `required` validation, which at least SAYS something */}
        <button type="submit" className="auth-submit" disabled={busy} data-testid="login-submit">
          {t('login.submit')}
        </button>
        <p className="border-t pt-4 text-center text-xs" style={{ borderColor: 'var(--auth-hairline)' }}>
          <Link to="/forgot-password" className="underline-offset-2 hover:underline" style={{ color: 'var(--muted)' }} data-testid="forgot-link">
            {t('login.forgotLink')}
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
