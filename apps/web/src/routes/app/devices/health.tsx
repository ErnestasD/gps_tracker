import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { chartPoints } from '@/components/SpeedChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getHealth, voltageSeries } from '@/lib/health'
import type { Device } from '@/lib/devices'

/** Device-health panel (V1-nice): GSM bars, voltage trend, last-seen, firmware. */
export function HealthCard({ device }: { device: Device }) {
  const { t } = useTranslation()
  const health = useQuery({ queryKey: ['health', device.id], queryFn: () => getHealth(device.id) })
  const volts = useMemo(() => voltageSeries(health.data?.series ?? []), [health.data])
  const pts = useMemo(() => chartPoints(volts.values, 600, 80, 6), [volts.values])
  const path = pts.length > 0 ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L') : ''
  const latest = health.data?.latest

  const gsm = latest?.gsm ?? null
  return (
    <Card data-testid="health-card">
      <CardHeader>
        <CardTitle className="text-base">{t('devices.health.title', { name: device.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {health.isError ? (
          <p className="text-sm text-danger">{t('devices.health.loadError')}</p>
        ) : (health.data?.series ?? []).length === 0 ? (
          <p className="text-sm text-muted" data-testid="health-empty">{t('devices.health.empty')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-6 text-sm">
              <Stat label={t('devices.health.gsm')} value={gsm === null ? '—' : <GsmBars level={gsm} />} testid="health-gsm" />
              <Stat label={t('devices.health.extV')} value={latest?.extV != null ? `${latest.extV.toFixed(1)} V` : '—'} testid="health-extv" />
              <Stat label={t('devices.health.battV')} value={latest?.battV != null ? `${latest.battV.toFixed(2)} V` : '—'} testid="health-battv" />
              <Stat label={t('devices.health.lastSeen')} value={health.data?.lastSeen ? new Date(health.data.lastSeen).toLocaleString() : '—'} testid="health-lastseen" />
              <Stat label={t('devices.health.firmware')} value={health.data?.firmware ?? t('devices.health.fwUnknown')} testid="health-fw" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted">{t(volts.label === 'ext' ? 'devices.health.extV' : 'devices.health.battV')}</div>
              <svg viewBox="0 0 600 80" className="h-20 w-full rounded-card border border-line bg-surface" role="img" aria-label="voltage timeline">
                {path !== '' && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
              </svg>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, testid }: { label: string; value: React.ReactNode; testid: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium tabular-nums" data-testid={testid}>{value}</div>
    </div>
  )
}

function GsmBars({ level }: { level: number }) {
  const n = Math.max(0, Math.min(5, Math.round(level)))
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={`GSM ${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="w-1 rounded-sm" style={{ height: `${i * 3 + 3}px`, background: i <= n ? 'var(--accent)' : 'var(--line)' }} />
      ))}
      <span className="ml-1 text-xs text-muted">{n}/5</span>
    </span>
  )
}
