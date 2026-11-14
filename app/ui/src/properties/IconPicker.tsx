import { useResource } from '../core/hooks/useResource'
import { useMemo, useState } from 'react'
import type { ForgeApi, IconDto } from '../api/ForgeApi'
import { matchesPattern } from './WildcardPicker'
import { Button, Input } from '../core/ui/controls'

// Business background: an icon is chosen by looking at it, not by typing an id that has to be
// remembered. The chooser shows every icon family the platform knows (Vaadin and Neon), filtered by
// a search with `*` as wildcard, and hands back the id exactly as the property stores it.

function bareName(id: string): string {
  const colon = id.indexOf(':')
  return colon >= 0 ? id.slice(colon + 1) : id
}

const NO_ICONS: IconDto[] = []

export function IconPicker({ api, current, onPick, onClose }: { api: ForgeApi; current: string; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')

  const loaded = useResource(() => api.listIcons(), [api])
  const icons = loaded.data ?? (loaded.error ? NO_ICONS : null)

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
        <Input type="text" autoFocus aria-label="Search icons" placeholder="Search icons (* is a wildcard)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="bare" onClick={() => onPick('')} isDisabled={current === ''} title="Remove the icon">
          Clear
        </Button>
        <Button variant="bare" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {icons === null ? <p className="icon-picker-note">Loading icons...</p> : null}
      {icons !== null && hits.length === 0 ? <p className="icon-picker-note">No icon matches.</p> : null}
      <div className="icon-picker-grid" role="listbox" aria-label="Icons">
        {hits.map((icon) => (
          <Button variant="bare"
            key={icon.id}

            role="option"
            aria-selected={icon.id === current}
            className={icon.id === current ? 'icon-cell selected' : 'icon-cell'}
            title={icon.id}
            onClick={() => onPick(icon.id)}
            onDoubleClick={() => onPick(icon.id)}
          >
            <span className="icon-cell-art" dangerouslySetInnerHTML={{ __html: icon.svg }} />
            <span className="icon-cell-name">{bareName(icon.id)}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
