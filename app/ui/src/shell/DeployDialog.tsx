import { useCallback, useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { ChangedFile, DeployOverview } from '../wire/types'
import { Modal } from './Dialogs'

// Deploy dialog: fetches the system database and shows what the last deploy was and which files of
// the project changed since, grouped by model. Reading only: the model rows of the system hold the
// merged model (modules included), which only the original Designer builds, so Dito Designer does
// not write them and the Deploy button stays off.

const when = (ms: number) => new Date(ms).toLocaleString()

function FileList({ files }: { files: ChangedFile[] }) {
  return (
    <ul className="forge-deploy-files">
      {files.map((f) => (
        <li key={f.path}>
          <span className="forge-deploy-file">{f.path}</span>
          <span className="forge-field-hint">{when(f.changed_ms)}</span>
        </li>
      ))}
    </ul>
  )
}

export function DeployDialog({
  api,
  projectRoot,
  systemName,
  warning,
  onClose,
}: {
  api: ForgeApi
  projectRoot: string
  /** System chosen in the first dialog (shown in the System line). */
  systemName?: string
  initialForce?: boolean
  initialCheckScan?: boolean
  /** Warning about the target (productive or cloud system), shown above the list. */
  warning?: string | null
  onClose: () => void
  onDeployed?: (message: string) => void
}) {
  const [overview, setOverview] = useState<DeployOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchOverview = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setOverview(await api.deployOverview(projectRoot))
    } catch (e) {
      setOverview(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, projectRoot])

  useEffect(() => {
    void fetchOverview()
  }, [fetchOverview])

  const cloud = warning ? false : overview ? /cloud/i.test(overview.target) : false
  const last = overview?.last_deploy ?? null

  return (
    <Modal
      title="Deploy"
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled title="Not available: the model rows of the system hold the merged model, which only the original Designer can build. Deploy there.">
            Deploy
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="forge-deploy">
        <div className="forge-deploy-head">
          <label className="forge-field">
            <span>Project:</span>
            <select aria-label="Project" disabled value="p">
              <option value="p">{projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? projectRoot}</option>
            </select>
          </label>
          <label className="forge-field">
            <span>System:</span>
            <select aria-label="System" disabled value="s">
              <option value="s">{systemName ?? (overview ? overview.target : '…')}</option>
            </select>
          </label>
        </div>
        {overview ? (
          <p className="forge-deploy-target">
            System database: <strong>{overview.target}</strong>
          </p>
        ) : null}
        {cloud ? (
          <p className="forge-field-error" role="alert">
            This looks like a cloud system. A deploy overwrites its database.
          </p>
        ) : null}
        {warning ? (
          <p className="forge-field-error" role="alert">
            {warning}
          </p>
        ) : null}
        {error ? (
          <p className="forge-field-error" role="alert">
            {error}
          </p>
        ) : null}

        {overview ? (
          <>
            <section className="forge-deploy-last" aria-label="Last deploy">
              <h4>Last deploy</h4>
              {last ? (
                <p>
                  {last.time_ms ? when(last.time_ms) : 'time unknown'}
                  {last.author ? ` by ${last.author}` : ''}
                  {last.designer_version ? ` (project version ${last.designer_version})` : ''}
                </p>
              ) : (
                <p className="forge-field-hint">This system has no deploy information yet; every file counts as changed.</p>
              )}
            </section>

            <section aria-label="Changes since the last deploy">
              <h4>
                Changed since the last deploy: {overview.changed.length} model{overview.changed.length === 1 ? '' : 's'}
              </h4>
              {overview.changed.length === 0 ? (
                <p className="forge-field-hint">The system database is up to date with your last transpile.</p>
              ) : (
                <ul className="forge-deploy-list" aria-label="Changed models">
                  {overview.changed.map((m) => (
                    <li key={m.key}>
                      <details>
                        <summary>
                          <span className="forge-deploy-op forge-deploy-op-U">U</span>
                          <span>{m.key}</span>
                          <span className="forge-field-hint">
                            {' '}
                            {m.files.length} file{m.files.length === 1 ? '' : 's'}
                          </span>
                        </summary>
                        <FileList files={m.files} />
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              {overview.other_files.length > 0 ? (
                <details>
                  <summary>Other changed files ({overview.other_files.length})</summary>
                  <FileList files={overview.other_files} />
                </details>
              ) : null}
            </section>
          </>
        ) : null}

        <div className="forge-deploy-actions">
          <button type="button" onClick={() => void fetchOverview()} disabled={busy}>
            {busy ? 'Fetching…' : 'Fetch again'}
          </button>
        </div>
        <p className="forge-field-hint">Dito Designer shows the changes but does not write into the system database. Deploy with the original Designer.</p>
      </div>
    </Modal>
  )
}
