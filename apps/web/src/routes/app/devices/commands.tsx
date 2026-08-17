import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  COMMAND_PRESETS,
  hasPendingCommand,
  isDestructiveCommand,
  listDeviceCommands,
  sendCommand,
} from '@/lib/commands'
import { useFmt } from '@/lib/datetime'
import type { Device } from '@/lib/devices'

/**
 * Codec-12 command panel for one device (E08-2b), reshaped into a CONSOLE (founder request
 * 2026-08-17): presets stay as one-click chips, but the history renders as a terminal —
 * each command a prompt line, the device's reply indented under it, a live "waiting" line
 * while queued/sent — and the input is the prompt itself (Enter sends, ↑/↓ recalls previous
 * commands). The console palette is deliberately fixed-dark in both themes: it reads as a
 * terminal, and device replies are raw ASCII that wants mono-on-dark.
 *
 * Destructive commands (cpureset/deleterecords) keep the two-step arm/confirm; the e2e
 * testids (commands-card / preset-* / command-text / command-send / command-armed /
 * commands-table) are contracts — the terminal container carries `commands-table`.
 */
const CONSOLE = {
  bg: '#0B1020',
  line: '#22304C',
  ink: '#E6EDF3',
  muted: '#8B949E',
  prompt: '#7AA2F7',
  reply: '#7CE38B',
  danger: '#F97066',
} as const

const STATUS_GLYPH: Record<string, { glyph: string; color: string }> = {
  queued: { glyph: '·', color: CONSOLE.muted },
  sent: { glyph: '→', color: CONSOLE.prompt },
  acked: { glyph: '✓', color: CONSOLE.reply },
  failed: { glyph: '✗', color: CONSOLE.danger },
  expired: { glyph: '✗', color: CONSOLE.danger },
}

export function CommandsCard({ device }: { device: Device }) {
  const { t } = useTranslation()
  const { dt } = useFmt()
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

  // terminal ordering: oldest first, newest at the prompt — like a real console session
  const ordered = [...(history.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // ↑/↓ recall previous commands (unique, newest first); recallIdx === -1 means "own draft"
  const recall = [...new Set(ordered.map((c) => c.text).reverse())]
  const [recallIdx, setRecallIdx] = useState(-1)
  const onPromptKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(recallIdx + 1, recall.length - 1)
      if (next >= 0 && recall[next] !== undefined) { setCommand(recall[next]); setRecallIdx(next) }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = recallIdx - 1
      if (next < 0) { setCommand(''); setRecallIdx(-1) }
      else if (recall[next] !== undefined) { setCommand(recall[next]); setRecallIdx(next) }
    }
  }

  // keep the console pinned to the newest line as history grows/polls
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [ordered.length, history.dataUpdatedAt])

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
        setRecallIdx(-1)
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

        {armed && (
          <p role="alert" className="text-sm text-danger" data-testid="command-armed">
            {t('devices.cmd.destructiveWarn')}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-danger" data-testid="command-error">
            {error}
          </p>
        )}

        {/* the console: history as a session transcript + the prompt as the input */}
        <div
          data-testid="commands-table"
          className="overflow-hidden rounded-lg border font-mono text-xs"
          style={{ background: CONSOLE.bg, borderColor: CONSOLE.line }}
        >
          <div ref={scrollRef} className="max-h-80 space-y-2 overflow-y-auto p-3">
            {history.isLoading ? (
              <p data-testid="commands-loading" style={{ color: CONSOLE.muted }}>{t('admin.loading')}</p>
            ) : history.isError ? (
              <p style={{ color: CONSOLE.danger }}>{t('devices.cmd.loadError')}</p>
            ) : ordered.length === 0 ? (
              <p style={{ color: CONSOLE.muted }}>{t('devices.cmd.termEmpty', { name: device.name })}</p>
            ) : (
              ordered.map((c) => {
                const st = STATUS_GLYPH[c.status] ?? { glyph: '?', color: CONSOLE.muted }
                const pending = c.status === 'queued' || c.status === 'sent'
                return (
                  <div key={c.id} data-testid={`command-${c.id}`}>
                    <div className="flex items-baseline gap-2">
                      <span aria-hidden style={{ color: CONSOLE.prompt }}>›</span>
                      <span className="break-all" style={{ color: CONSOLE.ink }}>{c.text}</span>
                      <span title={t(`devices.cmd.st.${c.status}`, c.status)} style={{ color: st.color }}>{st.glyph}</span>
                      <span className="ml-auto shrink-0" style={{ color: CONSOLE.muted }}>{dt(c.createdAt)}</span>
                    </div>
                    {c.response !== null && c.response !== '' ? (
                      <pre className="whitespace-pre-wrap break-all pl-5" style={{ color: CONSOLE.reply }}>{c.response}</pre>
                    ) : pending ? (
                      <div className="animate-pulse pl-5" style={{ color: CONSOLE.muted }}>{t('devices.cmd.waiting')}</div>
                    ) : (
                      <div className="pl-5" style={{ color: CONSOLE.danger }}>{t(`devices.cmd.st.${c.status}`, c.status)}</div>
                    )}
                  </div>
                )
              })
            )}
          </div>
          <form
            onSubmit={submit}
            className="flex items-center gap-2 border-t px-3 py-2"
            style={{ borderColor: CONSOLE.line }}
          >
            <span aria-hidden style={{ color: armed ? CONSOLE.danger : CONSOLE.prompt }}>›</span>
            <input
              value={text}
              onChange={(e) => { setCommand(e.target.value); setRecallIdx(-1) }}
              onKeyDown={onPromptKey}
              maxLength={512}
              placeholder={t('devices.cmd.placeholder')}
              aria-label={t('devices.cmd.send')}
              data-testid="command-text"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
              style={{ color: CONSOLE.ink, caretColor: CONSOLE.prompt }}
            />
            <Button
              type="submit"
              size="sm"
              variant={armed ? 'danger' : 'default'}
              disabled={busy || dwell || text.trim() === ''}
              data-testid="command-send"
            >
              {armed ? t('devices.cmd.confirm', { cmd: text.trim() }) : t('devices.cmd.send')}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
