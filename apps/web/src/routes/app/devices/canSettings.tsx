import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminSwitch } from '@/components/admin/AdminKit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import {
  canChanges,
  enabledCount,
  getCanElements,
  groupCanElements,
  isOn,
  saveCanElements,
  type CanElement,
} from '@/lib/canSettings'
import type { Device } from '@/lib/devices'

/**
 * CAN parameters card — which values the vehicle's CAN bus is allowed to send.
 *
 * Why it exists: a customer wired a working CAN adapter and the dashboard showed six parameters.
 * Nothing was broken. Every CAN element on a Teltonika device leaves the factory at priority 0,
 * which means "do not send", so a correctly installed bus reports almost nothing until somebody
 * switches the elements on. There was no way to do that short of the command console.
 *
 * The three rules this screen shares with the tracking-settings card next to it:
 *
 *  - it never says "saved". The API queues a Codec 12 command that the device collects the next time
 *    it connects; on a vehicle parked over a weekend that is days away. Every affordance here says
 *    "queued" and means it.
 *  - it sends only what the customer touched. Flipping a switch off and back on again leaves the
 *    change set empty and disarms Save, rather than queueing an 83-parameter command that changes
 *    nothing.
 *  - `supported: false` gets a sentence, not an empty list. A model with no CAN block is a fact about
 *    the hardware; zero toggles under a heading reads as a bug in us.
 *
 * The list is split because 83 rows is not a settings screen. The fourteen a passenger car or van
 * actually reports come first; tachograph fields, harvester telemetry and eleven kinds of road salt
 * sit behind a disclosure.
 */
export function CanSettingsCard({ device, canWrite }: { device: Device; canWrite: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['can-elements', device.id], queryFn: () => getCanElements(device.id) })
  /** param → wanted on/off. ONLY switches the customer touched; absence means "as the device has it". */
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [showMore, setShowMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [queued, setQueued] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const elements = useMemo(() => q.data?.elements ?? [], [q.data])
  const { primary, more } = useMemo(() => groupCanElements(elements), [elements])
  const changes = useMemo(() => canChanges(elements, draft), [elements, draft])
  const dirty = Object.keys(changes).length > 0

  const toggle = (param: string, on: boolean) => {
    setQueued(0) // a new edit retires the previous "queued" notice; it described a different command
    setDraft((d) => ({ ...d, [param]: on }))
  }

  /** The founder's actual ask, in one click: everything a car reports, on. Still only a DRAFT —
   *  nothing leaves for the device until Save, and the count under the button says what it will do. */
  const enableAllPrimary = () => {
    setQueued(0)
    setDraft((d) => {
      const next = { ...d }
      for (const e of primary) next[e.param] = true
      return next
    })
  }
  const primaryAllOn = primary.length > 0 && primary.every((e) => isOn(e, draft))

  const save = () => {
    setSaving(true)
    setError(null)
    const n = Object.keys(changes).length
    saveCanElements(device.id, changes)
      // refetch BEFORE clearing the draft, exactly as the tracking-settings card does: clearing
      // first shows the pre-change state for the whole round trip, so a switch the customer just
      // moved visibly snaps back and Save re-arms with it
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ['can-elements', device.id] })
        setDraft({})
        setQueued(n)
        void qc.invalidateQueries({ queryKey: ['commands', device.id] })
      })
      // ApiError's `message` is just "API 400"; the server's explanation lives in `detail`
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.detail !== undefined ? e.detail : t('devices.canSettings.saveError')),
      )
      .finally(() => setSaving(false))
  }

  const on = enabledCount(elements, draft)

  return (
    <Card data-testid="can-settings-card">
      <CardHeader>
        <CardTitle className="text-base">{t('devices.canSettings.title', { name: device.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading && <p className="text-sm text-muted" data-testid="can-settings-loading">{t('admin.loading')}</p>}
        {q.isError && (
          <p className="text-sm text-danger" role="alert" data-testid="can-settings-error">
            {t('devices.canSettings.loadError')}
          </p>
        )}

        {/* A model with no CAN element block. Saying so beats a heading over nothing. */}
        {q.isSuccess && q.data.supported === false && (
          <p className="text-sm text-muted" data-testid="can-settings-unsupported">
            {t('devices.canSettings.unsupported')}
          </p>
        )}

        {q.isSuccess && q.data.supported && elements.length === 0 && (
          <p className="text-sm text-muted" data-testid="can-settings-empty">
            {t('devices.canSettings.unsupported')}
          </p>
        )}

        {q.isSuccess && q.data.supported && elements.length > 0 && (
          <>
            {/* The explanation the customer needed and never got: nothing is broken, everything is
                simply switched off from the factory. */}
            <p className="text-sm text-muted" data-testid="can-settings-intro">
              {t('devices.canSettings.intro')}
            </p>
            <p className="text-xs text-muted" data-testid="can-settings-count">
              {t('devices.canSettings.count', { on, total: elements.length })}
            </p>

            <section className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{t('devices.canSettings.primary')}</h3>
                {canWrite && !primaryAllOn && (
                  <Button
                    variant="secondary"
                    onClick={enableAllPrimary}
                    disabled={saving}
                    data-testid="can-settings-enable-primary"
                  >
                    {t('devices.canSettings.enablePrimary')}
                  </Button>
                )}
              </div>
              <ul className="divide-y divide-line" data-testid="can-settings-primary-list">
                {primary.map((e) => (
                  <ElementRow key={e.param} el={e} draft={draft} disabled={!canWrite || saving} onToggle={toggle} />
                ))}
              </ul>
            </section>

            {more.length > 0 && (
              <section className="space-y-1">
                <Button
                  variant="secondary"
                  onClick={() => setShowMore((v) => !v)}
                  aria-expanded={showMore}
                  aria-controls={`can-more-${device.id}`}
                  data-testid="can-settings-more-toggle"
                >
                  {showMore ? t('devices.canSettings.moreHide') : t('devices.canSettings.more', { count: more.length })}
                </Button>
                {/* `hidden` rather than unmounting: a switch flipped down here must survive collapsing
                    the section, or a customer loses edits by tidying up before pressing Save. */}
                <ul id={`can-more-${device.id}`} hidden={!showMore} className="divide-y divide-line" data-testid="can-settings-more-list">
                  {more.map((e) => (
                    <ElementRow key={e.param} el={e} draft={draft} disabled={!canWrite || saving} onToggle={toggle} />
                  ))}
                </ul>
              </section>
            )}

            {error !== null && (
              <p className="text-sm text-danger" role="alert" data-testid="can-settings-save-error">{error}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={!canWrite || !dirty || saving} data-testid="can-settings-save">
                {saving ? t('devices.canSettings.queuing') : t('devices.canSettings.save', { count: Object.keys(changes).length })}
              </Button>
              {dirty && <span className="text-xs text-muted">{t('devices.canSettings.queuedNote')}</span>}
              {/* Not "saved". The command is in the queue and the device has not seen it — which on a
                  parked vehicle stays true for hours or days. */}
              {!dirty && queued > 0 && (
                <span className="text-xs text-muted" role="status" data-testid="can-settings-queued">
                  {t('devices.canSettings.queuedConfirm', { count: queued })}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** One element: its name in the operator's language, what the device holds, and the switch. */
function ElementRow({
  el,
  draft,
  disabled,
  onToggle,
}: {
  el: CanElement
  draft: Record<string, boolean>
  disabled: boolean
  onToggle: (param: string, on: boolean) => void
}) {
  const { t } = useTranslation()
  const on = isOn(el, draft)
  const changed = draft[el.param] !== undefined && draft[el.param] !== el.enabled
  // The API's `name` is the model's English parameter-list wording. Our catalogue is the same list in
  // the operator's language; an element we have never catalogued falls back to the API's name rather
  // than rendering a raw translation key at the customer.
  const label = t(`devices.canSettings.el.${el.param}`, { defaultValue: el.name })

  return (
    <li className="flex items-center justify-between gap-3 py-2" data-testid={`can-el-${el.param}`}>
      <div className="min-w-0">
        <div className="truncate text-sm">{label}</div>
        <div className="flex items-center gap-2">
          <span className="mono text-xs text-muted">{el.param}</span>
          {/* High/panic elements can force the device to send a record immediately, which costs
              mobile data. If an installer set one, say so rather than flattening it to "on". */}
          {on && (el.priority === 2 || el.priority === 3) && (
            <span className="text-xs text-muted" data-testid={`can-el-prio-${el.param}`}>
              {el.priority === 3 ? t('devices.canSettings.prio.panic') : t('devices.canSettings.prio.high')}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {changed && (
          <Badge variant="outline" data-testid={`can-el-changed-${el.param}`}>
            {t('devices.canSettings.notQueuedYet')}
          </Badge>
        )}
        <AdminSwitch
          checked={on}
          disabled={disabled}
          onCheckedChange={(v) => onToggle(el.param, v)}
          aria-label={label}
          data-testid={`can-el-switch-${el.param}`}
        />
      </div>
    </li>
  )
}
