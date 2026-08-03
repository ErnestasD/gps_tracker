import { Languages } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { LOCALE_LABELS, SUPPORTED_LOCALES, setLocale } from '@/lib/locale'
import { cn } from '@/lib/utils'

/**
 * Top-bar language switcher (i18n). A compact icon button opening the supported languages; picking
 * one applies it instantly AND persists it server-side (lib/locale setLocale). Sits next to the
 * theme toggle so the choice is one click, not buried in Settings.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = i18n.language.split('-')[0]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('settings.locale')} data-testid="topbar-language">
          <Languages className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            data-testid={`lang-${l}`}
            onClick={() => {
              setLocale(l)
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--admin-surface-sunken)]',
              current === l && 'font-semibold',
            )}
            style={{ color: 'var(--admin-ink)' }}
          >
            {LOCALE_LABELS[l]}
            <span className="mono text-[10px] text-muted">{l.toUpperCase()}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
