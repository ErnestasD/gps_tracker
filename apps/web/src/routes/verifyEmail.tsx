import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/AuthShell'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { resendVerification, verifyEmail } from '@/lib/auth'

/**
 * Account activation (audit MED #67). A self-serve signup creates an account that CANNOT sign in
 * until the address is proven, so this page is the only path from "signed up" to "usable".
 *
 * It runs the verification on mount rather than behind a button: the user already expressed intent
 * by clicking the link in their mail, and a second click would be ceremony. The trade-off is that a
 * mail scanner prefetching the link burns the token — which is why the failure state offers a
 * resend rather than a dead end, and why verifying does NOT sign anyone in.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token } = useSearch({ from: '/verify-email' })
  const [state, setState] = useState<'working' | 'done' | 'invalid'>(token === undefined || token === '' ? 'invalid' : 'working')
  const [email, setEmail] = useState('')
  const [resent, setResent] = useState(false)
  const [busy, setBusy] = useState(false)
  // StrictMode double-mounts in dev, and the token is SINGLE-USE: without this the second call
  // consumes nothing and paints "invalid" over a verification that actually succeeded.
  const started = useRef(false)

  useEffect(() => {
    if (token === undefined || token === '' || started.current) return
    started.current = true
    verifyEmail(token)
      .then(() => setState('done'))
      .catch(() => setState('invalid'))
  }, [token])

  const submitResend = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    // ALWAYS the same outcome, whatever the server says: the endpoint answers 200 for an unknown,
    // an already-verified and a real address alike, and the UI must not undo that by distinguishing
    // a network error from a refusal.
    void resendVerification(email).finally(() => {
      setResent(true)
      setBusy(false)
    })
  }

  return (
    <AuthShell label={t('verify.label')} title={t('verify.title')}>
      <Card className="w-full">
        <CardContent className="pb-8">
          {state === 'working' ? (
            <p className="text-center text-sm text-muted" data-testid="verify-working">
              {t('verify.working')}
            </p>
          ) : state === 'done' ? (
            <div className="space-y-4 text-center" data-testid="verify-done">
              <p className="text-sm text-muted">{t('verify.done')}</p>
              <Button className="w-full" onClick={() => void navigate({ to: '/login' })} data-testid="verify-to-login">
                {t('verify.toLogin')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4" data-testid="verify-invalid">
              <p role="alert" className="text-center text-sm text-danger">
                {t(token === undefined || token === '' ? 'verify.noToken' : 'verify.invalid')}
              </p>
              {resent ? (
                <p className="text-center text-sm text-muted" data-testid="verify-resent">
                  {t('verify.resendSent')}
                </p>
              ) : (
                <form onSubmit={submitResend} className="space-y-3">
                  <div className="space-y-1.5">
                    <label htmlFor="verify-email" className="text-sm text-muted">
                      {t('verify.resendEmail')}
                    </label>
                    <Input
                      id="verify-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      data-testid="verify-email-input"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy} data-testid="verify-resend">
                    {t('verify.resendSubmit')}
                  </Button>
                </form>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  )
}
