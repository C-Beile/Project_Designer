import type { DiagnosticDto } from '../wire/types'

// Ziel A.6: generic diagnostics list/panel for `list_diagnostics` results - knows nothing about
// which validator produced a finding, just severity/message/path (architecture.md §2/§6).
export function DiagnosticsPanel({ diagnostics }: { diagnostics: DiagnosticDto[] }) {
  if (diagnostics.length === 0) {
    return (
      <div className="diagnostics-panel" aria-label="Diagnostics">
        <p>No diagnostics.</p>
      </div>
    )
  }

  return (
    <ul className="diagnostics-panel" aria-label="Diagnostics">
      {diagnostics.map((d, i) => (
        <li key={i} className={`diagnostic diagnostic-${d.severity.toLowerCase()}`}>
          <strong>{d.severity}</strong> {d.message}
          {d.path ? <code>{d.path}</code> : null}
        </li>
      ))}
    </ul>
  )
}
