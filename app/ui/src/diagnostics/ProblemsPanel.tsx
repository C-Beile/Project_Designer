import { useMemo, useState } from 'react'
import type { Problem } from '../problems/problemStore'
import { SeverityIcon } from './SeverityIcon'
import { Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'

// Problems tab: every error and warning of the open projects with file, line and message. A double
// click (or Enter) jumps to the place: the object opens on its Source tab at the line.

const SOURCE_LABEL: Record<Problem['source'], string> = {
  parse: 'XML',
  validator: 'Check',
  reference: 'Reference',
  js: 'JavaScript',
  build: 'Build',
}

function shortFile(file: string | undefined): string {
  if (!file) return ''
  const parts = file.split(/[\\/]/).filter(Boolean)
  return parts.slice(-3).join('/')
}

/** Directory part dimmed, file name in full colour. */
function FileCell({ file }: { file: string | undefined }) {
  const short = shortFile(file)
  const cut = short.lastIndexOf('/')
  return (
    <span title={file}>
      <span className="forge-file-dir">{cut >= 0 ? short.slice(0, cut + 1) : ''}</span>
      <span className="forge-file-name">{cut >= 0 ? short.slice(cut + 1) : short}</span>
    </span>
  )
}

export function ProblemsPanel({ problems, scanning, onOpen }: { problems: Problem[]; scanning: boolean; onOpen: (p: Problem) => void }) {
  const [showErrors, setShowErrors] = useState(true)
  const [showWarnings, setShowWarnings] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return problems
      .filter((p) => (p.severity === 'Error' ? showErrors : showWarnings))
      .filter((p) => !needle || `${p.message} ${p.object ?? ''} ${p.file ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => (a.severity === b.severity ? (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) : a.severity === 'Error' ? -1 : 1))
  }, [problems, showErrors, showWarnings, filter])

  const errors = problems.filter((p) => p.severity === 'Error').length
  const warnings = problems.length - errors

  return (
    <div className="forge-problems" aria-label="Problems">
      <div className="forge-problems-bar" role="toolbar" aria-label="Problem filters">
        <label className="forge-check forge-chip is-error">
          <Input type="checkbox" checked={showErrors} onChange={(e) => setShowErrors(e.target.checked)} />
          <SeverityIcon severity="Error" />
          <span>Errors ({errors})</span>
        </label>
        <label className="forge-check forge-chip is-warning">
          <Input type="checkbox" checked={showWarnings} onChange={(e) => setShowWarnings(e.target.checked)} />
          <SeverityIcon severity="Warning" />
          <span>Warnings ({warnings})</span>
        </label>
        <Input type="text" aria-label="Filter problems" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {scanning ? <span className="forge-field-hint">Scanning the project…</span> : null}
      </div>
      {shown.length === 0 ? (
        <p className="forge-field-hint forge-problems-empty">{scanning ? 'Scanning…' : problems.length === 0 ? 'No problems found.' : 'No problems match the filter.'}</p>
      ) : (
        <Table className="forge-problems-table is-problems" aria-label="Problem list">

          <TableHeader>

              <TableColumn isRowHeader className="col-icon" />
              <TableColumn className="col-desc">Description</TableColumn>
              <TableColumn className="col-object">Object</TableColumn>
              <TableColumn className="col-file">File</TableColumn>
              <TableColumn className="col-line">Line</TableColumn>
              <TableColumn className="col-source">Source</TableColumn>

          </TableHeader>
          <TableBody>
            {shown.map((p) => (
              <TableRow
                key={p.id}
                className={`forge-problem-row is-${p.severity.toLowerCase()}${selected === p.id ? ' is-selected' : ''}`}

                onClick={() => setSelected(p.id)}
                onDoubleClick={() => onOpen(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(p)
                }}
              >
                <TableCell className="forge-problem-icon" aria-label={p.severity}>
                  <SeverityIcon severity={p.severity} />
                </TableCell>
                <TableCell className="forge-problem-text" title={p.message}>
                  {p.message}
                </TableCell>
                <TableCell title={p.object}>{p.object ?? ''}</TableCell>
                <TableCell>
                  <FileCell file={p.file} />
                </TableCell>
                <TableCell className="forge-cell-num">{p.line ?? ''}</TableCell>
                <TableCell>
                  <span className="forge-source-badge">{SOURCE_LABEL[p.source]}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
