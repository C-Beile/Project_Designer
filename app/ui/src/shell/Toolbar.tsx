import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconBack,
  IconFind,
  IconDeploy,
  IconForward,
  IconNew,
  IconOpenProject,
  IconRedo,
  IconRefresh,
  IconSaveAll,
  IconSql,
  IconRest,
  IconTranspile,
  IconUndo,
} from './icons'
import { TranspilerEngineSelector } from '../settings/TranspilerEngineSelector'
import type { TranspilerEngineId } from '../settings/transpilerEngine'
import { TOOLBAR_GROUPS, type ToolbarGroup, type ToolbarPrefs } from './toolbarPrefs'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { formatShortcut } from '../core/shortcuts'
import { toolbarItemState, useToolbarItems, type ToolbarContext } from '../core/plugins/registry'

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

/** Knöpfe einer Toolbar-Gruppe, die Plugins über das Register liefern; ohne Beiträge erscheint nichts. */
function PluginToolbarGroup({ group, ctx, onCommand }: { group: string; ctx: ToolbarContext; onCommand: (command: string) => void }) {
  const items = useToolbarItems(group)
  if (items.length === 0) return null
  return (
    <>
      {items.map((i) => {
        const st = toolbarItemState(i, ctx)
        return (
          <ToolButton key={i.id} label={i.label} hint={st.hint} enabled={st.enabled} onClick={() => onCommand(i.command)}>
            {i.icon}
          </ToolButton>
        )
      })}
      <Sep />
    </>
  )
}

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
  /** Project folder is inside a Git repository (false dims the Git buttons). */
  gitRepo?: boolean
  /** The project has changed files (false dims Commit). */
  gitChanges?: boolean
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
  const sqlOn = p.sqlActive !== false

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
          <ToolButton label="REST Client" hint="REST Client" enabled={p.hasProject} onClick={() => p.onCommand('tools.restClient')}>
            <IconRest />
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
          <Sep />
        </>
      ) : null}
      {g.git ? <PluginToolbarGroup group="git" ctx={{ hasProject: p.hasProject, pluginActive: p.gitActive !== false, gitRepo: p.gitRepo !== false, gitChanges: p.gitChanges !== false }} onCommand={p.onCommand} /> : null}
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
