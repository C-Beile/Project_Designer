import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import type { CommitFile, DiffTarget, GitCommit, GitOutput, ScmFile } from '../../wire/types'
import { confirmDialog, promptDialog } from '../../core/dialogService'
import { notify } from '../../core/notifications'
import { codeOf, GIT_CODE_LABEL, refreshScm, useScm } from '../../core/scm'
import { errorText } from '../../core/errorText'

// Source Control, docked like the Source Control view of VS Code: branch and Pull / Push / Sync on
// top, the commit message with Commit, the staged and the other changes with stage / unstage /
// discard per file, and the history. A click on a file opens its diff as an editor tab. Local Git
// only. Every writing action runs from exactly one click; nothing runs by itself. `package-lock.json`
// is never staged by "Stage All Changes" and is shown with a hint.

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function dirName(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

function shortDate(iso: string): string {
  return iso.slice(0, 10)
}

const BRANCH_NAME = /^[A-Za-z0-9._/-]+$/

export function ScmPanel({
  api,
  root,
  onOpenDiff,
  onChanged,
}: {
  api: ForgeApi
  root: string
  onOpenDiff: (target: DiffTarget) => void
  /** The work tree changed through Git (switch, pull, discard): the shell reloads the tree and open objects. */
  onChanged: () => void
}) {
  const scm = useScm()
  const overview = scm.root === root ? scm.overview : null
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<GitCommit[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({ staged: true, changes: true, history: false })
  const [commitFiles, setCommitFiles] = useState<Record<string, CommitFile[]>>({})
  const [branchPicker, setBranchPicker] = useState(false)
  const [branchFilter, setBranchFilter] = useState('')

  useEffect(() => {
    if (root) void refreshScm(api, root)
  }, [api, root])

  useEffect(() => {
    if (!open.history || !overview) return
    let cancelled = false
    api
      .scmHistory(root, 50)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setHistory([]))
    return () => {
      cancelled = true
    }
  }, [api, root, open.history, scm.version, overview])

  const staged = useMemo(() => (overview?.files ?? []).filter((f) => f.index !== ' ' && f.index !== '?'), [overview])
  const changes = useMemo(() => (overview?.files ?? []).filter((f) => f.worktree !== ' ' || f.index === '?'), [overview])

  const run = useCallback(
    async (action: () => Promise<GitOutput>, options: { reloadTree?: boolean; success?: string } = {}): Promise<boolean> => {
      setBusy(true)
      try {
        const result = await action()
        if (!result.ok) notify(result.text.split('\n')[0] || 'Git reported an error.', { kind: 'error', timeoutMs: 10000 })
        else if (options.success) notify(options.success, { kind: 'success' })
        if (result.ok && options.reloadTree) onChanged()
        return result.ok
      } catch (e) {
        notify(errorText(e), { kind: 'error', timeoutMs: 10000 })
        return false
      } finally {
        await refreshScm(api, root)
        setBusy(false)
      }
    },
    [api, root, onChanged],
  )

  async function discard(file: ScmFile) {
    const text =
      file.index === '?'
        ? `Delete the new file ${file.path}?\n\nIt is not tracked by Git. A copy is kept in the backup folder (Help > Open Backup Folder).`
        : `Discard the changes in ${file.path}?\n\nThe file goes back to the staged or committed version. A copy of the current file is kept in the backup folder (Help > Open Backup Folder).`
    if (await confirmDialog(text, { title: 'Discard Changes', okLabel: 'Discard' })) await run(() => api.scmDiscard(root, [file.path]), { reloadTree: true })
  }

  async function commit(thenPush: boolean) {
    const ok = await run(() => api.scmCommit(root, message.trim()), { success: 'Committed.' })
    if (!ok) return
    setMessage('')
    if (thenPush) await run(() => api.gitPush(root), { success: 'Pushed.' })
  }

  async function checkout(name: string) {
    setBranchPicker(false)
    await run(() => api.gitCheckout(root, name), { reloadTree: true, success: `Switched to ${name}.` })
  }

  async function createBranch(start: string | null) {
    const suggested = start ? start.replace(/^[^/]+\//, '') : ''
    const name = await promptDialog(start ? `Create a local branch from ${start}.` : 'Create a new branch from the current commit and switch to it.', {
      title: 'New Branch',
      label: 'Branch name',
      initial: suggested,
      okLabel: 'Create',
      validate: (v) => (v.trim() === '' || BRANCH_NAME.test(v.trim()) ? null : 'Use letters, digits and _ - . / only.'),
    })
    if (!name) return
    setBranchPicker(false)
    await run(() => api.gitCreateBranch(root, name.trim(), start), { reloadTree: true, success: `Created and switched to ${name.trim()}.` })
  }

  async function toggleCommit(hash: string) {
    if (commitFiles[hash]) {
      setCommitFiles((prev) => {
        const { [hash]: _gone, ...rest } = prev
        return rest
      })
      return
    }
    try {
      const files = await api.scmCommitFiles(root, hash)
      setCommitFiles((prev) => ({ ...prev, [hash]: files }))
    } catch (e) {
      notify(errorText(e), { kind: 'error' })
    }
  }

  if (!root.trim()) return <div className="forge-panel-empty">Open a project to see its changes.</div>
  if (scm.root === root && scm.error) {
    return (
      <div className="forge-panel-empty" role="status">
        {scm.error}
      </div>
    )
  }
  if (!overview) return <div className="forge-panel-empty">Please Wait…</div>

  const lockInChanges = changes.some((f) => f.path.endsWith('package-lock.json'))
  const canCommit = !busy && staged.length > 0 && message.trim() !== '' && !/[\r\n]/.test(message)
  const localBranches = overview.branches.filter((b) => b.name.toLowerCase().includes(branchFilter.toLowerCase()))
  const remoteBranches = overview.remote_branches.filter((b) => b.toLowerCase().includes(branchFilter.toLowerCase()))

  function FileRow({ file, side }: { file: ScmFile; side: 'staged' | 'unstaged' }) {
    const code = codeOf(file)
    return (
      <li
        className="scm-row"
        data-git={code}
        title={`${GIT_CODE_LABEL[code]}: ${file.path}`}
        onClick={() => onOpenDiff({ root, path: file.path, side: side === 'staged' ? 'staged' : 'unstaged' })}
      >
        <span className="scm-name">{baseName(file.path)}</span>
        <span className="scm-dir">{dirName(file.path)}</span>
        <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
          {side === 'unstaged' ? (
            <>
              <button type="button" aria-label={`Discard ${file.path}`} title="Discard Changes" disabled={busy} onClick={() => void discard(file)}>
                ↶
              </button>
              <button type="button" aria-label={`Stage ${file.path}`} title="Stage Changes" disabled={busy} onClick={() => void run(() => api.scmStage(root, [file.path]))}>
                +
              </button>
            </>
          ) : (
            <button type="button" aria-label={`Unstage ${file.path}`} title="Unstage Changes" disabled={busy} onClick={() => void run(() => api.scmUnstage(root, [file.path]))}>
              −
            </button>
          )}
        </span>
        <span className="scm-code" aria-hidden="true">
          {code}
        </span>
      </li>
    )
  }

  return (
    <div className="scm-panel">
      <div className="scm-head">
        <button type="button" className="scm-branch" title="Switch or create a branch" aria-expanded={branchPicker} onClick={() => setBranchPicker((v) => !v)}>
          ⎇ {overview.branch ?? '(detached)'}
          {overview.upstream ? <span className="scm-sync-state"> ↑{overview.ahead} ↓{overview.behind}</span> : null}
        </button>
        <span className="scm-head-actions">
          <button type="button" aria-label="Pull" title="Pull" disabled={busy} onClick={() => void run(() => api.gitPull(root), { reloadTree: true, success: 'Pulled.' })}>
            ⇣
          </button>
          <button type="button" aria-label="Push" title="Push" disabled={busy} onClick={() => void run(() => api.gitPush(root), { success: 'Pushed.' })}>
            ⇡
          </button>
          <button type="button" aria-label="Sync" title="Sync: pull, then push" disabled={busy} onClick={() => void run(() => api.scmSync(root), { reloadTree: true, success: 'Synchronised.' })}>
            ⟳
          </button>
          <button type="button" aria-label="Refresh" title="Refresh" disabled={busy} onClick={() => void refreshScm(api, root)}>
            ↻
          </button>
        </span>
      </div>

      {branchPicker ? (
        <div className="scm-branches" role="listbox" aria-label="Branches">
          <input type="text" value={branchFilter} placeholder="Filter branches" aria-label="Filter branches" autoFocus onChange={(e) => setBranchFilter(e.target.value)} />
          <button type="button" className="scm-branch-item" onClick={() => void createBranch(null)}>
            + New Branch…
          </button>
          {localBranches.map((b) => (
            <button key={b.name} type="button" role="option" aria-selected={b.is_current} className={`scm-branch-item${b.is_current ? ' is-current' : ''}`} onClick={() => (b.is_current ? setBranchPicker(false) : void checkout(b.name))}>
              {b.is_current ? '✔ ' : ''}
              {b.name}
            </button>
          ))}
          {remoteBranches.map((r) => (
            <button key={r} type="button" role="option" aria-selected={false} className="scm-branch-item is-remote" title="Create a local branch from it" onClick={() => void createBranch(r)}>
              {r}
            </button>
          ))}
        </div>
      ) : null}

      <div className="scm-commit">
        <input
          type="text"
          value={message}
          aria-label="Commit message"
          placeholder={`Message (commits ${staged.length} staged file${staged.length === 1 ? '' : 's'})`}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCommit) void commit(false)
          }}
        />
        <div className="scm-commit-buttons">
          <button type="button" disabled={!canCommit} onClick={() => void commit(false)}>
            Commit
          </button>
          <button type="button" disabled={!canCommit} title="Commit, then push the branch" onClick={() => void commit(true)}>
            Commit &amp; Push
          </button>
        </div>
        {staged.length === 0 && changes.length > 0 ? <p className="forge-field-hint">Stage the files to commit with +.</p> : null}
      </div>

      <section className="scm-section">
        <header>
          <button type="button" className="scm-twisty" aria-expanded={open.staged} onClick={() => setOpen((o) => ({ ...o, staged: !o.staged }))}>
            {open.staged ? '▾' : '▸'} Staged Changes
          </button>
          <span className="scm-count">{staged.length}</span>
          {staged.length > 0 ? (
            <button type="button" className="scm-section-action" aria-label="Unstage All Changes" title="Unstage All Changes" disabled={busy} onClick={() => void run(() => api.scmUnstage(root, staged.map((f) => f.path)))}>
              −
            </button>
          ) : null}
        </header>
        {open.staged ? <ul aria-label="Staged changes">{staged.map((f) => <FileRow key={`s:${f.path}`} file={f} side="staged" />)}</ul> : null}
      </section>

      <section className="scm-section">
        <header>
          <button type="button" className="scm-twisty" aria-expanded={open.changes} onClick={() => setOpen((o) => ({ ...o, changes: !o.changes }))}>
            {open.changes ? '▾' : '▸'} Changes
          </button>
          <span className="scm-count">{changes.length}</span>
          {changes.length > 0 ? (
            <button type="button" className="scm-section-action" aria-label="Stage All Changes" title="Stage All Changes (package-lock.json stays out)" disabled={busy} onClick={() => void run(() => api.scmStageAll(root))}>
              +
            </button>
          ) : null}
        </header>
        {open.changes ? <ul aria-label="Changes">{changes.map((f) => <FileRow key={`c:${f.path}`} file={f} side="unstaged" />)}</ul> : null}
        {open.changes && lockInChanges ? <p className="forge-field-hint">package-lock.json is left out of Stage All Changes and is never committed from here.</p> : null}
        {overview.truncated ? <p className="forge-field-hint">Only the first changes are listed.</p> : null}
        {changes.length === 0 && staged.length === 0 ? <p className="forge-field-hint">No changes.</p> : null}
      </section>

      <section className="scm-section">
        <header>
          <button type="button" className="scm-twisty" aria-expanded={open.history} onClick={() => setOpen((o) => ({ ...o, history: !o.history }))}>
            {open.history ? '▾' : '▸'} History
          </button>
        </header>
        {open.history ? (
          history === null ? (
            <p className="forge-field-hint">Please Wait…</p>
          ) : history.length === 0 ? (
            <p className="forge-field-hint">No commits yet.</p>
          ) : (
            <ul aria-label="Commit history">
              {history.map((c) => (
                <li key={c.hash} className="scm-commit-row">
                  <button type="button" className="scm-commit-line" aria-expanded={!!commitFiles[c.hash]} title={`${c.hash}\n${c.author}`} onClick={() => void toggleCommit(c.hash)}>
                    <span className="scm-subject">{c.subject}</span>
                    <span className="scm-meta">
                      {c.hash.slice(0, 7)} · {c.author} · {shortDate(c.date)}
                    </span>
                  </button>
                  {commitFiles[c.hash] ? (
                    <ul className="scm-commit-files" aria-label={`Files of ${c.hash.slice(0, 7)}`}>
                      {commitFiles[c.hash].map((f) => (
                        <li key={f.path} className="scm-row" data-git={f.status === 'A' ? 'A' : f.status === 'D' ? 'D' : 'M'} onClick={() => onOpenDiff({ root, path: f.path, side: 'commit', hash: c.hash })}>
                          <span className="scm-name">{baseName(f.path)}</span>
                          <span className="scm-dir">{dirName(f.path)}</span>
                          <span className="scm-code" aria-hidden="true">
                            {f.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  )
}
