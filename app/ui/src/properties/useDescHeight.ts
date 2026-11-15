import { useCallback, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { configGet, configSet } from '../settings/appConfig'

// Höhe des Doku-Felds unter dem Property Sheet in px. Gemerkt in designer.conf ([layout.sheet_desc_height]).
// Ohne Wert bestimmt der Inhalt die Höhe (bis zu einem Drittel des Panels).

const MIN = 40
const MAX = 800
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)))

function load(key: string): number | null {
  const raw = Number(configGet<number>('layout', 'sheet_desc_height', key))
  return Number.isFinite(raw) && raw >= MIN && raw <= MAX ? raw : null
}

export function useDescHeight(key: string, area: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(() => load(key))

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const box = area.current
      if (!box) return
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture?.(e.pointerId)
      const startY = e.clientY
      const startH = box.getBoundingClientRect().height
      let last = startH
      const move = (ev: PointerEvent) => {
        last = clamp(startH + (startY - ev.clientY))
        setHeight(last)
      }
      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
        configSet(['layout', 'sheet_desc_height', key], last)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    },
    [area, key],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const current = height ?? area.current?.getBoundingClientRect().height ?? 80
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = clamp(current + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 40 : 10))
        setHeight(next)
        configSet(['layout', 'sheet_desc_height', key], next)
      } else if (e.key === 'Home' || e.key === 'Enter') {
        e.preventDefault()
        setHeight(null)
        configSet(['layout', 'sheet_desc_height', key], null)
      }
    },
    [area, height, key],
  )

  const reset = useCallback(() => {
    setHeight(null)
    configSet(['layout', 'sheet_desc_height', key], null)
  }, [key])

  return { height, onPointerDown, onKeyDown, reset }
}
