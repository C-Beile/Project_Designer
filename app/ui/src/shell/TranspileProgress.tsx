// Progress of a running build: a small panel in the corner. It does not block the window, so work in
// the Designer goes on while the build runs. The built-in transpiler reports how far it is: a bar
// with the percentage and the stage that runs now. The official transpiler reports nothing, so it
// keeps the running stripe. Cancel ends the official transpiler process after a question; the
// built-in engine has no abort hook, so there the button stays dimmed.

export interface BuildProgress {
  percent: number
  stage: string
}

export function TranspileProgress({ label, onCancel, progress }: { label: string; onCancel?: () => void; progress?: BuildProgress | null }) {
  return (
    <div className="forge-build-progress" role="status" aria-label="Transpiling...">
      <div className="forge-build-progress-head">
        <strong>{progress ? `Transpiling... ${progress.percent} %` : 'Transpiling...'}</strong>
        <button type="button" disabled={!onCancel} title={onCancel ? 'Ends the running build after a question' : 'This engine cannot be cancelled'} onClick={() => onCancel?.()}>
          Cancel
        </button>
      </div>
      <p>{progress ? progress.stage : label}</p>
      {progress ? (
        <div className="forge-progress-bar" role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div className="forge-progress-bar-fill" style={{ width: `${progress.percent}%` }} />
        </div>
      ) : (
        <div className="forge-progress-stripe" role="progressbar" aria-label="Build running" aria-busy="true" />
      )}
    </div>
  )
}
