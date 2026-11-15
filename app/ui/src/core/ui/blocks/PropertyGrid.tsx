import { Chevron } from '../../icons/Icon'
import { useState, type CSSProperties, type MouseEvent, type PointerEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

export interface GridGroup<R> {
  key: string
  label: string
  rows: R[]
}

export interface GridSplit {
  split: number
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  reset: () => void
}

export interface PropertyGridProps<R> {
  ariaLabel: string
  groups: GridGroup<R>[]
  rowKey: (row: R) => string
  rowLabel: (row: R) => string
  rowTitle?: (row: R) => string | undefined
  /** Graue, kursive Darstellung für Werte, die nicht gesetzt sind. */
  isUnset: (row: R) => boolean
  selected: string | null
  onSelect: (key: string) => void
  onRowMenu?: (row: R, event: MouseEvent) => void
  renderValue: (row: R) => ReactNode
  /** Trenner zwischen Name und Wert; ohne Angabe fehlt er. */
  split?: GridSplit
  rowsRef?: RefObject<HTMLDivElement | null>
}

/** Tabelle aus Gruppen und Zeilen (Name links, Wert rechts) mit Einklappen, Auswahl und Kontextmenü. Was in der Wertspalte steht, bestimmt der Aufrufer. */
export function PropertyGrid<R>({ ariaLabel, groups, rowKey, rowLabel, rowTitle, isUnset, selected, onSelect, onRowMenu, renderValue, split, rowsRef }: PropertyGridProps<R>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="psheet-grid" role="grid" aria-label={ariaLabel} style={split ? ({ '--sheet-split': `${split.split}%` } as CSSProperties) : undefined}>
      <div className="psheet-rows" ref={rowsRef}>
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <div key={group.key} role="rowgroup" className="psheet-group">
              <div role="row" className="psheet-group-head">
                <button
                  type="button"
                  className="psheet-toggle"
                  aria-expanded={!isCollapsed}
                  aria-label={group.label ? `${isCollapsed ? 'Expand' : 'Collapse'} ${group.label}` : isCollapsed ? 'Expand' : 'Collapse'}
                  onClick={() => toggle(group.key)}
                >
                  <Chevron open={!isCollapsed} />
                </button>
                <span className="psheet-group-label">{group.label}</span>
              </div>
              {isCollapsed
                ? null
                : group.rows.map((row) => {
                    const key = rowKey(row)
                    return (
                      <div
                        key={key}
                        role="row"
                        className={`psheet-row${isUnset(row) ? ' is-unset' : ''}${selected === key ? ' is-selected' : ''}`}
                        onMouseDown={() => onSelect(key)}
                        onFocusCapture={() => onSelect(key)}
                        onContextMenu={
                          onRowMenu
                            ? (e) => {
                                e.preventDefault()
                                onSelect(key)
                                onRowMenu(row, e)
                              }
                            : undefined
                        }
                      >
                        <span role="rowheader" className="psheet-label" title={rowTitle?.(row) ?? rowLabel(row)}>
                          {rowLabel(row)}
                        </span>
                        <span role="gridcell" className="psheet-value">
                          {renderValue(row)}
                        </span>
                      </div>
                    )
                  })}
            </div>
          )
        })}
        {split ? (
          <div
            className="sheet-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Column divider"
            aria-valuemin={15}
            aria-valuemax={85}
            aria-valuenow={Math.round(split.split)}
            tabIndex={0}
            title="Drag to resize the columns, double-click to reset"
            onPointerDown={split.onPointerDown}
            onKeyDown={split.onKeyDown}
            onDoubleClick={split.reset}
          />
        ) : null}
      </div>
    </div>
  )
}
