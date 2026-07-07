import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { changePassword } from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { ApiError } from '@/lib/http'
import { getTheme, setStoredLocale, setTheme, type Theme } from '@/lib/prefs'

const LOCALES = ['en', 'lt', 'pl', 'de'] as const

/** Settings/Profile (E03-2, DASHBOARD_UI_SPEC §4): locale, theme, password change. */
export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const user = getCurrentUser()
  const [theme, setThemeState] = useState<Theme>(getTheme())
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const onTheme = (value: Theme) => {
    setThemeState(value)
    setTheme(value)
  }
  const onLocale = (value: string) => {
    setStoredLocale(value)
    void i18n.changeLanguage(value)
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setPwMsg(null)
    changePassword(current, next)
      .then(() => {
        setPwMsg({ kind: 'ok', text: t('settings.password.changed') })
        setCurrent('')
        setNext('')
      })
      .catch((err: unknown) => {
        const key = err instanceof ApiError && err.status === 401 ? 'settings.password.wrongCurrent' : 'settings.password.error'
        setPwMsg({ kind: 'err', text: t(key) })
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6" data-testid="settings-page">
      <h1 className="text-lg font-semibold">{t('settings.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.profile')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">{t('settings.email')}</span>
            <span className="font-mono">{user?.email ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{t('settings.role')}</span>
            <span>{user?.role ?? '—'}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.appearance')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <label htmlFor="locale" className="text-sm text-muted">{t('settings.locale')}</label>
            <select
              id="locale"
              data-testid="locale-select"
              value={i18n.language.split('-')[0]}
              onChange={(e) => onLocale(e.target.value)}
              className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text"
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">{t('settings.theme')}</span>
            <div className="flex gap-2">
              {(['dark', 'light'] as const).map((value) => (
                <Button
                  key={value}
                  variant={theme === value ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => onTheme(value)}
                  data-testid={`theme-${value}`}
                >
                  {t(`settings.themeOption.${value}`)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.password.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitPassword} className="space-y-3">
            <Input
              type="password"
              autoComplete="current-password"
              placeholder={t('settings.password.current')}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              data-testid="current-password"
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder={t('settings.password.new')}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              data-testid="new-password"
            />
            {pwMsg !== null && (
              <p role="alert" data-testid="password-msg" className={pwMsg.kind === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>
                {pwMsg.text}
              </p>
            )}
            <Button type="submit" disabled={busy || current === '' || next.length < 8} data-testid="change-password">
              {t('settings.password.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
