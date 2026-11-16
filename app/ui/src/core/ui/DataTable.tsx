import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from './controls'

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

  // Der Tabellenkopf zeichnet sich bei React Aria verzögert neu: der Schlüssel setzt das Kästchen sicher auf den neuen Stand.
  const allChosen = rows.length > 0 && rows.every((r) => chosen.includes(rowKey(r)))
  const column = sort ? columns.find((c) => c.id === sort.id) : undefined
  const shown = column?.value ? [...rows].sort((a, b) => compare(column.value!(a), column.value!(b)) * (sort!.dir === 'asc' ? 1 : -1)) : rows

  const toggleSort = (c: DataColumn<R>) => setSort((s) => (s?.id !== c.id ? { id: c.id, dir: 'asc' } : s.dir === 'asc' ? { id: c.id, dir: 'desc' } : null))
  const toggle = (key: string) => choose(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key])
  const select = (key: string) => {
    if (selection === 'single') choose([key])
  }

  return (
    <Table className={`forge-data-table ${className}`} aria-label={ariaLabel}>
      <TableHeader>

          {selection === 'multiple' ? (
            <TableColumn isRowHeader>
              <Input
                key={String(allChosen)}
                type="checkbox"
                aria-label="Select all"
                defaultChecked={allChosen}
                onChange={(e) => choose(e.target.checked ? rows.map(rowKey) : [])}
              />
            </TableColumn>
          ) : null}
          {columns.map((c, i) => (
            <TableColumn key={c.id} isRowHeader={i === 0} aria-sort={sort?.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {c.sortable && c.value ? (
                <Button variant="bare" className="forge-link" onClick={() => toggleSort(c)}>
                  {c.header}
                  {sort?.id === c.id ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </Button>
              ) : (
                c.header
              )}
            </TableColumn>
          ))}

      </TableHeader>
      <TableBody>
        {shown.map((r) => {
          const key = rowKey(r)
          return (
            <TableRow key={key} className={chosen.includes(key) ? 'is-selected' : undefined} aria-selected={selection === 'none' ? undefined : chosen.includes(key)} onClick={() => select(key)}>
              {selection === 'multiple' ? (
                <TableCell>
                  <Input type="checkbox" aria-label={key} checked={chosen.includes(key)} onChange={() => toggle(key)} />
                </TableCell>
              ) : null}
              {columns.map((c) => (
                <TableCell key={c.id} title={c.title?.(r)}>
                  {c.render ? c.render(r) : String(c.value?.(r) ?? '')}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
        {rows.length === 0 && emptyText ? (
          <TableRow>
            <TableCell className="forge-field-hint" colSpan={columns.length + (selection === 'multiple' ? 1 : 0)}>
              {emptyText}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  )
}
