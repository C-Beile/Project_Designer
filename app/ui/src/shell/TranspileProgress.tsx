// Progress of a running build: a small panel in the corner with the running stripe. It does not block
// the window, so work in the Designer goes on while the build runs. Cancel ends the official
// transpiler process after a question; the experimental engine has no abort hook, so there the
// button stays dimmed.

export function TranspileProgress({ label, onCancel }: { label: string; onCancel?: () => void }) {
  return (
    <div className="forge-build-progress" role="status" aria-label="Transpiling...">
      <div className="forge-build-progress-head">
        <strong>Transpiling...</strong>
        <button type="button" disabled={!onCancel} title={onCancel ? 'Ends the running build after a question' : 'This engine cannot be cancelled'} onClick={() => onCancel?.()}>
          Cancel
        </button>
      </div>
      <p>{label}</p>
      <div className="forge-progress-stripe" role="progressbar" aria-label="Build running" aria-busy="true" />
    </div>
  )
}
