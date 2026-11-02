import { useState } from 'react'
import type { RenameHit, UsageDto } from '../wire/types'

// Refactoring tab (manual 4.6): lists everything a change would touch and waits for the explicit
// "Do Refactoring". Available: Find Usages, Safely Delete and Rename of entities, views and
// webservices. Rename lists the references it will update and, apart, mentions it will not touch.
// Move stays unavailable.

export interface RefactoringState {
  mode: 'usages' | 'delete' | 'rename'
  newName?: string
  /** Project root the object belongs to (Rename needs it to follow the references). */
  project?: string
  /** Rename only: mentions of the old name that are not updated. */
  hits?: RenameHit[]
  object: string
  objectType: string
  nodeId: string
  usages: UsageDto[] | null
  error?: string
}

export function RefactoringPanel({
  state,
  onOpenUsage,
  onDo,
  onClose,
}: {
  state: RefactoringState | null
  onOpenUsage: (u: UsageDto) => void
  onDo: () => void
  onClose: () => void
}) {
  const [force, setForce] = useState(false)
  if (!state) {
    return (
      <div className="forge-panel-empty" role="tabpanel" aria-label="Refactoring">
        Nothing to refactor. Use Find Usages or Safely Delete on an entity, view or webservice.
      </div>
    )
  }
  const count = state.usages?.length ?? 0
  const blocked = state.mode === 'delete' && count > 0 && !force
  return (
    <div className="forge-refactoring" role="tabpanel" aria-label="Refactoring">
      <div className="forge-refactoring-bar">
        <strong>
          {state.mode === 'delete' ? 'Safely Delete' : state.mode === 'rename' ? 'Rename' : 'Usages of'} {state.object}
          {state.mode === 'rename' ? ` to ${state.newName ?? ''}` : ''}
        </strong>
        {state.usages ? <span className="forge-field-hint"> {count} usage(s) in the project</span> : <span className="forge-field-hint"> searching…</span>}
        <span className="forge-refactoring-fill" />
        {state.mode === 'rename' ? (
          <button type="button" disabled={!state.usages || !!state.error} onClick={onDo}>
            Do Refactoring
          </button>
        ) : null}
        {state.mode === 'delete' ? (
          <>
            {count > 0 ? (
              <label className="forge-check">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>Delete anyway (the references stay broken)</span>
              </label>
            ) : null}
            <button type="button" disabled={!state.usages || blocked} onClick={onDo}>
              Do Refactoring
            </button>
          </>
        ) : null}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {state.error ? (
        <p className="forge-field-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.mode === 'rename' && state.usages ? (
        <p className="forge-field-hint forge-refactoring-note">
          The object folder and the model file are renamed as well. Open editors of the touched models are closed; the dist folder is renewed by the next transpile.
        </p>
      ) : null}
      {state.usages && count === 0 && state.mode !== 'rename' ? <p className="forge-field-hint forge-refactoring-note">{state.mode === 'delete' ? 'Nothing refers to it: it can be deleted safely.' : 'No usages found.'}</p> : null}
      {blocked ? <p className="forge-field-hint forge-refactoring-note">Safe delete is blocked while other models refer to it. Remove these references first.</p> : null}
      {count > 0 ? (
        <table className="forge-problems-table" aria-label="Usages">
          <thead>
            <tr>
              <th>Model</th>
              <th>Type</th>
              <th>Reference</th>
              <th>Line</th>
            </tr>
          </thead>
          <tbody>
            {state.usages!.map((u, i) => (
              <tr key={`${u.node_id}|${u.path}|${i}`} className="forge-problem-row" tabIndex={0} onDoubleClick={() => onOpenUsage(u)} onKeyDown={(e) => e.key === 'Enter' && onOpenUsage(u)}>
                <td>{u.object}</td>
                <td>{u.object_type}</td>
                <td>{u.kind}</td>
                <td>{u.line ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {state.hits && state.hits.length > 0 ? (
        <>
          <p className="forge-field-hint forge-refactoring-note">{state.hits.length} other mention(s) of the old name are NOT changed (script code or elements Forge does not know as references). Check them by hand:</p>
          <table className="forge-problems-table" aria-label="Mentions not updated">
            <thead>
              <tr>
                <th>File</th>
                <th>Line</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody>
              {state.hits.map((h, i) => (
                <tr key={`${h.file}|${h.line}|${i}`} className="forge-problem-row">
                  <td>{h.file}</td>
                  <td>{h.line}</td>
                  <td>{h.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  )
}
