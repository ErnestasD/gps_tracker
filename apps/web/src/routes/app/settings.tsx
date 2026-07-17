import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, AdminInput, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { changePassword } from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { useFmt } from '@/lib/datetime'
import { listAccounts } from '@/lib/devices'
import { downloadExport, hasPendingExport, listExports, requestExport } from '@/lib/gdpr'
import { ApiError } from '@/lib/http'
import { getTheme, onThemeChange, setStoredLocale, setTheme, type Theme } from '@/lib/prefs'
import { disablePush, enablePush, pushEnabled, pushSupported } from '@/lib/push'

const LOCALES = ['en', 'lt', 'pl', 'de'] as const

const th = 'py-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

const TAB_IDS = ['profile', 'security', 'notifications', 'data'] as const
type TabId = (typeof TAB_IDS)[number]

/** Settings/Profile (E03-2, DASHBOARD_UI_SPEC §4): locale, theme, password change, push, export.
 * Re-skinned onto the admin design (ADR-028). The tab bar is ANCHOR navigation, not panel
 * switching: every section stays mounted and visible because the e2e flow (smoke.spec.ts
 * 'settings: theme toggle + password change') clicks theme-light/theme-dark and then fills
 * current-password with NO tab click in between — hiding non-active panels would break it. */
export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const user = getCurrentUser()
  const isAdmin = user?.role === 'platform_admin' || user?.role === 'tsp_admin'
  const [theme, setThemeState] = useState<Theme>(getTheme())
  // the topbar toggle also changes the theme — keep the buttons in sync (ADR-028)
  useEffect(() => onThemeChange(() => setThemeState(getTheme())), [])
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [activeTab, setActiveTab] = useState<TabId>('profile')
  const sectionRefs = useRef<Partial<Record<TabId, HTMLDivElement | null>>>({})
  const goTo = (id: TabId) => {
    setActiveTab(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const tabs = TAB_IDS.filter((id) => id !== 'data' || isAdmin)

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
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6" data-testid="settings-page">
      <PageHeader className="mb-0" title={t('settings.title')} />

      {/* hand-rolled tab bar (no Radix): anchor-jumps, active gets the brand underline.
          ARIA: tabs point at id'd tabpanels (all stay mounted — anchor navigation by design). */}
      <div className="admin-hairline-b flex gap-1" role="tablist" aria-label={t('settings.title')}>
        {tabs.map((id) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-controls={`settings-panel-${id}`}
              aria-selected={active}
              onClick={() => goTo(id)}
              className="-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition-colors"
              style={{
                color: active ? 'var(--admin-brand)' : 'var(--admin-ink-soft)',
                background: active ? 'var(--admin-brand-soft)' : 'transparent',
                borderBottom: active ? '2px solid var(--admin-brand)' : '2px solid transparent',
              }}
            >
              {t(`settings.tab.${id}`)}
            </button>
          )
        })}
      </div>

      {/* Profile: identity + appearance (locale/theme) */}
      <div ref={(el) => { sectionRefs.current.profile = el }} role="tabpanel" id="settings-panel-profile" aria-labelledby="settings-tab-profile" className="admin-card scroll-mt-4">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('settings.profile')}
        </div>
        <div className="space-y-4 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--admin-ink-soft)' }}>{t('settings.email')}</span>
            <span className="mono text-xs" style={{ color: 'var(--admin-ink)' }}>{user?.email ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--admin-ink-soft)' }}>{t('settings.role')}</span>
            <Badge tone="neutral">{user?.role != null ? t(`roles.${user.role}`, user.role) : '—'}</Badge>
          </div>
          <div className="admin-hairline-t flex items-center justify-between pt-4">
            <span style={{ color: 'var(--admin-ink-soft)' }}>{t('settings.locale')}</span>
            <div className="w-28">
              <Combobox
                data-testid="locale-select"
                aria-label={t('settings.locale')}
                value={i18n.language.split('-')[0]}
                onChange={onLocale}
                options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--admin-ink-soft)' }}>{t('settings.theme')}</span>
            <div className="flex gap-2">
              {(['dark', 'light'] as const).map((value) => (
                <AdminButton
                  key={value}
                  variant={theme === value ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onTheme(value)}
                  data-testid={`theme-${value}`}
                >
                  {t(`settings.themeOption.${value}`)}
                </AdminButton>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Security: password change */}
      <div ref={(el) => { sectionRefs.current.security = el }} role="tabpanel" id="settings-panel-security" aria-labelledby="settings-tab-security" className="admin-card scroll-mt-4">
        <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('settings.password.title')}
        </div>
        <div className="p-4">
          <form onSubmit={submitPassword} className="space-y-3">
            <AdminInput
              type="password"
              autoComplete="current-password"
              aria-label={t('settings.password.current')}
              placeholder={t('settings.password.current')}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              data-testid="current-password"
            />
            <AdminInput
              type="password"
              autoComplete="new-password"
              aria-label={t('settings.password.new')}
              placeholder={t('settings.password.new')}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              data-testid="new-password"
            />
            {pwMsg !== null && (
              <p role="alert" data-testid="password-msg" className="text-sm" style={{ color: pwMsg.kind === 'ok' ? 'var(--admin-success)' : 'var(--admin-danger)' }}>
                {pwMsg.text}
              </p>
            )}
            <AdminButton type="submit" disabled={busy || current === '' || next.length < 8} data-testid="change-password">
              {t('settings.password.submit')}
            </AdminButton>
          </form>
        </div>
      </div>

      {/* Notifications: browser push */}
      <div ref={(el) => { sectionRefs.current.notifications = el }} role="tabpanel" id="settings-panel-notifications" aria-labelledby="settings-tab-notifications" className="scroll-mt-4">
        <PushSection />
      </div>

      {/* Data: GDPR export (admins only — the server enforces it too) */}
      {isAdmin && (
        <div ref={(el) => { sectionRefs.current.data = el }} role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data" className="scroll-mt-4">
          <ExportSection />
        </div>
      )}
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
    <div className="admin-card" data-testid="push-section">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {t('settings.push.title')}
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('settings.push.hint')}</p>
        {!supported ? (
          <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="push-unsupported">{t('settings.push.unsupported')}</p>
        ) : (
          <div className="flex items-center gap-3">
            <AdminButton variant={enabled ? 'secondary' : 'primary'} size="sm" disabled={busy} onClick={toggle} data-testid="push-toggle">
              {enabled ? t('settings.push.disable') : t('settings.push.enable')}
            </AdminButton>
            <Badge tone={enabled ? 'success' : 'neutral'} data-testid="push-status">
              {enabled ? t('settings.push.on') : t('settings.push.off')}
            </Badge>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="push-error">{error}</p>
        )}
      </div>
    </div>
  )
}

/** GDPR account data export (E08-4): request → poll while pending → download. Admins only
 * (the server enforces it too — this gate is UX, not security). */
function ExportSection() {
  const { t } = useTranslation()
  const { dt } = useFmt()
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
    <div className="admin-card" data-testid="export-section">
      <div className="admin-hairline-b px-4 py-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
        {t('settings.export.title')}
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('settings.export.hint')}</p>
        <form onSubmit={submit} className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
            {t('settings.export.account')}
            <div className="w-52">
              <Combobox value={acc} onChange={setAccountId} data-testid="export-account" aria-label={t('settings.export.account')}
                options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
            </div>
          </label>
          <AdminButton type="submit" disabled={busy || acc === ''} data-testid="export-request">
            {t('settings.export.request')}
          </AdminButton>
          {error !== null && (
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</p>
          )}
        </form>
        {(jobs.data ?? []).length > 0 && (
          <table className="w-full text-sm" data-testid="exports-table">
            <thead>
              <tr className="admin-hairline-b">
                <th className={th} style={thStyle}>{t('settings.export.requested')}</th>
                <th className={th} style={thStyle}>{t('settings.export.status')}</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {(jobs.data ?? []).map((j) => (
                <tr key={j.id} className="admin-hairline-b last:border-b-0" data-testid={`export-${j.id}`}>
                  <td className="py-2 pr-4 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{dt(j.createdAt)}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={j.status === 'done' ? 'success' : j.status === 'failed' ? 'danger' : 'neutral'}>
                      {t(`settings.export.st.${j.status}`, j.status)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {j.status === 'done' && new Date(j.expiresAt).getTime() > Date.now() && (
                      <AdminButton variant="secondary" size="sm" data-testid={`export-download-${j.id}`} onClick={() => void downloadExport(j.id).catch(() => setError(t('settings.export.error')))}>
                        {t('settings.export.download')}
                      </AdminButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
