import { useMemo, useState } from 'react'

// Combobox content search (manual appendix A.3): for long lists (icons, record fields) a typed
// pattern narrows the choices; `*` is the wildcard, so `*circle` finds every name containing
// "circle". Without a `*` the text must be the beginning of the name. Arrow keys move, Enter picks.

export function matchesPattern(name: string, pattern: string): boolean {
  const p = pattern.trim()
  if (!p) return true
  const body = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${body}`, 'i').test(name)
}

export function WildcardPicker({ label, options, current, onPick, onClose }: { label: string; options: string[]; current: string; onPick: (value: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const hits = useMemo(() => options.filter((o) => matchesPattern(o, query)), [options, query])
  const active = Math.min(index, Math.max(0, hits.length - 1))

  return (
    <div
      className="psheet-picker"
      role="dialog"
      aria-label={`Search ${label}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setIndex(Math.min(active + 1, hits.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setIndex(Math.max(active - 1, 0))
        } else if (e.key === 'Enter' && hits[active] !== undefined) {
          e.preventDefault()
          onPick(hits[active])
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <input autoFocus type="text" aria-label={`Filter ${label}`} placeholder="e.g. *circle" value={query} onChange={(e) => (setQuery(e.target.value), setIndex(0))} />
      <ul role="listbox" aria-label={`${label} choices`}>
        {hits.slice(0, 300).map((h, i) => (
          <li key={h} role="option" aria-selected={i === active} className={`${i === active ? 'is-selected' : ''}${h === current ? ' is-current' : ''}`} onClick={() => onPick(h)}>
            {h}
          </li>
        ))}
        {hits.length === 0 ? <li className="forge-field-hint">Nothing matches.</li> : null}
      </ul>
    </div>
  )
}
