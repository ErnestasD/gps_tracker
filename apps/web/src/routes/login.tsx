import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError, getLastPositions } from '@/lib/api'
import { setToken } from '@/lib/auth'
import { liveStore } from '@/lib/liveStore'

/**
 * Stub-era login (spec §4 Auth screens; E03-1 replaces with email+password):
 * the "password" is STUB_AUTH_TOKEN, validated by calling the snapshot endpoint —
 * side-effect-free AND warms the store, so the map paints instantly after login.
 */
export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useSearch({ from: '/login' })
  const [token, setTokenInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setToken(token.trim())
    getLastPositions()
      .then((events) => {
        liveStore.seed(events)
        void navigate({ to: search.redirect ?? '/app/map' })
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 401 ? t('login.invalidToken') : t('login.networkError'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#16213A_0%,_#0B1020_60%)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center pt-8 text-center">
          <img src="/icons/pwa-192.png" alt="" className="mb-2 h-12 w-12 rounded-xl" />
          <CardTitle className="text-lg">{t('login.title')}</CardTitle>
        </CardHeader>
        <CardContent className="pb-8">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="token" className="text-sm text-muted">
                {t('login.tokenLabel')}
              </label>
              <Input
                id="token"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(e) => setTokenInput(e.target.value)}
                required
                data-testid="token-input"
              />
              <p className="text-xs text-muted">{t('login.tokenHint')}</p>
            </div>
            {error !== null && (
              <p role="alert" data-testid="login-error" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || token.trim() === ''} data-testid="login-submit">
              {t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
