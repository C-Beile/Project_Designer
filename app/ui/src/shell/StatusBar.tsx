import { useCallback, useState, useSyncExternalStore } from 'react'
import { useStatusBarItems } from '../core/plugins/registry'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'
import { getEditorStatus, goToLine, subscribeEditorStatus, toggleOvertype } from '../theme/monacoActions'
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
  pluginData,
}: {
  system: string | null
  systems?: string[]
  onPickSystem?: (name: string) => void
  message: string
  task: StatusTask | null
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
  /** Daten für Plugin-Beiträge, je Plugin-Id (z. B. `git`); die Shell füllt sie, die Beiträge lesen sie. */
  pluginData?: Record<string, unknown>
}) {
  const editor = useSyncExternalStore(subscribeEditorStatus, getEditorStatus)
  const [menu, setMenu] = useState<{ entries: MenuEntry[]; at: Anchor; pick: (id: string) => void } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  function anchorOf(el: HTMLElement): Anchor {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top }
  }

  function openMenu(el: HTMLElement, entries: MenuEntry[], pick: (id: string) => void) {
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

  const leftItems = useStatusBarItems('left')
  const rightItems = useStatusBarItems('right')
  const caretText = editor.hasEditor ? `${editor.line}:${editor.column}` : ''

  return (
    <footer className="forge-statusbar" aria-label="Status bar">
      <button type="button" className="forge-status-btn forge-status-system" title="Run configuration (system): click to choose" onClick={systemMenu}>
        {system || '-'}
      </button>
      <span className="forge-status-message" role="status">
        {message}
      </span>
      {leftItems.map((i) => (
        <i.component key={i.id} data={pluginData ?? {}} openMenu={openMenu} />
      ))}
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
      {rightItems.map((i) => (
        <i.component key={i.id} data={pluginData ?? {}} openMenu={openMenu} />
      ))}
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
    </footer>
  )
}
