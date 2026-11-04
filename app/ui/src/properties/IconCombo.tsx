import { useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeApi, IconDto } from '../api/ForgeApi'
import { matchesPattern } from './WildcardPicker'

// Business background: like the original Designer, an icon property is a drop-down list that shows each
// icon next to its id. The value can still be typed (filters the list) and is stored exactly as typed or picked.

let iconCache: Promise<IconDto[]> | null = null

function loadIcons(api: ForgeApi): Promise<IconDto[]> {
  if (!iconCache) {
    iconCache = api.listIcons().catch(() => {
      iconCache = null
      return []
    })
  }
  return iconCache
}

export function IconCombo({ api, value, disabled, onCommit }: { api: ForgeApi; value: string; disabled?: boolean; onCommit: (id: string) => void }) {
  const [icons, setIcons] = useState<IconDto[]>([])
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void loadIcons(api).then((list) => !cancelled && setIcons(list))
    return () => {
      cancelled = true
    }
  }, [api])

  useEffect(() => setText(value), [value])

  const hits = useMemo(() => {
    const query = text.trim()
    const all = query === '' || query === value ? icons : icons.filter((i) => matchesPattern(i.id, `*${query}*`))
    return all.slice(0, 200)
  }, [icons, text, value])

  const current = icons.find((i) => i.id === value)

  function pick(id: string) {
    setOpen(false)
    setText(id)
    if (id !== value) onCommit(id)
  }

  return (
    <div
      className="icon-combo"
      ref={rootRef}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false)
          if (text !== value) onCommit(text.trim())
        }
      }}
    >
      <span className="icon-combo-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: current?.svg ?? '' }} />
      <input
        type="text"
        aria-label="Icon"
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            pick(text.trim())
          } else if (e.key === 'Escape') {
            setText(value)
            setOpen(false)
          } else if (e.key === 'ArrowDown') setOpen(true)
        }}
      />
      <button type="button" className="icon-combo-arrow" aria-label="Show icons" disabled={disabled} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {'▾'}
      </button>
      {open && hits.length > 0 ? (
        <ul className="icon-combo-list" role="listbox" aria-label="Icons">
          <li role="option" aria-selected={value === ''} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>
            <span className="icon-combo-art" />
            <span>(none)</span>
          </li>
          {hits.map((icon) => (
            <li key={icon.id} role="option" aria-selected={icon.id === value} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(icon.id)}>
              <span className="icon-combo-art" dangerouslySetInnerHTML={{ __html: icon.svg }} />
              <span>{icon.id}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
