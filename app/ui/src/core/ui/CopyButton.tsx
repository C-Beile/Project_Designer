import { useEffect, useRef, useState } from 'react'
import { copyText } from '../clipboard'
import { Button } from './controls'
import { Icon } from '../icons/Icon'

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
    <Button variant="bare" className={`forge-copy-btn${className ? ` ${className}` : ''}`} data-state={state} aria-label={label} title={title} onClick={(e) => void copy(e)}>
      <Icon name="copy" size="sm" className="forge-copy-icon" />
      <Icon name="check" weight="bold" size="sm" className="forge-copy-check" />
      <span className="forge-copy-live" role="status">
        {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </Button>
  )
}
