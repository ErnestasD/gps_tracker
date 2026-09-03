import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import {
  SHEET_KEY_STEP_PX,
  SHEET_PEEK_PX,
  initialSheetHeight,
  maxSheetHeight,
  readStoredSheet,
  refitSheet,
  resolveSheet,
  writeStoredSheet,
  type SheetGeometry,
} from '@/lib/sheet'

/**
 * The bottom sheet's drag handle, and the height it drives.
 *
 * Below `xl` the inspector is a sheet over the map, and it was a fixed 60 % of the viewport. On a
 * 1024–1279 px laptop — the whole band between the fleet list docking and the inspector becoming a
 * rail — that is most of the screen: reading a vehicle's parameters meant losing sight of where the
 * vehicle is. The panel is dragged now, pushed down to a header-only strip and pulled back up.
 *
 * Pointer events, not touch + mouse separately: one code path for a finger, a trackpad and a
 * stylus, with capture so a fast drag that leaves the handle keeps resizing instead of sticking.
 *
 * The handle is a `separator` with a value, so it is operable from the keyboard — arrows nudge,
 * Home/End go to full and away, Enter toggles. A drag-only control is a control some people cannot
 * use at all, and this one decides whether the rest of the panel is reachable.
 */
export function useSheet(containerRef: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [container, setContainer] = useState(0)
  const [sheet, setSheet] = useState<SheetGeometry>({ heightPx: 0, peek: false })
  const seeded = useRef(false)

  // measure the map area the sheet sits in — the clamp is against THIS, not the window: the map
  // column has a header above it and the timeline dock below
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setContainer(entry?.contentRect.height ?? 0))
    ro.observe(el)
    setContainer(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [containerRef])

  useEffect(() => {
    if (container <= 0) return
    if (!seeded.current) {
      seeded.current = true
      const stored = readStoredSheet(typeof window === 'undefined' ? undefined : window.localStorage)
      const px = initialSheetHeight(container, stored)
      setSheet({ heightPx: px, peek: stored === SHEET_PEEK_PX })
      return
    }
    setSheet((cur) => refitSheet(cur, container))
  }, [container])

  const commit = useCallback(
    (next: SheetGeometry) => {
      setSheet(next)
      writeStoredSheet(typeof window === 'undefined' ? undefined : window.localStorage, next.heightPx)
    },
    [],
  )

  const dragRef = useRef<{ startY: number; startPx: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    dragRef.current = { startY: e.clientY, startPx: sheet.peek ? SHEET_PEEK_PX : sheet.heightPx }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (d === null) return
    // dragging UP (negative dy) makes the sheet taller — it grows from the bottom edge
    setSheet(resolveSheet(d.startPx + (d.startY - e.clientY), container))
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    commit(sheet)
  }

  const nudge = (dy: number) => commit(resolveSheet((sheet.peek ? SHEET_PEEK_PX : sheet.heightPx) + dy, container))
  const toggle = () =>
    commit(sheet.peek ? resolveSheet(initialSheetHeight(container, null), container) : { heightPx: SHEET_PEEK_PX, peek: true })

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return
    const keys: Record<string, () => void> = {
      ArrowUp: () => nudge(SHEET_KEY_STEP_PX),
      ArrowDown: () => nudge(-SHEET_KEY_STEP_PX),
      Home: () => commit(resolveSheet(maxSheetHeight(container), container)),
      End: () => commit({ heightPx: SHEET_PEEK_PX, peek: true }),
      Enter: toggle,
      ' ': toggle,
    }
    const run = keys[e.key]
    if (run === undefined) return
    e.preventDefault()
    run()
  }

  return {
    sheet,
    container,
    toggle,
    gripProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onKeyDown },
  }
}

/**
 * The grip itself: a wide hit area with a small pill in it.
 *
 * `touch-action: none` matters — without it a finger drag scrolls the page and the sheet never
 * moves, which reads as the handle being decorative.
 */
export function SheetGrip({
  sheet,
  container,
  gripProps,
  onToggle,
  className,
}: {
  sheet: SheetGeometry
  container: number
  gripProps: React.HTMLAttributes<HTMLDivElement>
  onToggle: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      {...gripProps}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('map.inspector.resize')}
      aria-valuenow={Math.round(sheet.heightPx)}
      aria-valuemin={SHEET_PEEK_PX}
      aria-valuemax={Math.round(maxSheetHeight(container))}
      tabIndex={0}
      onDoubleClick={onToggle}
      data-testid="sheet-grip"
      className={cn(
        'group flex h-5 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-accent xl:hidden',
        className,
      )}
      title={t('map.inspector.resize')}
    >
      <span className="h-1 w-10 rounded-full bg-line transition-colors group-hover:bg-muted group-focus-visible:bg-accent" aria-hidden />
    </div>
  )
}
