import { useCallback, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'

// Position of the divider between the Name and the Value column of a property sheet, as a share of
// the sheet width. Each place that shows a sheet (the Properties panel, the editor tab) keeps its
// own position, remembered in the browser storage; without it the sheet starts in the middle.

const MIN = 15
const MAX = 85
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v))

function load(key: string, fallback: number): number {
  try {
    const raw = Number(window.localStorage.getItem(`forge.sheetSplit.${key}`))
    return Number.isFinite(raw) && raw >= MIN && raw <= MAX ? raw : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: number) {
  try {
    window.localStorage.setItem(`forge.sheetSplit.${key}`, String(Math.round(value * 10) / 10))
  } catch {
    // the divider still keeps its place for this session
  }
}

export function useSheetSplit(key: string, area: RefObject<HTMLElement | null>, fallback = 50) {
  const [split, setSplit] = useState(() => load(key, fallback))

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const box = area.current?.getBoundingClientRect()
      if (!box || box.width <= 0) return
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture?.(e.pointerId)
      let last = split
      const move = (ev: PointerEvent) => {
        last = clamp(((ev.clientX - box.left) / box.width) * 100)
        setSplit(last)
      }
      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
        save(key, last)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    },
    [area, key, split],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? 10 : 2
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const next = clamp(split + (e.key === 'ArrowLeft' ? -step : step))
        setSplit(next)
        save(key, next)
      } else if (e.key === 'Home' || e.key === 'Enter') {
        e.preventDefault()
        setSplit(fallback)
        save(key, fallback)
      }
    },
    [fallback, key, split],
  )

  const reset = useCallback(() => {
    setSplit(fallback)
    save(key, fallback)
  }, [fallback, key])

  return { split, onPointerDown, onKeyDown, reset }
}
