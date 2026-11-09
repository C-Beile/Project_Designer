import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '../Modal'

// Maske "Liste": suchbare Liste mit Einzel- oder Mehrfachauswahl. Einzelauswahl: Pfeiltasten,
// Enter und Doppelklick wählen aus. Mehrfachauswahl: Häkchen pro Zeile, OK gibt alle zurück.

export interface ListItem<T = unknown> {
  id: string
  label: string
  /** Zusatztext hinter dem Namen (z. B. der Typ). */
  hint?: string
  data?: T
}

export interface ListDialogProps<T = unknown> {
  title: string
  items: ListItem<T>[]
  /** Eigener Filter; ohne: Teiltext im Namen, Groß-/Kleinschreibung egal. */
  filter?: (items: ListItem<T>[], query: string) => ListItem<T>[]
  searchable?: boolean
  searchLabel?: string
  /** Zugänglicher Name des Suchfelds; Standard: searchLabel. */
  searchAriaLabel?: string
  searchPlaceholder?: string
  listLabel?: string
  emptyText?: string
  multiple?: boolean
  /** Vorgewählte Ids (nur Mehrfachauswahl). */
  selected?: string[]
  okLabel?: string
  cancelLabel?: string
  /** Weitere Knöpfe in der Fußzeile; sie bekommen die aktuelle Auswahl. */
  actions?: { id: string; label: string; onClick: (picked: ListItem<T>[]) => void }[]
  header?: ReactNode
  onPick: (picked: ListItem<T>[]) => void
  onCancel: () => void
}

function defaultFilter<T>(items: ListItem<T>[], query: string): ListItem<T>[] {
  const q = query.trim().toLowerCase()
  return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items
}

export function ListDialog<T = unknown>({
  title,
  items,
  filter = defaultFilter,
  searchable = true,
  searchLabel = 'Search',
  searchAriaLabel,
  searchPlaceholder,
  listLabel = 'Items',
  emptyText = 'Nothing found.',
  multiple = false,
  selected,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  actions,
  header,
  onPick,
  onCancel,
}: ListDialogProps<T>) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected ?? []))
  const hits = useMemo(() => filter(items, query), [filter, items, query])
  const active = Math.min(index, Math.max(0, hits.length - 1))
  const picked = (): ListItem<T>[] => (multiple ? items.filter((i) => checked.has(i.id)) : hits[active] ? [hits[active]] : [])
  const canPick = multiple ? checked.size > 0 : hits.length > 0
  const ok = () => {
    if (canPick) onPick(picked())
  }
  const toggle = (id: string) =>
    setChecked((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" disabled={!canPick} onClick={ok}>
            {okLabel}
          </button>
          {actions?.map((a) => (
            <button key={a.id} type="button" onClick={() => a.onClick(picked())}>
              {a.label}
            </button>
          ))}
          <button type="button" onClick={onCancel}>
            {cancelLabel}
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
          } else if (e.key === 'Enter' && canPick) {
            e.preventDefault()
            ok()
          }
        }}
      >
        {header}
        {searchable ? (
          <label className="forge-field">
            <span>{searchLabel}</span>
            <input
              type="text"
              aria-label={searchAriaLabel ?? searchLabel}
              value={query}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQuery(e.target.value)
                setIndex(0)
              }}
            />
          </label>
        ) : null}
        <ul className="forge-openmodel-list" aria-label={listLabel}>
          {hits.map((m, i) => (
            <li key={m.id} className={!multiple && i === active ? 'is-selected' : undefined} onClick={() => setIndex(i)} onDoubleClick={() => !multiple && onPick([m])}>
              {multiple ? (
                <label className="forge-check">
                  <input type="checkbox" checked={checked.has(m.id)} aria-label={m.label} onChange={() => toggle(m.id)} />
                  <span>{m.label}</span>
                </label>
              ) : (
                <span>{m.label}</span>
              )}
              {m.hint ? <span className="forge-field-hint"> {m.hint}</span> : null}
            </li>
          ))}
          {hits.length === 0 ? <li className="forge-field-hint">{emptyText}</li> : null}
        </ul>
      </div>
    </Modal>
  )
}
