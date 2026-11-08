import { useEffect, useRef, useState } from 'react'
import { copyText } from '../clipboard'

export interface CopyButtonProps {
  /** Der Text, oder eine Funktion, die ihn erst beim Klick liefert (spart Arbeit bei vielen Knöpfen). */
  text: string | (() => string)
  /** Für Screenreader und Tooltip, z. B. "Copy line". */
  label?: string
  className?: string
  /** Wie lange der grüne Haken bleibt (ms). */
  feedbackMs?: number
  onCopied?: () => void
}

/**
 * Kleiner Kopieren-Knopf. Nach dem Klick zeigt er kurz einen grünen Haken mit Animation.
 * Überall in der App für "diesen Text kopieren" verwenden (Farben kommen aus den Theme-Variablen).
 */
export function CopyButton({ text, label = 'Copy', className, feedbackMs = 1500, onCopied }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    const ok = await copyText(typeof text === 'function' ? text() : text)
    setState(ok ? 'done' : 'failed')
    if (ok) onCopied?.()
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), feedbackMs)
  }

  const title = state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label
  return (
    <button type="button" className={`forge-copy-btn${className ? ` ${className}` : ''}`} data-state={state} aria-label={label} title={title} onClick={(e) => void copy(e)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="forge-copy-icon">
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="forge-copy-check">
        <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="forge-copy-live" role="status">
        {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </button>
  )
}
