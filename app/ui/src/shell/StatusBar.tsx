import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'
import { getEditorStatus, goToLine, subscribeEditorStatus, toggleOvertype } from '../theme/monacoActions'
import type { GitOverview } from '../wire/types'
import { TunnelStateIcon } from '../tree/TunnelStateIcon'
import { TUNNEL_PHASE_LABEL, type TunnelPhase } from '../services/tunnelState'

// Status bar. Layout from the original (reference shots 58, 59, 60): notification and task icons,
// the Git branch, INS, caret position and encoding sit at the right edge; the branch opens a
// "Git Branches" popup. Every element is a button with a tooltip and can be reached with Tab.
// Choices not shown in a reference shot (marked "own choice" in ORIGINAL_DELTA.md): the actions of
// the system, tunnel, error, caret, INS and encoding cells, and the context menu of the branch.

export interface StatusTask {
  label: string
}

export type GitStatusAction = 'commit' | 'pull' | 'push' | 'branches' | 'newBranch' | 'history'

interface Anchor {
  x: number
  y: number
}

export function StatusBar({
  system,
  systems = [],
  onPickSystem,
  message,
  task,
  branch,
  tunnel = null,
  tunnelPhase,
  errors = 0,
  onShowProblems,
  onShowOutput,
  onShowNotifications,
  onShowServices,
  onCloseTunnels,
  openTunnels,
  tunnelDetail,
  loadBranches,
  onGit,
  onCheckoutBranch,
  gitEnabled = true,
}: {
  system: string | null
  systems?: string[]
  onPickSystem?: (name: string) => void
  message: string
  task: StatusTask | null
  branch: string | null
  /** SSH tunnel of the Services tab; null hides the cell. */
  tunnel?: boolean | null
  /** Colour state of the tunnel (grey, yellow, green, red); defaults to on/off from `tunnel`. */
  tunnelPhase?: TunnelPhase
  /** Systems whose tunnel is open right now (status bar shows the count, the tooltip the names). */
  openTunnels?: string[]
  /** Running connect, e.g. "dev1: Waiting for the database (12 s)". */
  tunnelDetail?: string
  /** Number of errors in the open projects; a click opens the Problems tab. */
  errors?: number
  onShowProblems?: () => void
  onShowOutput?: () => void
  onShowNotifications?: () => void
  onShowServices?: () => void
  onCloseTunnels?: () => void
  loadBranches?: () => Promise<GitOverview>
  onGit?: (action: GitStatusAction) => void
  /** Opens the Git dialog on the Branches tab with this branch preselected; nothing is switched yet. */
  onCheckoutBranch?: (target: { local?: string; remote?: string }) => void
  gitEnabled?: boolean
}) {
  const editor = useSyncExternalStore(subscribeEditorStatus, getEditorStatus)
  const [menu, setMenu] = useState<{ entries: MenuEntry[]; at: Anchor; pick: (id: string) => void } | null>(null)
  const [branchPopup, setBranchPopup] = useState<{ at: Anchor; data: GitOverview | null; error: string | null } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  function anchorOf(el: HTMLElement): Anchor {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top }
  }

  function openMenu(el: HTMLElement, entries: MenuEntry[], pick: (id: string) => void) {
    setBranchPopup(null)
    setMenu({ entries, at: anchorOf(el), pick })
  }

  function systemMenu(e: React.MouseEvent<HTMLElement>) {
    const list: MenuEntry[] = systems.length
      ? systems.map((s) => ({ id: s, label: `${s === system ? '✔ ' : '    '}${s}`, enabled: true }))
      : [{ id: 'none', label: 'No systems in the project', enabled: false, hint: 'The project has no system definitions' }]
    openMenu(e.currentTarget, list, (id) => onPickSystem?.(id))
  }

  function tunnelMenu(e: React.MouseEvent<HTMLElement>) {
    openMenu(
      e.currentTarget,
      [
        { id: 'services', label: 'Tunnel Overview (Services)', enabled: true },
        { id: 'sep', label: '', enabled: false, separator: true },
        { id: 'open', label: 'Open Tunnels...', enabled: tunnel !== true, hint: 'The tunnel is already open; choose the config in the Services tab' },
        { id: 'close', label: 'Close Opened Tunnels', enabled: tunnel === true, hint: 'No tunnel is open' },
      ],
      (id) => {
        if (id === 'close') onCloseTunnels?.()
        else onShowServices?.()
      },
    )
  }

  function encodingMenu(e: React.MouseEvent<HTMLElement>) {
    openMenu(
      e.currentTarget,
      [
        { id: 'enc', label: '✔ UTF-8', enabled: true },
        { id: 'enc2', label: '    Other encodings', enabled: false, hint: 'Files are always read and written as UTF-8' },
        { id: 'sep', label: '', enabled: false, separator: true },
        { id: 'eol', label: `Line ending: ${editor.eol ?? 'no file open'}`, enabled: false, hint: 'Line endings are kept as they are in the file' },
      ],
      () => {},
    )
  }

  function branchContext(e: React.MouseEvent<HTMLElement>) {
    e.preventDefault()
    const el = e.currentTarget
    const off = !gitEnabled || branch === null
    openMenu(
      el,
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
    const at = anchorOf(e.currentTarget)
    setMenu(null)
    setBranchPopup({ at, data: null, error: null })
    try {
      const data = await loadBranches?.()
      setBranchPopup({ at, data: data ?? null, error: data ? null : 'Branches are not available.' })
    } catch (err) {
      setBranchPopup({ at, data: null, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const caretText = editor.hasEditor ? `${editor.line}:${editor.column}` : ''

  return (
    <footer className="forge-statusbar" aria-label="Status bar">
      <button type="button" className="forge-status-btn forge-status-system" title="Run configuration (system): click to choose" onClick={systemMenu}>
        {system || '-'}
      </button>
      <span className="forge-status-message" role="status">
        {message}
      </span>
      <button
        type="button"
        className="forge-status-btn forge-status-progress"
        title={task ? `${task.label} (click to open the Output window)` : 'Background tasks: no task is running (click to open the Output window)'}
        onClick={onShowOutput}
      >
        {task ? (
          <>
            <span className="forge-status-task">{task.label}</span>
            <span className="forge-progressbar" role="progressbar" aria-label={task.label} aria-busy="true">
              <span className="forge-progressbar-fill" />
            </span>
          </>
        ) : (
          <span aria-label="Background tasks">{'☰'}</span>
        )}
      </button>
      <button
        type="button"
        className={`forge-status-btn forge-status-errors${errors > 0 ? ' has-errors' : ''}`}
        title={errors > 0 ? 'Show the Problems tab' : 'No errors (click to open the Problems tab)'}
        onClick={onShowProblems}
      >
        {errors > 0 ? `✖ ${errors} error${errors === 1 ? '' : 's'}` : '✔ No errors'}
      </button>
      {tunnel === null ? null : (
        <button type="button" className="forge-status-btn forge-status-tunnel" data-state={tunnelPhase ?? (tunnel ? 'on' : 'off')} title={`SSH tunnel (${TUNNEL_PHASE_LABEL[tunnelPhase ?? (tunnel ? 'on' : 'off')]})${tunnelDetail ? `: ${tunnelDetail}` : ''}${openTunnels && openTunnels.length > 0 ? `: ${openTunnels.join(', ')}` : ''} - click for the tunnel overview`} onClick={tunnelMenu}>
          <TunnelStateIcon state={tunnelPhase ?? (tunnel ? 'on' : 'off')} /> Tunnel: {tunnelPhase === 'connecting' ? <>Connecting...{tunnelDetail ? ` ${tunnelDetail.replace(/^.*\((\d+ s)\)$/, '$1')}` : ''}</> : tunnelPhase === 'error' ? 'error' : tunnelPhase === 'open' ? 'open' : tunnel ? (openTunnels && openTunnels.length > 1 ? `on (${openTunnels.length})` : 'on') : 'off'}
        </button>
      )}
      <button type="button" className="forge-status-btn forge-status-notify" title="Notifications (click to open the Notifications tab)" aria-label="Notifications" onClick={onShowNotifications}>
        {'✉'}
      </button>
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
      <button type="button" className="forge-status-btn forge-status-cell" title="Insert or overtype mode (click or Insert key to switch)" onClick={() => toggleOvertype()} disabled={!editor.hasEditor}>
        {editor.overtype ? 'OVR' : 'INS'}
      </button>
      <button
        type="button"
        className="forge-status-btn forge-status-cell forge-status-caret"
        title="Line:column of the caret (click for Go to Line)"
        disabled={!editor.hasEditor}
        onClick={() => goToLine()}
      >
        {caretText}
      </button>
      <button type="button" className="forge-status-btn forge-status-cell" title="Encoding (click for details)" onClick={encodingMenu}>
        {editor.hasEditor ? 'UTF-8' : 'N/A'}
      </button>
      {menu ? <TreeContextMenu entries={menu.entries} x={menu.at.x} y={menu.at.y} onPick={menu.pick} onClose={closeMenu} /> : null}
      {branchPopup ? (
        <BranchPopup
          at={branchPopup.at}
          data={branchPopup.data}
          error={branchPopup.error}
          onClose={() => setBranchPopup(null)}
          onNew={() => onGit?.('newBranch')}
          onPick={(t) => onCheckoutBranch?.(t)}
        />
      ) : null}
    </footer>
  )
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
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, data])
  const left = Math.max(0, Math.min(at.x, window.innerWidth - 330))
  return (
    <div ref={ref} className="forge-branch-popup" role="dialog" aria-label="Git Branches" style={{ left, bottom: window.innerHeight - at.y + 2 }}>
      <header>Git Branches</header>
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
          <h4>Local Branches</h4>
          {data.branches.map((b) => (
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
              {b.name}
              <span aria-hidden="true"> &#9656;</span>
            </button>
          ))}
          <h4>Remote Branches</h4>
          {data.remote_branches.length === 0 ? <p className="forge-field-hint">None</p> : null}
          {data.remote_branches.map((r) => (
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
              {r}
              <span aria-hidden="true"> &#9656;</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
