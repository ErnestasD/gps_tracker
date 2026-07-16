import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { changePassword } from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { listAccounts } from '@/lib/devices'
import { downloadExport, hasPendingExport, listExports, requestExport } from '@/lib/gdpr'
import { ApiError } from '@/lib/http'
import { getTheme, setStoredLocale, setTheme, type Theme } from '@/lib/prefs'
import { disablePush, enablePush, pushEnabled, pushSupported } from '@/lib/push'

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

      <PushSection />

      {(user?.role === 'platform_admin' || user?.role === 'tsp_admin') && <ExportSection />}
    </div>
  )
}

/** Browser push opt-in (ADR-026): subscribe THIS browser to Web Push. Rules with a `webpush` channel
 * then fan out to every browser the account has enrolled. Per-device, not per-account. */
function PushSection() {
  const { t } = useTranslation()
  const [supported] = useState(pushSupported())
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void pushEnabled().then(setEnabled)
  }, [])

  const toggle = () => {
    setBusy(true)
    setError(null)
    const action = enabled ? disablePush().then(() => false) : enablePush()
    action
      .then((ok) => {
        setEnabled(ok)
        if (!ok && !enabled) setError(t('settings.push.denied'))
      })
      .catch(() => setError(t('settings.push.error')))
      .finally(() => setBusy(false))
  }

  return (
    <Card data-testid="push-section">
      <CardHeader>
        <CardTitle className="text-base">{t('settings.push.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">{t('settings.push.hint')}</p>
        {!supported ? (
          <p className="text-sm text-muted" data-testid="push-unsupported">{t('settings.push.unsupported')}</p>
        ) : (
          <div className="flex items-center gap-3">
            <Button variant={enabled ? 'secondary' : 'default'} size="sm" disabled={busy} onClick={toggle} data-testid="push-toggle">
              {enabled ? t('settings.push.disable') : t('settings.push.enable')}
            </Button>
            <Badge variant={enabled ? 'success' : 'outline'} data-testid="push-status">
              {enabled ? t('settings.push.on') : t('settings.push.off')}
            </Badge>
          </div>
        )}
        {error !== null && <p role="alert" className="text-sm text-danger" data-testid="push-error">{error}</p>}
      </CardContent>
    </Card>
  )
}

/** GDPR account data export (E08-4): request → poll while pending → download. Admins only
 * (the server enforces it too — this gate is UX, not security). */
function ExportSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const jobs = useQuery({
    queryKey: ['exports'],
    queryFn: listExports,
    refetchInterval: (q) => (hasPendingExport(q.state.data ?? []) ? 5000 : false),
  })
  const [accountId, setAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const acc = accountId || accounts.data?.[0]?.id || ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (acc === '') return
    setBusy(true)
    setError(null)
    requestExport(acc)
      .then(() => void qc.invalidateQueries({ queryKey: ['exports'] }))
      .catch(() => setError(t('settings.export.error')))
      .finally(() => setBusy(false))
  }

  return (
    <Card data-testid="export-section">
      <CardHeader>
        <CardTitle className="text-base">{t('settings.export.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">{t('settings.export.hint')}</p>
        <form onSubmit={submit} className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('settings.export.account')}
            <select value={acc} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-card border border-line bg-surface px-2 text-sm text-text" data-testid="export-account">
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={busy || acc === ''} data-testid="export-request">
            {t('settings.export.request')}
          </Button>
          {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
        </form>
        {(jobs.data ?? []).length > 0 && (
          <table className="w-full text-sm" data-testid="exports-table">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-4 font-medium">{t('settings.export.requested')}</th>
                <th className="py-2 pr-4 font-medium">{t('settings.export.status')}</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {(jobs.data ?? []).map((j) => (
                <tr key={j.id} className="border-b border-line/50" data-testid={`export-${j.id}`}>
                  <td className="py-2 pr-4 text-xs text-muted">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={j.status === 'done' ? 'success' : j.status === 'failed' ? 'danger' : 'outline'}>
                      {t(`settings.export.st.${j.status}`, j.status)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {j.status === 'done' && new Date(j.expiresAt).getTime() > Date.now() && (
                      <Button variant="secondary" size="sm" data-testid={`export-download-${j.id}`} onClick={() => void downloadExport(j.id).catch(() => setError(t('settings.export.error')))}>
                        {t('settings.export.download')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
