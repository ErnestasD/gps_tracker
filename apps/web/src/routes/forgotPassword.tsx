import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    requestPasswordReset(email.trim())
      .then(() => setSent(true))
      .catch((err: unknown) => setError(t(err instanceof ApiError && err.status === 429 ? 'login.tooManyAttempts' : 'forgot.error')))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#1A1F2C_0%,_#0A0E1A_60%)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center pt-8 text-center">
          <img src="/orbetra-wordmark.svg" alt="Orbetra" className="mb-3 h-8 w-auto" />
          <CardTitle className="text-lg">{t('forgot.title')}</CardTitle>
        </CardHeader>
        <CardContent className="pb-8">
          {sent ? (
            <div className="space-y-4 text-center" data-testid="forgot-sent">
              <p className="text-sm text-muted">{t('forgot.sent', { email: email.trim() })}</p>
              <Link to="/login" className="inline-block text-sm text-accent underline-offset-2 hover:underline" data-testid="forgot-back">
                {t('forgot.backToLogin')}
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-muted">{t('forgot.intro')}</p>
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
                  data-testid="forgot-email"
                />
              </div>
              {error !== null && (
                <p role="alert" data-testid="forgot-error" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy || email.trim() === ''} data-testid="forgot-submit">
                {t('forgot.submit')}
              </Button>
              <p className="text-center text-xs">
                <Link to="/login" className="text-muted underline-offset-2 hover:text-text hover:underline" data-testid="forgot-back">
                  {t('forgot.backToLogin')}
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
