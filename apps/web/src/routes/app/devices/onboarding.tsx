import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useFmt } from '@/lib/datetime'
import { updateDevice, type Device } from '@/lib/devices'
import { getOnboarding } from '@/lib/onboarding'
import { canSendConfigSms, hasPendingSms, listSmsDeliveries, sendConfigSms, smsStatusVariant } from '@/lib/sms'

/** SMS onboarding card (V1-nice): the copy-paste SMS that points a Teltonika device at us —
 * no Teltonika software (cloud FOTA is gold-partner-only). APN is operator-entered.
 * When the platform has an SMS gateway configured AND the device has a saved SIM number, the card
 * also offers a one-click "Send config SMS" (server sends it via Twilio); the copy-paste SMS below
 * always stays as the manual fallback. */
export function OnboardingCard({ device, initialApn }: { device: Device; initialApn?: string }) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const qc = useQueryClient()
  // initialApn pre-fills the APN when the card is auto-opened right after a device is created
  // with a SIM number (unified add flow), so the operator lands one click from "Send config SMS".
  const [apn, setApn] = useState(initialApn ?? '')
  const sheet = useQuery({ queryKey: ['onboarding', device.id, apn], queryFn: () => getOnboarding(device.id, apn) })
  const [copied, setCopied] = useState<string | null>(null)

  // SIM fields — saved via the device PATCH. `savedMsisdn` gates the send button so we never send
  // to an unsaved number (the server reads the persisted simMsisdn, not the input value).
  const [msisdn, setMsisdn] = useState(device.simMsisdn ?? '')
  const [iccid, setIccid] = useState(device.simIccid ?? '')
  const [savedMsisdn, setSavedMsisdn] = useState(device.simMsisdn ?? '')
  const [simSaving, setSimSaving] = useState(false)
  const [simSaved, setSimSaved] = useState(false)
  const [simError, setSimError] = useState(false)

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    })
  }

  const saveSim = () => {
    setSimSaving(true)
    setSimError(false)
    setSimSaved(false)
    const trimmed = msisdn.trim()
    updateDevice(device.id, { simMsisdn: trimmed === '' ? null : trimmed, simIccid: iccid.trim() === '' ? null : iccid.trim() })
      .then(() => {
        setSavedMsisdn(trimmed)
        setSimSaved(true)
        setTimeout(() => setSimSaved(false), 2000)
      })
      .catch(() => setSimError(true))
      .finally(() => setSimSaving(false))
  }

  const s = sheet.data
  const smsEnabled = s?.smsEnabled
  const canSend = canSendConfigSms(smsEnabled, savedMsisdn)

  const deliveries = useQuery({
    queryKey: ['sms', device.id],
    queryFn: () => listSmsDeliveries(device.id),
    enabled: canSend, // only poll when the send action is actually available
    // poll while anything is still queued so sent/failed shows up without a reload
    refetchInterval: (q) => (hasPendingSms(q.state.data ?? []) ? 5000 : false),
  })
  // newest first — the API orders it, but sort defensively so the "latest" badge is always right
  const latest = [...(deliveries.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

  const send = () => {
    setSending(true)
    setSendError(false)
    const apnTrim = apn.trim()
    sendConfigSms(device.id, apnTrim === '' ? {} : { apn: apnTrim })
      .then(() => qc.invalidateQueries({ queryKey: ['sms', device.id] }))
      .catch(() => setSendError(true))
      .finally(() => setSending(false))
  }

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

        {/* SIM fields — saved on the device, used as the SMS destination + support audit */}
        <div className="space-y-2 rounded-card border border-line p-3">
          <div className="text-xs font-medium text-muted">{t('devices.onb.sim.title')}</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('devices.onb.sim.msisdn')}
              <Input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="+37060000000" data-testid="onb-sim-msisdn" className="w-48" maxLength={20} inputMode="tel" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('devices.onb.sim.iccid')}
              <Input value={iccid} onChange={(e) => setIccid(e.target.value)} data-testid="onb-sim-iccid" className="w-56" maxLength={22} />
            </label>
            <Button variant="secondary" size="sm" onClick={saveSim} disabled={simSaving} data-testid="onb-sim-save">
              {t('devices.onb.sim.save')}
            </Button>
            {simSaved && <span className="text-xs text-success">{t('devices.onb.sim.saved')}</span>}
          </div>
          {simError && <p role="alert" className="text-xs text-danger" data-testid="onb-sim-error">{t('devices.onb.sim.error')}</p>}
        </div>

        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('devices.onb.apn')}
          <Input value={apn} onChange={(e) => setApn(e.target.value)} placeholder={t('devices.onb.apnPlaceholder')} data-testid="onboarding-apn" className="w-56" maxLength={64} />
        </label>

        {/* One-click send (shown only when the platform SMS gateway is configured AND a SIM is saved);
            otherwise a hint. The manual copy-paste SMS below always remains as the fallback. */}
        {s !== undefined && (
          canSend ? (
            <div className="space-y-2 rounded-card border border-line p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={send} disabled={sending} data-testid="onb-send-sms">
                  {sending ? t('devices.onb.sms.sending') : t('devices.onb.sms.send')}
                </Button>
                <span className="text-xs text-muted">{t('devices.onb.sms.hint')}</span>
                {latest !== undefined && (
                  <span className="flex items-center gap-2" data-testid="onb-sms-status">
                    <Badge variant={smsStatusVariant(latest.status)}>{t(`devices.onb.sms.${latest.status}`, latest.status)}</Badge>
                    {latest.status === 'failed' && latest.error !== null && (
                      <span className="text-xs text-danger">{latest.error}</span>
                    )}
                  </span>
                )}
              </div>
              {sendError && <p role="alert" className="text-xs text-danger" data-testid="onb-sms-error">{t('devices.onb.sms.error')}</p>}
              {(deliveries.data ?? []).length > 0 && (
                <ul className="space-y-1 text-xs text-muted" data-testid="onb-sms-list">
                  {(deliveries.data ?? []).map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <Badge variant={smsStatusVariant(d.status)}>{t(`devices.onb.sms.${d.status}`, d.status)}</Badge>
                      <span className="text-muted">{dt(d.createdAt)}</span>
                      {d.status === 'failed' && d.error !== null && <span className="text-danger">{d.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted" data-testid="onb-sms-unavailable">
              {smsEnabled === true ? t('devices.onb.sms.noMsisdn') : t('devices.onb.sms.notConfigured')}
            </p>
          )
        )}

        {sheet.isLoading && (
          <p className="text-xs text-muted" data-testid="onboarding-loading">{t('admin.loading')}</p>
        )}

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
