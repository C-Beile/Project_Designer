import type { ComponentProps, CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import {
  Cell as AriaCell,
  Column as AriaColumn,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableHeader as AriaTableHeader,
} from 'react-aria-components'

// Die Tabelle mit React Aria: `Table` > `TableHeader` > `TableColumn` und `TableBody` > `TableRow` > `TableCell`.
// Die Namen entsprechen table, thead, th, tbody, tr und td. Es entstehen echte `<table>`-Elemente,
// bestehende Klassen (z. B. `forge-problems-table`) gelten weiter. React Aria gibt `title`, `onClick`
// und `aria-sort` nicht an das Element weiter; `render` setzt sie.

// Tippt jemand in ein Eingabefeld in der Tabelle, darf React Aria das nicht als Zeilen-Navigation oder
// Buchstaben-Suche (Typeahead) lesen: sonst springt der Fokus weg.
const inField = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]') !== null
function fieldSafe<E extends HTMLElement>(handler?: (e: KeyboardEvent<E>) => void) {
  return (e: KeyboardEvent<E>) => {
    if (!inField(e)) handler?.(e)
  }
}

interface Common {
  className?: string
  style?: CSSProperties
  title?: string
  children?: ReactNode
}

export interface TableProps extends Common {
  'aria-label': string
  /** Weitere Attribute und Ereignisse für das `<table>` (z. B. Ablegen per Drag and Drop). */
  domProps?: ComponentProps<'table'>
}

function tableDom(dom: unknown): ComponentProps<'table'> {
  const d = dom as ComponentProps<'table'>
  return { ...d, onKeyDown: fieldSafe(d.onKeyDown), onKeyDownCapture: fieldSafe(d.onKeyDownCapture) }
}

export function Table({ className, style, title, children, domProps, 'aria-label': label }: TableProps) {
  return (
    <AriaTable aria-label={label} className={className} style={style} render={(dom) => <table {...tableDom(dom)} {...domProps} title={title} />}>
      {children}
    </AriaTable>
  )
}

export function TableHeader({ className, children }: Common) {
  return <AriaTableHeader className={className}>{children}</AriaTableHeader>
}

export interface TableColumnProps extends Common {
  id?: string
  colSpan?: number
  /** Genau eine Spalte je Tabelle: React Aria verlangt sie für die Zeilenüberschrift. */
  isRowHeader?: boolean
  'aria-label'?: string
  onClick?: (e: MouseEvent<HTMLTableCellElement>) => void
  domProps?: ComponentProps<'th'>
  'aria-sort'?: 'none' | 'ascending' | 'descending' | 'other'
}

export function TableColumn({ className, style, title, children, onClick, domProps, 'aria-sort': sort, 'aria-label': label, ...props }: TableColumnProps) {
  return (
    <AriaColumn
      {...props}
      textValue={label}
      className={className}
      style={style}
      render={(dom) => (
        <th
          {...(dom as ComponentProps<'th'>)}
          {...domProps}
          title={title}
          aria-label={label}
          aria-sort={sort ?? dom['aria-sort']}
          onClick={(e) => {
            (dom as ComponentProps<'th'>).onClick?.(e)
            onClick?.(e)
          }}
        />
      )}
    >
      {children}
    </AriaColumn>
  )
}

export function TableBody({ className, children }: Common) {
  return <AriaTableBody className={className}>{children}</AriaTableBody>
}

export interface TableRowProps extends Common {
  id?: string
  'aria-selected'?: boolean
  'aria-label'?: string
  onClick?: (e: MouseEvent<HTMLTableRowElement>) => void
  onDoubleClick?: (e: MouseEvent<HTMLTableRowElement>) => void
  onContextMenu?: (e: MouseEvent<HTMLTableRowElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTableRowElement>) => void
  domProps?: ComponentProps<'tr'>
}

export function TableRow({ className, style, title, children, onClick, onKeyDown, domProps, 'aria-selected': selected, ...props }: TableRowProps) {
  return (
    <AriaRow
      {...props}
     
      className={className}
      style={style}
      render={(dom) => (
        <tr
          {...(dom as ComponentProps<'tr'>)}
          {...domProps}
          title={title}
          aria-selected={selected ?? dom['aria-selected']}
          onKeyDown={(e) => {
            if (inField(e)) return
            ;(dom as ComponentProps<'tr'>).onKeyDown?.(e)
            onKeyDown?.(e)
          }}
          onKeyDownCapture={fieldSafe((dom as ComponentProps<'tr'>).onKeyDownCapture)}
          onClick={(e) => {
            (dom as ComponentProps<'tr'>).onClick?.(e)
            onClick?.(e)
          }}
        />
      )}
    >
      {children}
    </AriaRow>
  )
}

export interface TableCellProps extends Common {
  colSpan?: number
  onClick?: (e: MouseEvent<HTMLTableCellElement>) => void
  onDoubleClick?: (e: MouseEvent<HTMLTableCellElement>) => void
  onContextMenu?: (e: MouseEvent<HTMLTableCellElement>) => void
  domProps?: ComponentProps<'td'>
}

export function TableCell({ className, style, title, children, onClick, domProps, ...props }: TableCellProps) {
  return (
    <AriaCell
      {...props}
      className={className}
      style={style}
      render={(dom) => (
        <td
          {...(dom as ComponentProps<'td'>)}
          {...domProps}
          title={title}
          onKeyDown={fieldSafe((dom as ComponentProps<'td'>).onKeyDown)}
          onKeyDownCapture={fieldSafe((dom as ComponentProps<'td'>).onKeyDownCapture)}
          onClick={(e) => {
            (dom as ComponentProps<'td'>).onClick?.(e)
            onClick?.(e)
          }}
        />
      )}
    >
      {children}
    </AriaCell>
  )
}
