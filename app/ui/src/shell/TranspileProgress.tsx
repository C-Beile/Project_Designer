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

export interface BuildResult {
  ok: boolean
  seconds: string
  project: string
  message?: string
  /** Share of the reference files the output reproduces (null: no reference chosen or not compared yet). */
  match?: number | null
}

// The window after a transpile: it stays in the corner, says in one line how it went and offers the
// next step (Deploy) or the Output with the details. It closes itself a while after a success.
export function TranspileResult({ result, onDeploy, onShowOutput, onShowMatch, onClose }: { result: BuildResult; onDeploy: () => void; onShowOutput: () => void; onShowMatch?: () => void; onClose: () => void }) {
  const name = result.project.split(/[\/]/).filter(Boolean).pop() ?? result.project
  return (
    <div className={`forge-build-progress forge-build-result ${result.ok ? 'is-ok' : 'is-failed'}`} role="status" aria-label={result.ok ? 'Transpile finished' : 'Transpile failed'}>
      <div className="forge-build-progress-head">
        <strong>{result.ok ? `Transpile finished (${result.seconds} s)` : 'Transpile failed'}</strong>
        <button type="button" aria-label="Close" onClick={onClose}>
          {'×'}
        </button>
      </div>
      <p>{result.ok ? `${name} is transpiled. Changes you make now count for the next transpile.` : (result.message ?? 'See the Output for details.')}</p>
      {result.ok && typeof result.match === 'number' ? (
        <p>
          Match with the reference:{' '}
          <button type="button" className="forge-link" onClick={onShowMatch} aria-label="Show the match with the reference">
            {result.match.toFixed(2)} %
          </button>
        </p>
      ) : null}
      <div className="forge-build-result-actions">
        {result.ok ? (
          <button type="button" onClick={onDeploy}>
            Deploy...
          </button>
        ) : null}
        <button type="button" onClick={onShowOutput}>
          Show Output
        </button>
      </div>
    </div>
  )
}
