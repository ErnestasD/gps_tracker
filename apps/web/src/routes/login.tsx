import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getLastPositions } from '@/lib/api'
import { login } from '@/lib/auth'
import { ApiError } from '@/lib/http'
import { liveStore } from '@/lib/liveStore'

/**
 * Login (E03-1, spec §4 Auth screens): email + password against POST /v1/auth/login.
 * Tenant branding by Host arrives with E03-5; password reset is manual in v1
 * (forgot-password stub note below the form).
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
    }
    return 'login.networkError'
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    liveStore.reset() // no stale prior-session devices (E02-6 review HIGH)
    qc.clear() // and no stale prior-session query cache (R4 HIGH cross-tenant leak) before a new login
    login(email, password)
      .then(async () => {
        // best-effort map warm-up: a failed snapshot must NOT block navigation or surface a
        // misleading credentials/network error — the user is already authenticated, and the WS
        // delivers positions anyway (map.tsx treats the same call as best-effort)
        liveStore.seed(await getLastPositions().catch(() => []))
        void navigate({ to: search.redirect ?? '/app/map' })
      })
      .catch((err: unknown) => setError(t(errorKey(err))))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#1A1F2C_0%,_#0A0E1A_60%)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center pt-8 text-center">
          <img src="/orbetra-logo.svg" alt="Orbetra" className="mb-2 h-12 w-12" />
          <CardTitle className="text-lg">{t('login.title')}</CardTitle>
        </CardHeader>
        <CardContent className="pb-8">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm text-muted">
                {t('login.emailLabel')}
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="email-input"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm text-muted">
                {t('login.passwordLabel')}
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="password-input"
              />
            </div>
            {error !== null && (
              <p role="alert" data-testid="login-error" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || email.trim() === '' || password === ''}
              data-testid="login-submit"
            >
              {t('login.submit')}
            </Button>
            <p className="text-center text-xs text-muted">{t('login.forgotHint')}</p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
