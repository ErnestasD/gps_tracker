import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  COMMAND_PRESETS,
  hasPendingCommand,
  isDestructiveCommand,
  listDeviceCommands,
  sendCommand,
  statusVariant,
} from '@/lib/commands'
import type { Device } from '@/lib/devices'

/** Codec-12 command panel for one device (E08-2b): 10 presets + free text + history.
 * Destructive commands (cpureset/deleterecords) are two-step: first click arms a danger
 * confirm, the second click sends; changing the text or picking another preset disarms. */
export function CommandsCard({ device }: { device: Device }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [armed, setArmed] = useState(false)
  const [dwell, setDwell] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (dwellTimer.current !== null) clearTimeout(dwellTimer.current) }, [])

  const history = useQuery({
    queryKey: ['commands', device.id],
    queryFn: () => listDeviceCommands(device.id),
    // poll while anything is still queued/sent so acks/failures show up without a reload
    refetchInterval: (q) => (hasPendingCommand(q.state.data ?? []) ? 5000 : false),
  })

  const setCommand = (next: string) => {
    setText(next)
    setArmed(false) // any edit or preset switch disarms a pending destructive confirm
    setDwell(false)
    if (dwellTimer.current !== null) clearTimeout(dwellTimer.current)
    setError(null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const cmd = text.trim()
    if (cmd === '') return
    if (!/^[\x20-\x7e]+$/.test(cmd)) {
      // mirror the server zod gate with a SPECIFIC message (a bare 400 would be opaque)
      setError(t('devices.cmd.asciiError'))
      return
    }
    if (isDestructiveCommand(cmd) && !armed) {
      setArmed(true) // first click only arms — the operator must confirm
      // dwell: swallow the second half of a double-click so "confirm" is a deliberate act
      setDwell(true)
      dwellTimer.current = setTimeout(() => setDwell(false), 600)
      return
    }
    if (dwell) return
    setBusy(true)
    setError(null)
    sendCommand(device.id, cmd)
      .then(() => {
        setText('')
        setArmed(false)
        void qc.invalidateQueries({ queryKey: ['commands', device.id] })
      })
      .catch(() => setError(t('devices.cmd.sendError')))
      .finally(() => setBusy(false))
  }

  return (
    <Card data-testid="commands-card">
      <CardHeader>
        <CardTitle className="text-base">{t('devices.cmd.title', { name: device.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {COMMAND_PRESETS.map((p) => (
            <Button
              key={p.key}
              variant={isDestructiveCommand(p.text) ? 'ghost' : 'secondary'}
              size="sm"
              data-testid={`preset-${p.key}`}
              className={isDestructiveCommand(p.text) ? 'text-danger' : undefined}
              onClick={() => setCommand(p.text)}
            >
              {t(`devices.cmd.preset.${p.key}`)}
            </Button>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setCommand(e.target.value)}
            maxLength={512}
            placeholder={t('devices.cmd.placeholder')}
            data-testid="command-text"
            className="w-80 font-mono text-xs"
          />
          <Button
            type="submit"
            variant={armed ? 'danger' : 'default'}
            disabled={busy || dwell || text.trim() === ''}
            data-testid="command-send"
          >
            {armed ? t('devices.cmd.confirm', { cmd: text.trim() }) : t('devices.cmd.send')}
          </Button>
          {armed && (
            <p role="alert" className="w-full text-sm text-danger" data-testid="command-armed">
              {t('devices.cmd.destructiveWarn')}
            </p>
          )}
          {error !== null && (
            <p role="alert" className="w-full text-sm text-danger" data-testid="command-error">
              {error}
            </p>
          )}
        </form>

        {history.isError ? (
          <p className="text-sm text-danger">{t('devices.cmd.loadError')}</p>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t('devices.cmd.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="commands-table">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">{t('devices.cmd.command')}</th>
                  <th className="py-2 pr-4 font-medium">{t('devices.cmd.status')}</th>
                  <th className="py-2 pr-4 font-medium">{t('devices.cmd.response')}</th>
                  <th className="py-2 pr-4 font-medium">{t('devices.cmd.at')}</th>
                </tr>
              </thead>
              <tbody>
                {(history.data ?? []).map((c) => (
                  <tr key={c.id} className="border-b border-line/50" data-testid={`command-${c.id}`}>
                    <td className="py-2 pr-4 font-mono text-xs">{c.text}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={statusVariant(c.status)}>{t(`devices.cmd.st.${c.status}`, c.status)}</Badge>
                    </td>
                    <td className="max-w-64 truncate py-2 pr-4 font-mono text-xs" title={c.response ?? ''}>
                      {c.response ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
