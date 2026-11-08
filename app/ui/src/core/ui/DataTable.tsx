import { useState } from 'react'
import type { ReactNode } from 'react'

// Maske "Tabelle": Spaltenbeschreibung, Sortierung per Klick auf die Kopfzeile, optional Auswahl
// (eine Zeile oder mehrere mit Häkchen). Gleiche Optik wie die vorhandenen Tabellen (forge-problems-table).

export interface DataColumn<R> {
  id: string
  header: string
  /** Zellinhalt; ohne: String(value(row)). */
  render?: (row: R) => ReactNode
  /** Wert zum Sortieren und für den Standard-Zellinhalt. */
  value?: (row: R) => string | number | null | undefined
  sortable?: boolean
  /** Tooltip der Zelle. */
  title?: (row: R) => string | undefined
}

export interface DataTableProps<R> {
  columns: DataColumn<R>[]
  rows: R[]
  rowKey: (row: R) => string
  ariaLabel: string
  /** Standard 'forge-problems-table'. */
  className?: string
  emptyText?: string
  selection?: 'none' | 'single' | 'multiple'
  /** Gewählte Schlüssel (gesteuert); ohne: die Tabelle merkt sich die Auswahl selbst. */
  selected?: string[]
  onSelectedChange?: (keys: string[]) => void
}

type Sort = { id: string; dir: 'asc' | 'desc' } | null

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

export function DataTable<R>({ columns, rows, rowKey, ariaLabel, className = 'forge-problems-table', emptyText, selection = 'none', selected, onSelectedChange }: DataTableProps<R>) {
  const [sort, setSort] = useState<Sort>(null)
  const [own, setOwn] = useState<string[]>([])
  const chosen = selected ?? own
  const choose = (keys: string[]) => {
    setOwn(keys)
    onSelectedChange?.(keys)
  }

  const column = sort ? columns.find((c) => c.id === sort.id) : undefined
  const shown = column?.value ? [...rows].sort((a, b) => compare(column.value!(a), column.value!(b)) * (sort!.dir === 'asc' ? 1 : -1)) : rows

  const toggleSort = (c: DataColumn<R>) => setSort((s) => (s?.id !== c.id ? { id: c.id, dir: 'asc' } : s.dir === 'asc' ? { id: c.id, dir: 'desc' } : null))
  const toggle = (key: string) => choose(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key])
  const select = (key: string) => {
    if (selection === 'single') choose([key])
  }

  return (
    <table className={`forge-data-table ${className}`} aria-label={ariaLabel}>
      <thead>
        <tr>
          {selection === 'multiple' ? (
            <th>
              <input
                type="checkbox"
                aria-label="Select all"
                checked={rows.length > 0 && rows.every((r) => chosen.includes(rowKey(r)))}
                onChange={(e) => choose(e.target.checked ? rows.map(rowKey) : [])}
              />
            </th>
          ) : null}
          {columns.map((c) => (
            <th key={c.id} aria-sort={sort?.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {c.sortable && c.value ? (
                <button type="button" className="forge-link" onClick={() => toggleSort(c)}>
                  {c.header}
                  {sort?.id === c.id ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              ) : (
                c.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => {
          const key = rowKey(r)
          return (
            <tr key={key} className={chosen.includes(key) ? 'is-selected' : undefined} aria-selected={selection === 'none' ? undefined : chosen.includes(key)} onClick={() => select(key)}>
              {selection === 'multiple' ? (
                <td>
                  <input type="checkbox" aria-label={key} checked={chosen.includes(key)} onChange={() => toggle(key)} />
                </td>
              ) : null}
              {columns.map((c) => (
                <td key={c.id} title={c.title?.(r)}>
                  {c.render ? c.render(r) : String(c.value?.(r) ?? '')}
                </td>
              ))}
            </tr>
          )
        })}
        {rows.length === 0 && emptyText ? (
          <tr>
            <td className="forge-field-hint" colSpan={columns.length + (selection === 'multiple' ? 1 : 0)}>
              {emptyText}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}
