import { useEffect, useRef, useState } from 'react'
import { registerStatusBarItem, type StatusBarSlotProps } from '../../core/plugins/registry'
import { errorText } from '../../core/errorText'
import type { GitOverview } from '../../wire/types'

export type GitStatusAction = 'commit' | 'pull' | 'push' | 'branches' | 'newBranch' | 'history'

/** Was die Shell dem Git-Statusleisten-Beitrag über `pluginData.git` gibt. */
export interface GitStatusData {
  branch: string | null
  gitEnabled: boolean
  loadBranches?: () => Promise<GitOverview>
  onGit?: (action: GitStatusAction) => void
  /** Opens the Git dialog on the Branches tab with this branch preselected; nothing is switched yet. */
  onCheckoutBranch?: (target: { local?: string; remote?: string }) => void
}

interface Anchor {
  x: number
  y: number
}

/** Branch-Knopf der Statusleiste: Klick = Branch-Popup, Rechtsklick = Menü Commit/Pull/Push. */
export function GitStatusItem({ data, openMenu }: StatusBarSlotProps) {
  const git = (data.git ?? { branch: null, gitEnabled: false }) as GitStatusData
  const { branch, gitEnabled, loadBranches, onGit, onCheckoutBranch } = git
  const [popup, setPopup] = useState<{ at: Anchor; data: GitOverview | null; error: string | null } | null>(null)

  function branchContext(e: React.MouseEvent<HTMLElement>) {
    e.preventDefault()
    setPopup(null)
    const off = !gitEnabled || branch === null
    openMenu(
      e.currentTarget,
      [
        { id: 'commit', label: 'Commit...', enabled: !off, hint: 'No Git repository' },
        { id: 'pull', label: 'Pull...', enabled: !off, hint: 'No Git repository' },
        { id: 'push', label: 'Push...', enabled: !off, hint: 'No Git repository' },
        { id: 'sep', label: '', enabled: false, separator: true },
        { id: 'newBranch', label: 'New Branch...', enabled: !off, hint: 'No Git repository' },
        { id: 'branches', label: 'Switch Branch...', enabled: !off, hint: 'No Git repository' },
        { id: 'history', label: 'History', enabled: !off, hint: 'No Git repository' },
      ],
      (id) => onGit?.(id as GitStatusAction),
    )
  }

  async function openBranches(e: React.MouseEvent<HTMLElement>) {
    if (!gitEnabled || branch === null) return
    const r = e.currentTarget.getBoundingClientRect()
    const at = { x: r.left, y: r.top }
    setPopup({ at, data: null, error: null })
    try {
      const d = await loadBranches?.()
      setPopup({ at, data: d ?? null, error: d ? null : 'Branches are not available.' })
    } catch (err) {
      setPopup({ at, data: null, error: errorText(err) })
    }
  }

  return (
    <>
      <button
        type="button"
        className="forge-status-btn forge-status-branch"
        title={branch ? `Git branch ${branch}: click to switch, right-click for Commit, Pull, Push` : 'No Git branch'}
        disabled={branch === null}
        onClick={openBranches}
        onContextMenu={branchContext}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            branchContext(e as unknown as React.MouseEvent<HTMLElement>)
          }
        }}
      >
        {branch ?? ''}
      </button>
      {popup ? (
        <BranchPopup at={popup.at} data={popup.data} error={popup.error} onClose={() => setPopup(null)} onNew={() => onGit?.('newBranch')} onPick={(t) => onCheckoutBranch?.(t)} />
      ) : null}
    </>
  )
}

export function registerGitStatusItem(): () => void {
  return registerStatusBarItem({ plugin: 'git', id: 'git.branch', align: 'right', order: 50, component: GitStatusItem })
}

// "Git Branches" popup of the original (reference shot 58): New Branch, Local Branches, Remote
// Branches. The arrow of a row opens its actions in the original; which actions it offers is not
// visible in the shot, so a click on a row only opens the Git dialog with that branch preselected,
// where the switch needs one more click.
function BranchPopup({
  at,
  data,
  error,
  onClose,
  onNew,
  onPick,
}: {
  at: Anchor
  data: GitOverview | null
  error: string | null
  onClose: () => void
  onNew: () => void
  onPick: (t: { local?: string; remote?: string }) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const localBranches = (data?.branches ?? []).filter((b) => !needle || b.name.toLowerCase().includes(needle))
  const remoteBranches = (data?.remote_branches ?? []).filter((r) => !needle || r.toLowerCase().includes(needle))
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, data])
  const left = Math.max(0, Math.min(at.x, window.innerWidth - 330))
  return (
    <div ref={ref} className="forge-branch-popup" role="dialog" aria-label="Git Branches" style={{ left, bottom: window.innerHeight - at.y + 2 }}>
      <header>
        <span>Git Branches</span>
        {data?.branch ? <span className="forge-branch-current">{data.branch}</span> : null}
      </header>
      {data ? <input type="search" className="forge-branch-filter" placeholder="Filter branches" aria-label="Filter branches" value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
      {error ? <p className="forge-field-error">{error}</p> : null}
      {!data && !error ? <p className="forge-field-hint">Loading...</p> : null}
      {data ? (
        <div className="forge-branch-list">
          <button
            type="button"
            className="forge-branch-item"
            onClick={() => {
              onClose()
              onNew()
            }}
          >
            + New Branch
          </button>
          <h4>
            Local Branches <span className="forge-branch-count">{localBranches.length}</span>
          </h4>
          {localBranches.length === 0 ? <p className="forge-field-hint">No branch matches.</p> : null}
          {localBranches.map((b) => (
            <button
              key={b.name}
              type="button"
              className={`forge-branch-item${b.is_current ? ' is-current' : ''}`}
              aria-current={b.is_current ? 'true' : undefined}
              title={b.is_current ? 'Current branch' : `Switch to ${b.name} (confirm in the dialog)`}
              onClick={() => {
                if (b.is_current) return onClose()
                onClose()
                onPick({ local: b.name })
              }}
            >
              <span className="forge-branch-name">{b.is_current ? <span className="forge-branch-check" aria-hidden="true">&#10003;</span> : null}{b.name}</span>
              <span className="forge-branch-arrow" aria-hidden="true">&#9656;</span>
            </button>
          ))}
          <h4>
            Remote Branches <span className="forge-branch-count">{remoteBranches.length}</span>
          </h4>
          {remoteBranches.length === 0 ? <p className="forge-field-hint">{data.remote_branches.length === 0 ? 'None' : 'No branch matches.'}</p> : null}
          {remoteBranches.map((r) => (
            <button
              key={r}
              type="button"
              className="forge-branch-item"
              title={`Create a local branch from ${r} (confirm in the dialog)`}
              onClick={() => {
                onClose()
                onPick({ remote: r })
              }}
            >
              <span className="forge-branch-name">{r}</span>
              <span className="forge-branch-arrow" aria-hidden="true">&#9656;</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
