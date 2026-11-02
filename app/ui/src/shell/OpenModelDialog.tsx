import { useMemo, useState } from 'react'
import { Modal } from './Dialogs'

// File > Open (Ctrl+O, manual 4.1 "Open/Search for one data model in a project"): type a part of
// the name, `*` works as a wildcard, Enter or a double click opens the model.

export interface ModelEntry {
  type: string
  name: string
}

export function matchModels(models: ModelEntry[], query: string, limit = 200): ModelEntry[] {
  const q = query.trim()
  if (!q) return models.slice(0, limit)
  const pattern = new RegExp(q.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i')
  return models.filter((m) => pattern.test(m.name)).slice(0, limit)
}

export function OpenModelDialog({ models, onPick, onClose }: { models: ModelEntry[]; onPick: (m: ModelEntry) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const hits = useMemo(() => matchModels(models, query), [models, query])
  const active = Math.min(index, Math.max(0, hits.length - 1))

  return (
    <Modal
      title="Open"
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={hits.length === 0} onClick={() => hits[active] && onPick(hits[active])}>
            Open
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div
        className="forge-openmodel"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex(Math.min(active + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex(Math.max(active - 1, 0))
          } else if (e.key === 'Enter' && hits[active]) {
            e.preventDefault()
            onPick(hits[active])
          }
        }}
      >
        <label className="forge-field">
          <span>Data model</span>
          <input
            type="text"
            aria-label="Data model name"
            value={query}
            placeholder="Name, * as wildcard"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
          />
        </label>
        <ul className="forge-openmodel-list" aria-label="Matching data models">
          {hits.map((m, i) => (
            <li key={`${m.type}:${m.name}`} className={i === active ? 'is-selected' : undefined} onClick={() => setIndex(i)} onDoubleClick={() => onPick(m)}>
              <span>{m.name}</span>
              <span className="forge-field-hint"> {m.type}</span>
            </li>
          ))}
          {hits.length === 0 ? <li className="forge-field-hint">No data model matches.</li> : null}
        </ul>
      </div>
    </Modal>
  )
}
