import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { runCommandById, useTreeContextItems } from '../core/plugins/registry'
import { ShellExtensions } from '../core/plugins/ShellExtensions'
import { activeTab, closeTabsWhere, isFileNode, openTab, setSubTab } from '../tabs/tabModel'
import { TitleBar } from '../chrome/TitleBar'
import { useTheme } from '../theme/useTheme'
import { ExperimentalEngineWarning } from '../settings/TranspilerEngineSelector'
import type { DiagnosticDto, TreeNode, WireValue } from '../wire/types'
import { DockLayout } from './DockLayout'
import { loadLayout, saveLayout, type LayoutState } from './layoutState'
import { MenuBar } from './MenuBar'
import { TOOL_WINDOWS, type ToolWindowId } from './menuModel'
import { type OutputMainTab, type OutputSubTab } from './OutputPanel'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'
import { AboutDialog } from './Dialogs'
import { OptionsDialog } from './OptionsDialog'
import { DeployDialog } from './DeployDialog'
import { SelectDatabaseConnectionDialog } from './SelectDatabaseConnectionDialog'
import { DeployOptionsDialog } from './DeployOptionsDialog'
import { OpenModelDialog } from './OpenModelDialog'
import { PluginsDialog } from './PluginsDialog'
import { LocalDataDialog } from './LocalDataDialog'
import { NewProjectDialog } from './NewProjectDialog'
import { TranspileMatchDialog } from './TranspileMatchDialog'
import { UpdatesDialog } from './UpdatesDialog'
import { decorationFor, indexOf, useScm, GIT_CODE_LABEL } from '../core/scm'
import { TabSwitcher } from './TabSwitcher'
import { QuickFileSearch, useDoubleCtrl } from './QuickFileSearch'
import { TableCenterDialog } from './TableCenterDialog'
import { loadToolbarPrefs, saveToolbarPrefs, type ToolbarGroup, type ToolbarPrefs } from './toolbarPrefs'
import { getEditorPrefs, subscribeEditorPrefs } from '../theme/editorPrefs'
import { getPluginPrefs, isPluginActive, subscribePluginPrefs } from '../settings/plugins'
import { buildTreeMenu } from '../tree/contextMenu'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { ConfirmDeleteDialog, PasteNameDialog, RenameDialog } from '../tree/TreeDialogs'
import { NewObjectDialog } from './NewObjectDialog'
import { ProjectZipDialog } from './ProjectZipDialog'
import type { AliasConfigDto } from '../wire/types'
import { DialogHost } from '../core/dialogService'
import { ToastHost, notify } from '../core/notifications'
import { collectIcons, entityOfView, findObject } from '../core/treeIndex'
import { useEditorWindows } from '../windows/useEditorWindows'
import { useCloseGuard } from '../windows/useCloseGuard'
import { osWindowsAvailable } from '../windows/windowService'
import { FLOAT_SIZES, type FloatView } from '../windows/protocol'
import { aliasConfigTabNode, type AliasConfigRef } from '../tabs/AliasConfigTab'
import { TranspileProgress, TranspileResult } from './TranspileProgress'
import { requestSystemReload, UNCONFIGURED_HINT, systemKey, systemNameOf, projectOfPath, systemPhase, TUNNEL_PHASE_LABEL } from '../services/tunnelState'
import { countsByNode, errorCount, fromDiagnostic, getProblems, normId, setProblems, subscribeProblems, type Problem } from '../problems/problemStore'
import { subscribeShellRequests } from '../core/outputBus'
import { errorText } from '../core/errorText'
import { baseName, findNodeByPath, nodeKind, samePath } from './shellHelpers'
import { listenBackend } from './hooks/backendEvent'
import { ConflictDialog } from './ConflictDialog'
import { useExternalChanges } from './hooks/useExternalChanges'
import { keymapEntries, useDialogWindows } from './hooks/useDialogWindows'
import { useOutputLogs } from './hooks/useOutputLogs'
import { useProblemScan } from './hooks/useProblemScan'
import { useDbStatus } from './hooks/useDbStatus'
import { useTranspile } from './hooks/useTranspile'
import { useDeploy } from './hooks/useDeploy'
import { useRefactoring } from './hooks/useRefactoring'
import { useLiquibase } from './hooks/useLiquibase'
import { useShellCommands } from './hooks/useShellCommands'
import { useTabs } from './hooks/useTabs'
import { useProjects } from './hooks/useProjects'
import { useSelection } from './hooks/useSelection'
import { useSave } from './hooks/useSave'
import { useShellPanels } from './ShellPanels'
import { useTreeActions } from './hooks/useTreeActions'
import { useNavElements } from './hooks/useNavElements'
import { useFloatingWindows } from './hooks/useFloatingWindows'
import type { ShellDialog } from './hooks/dialogTypes'

// Main window: menu bar, toolbar, docking layout and status bar around the tree, the editor tabs
// and the side panels (LAYOUT_SPEC §3, §6). The Projects tree holds several projects; a double
// click opens an object or file as an editor tab, a single click only selects.

function objectNameOf(nodeId: string): string {
  const parts = nodeId.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? nodeId)
}

/** A system and its background system (dev1 and dev1_bg) count as one tunnel in the status bar. */
export function groupOpenTunnels(names: string[]): string[] {
  const suffix = /_bg(?= \(|$)/i
  const bgOf = (n: string) => n.replace(suffix, '')
  const mains = names.filter((n) => !suffix.test(n))
  const bgs = names.filter((n) => suffix.test(n))
  const out = mains.map((m) => {
    const withBg = bgs.some((b) => bgOf(b) === m)
    return withBg ? m.replace(/^([^ ]+)/, '$1 + bg') : m
  })
  for (const b of bgs) if (!mains.includes(bgOf(b))) out.push(b)
  return out
}

export function Shell({ api, projectRoot }: { api: ForgeApi; projectRoot: string }) {
  const [value, setValue] = useState<WireValue | null>(null)
  const [, setDiagnostics] = useState<DiagnosticDto[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [status, setStatus] = useState('')
  // The last opened project is only offered, never opened automatically (see
  // p7-bugfix-empty-project-root-notes.md).
  const [recent, setRecent] = useState<string | null>(null)
  const [sheetVersion, setSheetVersion] = useState(0)

  const [layout, setLayout] = useState<LayoutState>(loadLayout)
  const [projectsTab, setProjectsTab] = useState<'projects' | 'services'>('projects')
  const [outputTab, setOutputTab] = useState<OutputMainTab>('output')
  const [outputSub, setOutputSub] = useState<OutputSubTab>('build')
  const { logs, appendLog, clearLog } = useOutputLogs()

  const [installDir, setInstallDir] = useState<string | null>(null)
  // Object whose file changed on disk (for example by Git) while it holds unsaved edits; set when a save is refused.
  const [conflict, setConflict] = useState<string | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [dialog, setDialog] = useState<ShellDialog>(null)
  // Services tab: connection state (polled, so a dying tunnel shows up) and the text of the open
  // SQL editors, which survives tab switches.
  const [aliasSel, setAliasSel] = useState<{ config: AliasConfigDto; system: string } | null>(null)
  const removeElementRef = useRef<(path: string, label: string) => void>(() => {})
  // Model file just created by File > New: opened as soon as the reloaded tree contains it.
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const sqlTexts = useRef(new Map<string, string>())
  const sqlCount = useRef(0)
  const [theme, toggleTheme] = useTheme()
  const problemList = useSyncExternalStore(subscribeProblems, getProblems)
  const problemCounts = useMemo(() => countsByNode(problemList), [problemList])
  const [toolbarPrefs, setToolbarPrefs] = useState<ToolbarPrefs>(loadToolbarPrefs)
  const editorPrefs = useSyncExternalStore(subscribeEditorPrefs, getEditorPrefs)
  const pluginPrefs = useSyncExternalStore(subscribePluginPrefs, getPluginPrefs)
  const gitActive = isPluginActive('git', pluginPrefs)
  const sqlActive = isPluginActive('sql', pluginPrefs)
  const layoutBeforeOnlyEditor = useRef<LayoutState | null>(null)
  const [scanTick, setScanTick] = useState(0)
  const [reveal, setReveal] = useState<{ nodeId: string; line: number; column?: number; token: number } | null>(null)

  useEffect(() => saveLayout(layout), [layout])
  const { projects, setActiveProject, reloadToken, setReloadToken, trees, loadingProjects, iconSvgs, root, tree, treeRef, objectsByType, openableModels, activeTree, systems, activeSystem, setRunConfig, projectOf, openProjectAt, removeProjects } = useProjects({ api, projectRoot, setStatus })
  const { treeSelection, setTreeSelection, selected, setSelected, selectedProject, setSelectedProject, navSel, setNavSel, inspected, inspectedObject, editNode, elementSel, focusLabel, inspectedKind } = useSelection(tree)
  const { db, changeDb, clearDb, tunnelState, nowTick } = useDbStatus(api, projects, trees, appendLog)
  const editorWindowsRef = useRef<ReturnType<typeof useEditorWindows> | null>(null)
  const scm = useScm()

  const gitIndex = useMemo(() => (scm.root === root ? indexOf(scm.overview) : null), [scm.overview, scm.root, root])
  const gitFor = useCallback(
    (node: TreeNode) => {
      const code = decorationFor(gitIndex, node.code ? '' : node.id, node.kind ?? (node.object_type ? 'object' : 'folder'))
      return code ? { code, title: `${GIT_CODE_LABEL[code]} (Git)` } : null
    },
    [gitIndex],
  )

  const scanning = useProblemScan(api, projects, trees, reloadToken, scanTick)

  useEffect(() => {
    api.getRecentProject().then(setRecent).catch(() => setRecent(null))
    api
      .getSettings()
      .then((s) => setInstallDir(s.designer_install_dir))
      .catch(() => setInstallDir(null))
  }, [api])

  // Every system carries its own tunnel state; it does not depend on the run configuration.
  const systemBadge = useCallback(
    (node: TreeNode) => {
      if (node.object_type !== 'system' || node.id.startsWith('missing:')) return null
      const project = projectOfPath(projects, node.id) ?? root
      const state = systemPhase(systemKey(project, node.label), tunnelState)
      const runSystem = node.label === activeSystem ? ' (run system)' : ''
      const prog = tunnelState.progressBy[systemKey(project, node.label)]
      const detail = prog && state === 'connecting' ? ` - ${prog.phase} (${Math.round((Date.now() - prog.startedAt) / 1000)} s)` : ''
      const err = state === 'error' ? ` - ${tunnelState.errorBy[systemKey(project, node.label)] ?? ''}` : ''
      if (tunnelState.unconfigured[systemKey(project, node.label)]) return { state: 'off' as const, title: `${node.label}: ${UNCONFIGURED_HINT}` }
      return { state, title: `Tunnel of ${node.label}${runSystem}: ${TUNNEL_PHASE_LABEL[state]}${detail}${err}` }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSystem, tunnelState, projects, root, nowTick],
  )

  const refreshDiagnostics = useCallback(
    (nodeId: string) => {
      api
        .listDiagnostics(nodeId)
        .then((list) => {
          setDiagnostics(list)
          setProblems(`live:${nodeId}`, list.map((d) => fromDiagnostic(d, nodeId, objectNameOf(nodeId), `live:${nodeId}`)))
        })
        .catch(() => setDiagnostics([]))
    },
    [api],
  )

  const saveIdsRef = useRef<(ids: string[]) => Promise<boolean>>(async () => false)
  const { tabState, setTabState, drafts, flushers, historyFlags, unsaved, markUnsaved, activateNode, activateNodeRef, handleOpen, handleActivateTab, closeTabNow, handleCloseTab, handleCloseOthers, handleCloseAll } = useTabs({
    api, root, treeRef, editorWindowsRef, saveIdsRef, projectOf, refreshDiagnostics, setSelected, setTreeSelection, setActiveProject, setSelectedProject, setValue, setDiagnostics, setCanUndo, setCanRedo, setAliasSel, setStatus,
  })

  const closeProjects = useCallback(
    (toClose: string[]) => {
      if (toClose.length === 0) return
      removeProjects(toClose)
      const closing = (tab: { project: string }) => toClose.some((c) => samePath(c, tab.project))
      for (const d of Object.values(editorWindowsRef.current?.detachedRef.current ?? {})) if (closing(d)) void editorWindowsRef.current?.closeFor(d.node.id)
      const remaining = closeTabsWhere(tabState, closing)
      if (remaining !== tabState) {
        for (const tab of tabState.tabs) {
          if (closing(tab)) {
            drafts.current.delete(tab.id)
            historyFlags.current.delete(tab.id)
          }
        }
        setTabState(remaining)
        const next = activeTab(remaining)
        if (next && next.id !== activeTab(tabState)?.id) void activateNodeRef.current?.(next.node, next.project)
      }
      if (!activeTab(remaining)) {
        setSelected(null)
        setValue(null)
        setDiagnostics([])
      }
      setTreeSelection(null)
      setActiveProject(null)
    },
    [api, removeProjects, tabState],
  )

  const handleTreeSelect = useCallback(
    (node: TreeNode, top: TreeNode) => {
      if (node.object_type === 'system') requestSystemReload()
      setAliasSel(null)
      setTreeSelection(node)
      setActiveProject(projectOf(top))
    },
    [projectOf],
  )

  // Opens the SQL editor with the given statement (Services tab). There is one SQL tab that is reused:
  // a click on a table replaces its statement instead of opening yet another tab.
  const [sqlNonce, setSqlNonce] = useState(0)
  const openSql = useCallback(
    (sql: string) => {
      if (sqlCount.current === 0) sqlCount.current = 1
      const node: TreeNode = { id: 'sql:1', label: 'SQL', object_type: null, is_leaf: true, children: [], kind: 'service' }
      if (sql !== '' || !sqlTexts.current.has(node.id)) {
        sqlTexts.current.set(node.id, sql)
        setSqlNonce((n) => n + 1)
      }
      void handleOpen(node)
    },
    [handleOpen],
  )


  const selectedId = selected?.id ?? null
  const { applyOutcome, saveIds, registerFlush } = useSave({
    api, root, gitActive, tabState, selectedId, drafts, flushers, historyFlags, editorWindowsRef, saveIdsRef, markUnsaved, refreshDiagnostics, setValue, setSheetVersion, setCanUndo, setCanRedo, setConflict, setScanTick, setStatus,
  })

  const { resetNavElement, activateNavElement, resetNavRef, activateNavRef } = useNavElements({ api, root, inspectedObject, applyOutcome, setNavSel, setReloadToken, setStatus, removeElementRef })

  const [quickSearch, setQuickSearch] = useState(false)
  useDoubleCtrl(() => setQuickSearch(true))
  const { bridge, floatingViews, effectiveLayout, commands: floatingCommands } = useFloatingWindows({
    api, root, tree, treeRef, selectedId, handleOpen, openSql, markUnsaved, refreshDiagnostics, resetNavRef, activateNavRef, editorWindowsRef,
    setNavSel, setAliasSel, setTreeSelection, setValue, setSheetVersion, setCanUndo, setStatus, setReloadToken,
    inspected, inspectedKind, inspectedObject, focusLabel, elementSel, sheetVersion, objectsByType, layout, projectsTab, setProjectsTab, logs,
  })
  // Window menu: opens the tool window if needed and moves keyboard focus into it, like the original.
  const showToolWindow = useCallback((id: ToolWindowId, focus = true) => {
    const panel = TOOL_WINDOWS.find((w) => w.id === id)!.panel
    if (panel) setLayout((prev) => ({ ...prev, panels: { ...prev.panels, [panel]: 'open' } }))
    if (id === 'projects' || id === 'services') setProjectsTab(id)
    if (id === 'output' || id === 'scanservices' || id === 'search' || id === 'notifications' || id === 'refactoring' || id === 'problems') setOutputTab(id)
    if (focus) {
      const selector = panel ? `[data-panel="${panel}"]` : '.forge-editor-area'
      setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), 0)
    }
  }, [])

  const { engine, setEngine, transpileRunning, matchView, setMatchView, buildResult, setBuildResult, buildProgress, compareWithReference, transpile, cancelBuild, commands: transpileCommands } = useTranspile({ api, root, trees, installDir, appendLog, showToolWindow, setOutputSub, setStatus })

  const { deployOptions, deployRun, setDeployRun, startDeploy, commands: deployCommands } = useDeploy({ api, root, tree, projects, projectOf, transpile, setStatus })

  const usageNode =
    treeSelection && nodeKind(treeSelection) === 'object' && !treeSelection.id.startsWith('missing:') && ['entity', 'neonView', 'entityWebservice'].includes(treeSelection.object_type ?? '') && !/[\/]node_modules[\/]/i.test(treeSelection.id)
      ? treeSelection
      : null

  const { refactoring, setRefactoring, startRefactoring, startRename, doRefactoring, commands: refactoringCommands } = useRefactoring({ api, root, tabState, unsaved, usageNode, showToolWindow, closeTabNow, handleCloseTab, setReloadToken, setStatus })

  const { connectionPick, setConnectionPick, runLiquibaseUpdate } = useLiquibase({ api, showToolWindow, appendLog, transpile, setOutputSub, setStatus })

  const { ctxMenu, setCtxMenu, clipboard, fileClipboard, deleteTarget, setDeleteTarget, pasteTarget, setPasteTarget, newTarget, setNewTarget, renameTarget, setRenameTarget, zipMode, setZipMode, runTreeAction, commands: treeCommands } = useTreeActions({
    api, root, projects, tabState, setTabState, closeTabNow, activateNode, handleOpen, projectOf, showToolWindow, setOutputSub, appendLog, closeProjects, transpile, gitActive, startRefactoring, startRename, startDeploy, runLiquibaseUpdate, usageNode, setPendingOpen, setStatus, setReloadToken,
  })
  const pluginTreeItems = useTreeContextItems(ctxMenu?.node.object_type ?? null)

  const iconsByObject = useMemo(() => collectIcons(tree), [tree])
  const projectIndex = useMemo(
    () => ({
      findObject: (type: string, name: string) => findObject(tree, type, name),
      iconOf: (type: string, name: string) => iconsByObject.get(`${type}:${name}`),
      namesOf: (type: string) => [...(objectsByType.get(type) ?? [])],
      selection: navSel ? { nodeId: navSel.nodeId, path: navSel.path } : null,
      removeElement: (_nodeId: string, path: string, label: string) => removeElementRef.current(path, label),
      openObject: (n: TreeNode) => void handleOpen(n),
      selectAliasConfig: (config: AliasConfigDto, system: string) => {
        setAliasSel({ config, system })
        showToolWindow('properties', false)
      },
      openAliasConfig: (ref: AliasConfigRef) => void handleOpen(aliasConfigTabNode(ref)),
      openSql: (sql: string, key?: string) => {
        if (key) void api.dbActivate(key).catch(() => false)
        openSql(sql)
      },
      entityOfView: (viewName: string) => entityOfView(tree, viewName),
      selectElement: (nodeId: string, path: string, label: string) => {
        setAliasSel(null)
        setNavSel({ nodeId, path, label })
        showToolWindow('properties', false)
      },
    }),
    [tree, objectsByType, handleOpen, showToolWindow, navSel],
  )

  useEffect(() => subscribeShellRequests((r) => r === 'services' && showToolWindow('services')), [showToolWindow])

  // Editors moved into windows of their own: their tab leaves this window while the window exists.
  const unsavedRef = useRef(unsaved)
  unsavedRef.current = unsaved
  const editorWindows = useEditorWindows({
    root,
    projectLabel: baseName,
    isDirty: (id) => unsavedRef.current.has(id),
    prepareMove: async (tab) => {
      await flushers.current.get(tab.id)?.()
      if (drafts.current.get(tab.id) === undefined) return true
      if (!isFileNode(tab.node)) {
        setStatus('The Source text of this object has errors and was not applied; fix it before moving the editor.')
        return false
      }
      return (await saveIdsRef.current?.([tab.id])) === true
    },
    removeTab: (id) => closeTabNow(id),
    restoreTab: (node, project, sub) => {
      setTabState((prev) => setSubTab(openTab(prev, node, project), node.id, sub))
      void activateNodeRef.current?.(node, project)
    },
    onError: (m) => notify(m, { kind: 'error', timeoutMs: 10000 }),
    onStatus: setStatus,
  })
  editorWindowsRef.current = editorWindows
  const unsavedInWindows = [...unsaved].filter((id) => editorWindows.detached[id]).length
  useCloseGuard({ unsavedCount: unsaved.size, inWindows: unsavedInWindows, saveAll: () => saveIdsRef.current([...unsavedRef.current]) })

  const { resolveConflict } = useExternalChanges({ api, tabState, unsaved, projects, detached: editorWindows.detached, conflict, setConflict, markUnsaved, activateNodeRef, editorWindowsRef, setReloadToken, setScanTick, setSheetVersion, setStatus })

  // The macOS menu bar (Preferences...) reaches the window as an event from the Rust side.
  useEffect(
    () =>
      listenBackend('forge://native-menu', (p) => {
        if (p === 'preferences') setDialog('options')
      }),
    [],
  )

  // Double click in the Problems tab: the object opens on its Source tab at the problem's line.
  const openProblem = useCallback(
    (p: Problem) => {
      const wanted = normId(p.nodeId ?? p.file ?? '')
      const node = wanted ? findNodeByPath(tree, wanted) : null
      if (!node) {
        setStatus(p.file ? `${p.file} is not part of the open projects.` : p.message)
        return
      }
      const top = tree.find((t) => findNodeByPath([t], wanted)) ?? undefined
      const project = top ? projectOf(top) : root
      const inSource = !!p.line && p.source !== 'js'
      setTabState((prev) => setSubTab(openTab(prev, node, project), node.id, inSource ? 'source' : 'editor'))
      void activateNode(node, project)
      if (inSource && p.line) setReveal({ nodeId: node.id, line: p.line, column: p.column, token: Date.now() })
    },
    [tree, projectOf, root, activateNode],
  )

  useEffect(() => {
    if (!pendingOpen) return
    const wanted = normId(pendingOpen)
    const node = findNodeByPath(tree, wanted)
    if (!node) return
    const top = tree.find((t) => findNodeByPath([t], wanted))
    const project = top ? projectOf(top) : root
    setPendingOpen(null)
    setTabState((prev) => openTab(prev, node, project))
    void activateNode(node, project)
  }, [pendingOpen, tree, projectOf, root, activateNode])

  const updateToolbar = useCallback((next: ToolbarPrefs) => {
    setToolbarPrefs(next)
    saveToolbarPrefs(next)
  }, [])
  const toggleToolbarGroup = useCallback(
    (group: ToolbarGroup) => updateToolbar({ ...toolbarPrefs, groups: { ...toolbarPrefs.groups, [group]: !toolbarPrefs.groups[group] } }),
    [toolbarPrefs, updateToolbar],
  )

  const { menus, runCommand, onMenuCommand } = useShellCommands({
    api, root, projects, activeTree, tabState, unsaved, editNode, selected, canUndo, canRedo, recent, dialog, layout, theme, toggleTheme, transpile, engine, transpileRunning, usageNode, startRefactoring,
    gitActive, sqlActive, floatingViews, editorWindows, toolbarPrefs, editorPrefs, layoutBeforeOnlyEditor,
    extraCommands: [transpileCommands, deployCommands, refactoringCommands, treeCommands, floatingCommands],
    openProjectAt, closeProjects, saveIds, applyOutcome, markUnsaved, showToolWindow, openSql, toggleToolbarGroup, updateToolbar,
    setStatus, setNewProjectOpen, setRecent, setReloadToken, setDialog, setLayout, setTreeSelection,
  })

  const hasProject = root.trim() !== ''
  const totalErrors = errorCount(problemList)

  useDialogWindows({ dialog, setDialog, hasProject, root, engine, setEngine, theme, toggleTheme, menus, setInstallDir, openableModels, tree, handleOpen, setStatus })

  const { editor, panels } = useShellPanels({
    api, root, projects, tree, objectsByType, tabState, setTabState, selected, selectedProject, value, setValue, sheetVersion, setSheetVersion, setCanUndo, setCanRedo, recent, unsaved, hasProject, totalErrors,
    problemList, problemCounts, scanning, logs, clearLog, db, changeDb, drafts, historyFlags, sqlTexts, sqlNonce, reveal, setReveal, projectIndex, editorWindows, bridge, systemBadge, gitFor, loadingProjects,
    iconSvgs, projectsTab, setProjectsTab, outputTab, setOutputTab, outputSub, setOutputSub, aliasSel, inspected, inspectedKind, inspectedObject, elementSel, focusLabel, setNavSel, resetNavElement,
    activateNavElement, refactoring, setRefactoring, doRefactoring, setCtxMenu, runTreeAction, handleActivateTab, handleCloseTab, handleCloseOthers, handleCloseAll, handleTreeSelect, handleOpen,
    openProjectAt, closeProjects, openSql, openProblem, markUnsaved, refreshDiagnostics, applyOutcome, registerFlush, setScanTick, setReloadToken, setStatus,
  })

  return (
    <div className="forge-shell">
      <TitleBar title={hasProject ? `Dito Designer - ${baseName(root)}` : 'Dito Designer'} />
      <MenuBar menus={menus} onCommand={onMenuCommand} />
      <Toolbar
        hasProject={hasProject}
        hasSelection={selected !== null}
        hasUnsaved={unsaved.size > 0}
        canUndo={canUndo}
        canRedo={canRedo}
        systems={systems}
        runConfig={activeSystem}
        onRunConfigChange={setRunConfig}
        engine={engine}
        onEngineChange={setEngine}
        transpileRunning={transpileRunning}
        onCommand={(c) => runCommand(c)}
        prefs={toolbarPrefs}
        onToggleGroup={toggleToolbarGroup}
        gitActive={gitActive}
        sqlActive={sqlActive}
      />
      <ExperimentalEngineWarning engine={engine} />
      <DockLayout
        layout={effectiveLayout}
        onLayoutChange={setLayout}
        panels={panels}
        editor={editor}
        onFloat={
          osWindowsAvailable()
            ? {
                canFloat: (id) => id === 'navigator' || id === 'properties' || id === 'output' || (id === 'projects' && projectsTab === 'services'),
                float: (id, at) => {
                  const view = (id === 'projects' ? projectsTab : id) as FloatView
                  const size = FLOAT_SIZES[view]
                  void bridge.floatView(view, at ? { x: at.x, y: at.y, w: size.width, h: size.height } : null)
                },
              }
            : undefined
        }
      />
      <StatusBar
        system={activeSystem || null}
        systems={systems}
        onPickSystem={setRunConfig}
        message={status}
        task={transpileRunning ? { label: `Transpiling (${engine})...` } : null}
        tunnel={db.tunnel_up || tunnelState.phase === 'on'}
        tunnelPhase={tunnelState.phase}
        tunnelDetail={Object.entries(tunnelState.progressBy).map(([k, v]) => `${systemNameOf(k)}: ${v.phase} (${Math.round((Date.now() - v.startedAt) / 1000)} s)`).join('; ')}
        openTunnels={groupOpenTunnels(Object.entries(tunnelState.bySystem).filter(([k, v]) => k !== '' && !k.includes('|alias:') && (v.connected || v.tunnel_up)).map(([k]) => (projects.length > 1 ? `${systemNameOf(k)} (${baseName(k.slice(0, k.lastIndexOf('|')))})` : systemNameOf(k))))}
        errors={totalErrors}
        onShowProblems={() => showToolWindow('problems')}
        onShowOutput={() => showToolWindow('output')}
        onShowNotifications={() => showToolWindow('notifications')}
        onShowServices={() => showToolWindow('services')}
        onCloseTunnels={() => {
          void api.tunnelDisconnectAll().catch(() => {})
          void api.dbDisconnect().catch(() => {})
          clearDb()
        }}
      />
      {dialog === 'options' && !osWindowsAvailable() ? (
        <OptionsDialog
          api={api}
          onClose={() => setDialog(null)}
          onSaved={setInstallDir}
          engine={engine}
          onEngineChange={setEngine}
          theme={theme}
          onThemeChange={(t) => t !== theme && toggleTheme(t)}
          keymap={keymapEntries(menus)}
        />
      ) : null}
      {ctxMenu ? (
        <TreeContextMenu
          entries={[
            ...buildTreeMenu(ctxMenu.node, { clipboard, hasProject, fileClipboard }),
            ...(pluginTreeItems.length > 0
              ? [{ id: 'sep-plugins', label: '', enabled: false, separator: true }, ...pluginTreeItems.map((i) => ({ id: `plugin:${i.command}`, label: i.label, enabled: hasProject }))]
              : []),
          ]}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onPick={(id) => (id.startsWith('plugin:') ? void runCommandById(id.slice('plugin:'.length), ctxMenu.node) : runTreeAction(id, ctxMenu.node, ctxMenu.top))}
          onClose={() => setCtxMenu(null)}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDeleteDialog
          name={deleteTarget.node.label}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const { node } = deleteTarget
            setDeleteTarget(null)
            try {
              await api.deleteObject(node.id)
              void editorWindowsRef.current?.closeFor(node.id)
              if (tabState.tabs.some((t) => t.id === node.id)) handleCloseTab(node.id)
              setReloadToken((t) => t + 1)
              setStatus(`Deleted ${node.label}.`)
            } catch (e) {
              setStatus(errorText(e))
            }
          }}
        />
      ) : null}
      {newTarget && !osWindowsAvailable() ? (
        <NewObjectDialog
          api={api}
          projectRoot={newTarget.project}
          projects={projects}
          initialFolder={newTarget.folder}
          onClose={() => setNewTarget(null)}
          onCreated={(aod, folder, name) => {
            setNewTarget(null)
            setReloadToken((t) => t + 1)
            setPendingOpen(aod)
            setStatus(`Created ${folder}/${name}.`)
          }}
        />
      ) : null}
      {renameTarget && !osWindowsAvailable() ? (
        <RenameDialog
          folder={renameTarget.node.object_type ?? ''}
          initial={renameTarget.node.label}
          onClose={() => setRenameTarget(null)}
          onConfirm={(name) => {
            const { node, project } = renameTarget
            setRenameTarget(null)
            void startRename(node, project, name)
          }}
        />
      ) : null}
      {zipMode && !osWindowsAvailable() ? (
        <ProjectZipDialog
          api={api}
          projectRoot={root}
          mode={zipMode}
          onClose={() => setZipMode(null)}
          onDone={(message) => {
            setZipMode(null)
            setStatus(message)
            setReloadToken((t) => t + 1)
          }}
        />
      ) : null}
      {pasteTarget && clipboard ? (
        <PasteNameDialog
          folder={clipboard.folder}
          initial={`${clipboard.name}_copy`}
          onClose={() => setPasteTarget(null)}
          onConfirm={async (name) => {
            const { destRoot } = pasteTarget
            setPasteTarget(null)
            try {
              await api.copyObject(clipboard.path, destRoot, name)
              setReloadToken((t) => t + 1)
              setStatus(`Created ${name}.`)
            } catch (e) {
              setStatus(errorText(e))
            }
          }}
        />
      ) : null}
      <TabSwitcher tabs={tabState.tabs} activeId={tabState.activeId} dirtyIds={unsaved} onActivate={handleActivateTab} />
      {quickSearch && hasProject ? (
        <QuickFileSearch
          api={api}
          projectRoots={projects.length > 0 ? projects : [root]}
          onClose={() => setQuickSearch(false)}
          onOpen={(path) => {
            // An object file opens as the object, any other file as a plain file.
            const m = /\/([^/]+)\/([^/]+)\/\2\.aod$/i.exec(path)
            const object = m ? findObject(tree, m[1], m[2]) : null
            void handleOpen(object ?? { id: path, label: baseName(path), object_type: null, kind: 'file', is_leaf: true, children: [] })
          }}
        />
      ) : null}
      {connectionPick ? (
        <SelectDatabaseConnectionDialog
          connections={connectionPick.connections}
          preferredAlias={connectionPick.preferredAlias}
          title={connectionPick.title}
          onTranspile={connectionPick.onTranspile}
          onOk={(c) => {
            connectionPick.resolve(c)
            setConnectionPick(null)
          }}
          onCancel={() => {
            connectionPick.resolve(null)
            setConnectionPick(null)
          }}
        />
      ) : null}
      {!transpileRunning && buildResult ? <TranspileResult result={buildResult} onClose={() => setBuildResult(null)} onShowMatch={() => void compareWithReference(buildResult.project, false).catch(() => {})} onShowOutput={() => { showToolWindow('output', false); setOutputSub('build') }} onDeploy={() => { setBuildResult(null); void startDeploy(false) }} /> : null}
      {transpileRunning ? <TranspileProgress label={`Transpiling (${engine})...`} progress={engine === 'official' ? null : buildProgress} onCancel={engine === 'official' ? () => void cancelBuild() : undefined} /> : null}
      {deployOptions ? (
        <DeployOptionsDialog api={api} payload={deployOptions.payload} onOk={(r) => deployOptions.resolve(r)} onCancel={() => deployOptions.resolve(null)} />
      ) : null}
      {deployRun && !osWindowsAvailable() ? (
        <DeployDialog
          api={api}
          projectRoot={deployRun.project}
          systemName={deployRun.system}
          initialForce={deployRun.force}
          initialCheckScan={deployRun.checkScan}
          warning={deployRun.warning}
          onClose={() => setDeployRun(null)}
          onDeployed={(m) => {
            notify(m, { kind: 'success', timeoutMs: 10000 })
            setStatus(m)
          }}
        />
      ) : null}
      {dialog === 'deploy' && hasProject && !osWindowsAvailable() ? (
        <DeployDialog api={api} projectRoot={root} onClose={() => setDialog(null)} onDeployed={setStatus} />
      ) : null}
      {conflict ? (
        <ConflictDialog label={tabState.tabs.find((t) => t.id === conflict)?.node.label ?? 'This object'} onResolve={(choice) => void resolveConflict(choice)} onClose={() => setConflict(null)} />
      ) : null}
      <DialogHost />
      <ToastHost />
      {dialog === 'about' && !osWindowsAvailable() ? <AboutDialog api={api} onClose={() => setDialog(null)} /> : null}
      {dialog === 'openModel' && hasProject && !osWindowsAvailable() ? (
        <OpenModelDialog
          models={openableModels}
          onClose={() => setDialog(null)}
          onPick={(m) => {
            setDialog(null)
            const node = findObject(tree, m.type, m.name)
            if (node) void handleOpen(node)
          }}
        />
      ) : null}
      {dialog === 'plugins' && !osWindowsAvailable() ? <PluginsDialog onClose={() => setDialog(null)} /> : null}
      {matchView ? (
        <TranspileMatchDialog
          report={matchView.report}
          reference={matchView.reference}
          onClose={() => setMatchView(null)}
          onChangeReference={() => {
            const project = matchView.project
            setMatchView(null)
            void compareWithReference(project, true).catch((e) => notify(errorText(e), { kind: 'error', timeoutMs: 10000 }))
          }}
        />
      ) : null}
      {newProjectOpen ? (
        <NewProjectDialog
          api={api}
          currentProject={root}
          onClose={() => setNewProjectOpen(false)}
          onCreated={(dir) => {
            setNewProjectOpen(false)
            openProjectAt(dir)
            api.setRecentProject(dir).catch(() => {})
            setRecent(dir)
          }}
        />
      ) : null}
      {dialog === 'localData' && !osWindowsAvailable() ? <LocalDataDialog api={api} onClose={() => setDialog(null)} /> : null}
      <ShellExtensions
        ctx={{ api, root, hasProject, reloadToken, setReloadToken, dialog, setDialog, handleOpen, isPluginActive: (id) => isPluginActive(id, pluginPrefs) }}
      />
      {dialog === 'updates' && !osWindowsAvailable() ? <UpdatesDialog api={api} onClose={() => setDialog(null)} onOpenTableCenter={() => setDialog('tableCenter')} /> : null}
      {dialog === 'tableCenter' ? <TableCenterDialog api={api} db={db} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}
