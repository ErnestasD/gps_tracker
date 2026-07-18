import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getOnboarding } from '@/lib/onboarding'
import type { Device } from '@/lib/devices'

/** SMS onboarding card (V1-nice): the copy-paste SMS that points a Teltonika device at us —
 * no Teltonika software (cloud FOTA is gold-partner-only). APN is operator-entered. */
export function OnboardingCard({ device }: { device: Device }) {
  const { t } = useTranslation()
  const [apn, setApn] = useState('')
  const sheet = useQuery({ queryKey: ['onboarding', device.id, apn], queryFn: () => getOnboarding(device.id, apn) })
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    })
  }

  const s = sheet.data
  return (
    <Card data-testid="onboarding-card">
      <CardHeader>
        <CardTitle className="text-base">{t('devices.onb.title', { name: device.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sheet.isError ? (
          /* don't quote a (possibly wrong, white-label) fallback host as if it loaded — say it failed */
          <p role="alert" className="text-xs text-danger" data-testid="onboarding-error">{t('admin.loadError')}</p>
        ) : (
          <p className="text-xs text-muted">{t('devices.onb.intro', { host: s?.host ?? 'orbetra.com', port: s?.port ?? 5027 })}</p>
        )}

        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('devices.onb.apn')}
          <Input value={apn} onChange={(e) => setApn(e.target.value)} placeholder={t('devices.onb.apnPlaceholder')} data-testid="onboarding-apn" className="w-56" maxLength={64} />
        </label>

        {s !== undefined && (
          <div className="space-y-3">
            {s.smsApn !== null && (
              <SmsRow label={t('devices.onb.smsApn')} text={s.smsApn} copied={copied === 'apn'} onCopy={() => copy(s.smsApn!, 'apn')} testid="onboarding-sms-apn" copyLabel={t('devices.onb.copy')} copiedLabel={t('devices.onb.copied')} />
            )}
            <SmsRow label={t('devices.onb.smsServer')} text={s.smsServer} copied={copied === 'server'} onCopy={() => copy(s.smsServer, 'server')} testid="onboarding-sms-server" copyLabel={t('devices.onb.copy')} copiedLabel={t('devices.onb.copied')} />
            {s.familyCaveat && <p className="text-xs text-warn" data-testid="onboarding-caveat">{t('devices.onb.caveat')}</p>}
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              {s.steps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SmsRow({ label, text, copied, onCopy, testid, copyLabel, copiedLabel }: { label: string; text: string; copied: boolean; onCopy: () => void; testid: string; copyLabel: string; copiedLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-card border border-line bg-surface px-2 py-1.5 font-mono text-xs text-text" data-testid={testid}>{text}</code>
        <Button variant="secondary" size="sm" onClick={onCopy}>{copied ? copiedLabel : copyLabel}</Button>
      </div>
    </div>
  )
}
