import { useEffect, useMemo, type ComponentProps, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { getEditorFor } from '../editors/registry'
import { runCommandById } from '../core/plugins/registry'
import { ProjectIndexContext, type ProjectIndex } from '../editors/projectIndex'
import { collectByType } from '../core/treeIndex'
import { EditorTabBar } from '../tabs/EditorTabBar'
import { ObjectEditorArea } from '../tabs/ObjectEditorArea'
import { activeTab, isAliasConfigNode, setSubTab, type SubTab, type TabState } from '../tabs/tabModel'
import { parseAliasConfigRef } from '../tabs/AliasConfigTab'
import { ConfigNavigator } from '../navigator/ConfigNavigator'
import { NavigatorPanel } from '../navigator/NavigatorPanel'
import { isConfigurationAlias, sectionLabel, useConfigSection } from '../properties/configSections'
import { normId, type Problem } from '../problems/problemStore'
import { useUserSelection } from '../services/userSelection'
import { useTunnelState } from '../services/tunnelState'
import { osWindowsAvailable } from '../windows/windowService'
import type { useEditorWindows } from '../windows/useEditorWindows'
import type { AliasConfigDto, TreeNode, TreeNodeKind, UndoRedoOutcome, WireValue } from '../wire/types'
import type { PanelContent } from './DockLayout'
import type { PanelId } from './layoutState'
import { OutputBody, OutputTabs, type OutputMainTab, type OutputSubTab } from './OutputPanel'
import { PropertiesBody } from './PropertiesBody'
import { ProjectsPanelBody, ProjectsPanelHeader } from './ProjectsPanel'
import { baseName, originLabel } from './shellHelpers'
import type { useDbStatus } from './hooks/useDbStatus'
import type { useFloatingWindows } from './hooks/useFloatingWindows'
import type { useOutputLogs } from './hooks/useOutputLogs'
import type { useProblemScan } from './hooks/useProblemScan'
import type { useRefactoring } from './hooks/useRefactoring'
import type { useTreeActions } from './hooks/useTreeActions'

type Refactoring = ReturnType<typeof useRefactoring>
type TreeActions = ReturnType<typeof useTreeActions>
type Reveal = { nodeId: string; line: number; column?: number; token: number }

export interface ShellPanelsDeps {
  api: ForgeApi
  root: string
  projects: string[]
  tree: TreeNode[]
  objectsByType: ReturnType<typeof collectByType>
  tabState: TabState
  setTabState: Dispatch<SetStateAction<TabState>>
  selected: TreeNode | null
  selectedProject: string
  value: WireValue | null
  setValue: (v: WireValue | null) => void
  sheetVersion: number
  setSheetVersion: (update: (v: number) => number) => void
  setCanUndo: (v: boolean) => void
  setCanRedo: (v: boolean) => void
  recent: string | null
  recentList: string[]
  unsaved: Set<string>
  hasProject: boolean
  totalErrors: number
  problemList: Problem[]
  problemCounts: ComponentProps<typeof EditorTabBar>['problemCounts']
  scanning: ReturnType<typeof useProblemScan>
  logs: ReturnType<typeof useOutputLogs>['logs']
  clearLog: ReturnType<typeof useOutputLogs>['clearLog']
  db: ReturnType<typeof useDbStatus>['db']
  changeDb: ReturnType<typeof useDbStatus>['changeDb']
  drafts: MutableRefObject<Map<string, string>>
  historyFlags: MutableRefObject<Map<string, { undo: boolean; redo: boolean }>>
  sqlTexts: MutableRefObject<Map<string, string>>
  sqlNonce: number
  reveal: Reveal | null
  setReveal: (r: Reveal | null) => void
  projectIndex: ProjectIndex
  editorWindows: ReturnType<typeof useEditorWindows>
  bridge: ReturnType<typeof useFloatingWindows>['bridge']
  systemBadge: NonNullable<ComponentProps<typeof ProjectsPanelBody>['badgeFor']>
  gitFor: NonNullable<ComponentProps<typeof ProjectsPanelBody>['gitFor']>
  loadingProjects: Set<string>
  iconSvgs: ReadonlyMap<string, string>
  projectsTab: 'projects' | 'services'
  setProjectsTab: (tab: 'projects' | 'services') => void
  outputTab: OutputMainTab
  setOutputTab: (tab: OutputMainTab) => void
  outputSub: OutputSubTab
  setOutputSub: (sub: OutputSubTab) => void
  aliasSel: { config: AliasConfigDto; system: string } | null
  inspected: TreeNode | null
  inspectedKind: TreeNodeKind | null
  inspectedObject: TreeNode | null
  elementSel: { nodeId: string; path: string; label: string } | null
  focusLabel: string | null
  setNavSel: (sel: { nodeId: string; path: string; label: string } | null) => void
  resetNavElement: (path: string, label: string) => Promise<void> | void
  activateNavElement: (path: string, label: string) => Promise<void> | void
  refactoring: Refactoring['refactoring']
  setRefactoring: Refactoring['setRefactoring']
  doRefactoring: Refactoring['doRefactoring']
  setCtxMenu: TreeActions['setCtxMenu']
  runTreeAction: TreeActions['runTreeAction']
  handleActivateTab: (id: string) => void
  handleCloseTab: (id: string) => void
  handleCloseOthers: (id: string) => void
  handleCloseAll: () => void
  handleTreeSelect: (node: TreeNode, top: TreeNode) => void
  handleOpen: (node: TreeNode, top?: TreeNode) => Promise<void>
  openProjectAt: (path: string) => void
  closeProjects: (toClose: string[]) => void
  openSql: (sql: string) => void
  openProblem: (p: Problem) => void
  markUnsaved: (nodeId: string, dirty: boolean) => void
  refreshDiagnostics: (nodeId: string) => void
  applyOutcome: (nodeId: string, outcome: UndoRedoOutcome) => void
  registerFlush: (nodeId: string, flush: (() => Promise<void>) | null) => void
  setScanTick: (update: (t: number) => number) => void
  setReloadToken: (update: (t: number) => number) => void
  setStatus: (text: string) => void
}

// Baut den Editorbereich und die vier Panels (Projects, Properties, Navigator, Output) des Hauptfensters.
export function useShellPanels({
  api, root, projects, tree, objectsByType, tabState, setTabState, selected, selectedProject, value, setValue, sheetVersion, setSheetVersion, setCanUndo, setCanRedo, recent, recentList, unsaved, hasProject, totalErrors,
  problemList, problemCounts, scanning, logs, clearLog, db, changeDb, drafts, historyFlags, sqlTexts, sqlNonce, reveal, setReveal, projectIndex, editorWindows, bridge, systemBadge, gitFor, loadingProjects,
  iconSvgs, projectsTab, setProjectsTab, outputTab, setOutputTab, outputSub, setOutputSub, aliasSel, inspected, inspectedKind, inspectedObject, elementSel, focusLabel, setNavSel, resetNavElement,
  activateNavElement, refactoring, setRefactoring, doRefactoring, setCtxMenu, runTreeAction, handleActivateTab, handleCloseTab, handleCloseOthers, handleCloseAll, handleTreeSelect, handleOpen,
  openProjectAt, closeProjects, openSql, openProblem, markUnsaved, refreshDiagnostics, applyOutcome, registerFlush, setScanTick, setReloadToken, setStatus,
}: ShellPanelsDeps) {
  // The Services tab only exists while a system is connected; it is the place to see and close the connections.
  const tunnelStates = useTunnelState()
  const servicesVisible = Object.entries(tunnelStates.bySystem).some(([k, v]) => k !== '' && (v.connected || v.tunnel_up))
  useEffect(() => {
    if (!servicesVisible && projectsTab === 'services') setProjectsTab('projects')
  }, [servicesVisible, projectsTab, setProjectsTab])
  const configSection = useConfigSection()
  const Editor = getEditorFor(selected?.object_type ?? null)
  const currentTab = activeTab(tabState)
  const nodeProblems = useMemo(
    () => (currentTab ? problemList.filter((p) => p.nodeId && normId(p.nodeId) === normId(currentTab.node.id) && p.line && p.source !== 'js' && p.source !== 'build') : []),
    [problemList, currentTab],
  )

  const editor = !hasProject && tabState.tabs.length === 0 ? (
    <div className="forge-editor-empty">
      <p>No project open yet.</p>
      <p className="forge-field-hint">Use File &gt; Open Project… or the Open Project button in the toolbar to choose a project folder.</p>
      {recent ? (
        <button type="button" className="forge-link-btn" onClick={() => openProjectAt(recent)}>
          Recent: {recent}
        </button>
      ) : null}
    </div>
  ) : (
    <div className="forge-editor-pane">
      <EditorTabBar tabs={tabState.tabs} activeId={tabState.activeId} dirtyIds={unsaved} onActivate={handleActivateTab} onClose={handleCloseTab} onCloseOthers={handleCloseOthers} onCloseAll={handleCloseAll} onMoveToWindow={osWindowsAvailable() ? (id, at) => { const tab = tabState.tabs.find((t) => t.id === id); if (tab) void editorWindows.moveToWindow(tab, at) } : undefined} problemCounts={problemCounts} badgeFor={(t) => (t.node.object_type === 'system' ? systemBadge(t.node) : null)} gitFor={(t) => (t.node.diff ? null : gitFor(t.node))} />
      {currentTab ? (
        <ProjectIndexContext.Provider value={projectIndex}>
        <ObjectEditorArea
          key={currentTab.id + (currentTab.id.startsWith('sql:') ? `#${sqlNonce}` : '')}
          tab={currentTab}
          api={api}
          value={value}
          Editor={Editor}
          projectRoot={currentTab.project || selectedProject || root}
          version={sheetVersion}
          drafts={drafts.current}
          onSubTab={(sub: SubTab) => setTabState((prev) => setSubTab(prev, currentTab.id, sub))}
          onTreeChange={(next) => {
            setValue(next)
            setSheetVersion((v) => v + 1)
            setCanUndo(true)
            setCanRedo(false)
            historyFlags.current.set(currentTab.id, { undo: true, redo: false })
            markUnsaved(currentTab.id, true)
            refreshDiagnostics(currentTab.id)
          }}
          onApplied={applyOutcome}
          registerFlush={registerFlush}
          onFileDirty={markUnsaved}
          onOpenFileAt={(path, line) => {
            void handleOpen({ id: path, label: baseName(path), object_type: null, kind: 'file', is_leaf: true, children: [] })
            setReveal({ nodeId: path, line, token: Date.now() })
          }}
          db={db}
          sqlTexts={sqlTexts.current}
          onDbChange={changeDb}
          problems={nodeProblems}
          reveal={reveal && currentTab && normId(reveal.nodeId) === normId(currentTab.node.id) ? reveal : null}
        />
        </ProjectIndexContext.Provider>
      ) : (
        <div className="forge-editor-empty">
          <p className="forge-field-hint">Double-click an object or file in the tree to open it.</p>
        </div>
      )}
    </div>
  )

  const userSel = useUserSelection()
  const propertiesTitle = userSel ? `${userSel.title || userSel.user} - Properties` : aliasSel ? `${isConfigurationAlias(aliasSel.config.name) ? sectionLabel(configSection) : aliasSel.config.name} - Properties` : focusLabel ? `${focusLabel} - Properties` : 'Properties'
  const configRef = currentTab && isAliasConfigNode(currentTab.node) ? parseAliasConfigRef(currentTab.node.path) : null
  const configTabOpen = !!configRef && !currentTab?.node.id.startsWith('dbbrowser:') && isConfigurationAlias(configRef.alias)
  const navigatorTitle = configTabOpen ? 'Navigator' : inspectedObject && focusLabel ? `${focusLabel} - Navigator` : 'Navigator'
  const propertiesBody = (
    <PropertiesBody
      api={api}
      userSel={userSel}
      aliasSel={aliasSel}
      inspected={inspected}
      inspectedKind={inspectedKind}
      inspectedObject={inspectedObject}
      elementPath={elementSel?.path ?? null}
      root={root}
      projects={projects}
      tree={tree}
      objectsByType={objectsByType}
      sheetVersion={sheetVersion}
      handleOpen={handleOpen}
      applyOutcome={applyOutcome}
      setStatus={setStatus}
      onModificationChanged={() => setReloadToken((t) => t + 1)}
    />
  )

  const panels: Record<PanelId, PanelContent> = {
    projects: {
      title: projectsTab === 'projects' ? 'Projects' : 'Services',
      header: <ProjectsPanelHeader tab={projectsTab} floating={bridge.floating} onTab={setProjectsTab} servicesVisible={servicesVisible} />,
      body: (
        <ProjectsPanelBody
          api={api}
          tab={projectsTab}
          tree={tree}
          root={root}
          loading={loadingProjects.size > 0}
          problemCounts={problemCounts}
          badgeFor={systemBadge}
          gitFor={gitFor}
          iconSvg={(id) => iconSvgs.get(id)}
          db={db}
          onDbChange={changeDb}
          onSelect={handleTreeSelect}
          onOpen={handleOpen}
          onContextMenu={(node, top, x, y) => setCtxMenu({ node, top, x, y })}
          onFileKey={(key, node, top) => runTreeAction(key === 'cut' ? 'file.cut' : key === 'copy' ? 'file.copy' : key === 'paste' ? 'file.paste' : 'file.delete', node, top)}
          onCloseProject={() => closeProjects([root])}
          onOpenSql={openSql}
          setStatus={setStatus}
          recentProjects={recentList}
          openProjects={projects}
          onOpenProjects={() => void runCommandById('file.openProject')}
          onOpenRecent={openProjectAt}
        />
      ),
    },
    properties: {
      title: propertiesTitle,
      header: <span className="forge-panel-title">{propertiesTitle}</span>,
      body: propertiesBody,
    },
    navigator: {
      title: navigatorTitle,
      header: <span className="forge-panel-title">{navigatorTitle}</span>,
      body: configTabOpen ? (
        <ConfigNavigator />
      ) : (
        <NavigatorPanel
          api={api}
          nodeId={inspectedObject?.id ?? null}
          objectType={inspectedObject?.object_type ?? null}
          origin={inspectedObject ? originLabel(inspectedObject) : ''}
          selectedPath={elementSel?.path ?? null}
          version={sheetVersion}
          onReset={(path, label) => void resetNavElement(path, label)}
          onActivate={(path, label) => void activateNavElement(path, label)}
          onSelect={(path, label) => {
            if (!inspectedObject) return
            setNavSel(path === '$' ? null : { nodeId: inspectedObject.id, path, label })
          }}
        />
      ),
    },
    output: {
      title: 'Output',
      header: <OutputTabs active={outputTab} activeSub={outputSub} onSelect={setOutputTab} problemCount={totalErrors} />,
      body: (
        <OutputBody
          active={outputTab}
          sub={outputSub}
          onSelectSub={setOutputSub}
          logs={logs}
          problems={problemList}
          scanning={scanning}
          onOpenProblem={openProblem}
          onClear={clearLog}
          onRefreshScan={() => setScanTick((t) => t + 1)}
          refactoring={refactoring}
          onOpenUsage={(u) => openProblem({ id: u.node_id, channel: 'usage', source: 'reference', severity: 'Info', message: u.kind, nodeId: u.node_id, line: u.line ?? undefined, column: u.column ?? undefined })}
          onCloseRefactoring={() => setRefactoring(null)}
          onDoRefactoring={() => void doRefactoring()}
        />
      ),
    },
  }

  return { editor, panels }
}
