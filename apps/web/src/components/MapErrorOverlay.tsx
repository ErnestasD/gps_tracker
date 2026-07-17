import { useTranslation } from 'react-i18next'

/**
 * Shared "map never loaded" overlay (ADR-030): pair with `watchMapLoad` (lib/map).
 * Renders nothing while the map is healthy; absolutely fills the nearest `relative`
 * ancestor when it isn't. `admin` matches the admin-card pages (geofences/routing/
 * playback); `shell` matches the dark app shell + public pages (live map, share).
 */
export function MapErrorOverlay({ show, testId, variant = 'admin' }: { show: boolean; testId: string; variant?: 'admin' | 'shell' }) {
  const { t } = useTranslation()
  if (!show) return null
  const style =
    variant === 'admin'
      ? { background: 'color-mix(in srgb, var(--admin-surface) 92%, transparent)', color: 'var(--admin-danger)' }
      : { background: 'color-mix(in srgb, var(--surface) 92%, transparent)', color: 'var(--danger)' }
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm" style={style} data-testid={testId}>
      {t('geofences.mapError')}
    </div>
  )
}
