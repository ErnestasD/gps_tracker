import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCan, hasCanData } from '@/lib/can'
import type { Device } from '@/lib/devices'
import { useUnits } from '@/lib/units'

/** CAN/OBD engine panel (V2): latest RPM / coolant / load / throttle / speed / odometer.
 *  Hidden entirely for non-CAN vehicles (the read returns null / all-null). */
export function CanCard({ device }: { device: Device }) {
  const { t } = useTranslation()
  const u = useUnits()
  const can = useQuery({ queryKey: ['can', device.id], queryFn: () => getCan(device.id) })
  const c = can.data ?? null

  if (!can.isLoading && !can.isError && !hasCanData(c)) return null // non-CAN vehicle → no panel

  const fmt = (v: number | null | undefined, unit: string, digits = 0) => (v == null ? '—' : `${v.toFixed(digits)}${unit}`)

  return (
    <Card data-testid="can-card">
      <CardHeader><CardTitle className="text-base">{t('devices.can.title')}</CardTitle></CardHeader>
      <CardContent>
        {can.isError ? (
          <p className="text-sm text-danger">{t('devices.can.loadError')}</p>
        ) : (
          <div className="flex flex-wrap gap-6 text-sm">
            <Stat label={t('devices.can.rpm')} value={fmt(c?.rpm, ' rpm')} testid="can-rpm" />
            <Stat label={t('devices.can.coolant')} value={fmt(c?.coolantC, ' °C')} testid="can-coolant" />
            <Stat label={t('devices.can.load')} value={fmt(c?.engineLoadPct, ' %')} testid="can-load" />
            <Stat label={t('devices.can.throttle')} value={fmt(c?.throttlePct, ' %')} testid="can-throttle" />
            <Stat label={t('devices.can.speed')} value={c?.speedKmh == null ? '—' : u.speed(c.speedKmh)} testid="can-speed" />
            <Stat label={t('devices.can.odometer')} value={c?.totalMileageKm == null ? '—' : u.distanceKm(c.totalMileageKm)} testid="can-odo" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium" data-testid={testid}>{value}</div>
    </div>
  )
}
