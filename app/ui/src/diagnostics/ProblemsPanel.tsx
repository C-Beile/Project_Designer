import { useMemo, useState } from 'react'
import type { Problem } from '../problems/problemStore'

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
        <label className="forge-check">
          <input type="checkbox" checked={showErrors} onChange={(e) => setShowErrors(e.target.checked)} />
          <span>Errors ({errors})</span>
        </label>
        <label className="forge-check">
          <input type="checkbox" checked={showWarnings} onChange={(e) => setShowWarnings(e.target.checked)} />
          <span>Warnings ({warnings})</span>
        </label>
        <input type="text" aria-label="Filter problems" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {scanning ? <span className="forge-field-hint">Scanning the project…</span> : null}
      </div>
      {shown.length === 0 ? (
        <p className="forge-field-hint forge-problems-empty">{scanning ? 'Scanning…' : problems.length === 0 ? 'No problems found.' : 'No problems match the filter.'}</p>
      ) : (
        <table className="forge-problems-table" aria-label="Problem list">
          <thead>
            <tr>
              <th />
              <th>Description</th>
              <th>Object</th>
              <th>File</th>
              <th>Line</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr
                key={p.id}
                className={`forge-problem-row is-${p.severity.toLowerCase()}${selected === p.id ? ' is-selected' : ''}`}
                tabIndex={0}
                onClick={() => setSelected(p.id)}
                onDoubleClick={() => onOpen(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(p)
                }}
              >
                <td className="forge-problem-icon" aria-label={p.severity}>
                  {p.severity === 'Error' ? '●' : '▲'}
                </td>
                <td>{p.message}</td>
                <td>{p.object ?? ''}</td>
                <td title={p.file}>{shortFile(p.file)}</td>
                <td>{p.line ?? ''}</td>
                <td>{SOURCE_LABEL[p.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
