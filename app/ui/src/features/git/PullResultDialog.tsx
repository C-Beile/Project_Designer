import { useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { Modal } from '../../core/Modal'
import { errorText } from '../../core/errorText'
import type { CommitFile, GitCommit } from '../../wire/types'

// What a pull brought in: the new commits (who, when, what) and, per commit, the files that changed. Shown on
// request from the notification of a finished pull, so the pull itself never interrupts the work.

export interface PullResult {
  branch: string | null
  commits: GitCommit[]
  /** package.json or package-lock.json came in: `npm install` is due. */
  dependenciesChanged: boolean
}

const STATUS_LABEL: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied' }

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const minutes = Math.max(0, Math.round((now - then) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(then).toLocaleDateString()
}

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase()
}

/** A stable colour per author, taken from the theme's accent variables. */
function authorColor(name: string): string {
  const palette = ['var(--accent)', 'var(--accent-2)', 'var(--warm)', 'var(--cyan)', 'var(--success)']
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return palette[h % palette.length]
}

function CommitCard({ api, root, commit }: { api: ForgeApi; root: string; commit: GitCommit }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<CommitFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open || files !== null) return
    let cancelled = false
    api
      .scmCommitFiles(root, commit.hash)
      .then((f) => !cancelled && setFiles(f))
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [api, root, commit.hash, open, files])
  return (
    <li className="pull-commit">
      <button type="button" className="pull-commit-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="pull-avatar" style={{ background: authorColor(commit.author) }} aria-hidden="true">
          {initials(commit.author)}
        </span>
        <span className="pull-commit-main">
          <span className="pull-subject">{commit.subject}</span>
          <span className="pull-meta">
            {commit.author} · <time dateTime={commit.date}>{relativeTime(commit.date)}</time> · <code>{commit.hash.slice(0, 7)}</code>
          </span>
        </span>
        <span className="pull-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="pull-files">
          {error ? <p className="forge-field-error">{error}</p> : null}
          {!files && !error ? <p className="forge-field-hint">Loading files...</p> : null}
          {files?.length === 0 ? <p className="forge-field-hint">No files.</p> : null}
          {files?.map((f) => (
            <div key={f.path} className="pull-file">
              <span className={`pull-badge is-${f.status.charAt(0)}`} title={STATUS_LABEL[f.status.charAt(0)] ?? f.status}>
                {f.status.charAt(0)}
              </span>
              <span className="pull-path" title={f.path}>
                {f.path}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  )
}

export function PullResultDialog({ api, root, result, onClose }: { api: ForgeApi; root: string; result: PullResult; onClose: () => void }) {
  const authors = useMemo(() => [...new Set(result.commits.map((c) => c.author))], [result.commits])
  const title = `Pull result${result.branch ? ` · ${result.branch}` : ''}`
  return (
    <Modal title={title} onClose={onClose} onEnter={onClose} footer={<button type="button" onClick={onClose}>Close</button>}>
      <div className="pull-result">
        <p className="pull-summary">
          <strong>
            {result.commits.length} new commit{result.commits.length === 1 ? '' : 's'}
          </strong>
          {authors.length > 0 ? ` from ${authors.join(', ')}` : ''}
        </p>
        {result.dependenciesChanged ? <p className="pull-banner">package.json changed: run <code>npm install</code>.</p> : null}
        {result.commits.length === 0 ? <p className="forge-field-hint">New changes were merged, the list of commits is not available.</p> : null}
        <ul className="pull-list">
          {result.commits.map((c) => (
            <CommitCard key={c.hash} api={api} root={root} commit={c} />
          ))}
        </ul>
      </div>
    </Modal>
  )
}
