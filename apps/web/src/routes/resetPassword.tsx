import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#1A1F2C_0%,_#0A0E1A_60%)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center pt-8 text-center">
          <img src="/orbetra-wordmark.svg" alt="Orbetra" className="mb-3 h-8 w-auto" />
          <CardTitle className="text-lg">{t('reset.title')}</CardTitle>
        </CardHeader>
        <CardContent className="pb-8">
          {done ? (
            <div className="space-y-4 text-center" data-testid="reset-done">
              <p className="text-sm text-muted">{t('reset.done')}</p>
              <Button className="w-full" onClick={() => void navigate({ to: '/login' })} data-testid="reset-to-login">
                {t('reset.toLogin')}
              </Button>
            </div>
          ) : token === undefined || token === '' ? (
            <div className="space-y-4 text-center" data-testid="reset-no-token">
              <p role="alert" className="text-sm text-danger">{t('reset.invalidToken')}</p>
              <Link to="/forgot-password" className="inline-block text-sm text-accent underline-offset-2 hover:underline" data-testid="reset-request-new">
                {t('reset.requestNew')}
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm text-muted">
                  {t('reset.newPassword')}
                </label>
                <Input
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
                <label htmlFor="confirm" className="text-sm text-muted">
                  {t('reset.confirmPassword')}
                </label>
                <Input
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
                <p role="alert" data-testid="reset-error" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy || password === '' || confirm === ''} data-testid="reset-submit">
                {t('reset.submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
