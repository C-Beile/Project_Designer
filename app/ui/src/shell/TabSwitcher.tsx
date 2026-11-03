import { useEffect, useRef, useState } from 'react'
import type { EditorTab } from '../tabs/tabModel'
import { NodeIcon } from '../tree/treeIcons'

// Ctrl+Tab: a list of the open tabs, most recently used first. Ctrl+Tab goes down the list,
// Ctrl+Shift+Tab up; releasing Ctrl opens the chosen tab, Escape keeps the current one.

export function TabSwitcher({
  tabs,
  activeId,
  dirtyIds,
  onActivate,
}: {
  tabs: EditorTab[]
  activeId: string | null
  dirtyIds: ReadonlySet<string>
  onActivate: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const recent = useRef<string[]>([])
  const order = useRef<EditorTab[]>([])
  const indexRef = useRef(0)
  const openRef = useRef(false)

  // Most recently used first: the active tab moves to the front, closed tabs drop out.
  useEffect(() => {
    if (openRef.current) return
    const ids = new Set(tabs.map((t) => t.id))
    recent.current = recent.current.filter((id) => ids.has(id))
    if (activeId) recent.current = [activeId, ...recent.current.filter((id) => id !== activeId)]
    for (const t of tabs) if (!recent.current.includes(t.id)) recent.current.push(t.id)
  }, [tabs, activeId])

  useEffect(() => {
    const move = (step: number) => {
      const next = (indexRef.current + step + order.current.length) % order.current.length
      indexRef.current = next
      setIndex(next)
    }
    const close = (commit: boolean) => {
      if (!openRef.current) return
      openRef.current = false
      setOpen(false)
      const chosen = order.current[indexRef.current]
      if (commit && chosen && chosen.id !== activeId) onActivate(chosen.id)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openRef.current) {
        e.preventDefault()
        close(false)
        return
      }
      if (e.key !== 'Tab' || !e.ctrlKey) return
      e.preventDefault()
      if (tabs.length < 2) return
      if (!openRef.current) {
        order.current = recent.current.map((id) => tabs.find((t) => t.id === id)).filter((t): t is EditorTab => !!t)
        if (order.current.length < 2) return
        openRef.current = true
        indexRef.current = 0
        setOpen(true)
      }
      move(e.shiftKey ? -1 : 1)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') close(true)
    }
    const onBlur = () => close(false)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [tabs, activeId, onActivate])

  if (!open) return null
  const list = order.current
  return (
    <div className="forge-switcher-backdrop">
      <div className="forge-switcher" role="listbox" aria-label="Open tabs">
        <div className="forge-switcher-title">Open tabs</div>
        <ul>
          {list.map((t, i) => (
            <li
              key={t.id}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'is-selected' : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                openRef.current = false
                setOpen(false)
                onActivate(t.id)
              }}
            >
              <span className="forge-switcher-icon">
                <NodeIcon node={t.node} expanded={false} />
              </span>
              <span className="forge-switcher-name">{t.node.label}</span>
              {dirtyIds.has(t.id) ? <span className="forge-switcher-dirty" title="Unsaved changes" /> : null}
              <span className="forge-switcher-where">{t.project.split(/[\\/]/).filter(Boolean).pop() ?? ''}</span>
            </li>
          ))}
        </ul>
        <div className="forge-switcher-hint">Ctrl+Tab next · Ctrl+Shift+Tab previous · release Ctrl to switch</div>
      </div>
    </div>
  )
}
