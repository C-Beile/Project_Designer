import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconBack,
  IconFind,
  IconCommit,
  IconDeploy,
  IconForward,
  IconHistory,
  IconNew,
  IconOpenProject,
  IconPull,
  IconPush,
  IconRedo,
  IconRefresh,
  IconRun,
  IconSaveAll,
  IconSql,
  IconTranspile,
  IconUndo,
} from './icons'
import { TranspilerEngineSelector } from '../settings/TranspilerEngineSelector'
import type { TranspilerEngineId } from '../settings/transpilerEngine'
import { TOOLBAR_GROUPS, type ToolbarGroup, type ToolbarPrefs } from './toolbarPrefs'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { formatShortcut } from './shortcuts'

export const DEPLOY_DISABLED_HINT = 'Deploy (open a project first)'
export const RUN_DISABLED_HINT = 'Not available yet: Dito Designer cannot start a server or client'

// Disabled buttons stay focusable (aria-disabled instead of the disabled attribute) so their
// tooltip explaining *why* they are unavailable can still be reached.
function ToolButton({
  label,
  hint,
  enabled,
  onClick,
  children,
  className,
}: {
  label: string
  hint?: string
  enabled: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={`forge-tool-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={hint ?? label}
      aria-disabled={!enabled || undefined}
      onClick={() => {
        if (enabled) onClick?.()
      }}
    >
      {children}
    </button>
  )
}

const tip = (text: string, shortcut: string) => `${text} (${formatShortcut(shortcut)})`

const Sep = () => <span className="forge-toolbar-sep" aria-hidden="true" />

export interface ToolbarProps {
  hasProject: boolean
  hasSelection: boolean
  hasUnsaved: boolean
  canUndo: boolean
  canRedo: boolean
  systems: string[]
  runConfig: string
  onRunConfigChange: (system: string) => void
  engine: TranspilerEngineId
  onEngineChange: (engine: TranspilerEngineId) => void
  transpileRunning: boolean
  onCommand: (command: string) => void
  prefs: ToolbarPrefs
  onToggleGroup: (group: ToolbarGroup) => void
  /** Git plugin and Execute SQL switched on in Tools > Plugins. */
  gitActive?: boolean
  sqlActive?: boolean
}

function useHeapMb(active: boolean): string {
  const [mb, setMb] = useState('')
  useEffect(() => {
    if (!active) return
    const read = () => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      setMb(mem ? `${Math.round(mem.usedJSHeapSize / (1024 * 1024))} MB` : 'n/a')
    }
    read()
    const t = setInterval(read, 3000)
    return () => clearInterval(t)
  }, [active])
  return mb
}

export function Toolbar(p: ToolbarProps) {
  const transpileEnabled = p.hasProject && !p.transpileRunning
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const heap = useHeapMb(p.prefs.groups.performance)
  const g = p.prefs.groups
  const gitOn = p.hasProject && p.gitActive !== false
  const gitHint = (what: string) => (p.gitActive === false ? `${what} (Git plugin deactivated)` : p.hasProject ? what : `${what} (open a project first)`)
  const sqlOn = p.sqlActive !== false
  const hasSystems = p.systems.length > 0

  return (
    <div
      className={`forge-toolbar${p.prefs.smallIcons ? '' : ' is-large'}`}
      role="toolbar"
      aria-label="Main toolbar"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {menu ? (
        <TreeContextMenu
          entries={TOOLBAR_GROUPS.map((t) => ({ id: t.id, label: `${g[t.id] ? '✓ ' : '   '}${t.label}`, enabled: true }))}
          x={menu.x}
          y={menu.y}
          onPick={(id) => p.onToggleGroup(id as ToolbarGroup)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {g.open ? (
        <>
          <ToolButton label="New" hint={tip(p.hasProject ? 'New' : 'New (open a project first)', 'Mod+N')} enabled={p.hasProject} onClick={() => p.onCommand('file.new')}>
            <IconNew />
          </ToolButton>
          <ToolButton label="Find" hint={tip(p.hasProject ? 'Find' : 'Find (open a project first)', 'Mod+O')} enabled={p.hasProject} onClick={() => p.onCommand('file.find')}>
            <IconFind />
          </ToolButton>
          <ToolButton label="Reload All from Disk" enabled={p.hasProject} onClick={() => p.onCommand('file.reloadAll')}>
            <IconRefresh />
          </ToolButton>
          <ToolButton label="Previous" hint={tip('Previous (not available yet)', 'Mod+Alt+ArrowLeft')} enabled={false}>
            <IconBack />
          </ToolButton>
          <ToolButton label="Next" hint={tip('Next (not available yet)', 'Mod+Alt+ArrowRight')} enabled={false}>
            <IconForward />
          </ToolButton>
          <ToolButton label="Save All" hint={tip('Save All', 'Mod+S')} enabled={p.hasUnsaved} onClick={() => p.onCommand('file.saveAll')}>
            <IconSaveAll />
          </ToolButton>
          <ToolButton label="Open Project…" enabled onClick={() => p.onCommand('file.openProject')}>
            <IconOpenProject />
          </ToolButton>
          <Sep />
        </>
      ) : null}
      {g.undoredo ? (
        <>
          <ToolButton label="Undo" hint={tip('Undo', 'Mod+Z')} enabled={p.canUndo} onClick={() => p.onCommand('edit.undo')}>
            <IconUndo />
          </ToolButton>
          <ToolButton label="Redo" hint={tip('Redo', 'Mod+Y')} enabled={p.canRedo} onClick={() => p.onCommand('edit.redo')}>
            <IconRedo />
          </ToolButton>
          <Sep />
        </>
      ) : null}
      {g.deploy ? (
        <>
          <ToolButton label="Deploy Project" hint={p.hasProject ? tip('Deploy Project', 'Mod+F8') : DEPLOY_DISABLED_HINT} enabled={p.hasProject} onClick={() => p.onCommand('project.deploy')}>
            <IconDeploy />
          </ToolButton>
          <ToolButton label="Execute SQL" hint={sqlOn ? 'Execute SQL' : 'Execute SQL (Execute SQL plugin deactivated)'} enabled={sqlOn} onClick={() => p.onCommand('tools.sqlPrompt')}>
            <IconSql />
          </ToolButton>
          <Sep />
        </>
      ) : null}
      {g.run ? (
        <>
          <ToolButton
            label="Partial Transpile"
            hint={p.transpileRunning ? 'Transpile running…' : p.hasProject ? 'Partial Transpile' : 'Partial Transpile (open a project first)'}
            enabled={transpileEnabled}
            onClick={() => p.onCommand('tools.transpilePartial')}
          >
            <IconTranspile />
          </ToolButton>
          <select
            className="forge-runconfig"
            aria-label="Run configuration"
            value={hasSystems ? p.runConfig : ''}
            disabled={!hasSystems}
            onChange={(e) => p.onRunConfigChange(e.target.value)}
          >
            {hasSystems ? null : <option value="">&lt;no config&gt;</option>}
            {hasSystems ? (
              <>
                <optgroup label="Clients">
                  {p.systems.map((s) => (
                    <option key={`c-${s}`} value={s}>
                      Web-Client (Neon) - {s}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Servers">
                  {p.systems.map((s) => (
                    <option key={`s-${s}`} value={s} disabled>
                      Server - {s}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Scripts">
                  <option value="" disabled>
                    (no scripts)
                  </option>
                </optgroup>
              </>
            ) : null}
          </select>
          <ToolButton label="Execute selected configuration" hint={`${RUN_DISABLED_HINT} (${formatShortcut('F9')})`} enabled={false} className="forge-tool-run">
            <IconRun />
          </ToolButton>
          <Sep />
        </>
      ) : null}
      {g.git ? (
        <>
          <ToolButton label="Pull" hint={gitHint('Pull: show and merge new commits of the remote')} enabled={gitOn} onClick={() => p.onCommand('team.pullView')}>
            <IconPull />
          </ToolButton>
          <ToolButton label="Commit Changed Files" hint={gitHint('Commit Changed Files')} enabled={gitOn} onClick={() => p.onCommand('team.commit')}>
            <IconCommit />
          </ToolButton>
          <ToolButton label="Push" hint={gitHint('Push: choose the local commits to push')} enabled={gitOn} onClick={() => p.onCommand('team.pushView')}>
            <IconPush />
          </ToolButton>
          <ToolButton label="Show Project History" hint={gitHint('Show Project History')} enabled={gitOn} onClick={() => p.onCommand('team.history')}>
            <IconHistory />
          </ToolButton>
          <Sep />
        </>
      ) : null}
      {g.analytics ? (
        <>
          <Sep />
        </>
      ) : null}
      {g.convert ? (
        <>
          <Sep />
        </>
      ) : null}
      {g.performance ? (
        <>
          <span className="forge-toolbar-heap" title="performance mb - memory used by the Designer window">
            {heap}
          </span>
          <Sep />
        </>
      ) : null}
      {g.build ? (
        <>
          <ToolButton
            label="Transpile"
            hint={p.transpileRunning ? 'Transpile running…' : p.hasProject ? 'Transpile' : 'Transpile (open a project first)'}
            enabled={transpileEnabled}
            onClick={() => p.onCommand('tools.transpileFull')}
          >
            <IconTranspile />
          </ToolButton>
          <TranspilerEngineSelector engine={p.engine} onChange={p.onEngineChange} disabled={p.transpileRunning} />
        </>
      ) : null}
    </div>
  )
}
