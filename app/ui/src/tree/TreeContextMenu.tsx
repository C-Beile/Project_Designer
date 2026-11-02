import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuEntry } from './contextMenu'

// Popup of the tree's context menu. Dimmed entries stay visible with their reason as tooltip;
// submenus open on hover or with Right arrow. Up/Down move between the enabled entries, Enter picks,
// Escape or a click outside closes. The popup is moved back into the window if it would stick out.

export function TreeContextMenu({
  entries,
  x,
  y,
  onPick,
  onClose,
}: {
  entries: MenuEntry[]
  x: number
  y: number
  onPick: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > li > [role="menuitem"]:not([aria-disabled="true"])') ?? [])
        if (items.length === 0) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (at + 1) % items.length : at <= 0 ? items.length - 1 : at - 1
        items[next].focus()
      } else if (e.key === 'Enter' && ref.current?.contains(document.activeElement)) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement).click()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
  }, [])

  const [pos, setPos] = useState({ left: Math.max(0, Math.min(x, window.innerWidth - 240)), top: Math.max(0, Math.min(y, window.innerHeight - 24 * entries.length)) })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) return
    setPos({ left: Math.max(0, Math.min(x, window.innerWidth - r.width - 2)), top: Math.max(0, Math.min(y, window.innerHeight - r.height - 2)) })
  }, [x, y, entries.length])

  function render(list: MenuEntry[]) {
    return list.map((e) =>
      e.separator ? (
        <li key={e.id} role="separator" className="forge-ctx-sep" />
      ) : (
        <li key={e.id} role="none" className={e.children ? 'forge-ctx-parent' : undefined}>
          <button
            type="button"
            role="menuitem"
            aria-disabled={!e.enabled}
            aria-haspopup={e.children ? 'menu' : undefined}
            title={e.enabled ? undefined : e.hint}
            className="forge-ctx-item"
            onClick={() => {
              if (!e.enabled || e.children) return
              onPick(e.id)
              onClose()
            }}
          >
            {e.label}
            {e.shortcut ? <span className="forge-ctx-shortcut">{e.shortcut}</span> : null}
            {e.children ? <span aria-hidden="true"> &#9656;</span> : null}
          </button>
          {e.children && e.enabled ? (
            <ul role="menu" aria-label={e.label} className="forge-ctx-sub">
              {render(e.children)}
            </ul>
          ) : null}
        </li>
      ),
    )
  }

  return (
    <ul ref={ref} role="menu" aria-label="Context menu" className="forge-ctx-menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {render(entries)}
    </ul>
  )
}
