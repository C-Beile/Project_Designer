import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { GitFileStatus, GitOutput, GitOverview } from '../wire/types'
import { Modal } from './Dialogs'
import { Chevron, CollapseAllIcon, ExpandAllIcon, FileIcon, FolderIcon, ListToggleIcon } from './commitIcons'

// Team menu: basic Git on the repository of the active project (commit, pull, push, switch
// branch, status, history). Every action runs from exactly one click on its own button and never
// by itself; the message of a commit is a single line.

type GitTab = 'changes' | 'history' | 'branches'

const TABS: { id: GitTab; label: string }[] = [
  { id: 'changes', label: 'Changes' },
  { id: 'history', label: 'History' },
  { id: 'branches', label: 'Branches' },
]

// Machine-generated file that a commit by hand normally leaves out.
const UNCHECKED_BY_DEFAULT = /(^|\/)package-lock\.json$/

interface TreeFolder {
  name: string
  path: string
  folders: TreeFolder[]
  files: GitFileStatus[]
}

function buildTree(files: GitFileStatus[]): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.folders.find((x) => x.name === part)
      if (!child) {
        child = { name: part, path: node.path ? `${node.path}/${part}` : part, folders: [], files: [] }
        node.folders.push(child)
      }
      node = child
    }
    node.files.push(f)
  }
  return root
}

function filesUnder(folder: TreeFolder): GitFileStatus[] {
  return [...folder.files, ...folder.folders.flatMap(filesUnder)]
}

// Colour of a changed file in the commit tree: new files green, everything else as plain text
// (original commit dialog, reference shots 61 and 65).
function fileClass(code: string): string {
  return code.includes('?') || code.includes('A') ? 'is-new' : 'is-modified'
}

interface TreeHandlers {
  checked: Set<string>
  collapsed: Set<string>
  onToggleFile: (path: string, on: boolean) => void
  onToggleFolder: (paths: string[], on: boolean) => void
  onToggleCollapse: (path: string) => void
}

function countLabel(n: number): string {
  return `${n} file${n === 1 ? '' : 's'} changed`
}

// One folder of the commit tree. The project folder itself is the root node, as in the original;
// files of a folder come before its sub folders.
function FolderNode({ folder, label, handlers }: { folder: TreeFolder; label: string; handlers: TreeHandlers }) {
  const { checked, collapsed, onToggleFile, onToggleFolder, onToggleCollapse } = handlers
  const all = filesUnder(folder)
  const on = all.filter((x) => checked.has(x.path)).length
  const open = !collapsed.has(folder.path)
  return (
    <li role="treeitem" aria-expanded={open}>
      <div className="forge-commit-row">
        <button type="button" className="forge-commit-twisty" aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={() => onToggleCollapse(folder.path)}>
          <Chevron open={open} />
        </button>
        <input
          type="checkbox"
          aria-label={label}
          checked={on === all.length}
          ref={(el) => {
            if (el) el.indeterminate = on > 0 && on < all.length
          }}
          onChange={(e) => onToggleFolder(all.map((x) => x.path), e.target.checked)}
        />
        <FolderIcon />
        <span className="forge-commit-folder">{label}</span>
        <span className="forge-commit-count">{countLabel(all.length)}</span>
      </div>
      {open ? (
        <ul className="forge-commit-tree" role="group">
          {folder.files.map((f) => (
            <FileRow key={f.path} file={f} label={f.path.split('/').pop() ?? f.path} handlers={{ onToggleFile, checked }} />
          ))}
          {folder.folders.map((f) => (
            <FolderNode key={f.path} folder={f} label={f.name} handlers={handlers} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function FileRow({ file, label, handlers }: { file: GitFileStatus; label: string; handlers: Pick<TreeHandlers, 'checked' | 'onToggleFile'> }) {
  return (
    <li role="treeitem" className="forge-commit-row forge-commit-file">
      <input type="checkbox" aria-label={file.path} checked={handlers.checked.has(file.path)} onChange={(e) => handlers.onToggleFile(file.path, e.target.checked)} />
      <FileIcon json={file.path.endsWith('.json')} />
      <span className={`forge-commit-name ${fileClass(file.code)}`} title={`${file.code.trim() || '?'}  ${file.path}`}>
        {label}
      </span>
    </li>
  )
}

function shortDate(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

export function GitDialog({
  api,
  projectRoot,
  initialTab,
  initialTarget,
  onClose,
  onChanged,
}: {
  api: ForgeApi
  projectRoot: string
  initialTab: GitTab
  /** Branch preselected in the Branches tab (from the status-bar popup); nothing is switched yet. */
  initialTarget?: { local?: string; remote?: string } | null
  onClose: () => void
  onChanged: () => void
}) {
  const [tab, setTab] = useState<GitTab>(initialTab)
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<GitOutput | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState(initialTarget?.local ?? '')
  const [remoteTarget, setRemoteTarget] = useState(initialTarget?.remote ?? '')
  const [newName, setNewName] = useState(initialTarget?.remote ? initialTarget.remote.replace(/^[^/]+\//, '') : '')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [flat, setFlat] = useState(false)

  const load = useCallback(async () => {
    try {
      const o = await api.gitOverview(projectRoot)
      setOverview(o)
      setError(null)
      setChecked(new Set(o.files.filter((f) => !UNCHECKED_BY_DEFAULT.test(f.path)).map((f) => f.path)))
      setTarget((prev) => (o.branches.some((b) => b.name === prev && !b.is_current) ? prev : (o.branches.find((b) => !b.is_current)?.name ?? '')))
    } catch (e) {
      setOverview(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api, projectRoot])

  useEffect(() => {
    void load()
  }, [load])

  async function act(run: () => Promise<GitOutput>) {
    setBusy(true)
    setOutput(null)
    try {
      const result = await run()
      setOutput(result)
      if (result.ok) {
        onChanged()
        await load()
      }
    } catch (e) {
      setOutput({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const messageIssue = /[\r\n]/.test(message) ? 'The message must be a single line.' : null
  const tree = useMemo(() => buildTree(overview?.files ?? []), [overview])
  const nameIssue = newName.trim() !== '' && !/^[A-Za-z0-9._/-]+$/.test(newName.trim()) ? 'Use letters, digits and _ - . / only.' : null
  const canCommit = !busy && checked.size > 0 && message.trim() !== '' && !messageIssue
  const rootName = (overview?.root ?? projectRoot).replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const flatRoot: TreeFolder = { name: '', path: '', folders: [], files: overview?.files ?? [] }
  const isCommitView = initialTab === 'changes'

  const commit = () => act(() => api.gitCommit(projectRoot, message.trim(), [...checked]).then((r) => { if (r.ok) setMessage(''); return r }))
  const commitAndPush = () =>
    act(async () => {
      const c = await api.gitCommit(projectRoot, message.trim(), [...checked])
      if (!c.ok) return c
      setMessage('')
      const p = await api.gitPush(projectRoot)
      return { ok: p.ok, text: `${c.text}\n${p.text}`.trim() }
    })

  return (
    <Modal
      title={isCommitView ? 'Commit' : 'Team - Git'}
      onClose={onClose}
      footer={
        isCommitView ? (
          <>
            <button type="button" disabled={!canCommit} onClick={commit}>
              Commit
            </button>
            <button type="button" className="is-primary" disabled={!canCommit} title="Commits the checked files, then pushes the current branch" onClick={commitAndPush}>
              Commit &amp; Push
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        )
      }
    >
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {overview ? (
        <div className="forge-git">
          {!isCommitView ? (
            <p className="forge-field-hint" title={overview.root}>
              Branch <strong>{overview.branch ?? '(detached)'}</strong> - {overview.root}
            </p>
          ) : null}
          {initialTab !== 'changes' ? (
          <div className="forge-subtabs" role="tablist" aria-label="Git views">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`forge-subtab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          ) : null}

          {tab === 'changes' ? (
            <div className="forge-commit">
              <div className="forge-commit-main">
                <div className="forge-commit-toolbar" role="toolbar" aria-label="Commit tree">
                  <button type="button" title="Expand all" aria-label="Expand all" onClick={() => setCollapsed(new Set())}>
                    <ExpandAllIcon />
                  </button>
                  <button
                    type="button"
                    title="Collapse all"
                    aria-label="Collapse all"
                    onClick={() => {
                      const all = new Set<string>([''])
                      const walk = (f: TreeFolder) =>
                        f.folders.forEach((c) => {
                          all.add(c.path)
                          walk(c)
                        })
                      walk(tree)
                      setCollapsed(all)
                    }}
                  >
                    <CollapseAllIcon />
                  </button>
                  <button type="button" title="Show changes as a list" aria-label="Show as list" aria-pressed={flat} className={flat ? 'is-active' : undefined} onClick={() => setFlat((v) => !v)}>
                    <ListToggleIcon />
                  </button>
                </div>
                {overview.files.length === 0 ? <p className="forge-field-hint">No changes.</p> : null}
                <div className="forge-commit-treebox" aria-label="Changed files">
                  <ul className="forge-commit-tree" role="tree">
                    <FolderNode
                      folder={flat ? flatRoot : tree}
                      label={rootName}
                      handlers={{
                        checked,
                        collapsed,
                        onToggleFile: (path, on) =>
                          setChecked((prev) => {
                            const next = new Set(prev)
                            if (on) next.add(path)
                            else next.delete(path)
                            return next
                          }),
                        onToggleFolder: (paths, on) =>
                          setChecked((prev) => {
                            const next = new Set(prev)
                            for (const p of paths) {
                              if (on) next.add(p)
                              else next.delete(p)
                            }
                            return next
                          }),
                        onToggleCollapse: (path) =>
                          setCollapsed((prev) => {
                            const next = new Set(prev)
                            if (next.has(path)) next.delete(path)
                            else next.add(path)
                            return next
                          }),
                      }}
                    />
                  </ul>
                </div>
                <div className="forge-titled-rule">
                  <span>Commit Message</span>
                </div>
                <textarea className="forge-commit-message" value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Commit message" rows={5} />
                {messageIssue ? <p className="forge-field-error">{messageIssue}</p> : null}
              </div>
              <aside className="forge-commit-side">
                <div className="forge-titled-rule">
                  <span>Author (This commit only)</span>
                </div>
                <label className="forge-commit-author">
                  <span>Name:</span>
                  <input type="text" readOnly value={overview.user_name ?? ''} placeholder="from git config user.name" title="The author comes from the Git configuration of the repository." />
                </label>
                <label className="forge-commit-author">
                  <span>Email:</span>
                  <input type="text" readOnly value={overview.user_email ?? ''} placeholder="from git config user.email" title="The author comes from the Git configuration of the repository." />
                </label>
                <div className="forge-titled-rule">
                  <span>General</span>
                </div>
                <label className="forge-commit-check" title="Not available yet">
                  <input type="checkbox" disabled /> Amend Commit
                </label>
                <div className="forge-titled-rule">
                  <span>Before Commit</span>
                </div>
                <label className="forge-commit-check" title="Not available yet">
                  <input type="checkbox" disabled /> ESLint analyze changed files
                </label>
              </aside>
            </div>
          ) : null}

          {tab === 'history' ? (
            overview.commits.length === 0 ? (
              <p className="forge-field-hint">No commits yet.</p>
            ) : (
              <div className="forge-history">
                <table className="forge-history-table" aria-label="Commit history">
                  <thead>
                    <tr>
                      <th>Commit</th>
                      <th>Author</th>
                      <th>Date</th>
                      <th>Subject</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.commits.map((c) => (
                      <tr key={c.hash}>
                        <td className="forge-history-hash" title={c.hash}>
                          {c.hash.slice(0, 8)}
                        </td>
                        <td>{c.author}</td>
                        <td>{shortDate(c.date)}</td>
                        <td>{c.subject}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {tab === 'branches' ? (
            <div>
              <label className="forge-field">
                <span>Switch to branch</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Branch">
                  {overview.branches.map((b) => (
                    <option key={b.name} value={b.name} disabled={b.is_current}>
                      {b.name}
                      {b.is_current ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy || !target} onClick={() => act(() => api.gitCheckout(projectRoot, target))}>
                Switch branch
              </button>
              <hr />
              <label className="forge-field">
                <span>New branch name</span>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New branch name" />
              </label>
              <label className="forge-field">
                <span>Start from</span>
                <select value={remoteTarget} onChange={(e) => setRemoteTarget(e.target.value)} aria-label="Start from">
                  <option value="">{overview.branch ?? 'current HEAD'} (current)</option>
                  {overview.remote_branches.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              {nameIssue ? <p className="forge-field-error">{nameIssue}</p> : null}
              <button type="button" disabled={busy || newName.trim() === '' || !!nameIssue} onClick={() => act(() => api.gitCreateBranch(projectRoot, newName.trim(), remoteTarget || null))}>
                Create and switch
              </button>
            </div>
          ) : null}

          {output ? (
            <pre className={output.ok ? 'forge-git-output' : 'forge-git-output is-error'} role="status">
              {output.text || (output.ok ? 'Done.' : 'Failed.')}
            </pre>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
