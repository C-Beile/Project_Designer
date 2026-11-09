import { Suspense, useEffect, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import type { CommitFile, GitCommit, GitOutput } from '../../wire/types'
import { LazyDiffView } from './LazyDiffView'
import { Modal } from '../../core/Modal'
import { errorText } from '../../core/errorText'

// Toolbar Pull and Push: Pull shows what the remote has that is not here yet before anything is
// merged; Push lists the local commits that are not on the remote and pushes the chosen ones.
// A push always sends a run of commits from the oldest unpushed one up to the newest chosen one,
// because commits build on each other: ticking a commit ticks every older one, unticking a commit
// unticks every newer one.

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')

export interface SyncResult {
  ok: boolean
  text: string
  /** Commits that were merged (pull) or pushed (push). */
  commits: number
}

export function SyncDialog({
  api,
  projectRoot,
  mode,
  onClose,
  onDone,
  onResult,
}: {
  api: ForgeApi
  projectRoot: string
  mode: 'pull' | 'push'
  onClose: () => void
  onDone: () => void
  /** Called after every run with what happened, so the caller can tell the user. */
  onResult?: (result: SyncResult) => void
}) {
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<GitOutput | null>(null)
  // The commit whose changes are shown below the list, its files and the file whose diff is open.
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<CommitFile[] | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<string | null>(null)

  useEffect(() => {
    setFiles(null)
    setFilesError(null)
    setOpenFile(null)
    if (!selected) return
    let cancelled = false
    api
      .scmCommitFiles(projectRoot, selected)
      .then((list) => {
        if (cancelled) return
        setFiles(list)
        setOpenFile(list[0]?.path ?? null)
      })
      .catch((e) => !cancelled && setFilesError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [api, projectRoot, selected])

  async function load() {
    setCommits(null)
    setError(null)
    try {
      const list = await (mode === 'pull' ? api.gitIncoming(projectRoot) : api.gitUnpushed(projectRoot))
      setCommits(list)
      setCount(list.length)
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectRoot])

  // Commits are listed newest first: the ticked ones are the oldest `count` entries.
  const total = commits?.length ?? 0
  const isChecked = (i: number) => i >= total - count
  const toggle = (i: number, on: boolean) => setCount(on ? total - i : total - i - 1)

  async function run() {
    setBusy(true)
    setOutput(null)
    try {
      const result = mode === 'pull' ? await api.gitPull(projectRoot) : await api.gitPushTo(projectRoot, commits![total - count].hash)
      setOutput(result)
      onResult?.({ ok: result.ok, text: result.text, commits: mode === 'pull' ? total : count })
      if (result.ok) {
        onDone()
        await load()
      }
    } catch (e) {
      const text = errorText(e)
      setOutput({ ok: false, text })
      onResult?.({ ok: false, text, commits: 0 })
    } finally {
      setBusy(false)
    }
  }

  const selectedCommit = commits?.find((c) => c.hash === selected) ?? null
  const title = mode === 'pull' ? 'Pull' : 'Push'
  const canRun = !busy && commits !== null && (mode === 'pull' || count > 0)
  let heading: string
  if (commits === null) heading = mode === 'pull' ? 'Looking for new commits on the remote…' : 'Reading local commits…'
  else if (total === 0) heading = mode === 'pull' ? 'Nothing to pull: this branch is up to date with the remote.' : 'Nothing to push: every local commit is already on the remote.'
  else heading = mode === 'pull' ? `${total} commit${total === 1 ? '' : 's'} on the remote will be merged:` : 'Choose the local commits to push:'

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="is-primary" disabled={!canRun} onClick={run}>
            {title}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="sync-dialog">
        {error ? (
          <p className="forge-field-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="forge-field-hint">{heading}</p>
        )}
        {commits && total > 0 ? (
          <table className="forge-history-table" aria-label={mode === 'pull' ? 'Incoming commits' : 'Local commits'}>
            <thead>
              <tr>
                {mode === 'push' ? <th /> : null}
                <th>Commit</th>
                <th>Author</th>
                <th>Date</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {commits.map((c, i) => (
                <tr key={c.hash} className={`${mode === 'push' && !isChecked(i) ? 'is-unchecked' : ''}${c.hash === selected ? ' is-selected' : ''}`.trim() || undefined} aria-selected={c.hash === selected} onClick={() => setSelected(c.hash)}>
                  {mode === 'push' ? (
                    <td>
                      <input type="checkbox" aria-label={`Push ${c.subject}`} checked={isChecked(i)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(i, e.target.checked)} />
                    </td>
                  ) : null}
                  <td className="forge-history-hash" title={c.hash}>
                    {c.hash.slice(0, 8)}
                  </td>
                  <td>{c.author}</td>
                  <td>{when(c.date)}</td>
                  <td>{c.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {selectedCommit ? (
          <div className="sync-changes">
            <div className="sync-changes-bar">
              <strong>
                {selectedCommit.hash.slice(0, 8)} {selectedCommit.subject}
              </strong>
              <span className="forge-field-hint">
                {selectedCommit.author} · {when(selectedCommit.date)}
              </span>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(selectedCommit.hash)}>
                Copy hash
              </button>
              {mode === 'push' ? (
                <button type="button" onClick={() => toggle(commits!.indexOf(selectedCommit), true)} title="Ticks this commit and every older one">
                  Push up to here
                </button>
              ) : null}
            </div>
            {filesError ? <p className="forge-field-error">{filesError}</p> : null}
            {files === null && !filesError ? <p className="forge-field-hint">Please Wait…</p> : null}
            {files && files.length === 0 ? <p className="forge-field-hint">This commit changes no files.</p> : null}
            {files && files.length > 0 ? (
              <div className="sync-changes-body">
                <ul className="sync-changes-files" aria-label="Changed files">
                  {files.map((f) => (
                    <li key={f.path} className={f.path === openFile ? 'is-selected' : undefined} data-git={f.status === 'A' ? 'A' : f.status === 'D' ? 'D' : 'M'} title={f.path} onClick={() => setOpenFile(f.path)}>
                      <span className="sync-changes-code">{f.status}</span> {f.path.split('/').pop()}
                      <span className="forge-field-hint"> {f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
                    </li>
                  ))}
                </ul>
                <div className="sync-changes-diff">
                  {openFile ? (
                    <Suspense fallback={<p className="forge-field-hint">Please Wait…</p>}>
                      <LazyDiffView api={api} target={{ root: projectRoot, path: openFile, side: 'commit', hash: selected ?? undefined }} />
                    </Suspense>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : commits && total > 0 ? (
          <p className="forge-field-hint">Click a commit to see its changes.</p>
        ) : null}
        {output ? (
          <pre className={output.ok ? 'forge-git-output' : 'forge-git-output is-error'} role="status">
            {output.text || (output.ok ? 'Done.' : 'Failed.')}
          </pre>
        ) : null}
      </div>
    </Modal>
  )
}
