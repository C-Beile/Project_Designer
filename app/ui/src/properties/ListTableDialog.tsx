import { useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '../core/Modal'
import { Button, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'
import { Icon } from '../core/icons/Icon'

export interface ListColumn<T> {
  id: string
  label: string
  width?: string
  cell: (row: T, change: (patch: Partial<T>) => void, index: number) => ReactNode
}

export interface ListTableDialogProps<T> {
  title: string
  label: string
  rows: T[]
  columns: ListColumn<T>[]
  newRow: (rows: T[]) => T
  validate: (rows: T[]) => string | null
  readOnly?: boolean
  onOk: (rows: T[]) => void
  onCancel: () => void
}

export function ListTableDialog<T>({ title, label, rows: initial, columns, newRow, validate, readOnly = false, onOk, onCancel }: ListTableDialogProps<T>) {
  const [rows, setRows] = useState<T[]>(initial)
  const [selected, setSelected] = useState(initial.length > 0 ? 0 : -1)
  const [shown, setShown] = useState<string | null>(null)
  const error = readOnly ? null : validate(rows)

  const change = (index: number, patch: Partial<T>) => {
    setShown(null)
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }
  const add = () => {
    setRows((prev) => [...prev, newRow(prev)])
    setSelected(rows.length)
  }
  const remove = () => {
    if (selected < 0) return
    setRows((prev) => prev.filter((_, i) => i !== selected))
    setSelected(Math.min(selected, rows.length - 2))
  }
  const move = (delta: number) => {
    const target = selected + delta
    if (selected < 0 || target < 0 || target >= rows.length) return
    setRows((prev) => {
      const next = [...prev]
      ;[next[selected], next[target]] = [next[target], next[selected]]
      return next
    })
    setSelected(target)
  }
  const confirm = () => {
    if (readOnly) return onCancel()
    if (error) return setShown(error)
    onOk(rows)
  }

  return (
    <Modal
      title={title}
      onClose={onCancel}
      onEnter={confirm}
      footer={
        <>
          {shown ? (
            <span className="list-dialog-error" role="alert">
              {shown}
            </span>
          ) : null}
          <Button variant="primary" onClick={confirm}>
            {readOnly ? 'Close' : 'OK'}
          </Button>
          {readOnly ? null : <Button onClick={onCancel}>Cancel</Button>}
        </>
      }
    >
      <div className="list-dialog">
        <div className="list-dialog-table">
          <Table aria-label={label} className="list-dialog-grid">
            <TableHeader>
              <TableColumn isRowHeader className="list-dialog-index" aria-label="Row" />
              {columns.map((c) => (
                <TableColumn key={c.id} style={c.width ? { width: c.width } : undefined}>
                  {c.label}
                </TableColumn>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i} aria-selected={selected === i} className={selected === i ? 'is-selected' : undefined} onClick={() => setSelected(i)}>
                  <TableCell className="list-dialog-index">{i + 1}</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.id}>{c.cell(row, (patch) => change(i, patch), i)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 ? <p className="forge-field-hint">No entries yet.</p> : null}
        </div>
        {readOnly ? null : (
          <div className="list-dialog-tools" role="toolbar" aria-label={`${label} actions`} aria-orientation="vertical">
            <Button variant="bare" aria-label="Add entry" title="Add entry" onClick={add}>
              <Icon name="plus" weight="bold" size="sm" />
            </Button>
            <Button variant="bare" aria-label="Remove entry" title="Remove the selected entry" isDisabled={selected < 0} onClick={remove}>
              <Icon name="trash" size="sm" />
            </Button>
            <Button variant="bare" aria-label="Move up" title="Move up" isDisabled={selected <= 0} onClick={() => move(-1)}>
              <Icon name="caret-up" weight="bold" size="sm" />
            </Button>
            <Button variant="bare" aria-label="Move down" title="Move down" isDisabled={selected < 0 || selected >= rows.length - 1} onClick={() => move(1)}>
              <Icon name="caret-down" weight="bold" size="sm" />
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
