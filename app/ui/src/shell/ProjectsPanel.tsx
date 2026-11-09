import { useState } from 'react'
import type { ComponentProps } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { ServicesPanel } from '../services/ServicesPanel'
import { ProjectTree } from '../tree/ProjectTree'
import { ProjectIcon } from '../tree/treeIcons'
import { tunnelTabNode } from '../tabs/tabModel'
import { errorText } from '../core/errorText'
import { textField } from '../wire/types'
import type { DbStatus, TreeNode } from '../wire/types'
import type { FloatView } from '../windows/protocol'
import { baseName, samePath } from './shellHelpers'
import { TreeContextMenu } from '../tree/TreeContextMenu'

export type ProjectsTab = 'projects' | 'services'

// Kopf des Projects-Panels: Reiter Projects / Services (schwebende Reiter fehlen).
export function ProjectsPanelHeader({ tab, floating, onTab, servicesVisible = true }: { tab: ProjectsTab; floating: FloatView[]; onTab: (t: ProjectsTab) => void; servicesVisible?: boolean }) {
  return (
    <div className="forge-panel-tabs" role="tablist" aria-label="Project windows">
      {(['projects', 'services'] as const).filter((t) => !floating.includes(t as FloatView) && (t === 'projects' || servicesVisible || tab === 'services')).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          className={`forge-panel-tab${tab === t ? ' is-active' : ''}`}
          onClick={() => onTab(t)}
        >
          {t === 'projects' ? 'Projects' : 'Services'}
        </button>
      ))}
    </div>
  )
}

export interface ProjectsPanelBodyProps {
  api: ForgeApi
  tab: ProjectsTab
  tree: TreeNode[]
  root: string
  loading: boolean
  problemCounts: ComponentProps<typeof ProjectTree>['problemCounts']
  badgeFor: ComponentProps<typeof ProjectTree>['badgeFor']
  gitFor: ComponentProps<typeof ProjectTree>['gitFor']
  iconSvg: (id: string) => string | undefined
  db: DbStatus
  onDbChange: (next: DbStatus) => void
  onSelect: ComponentProps<typeof ProjectTree>['onSelect']
  onOpen: (node: TreeNode, top?: TreeNode) => Promise<void>
  onContextMenu: ComponentProps<typeof ProjectTree>['onContextMenu']
  onFileKey: ComponentProps<typeof ProjectTree>['onFileKey']
  onCloseProject: () => void
  onOpenSql: (sql: string) => void
  setStatus: (text: string) => void
  /** Recently opened projects for the context menu of the empty panel area. */
  recentProjects: string[]
  openProjects: string[]
  onOpenProjects: () => void
  onOpenRecent: (path: string) => void
}

// Inhalt des Projects-Panels: Projektbaum mit Leiste des aktiven Projekts, oder die Services.
export function ProjectsPanelBody({ api, tab, tree, root, loading, problemCounts, badgeFor, gitFor, iconSvg, db, onDbChange, onSelect, onOpen, onContextMenu, onFileKey, onCloseProject, onOpenSql, setStatus, recentProjects, openProjects, onOpenProjects, onOpenRecent }: ProjectsPanelBodyProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  if (tab !== 'projects') return <ServicesPanel api={api} db={db} onDbChange={onDbChange} onOpenSql={onOpenSql} projects={openProjects} />
  const recentEntries = recentProjects.map((p) => {
    const open = openProjects.some((o) => samePath(o, p))
    return { id: `recent:${p}`, label: baseName(p), enabled: !open, hint: open ? 'Already open' : p }
  })
  return (
    <div
      className="projects-panel"
      onContextMenu={(e) => {
        // A row of the tree has its own menu; this one belongs to the empty area and the active project bar.
        if (e.defaultPrevented) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <ProjectTree
        roots={tree}
        loading={loading}
        onSelect={onSelect}
        onOpen={onOpen}
        loadChildren={(n) => api.listTreeChildren(n.id)}
        onContextMenu={onContextMenu}
        problemCounts={problemCounts}
        badgeFor={badgeFor}
        iconSvg={iconSvg}
        onSystemTunnel={(node) =>
          void api
            .getPropertyTree(node.id)
            .then((t) => {
              const reference = textField(t, 'tunnelConfigPath') ?? ''
              if (reference) void onOpen(tunnelTabNode(node.id, node.label, reference))
              else setStatus(`${node.label} has no tunnelConfigPath yet. Choose the tunnel config in its properties (the ... button).`)
            })
            .catch((e) => setStatus(errorText(e)))
        }
        gitFor={gitFor}
        onFileKey={onFileKey}
      />
      {root ? (
        <div className="projects-active-bar" aria-label="Active project">
          <ProjectIcon />
          <span className="projects-active-name" title={root}>
            {baseName(root)}
          </span>
          <button type="button" aria-label={`Close project ${baseName(root)}`} title="Close Project" onClick={onCloseProject}>
            ×
          </button>
        </div>
      ) : null}
      {menu ? (
        <TreeContextMenu
          entries={[
            { id: 'open', label: 'Open Project…', enabled: true, hint: 'Choose one or more project folders' },
            { id: 'sep', label: '', enabled: false, separator: true },
            recentEntries.length > 0 ? { id: 'recent', label: 'Open recent', enabled: true, children: recentEntries } : { id: 'recent', label: 'Open recent', enabled: false, hint: 'No project opened yet' },
          ]}
          x={menu.x}
          y={menu.y}
          onPick={(id) => (id === 'open' ? onOpenProjects() : id.startsWith('recent:') ? onOpenRecent(id.slice('recent:'.length)) : undefined)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
