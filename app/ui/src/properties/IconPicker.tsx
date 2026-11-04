import { useEffect, useMemo, useState } from 'react'
import type { ForgeApi, IconDto } from '../api/ForgeApi'
import { matchesPattern } from './WildcardPicker'

// Business background: an icon is chosen by looking at it, not by typing an id that has to be
// remembered. The chooser shows every icon family the platform knows (Vaadin and Neon), filtered by
// a search with `*` as wildcard, and hands back the id exactly as the property stores it.

function bareName(id: string): string {
  const colon = id.indexOf(':')
  return colon >= 0 ? id.slice(colon + 1) : id
}

export function IconPicker({ api, current, onPick, onClose }: { api: ForgeApi; current: string; onPick: (id: string) => void; onClose: () => void }) {
  const [icons, setIcons] = useState<IconDto[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .listIcons()
      .then((list) => {
        if (!cancelled) setIcons(list)
      })
      .catch(() => {
        if (!cancelled) setIcons([])
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const hits = useMemo(() => (icons ?? []).filter((i) => matchesPattern(bareName(i.id), query) || matchesPattern(i.id, query)), [icons, query])

  return (
    <div
      className="icon-picker"
      role="dialog"
      aria-label="Choose icon"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="icon-picker-bar">
        <input type="text" autoFocus aria-label="Search icons" placeholder="Search icons (* is a wildcard)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" onClick={() => onPick('')} disabled={current === ''} title="Remove the icon">
          Clear
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      {icons === null ? <p className="icon-picker-note">Loading icons...</p> : null}
      {icons !== null && hits.length === 0 ? <p className="icon-picker-note">No icon matches.</p> : null}
      <div className="icon-picker-grid" role="listbox" aria-label="Icons">
        {hits.map((icon) => (
          <button
            key={icon.id}
            type="button"
            role="option"
            aria-selected={icon.id === current}
            className={icon.id === current ? 'icon-cell selected' : 'icon-cell'}
            title={icon.id}
            onClick={() => onPick(icon.id)}
            onDoubleClick={() => onPick(icon.id)}
          >
            <span className="icon-cell-art" dangerouslySetInnerHTML={{ __html: icon.svg }} />
            <span className="icon-cell-name">{bareName(icon.id)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
