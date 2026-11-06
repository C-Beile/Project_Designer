import { useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { GitCommit, GitOutput } from '../wire/types'
import { Modal } from './Dialogs'

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

  async function load() {
    setCommits(null)
    setError(null)
    try {
      const list = await (mode === 'pull' ? api.gitIncoming(projectRoot) : api.gitUnpushed(projectRoot))
      setCommits(list)
      setCount(list.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      const text = e instanceof Error ? e.message : String(e)
      setOutput({ ok: false, text })
      onResult?.({ ok: false, text, commits: 0 })
    } finally {
      setBusy(false)
    }
  }

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
                <tr key={c.hash} className={mode === 'push' && !isChecked(i) ? 'is-unchecked' : undefined}>
                  {mode === 'push' ? (
                    <td>
                      <input type="checkbox" aria-label={`Push ${c.subject}`} checked={isChecked(i)} onChange={(e) => toggle(i, e.target.checked)} />
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
        {output ? (
          <pre className={output.ok ? 'forge-git-output' : 'forge-git-output is-error'} role="status">
            {output.text || (output.ok ? 'Done.' : 'Failed.')}
          </pre>
        ) : null}
      </div>
    </Modal>
  )
}
