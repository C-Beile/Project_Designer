import { pathKey } from '../platform/pathKey'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { ProjectTree } from '../tree/ProjectTree'
import { ProjectIcon } from '../tree/treeIcons'
import { getEditorFor } from '../editors/registry'
import { EditorTabBar } from '../tabs/EditorTabBar'
import { ObjectEditorArea } from '../tabs/ObjectEditorArea'
import { ProjectIndexContext } from '../editors/projectIndex'
import { tunnelTabNode, isAliasConfigNode, EMPTY_TABS, activateTab, activeTab, closeTab, closeTabsWhere, isFileNode, isServiceNode, isTunnelNode, openTab, setSubTab, type SubTab, type TabState } from '../tabs/tabModel'
import { TitleBar } from '../chrome/TitleBar'
import { closeWindow } from '../chrome/tauriWindow'
import { useTheme, type ThemeName } from '../theme/useTheme'
import { ExperimentalEngineWarning } from '../settings/TranspilerEngineSelector'
import {
  DEFAULT_ENGINE,
  ENGINE_LABELS,
  transpileParams,
  type TranspileMode,
  type TranspilerEngineId,
} from '../settings/transpilerEngine'
import type { DbStatus, DiagnosticDto, DiffTarget, GitOutput, TreeNode, UndoRedoOutcome, WireValue } from '../wire/types'
import { boolField, textField } from '../wire/types'
import { ServicesPanel } from '../services/ServicesPanel'
import { DockLayout, type PanelContent } from './DockLayout'
import { defaultLayout, loadLayout, saveLayout, type LayoutState, type PanelId } from './layoutState'
import { MenuBar } from './MenuBar'
import { TOOL_WINDOWS, buildMenus, shortcutItems, type MenuDef, type MenuItemDef, type ToolWindowId } from './menuModel'
import type { KeymapEntry } from './OptionsDialog'
import { OutputBody, OutputTabs, type OutputLine, type OutputMainTab, type OutputSubTab } from './OutputPanel'
import { matchesShortcut } from './shortcuts'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'
import { AboutDialog, Modal } from './Dialogs'
import { OptionsDialog } from './OptionsDialog'
import { DeployDialog } from './DeployDialog'
import { SelectDatabaseConnectionDialog, type LiquibaseChoice } from './SelectDatabaseConnectionDialog'
import type { LiquibaseConnection } from '../api/ForgeApi'
import { DeployOptionsDialog, systemWarning, type DeployOptionsPayload, type DeployOptionsResult, type DeploySystem } from './DeployOptionsDialog'
import { copyNewUuid } from './uuid'
import type { RefactoringState } from './RefactoringPanel'
import { OpenModelDialog } from './OpenModelDialog'
import { PluginsDialog } from './PluginsDialog'
import { LocalDataDialog } from './LocalDataDialog'
import { UpdatesDialog } from './UpdatesDialog'
import { GitDialog } from './GitDialog'
import { SyncDialog } from './SyncDialog'
import { TabSwitcher } from './TabSwitcher'
import { QuickFileSearch, useDoubleCtrl } from './QuickFileSearch'
import { TableCenterDialog } from './TableCenterDialog'
import { defaultToolbarPrefs, loadToolbarPrefs, saveToolbarPrefs, type ToolbarGroup, type ToolbarPrefs } from './toolbarPrefs'
import { getEditorPrefs, reloadEditorPrefs, setEditorPref, subscribeEditorPrefs, type EditorPrefs } from '../theme/editorPrefs'
import { runEditorAction } from '../theme/monacoActions'
import { getPluginPrefs, isPluginActive, reloadPluginPrefs, subscribePluginPrefs } from '../settings/plugins'
import { getOptions, reloadOptions } from '../settings/options'
import { reloadCustomThemes } from '../theme/customThemes'
import { UserPropertiesPanel } from '../services/UserPropertiesPanel'
import { useUserSelection } from '../services/userSelection'
import { resolvePathVariables } from '../properties/pathVariables'
import { formatBeforeSave } from '../theme/formatOnSave'
import { buildTreeMenu, objectLayout, type TreeMenuContext } from '../tree/contextMenu'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { ConfirmDeleteDialog, PasteNameDialog, RenameDialog } from '../tree/TreeDialogs'
import { NewObjectDialog } from './NewObjectDialog'
import { ProjectZipDialog } from './ProjectZipDialog'
import { diskFolderOf } from '../tree/contextMenu'
import { ProjectPropertiesPanel, PropertySheetPanel } from '../properties/PropertySheetPanel'
import type { AliasConfigDto } from '../wire/types'
import { AliasConfigPanel } from '../properties/AliasConfigPanel'
import { FilePropertiesPanel } from '../properties/FilePropertiesPanel'
import { codeTabNode, processCodeTarget, saveCodeProperty } from '../properties/codeSave'
import { objectRoot } from '../properties/objectRoot'
import { choiceDialog, confirmDialog, DialogHost, promptDialog } from './dialogService'
import { ToastHost, notify } from './notifications'
import { collectByType, entityOfView, findObject } from './treeIndex'
import { useFloatBridge } from '../windows/useFloatBridge'
import { useEditorWindows } from '../windows/useEditorWindows'
import { useOsDialog } from '../windows/useOsDialog'
import { useCloseGuard } from '../windows/useCloseGuard'
import { canMoveToWindow } from '../windows/editorWindows'
import { getWindowBackend, openDialogWindow, osWindowsAvailable } from '../windows/windowService'
import type { OptionsWindowResult } from '../windows/DialogWindowApp'
import { EVENTS, FLOAT_SIZES, type FloatAction, type FloatView, type Geometry, type MainState } from '../windows/protocol'
import { diffTitle } from '../scm/diffTitle'
import { decorationFor, indexOf, refreshScm, useScm, GIT_CODE_LABEL } from '../scm/scmStore'
import { aliasConfigTabNode, parseAliasConfigRef, type AliasConfigRef } from '../tabs/AliasConfigTab'
import { ConfigNavigator } from '../navigator/ConfigNavigator'
import { isConfigurationAlias, sectionLabel, useConfigSection } from '../properties/configSections'
import { useSystemTunnels } from '../services/useSystemTunnels'
import { TranspileProgress, type BuildProgress } from './TranspileProgress'
import { getTunnelState, requestSystemReload, setConnectedSystem, setSystemsDb, setProgress, UNCONFIGURED_HINT, systemKey, systemNameOf, projectOfPath, systemPhase, TUNNEL_PHASE_LABEL, useTunnelState } from '../services/tunnelState'
import { NavigatorPanel } from '../navigator/NavigatorPanel'
import {
  clearChannelsWhere,
  countsByNode,
  errorCount,
  fromDiagnostic,
  fromProblemDto,
  getProblems,
  normId,
  problemsFromBuildLog,
  setProblems,
  subscribeProblems,
  type Problem,
} from '../problems/problemStore'
import { subscribeOutput, subscribeShellRequests } from './outputBus'

// Main window: menu bar, toolbar, docking layout and status bar around the tree, the editor tabs
// and the side panels (LAYOUT_SPEC §3, §6). The Projects tree holds several projects; a double
// click opens an object or file as an editor tab, a single click only selects.

const NO_DB: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }
const DB_POLL_MS = 5000

const EMPTY_LOGS: Record<OutputSubTab, OutputLine[]> = { database: [], build: [], default: [], nodejs: [] }

function findNodeByPath(nodes: TreeNode[], wanted: string): TreeNode | null {
  for (const n of nodes) {
    if (normId(n.id) === wanted) return n
    const hit = findNodeByPath(n.children, wanted)
    if (hit) return hit
  }
  return null
}

function keymapEntries(menus: MenuDef[]): KeymapEntry[] {
  const out: KeymapEntry[] = []
  const walk = (group: string, items: MenuItemDef[]) => {
    for (const i of items) {
      if (i.children) walk(group, i.children)
      if (i.kind === 'item' && i.shortcut) out.push({ group, label: i.label.replace(/…$/, ''), shortcut: i.shortcut })
    }
  }
  for (const m of menus) walk(m.label, m.items)
  return out
}

function objectNameOf(nodeId: string): string {
  const parts = nodeId.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? nodeId)
}

function collectSystems(nodes: TreeNode[], out: { name: string; isDefault: boolean }[] = []) {
  for (const n of nodes) {
    if (n.is_leaf && n.object_type === 'system' && !n.id.startsWith('missing:')) out.push({ name: n.label, isDefault: !!n.bold })
    collectSystems(n.children, out)
  }
  return out
}

// Object whose Properties a code tab or a tunnel config tab shows: the owner of the property, or the
// system the tunnel config belongs to (original Designer, reference shot 81).
function ownerNodeOf(tree: TreeNode[], node: TreeNode): TreeNode | null {
  if (node.code) return findNodeByPath(tree, normId(node.code.ownerNodeId))
  if (node.kind === 'tunnel' && node.id.startsWith('tunnel:')) return findNodeByPath(tree, normId(node.id.slice('tunnel:'.length)))
  return null
}

function nodeKind(n: TreeNode) {
  return n.kind ?? (n.object_type ? 'object' : 'folder')
}

// Origin label as in the Projects tree; of the override chain only the last package is shown,
// like the original (`@aditosoftware/contact:8.0.0 (@3hills-IT/easescreen:1.6.5-RC1)`).
function originLabel(n: TreeNode): string {
  if (!n.origin) return ''
  const last = n.overrides?.length ? n.overrides[n.overrides.length - 1] : null
  return last ? `${n.origin} (${last})` : n.origin
}

function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

function timestamp(): string {
  return new Date().toISOString()
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
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
  // Several projects at once (LAYOUT_SPEC §4.2). `projectRoot` is only an initial project (dev
  // "project" URL parameter / tests); the persisted list is restored on start.
  const [projects, setProjects] = useState<string[]>(() => (projectRoot.trim() ? [projectRoot] : []))
  const [activeProject, setActiveProject] = useState<string | null>(projectRoot.trim() ? projectRoot : null)
  const [reloadToken, setReloadToken] = useState(0)
  const [trees, setTrees] = useState<Record<string, TreeNode[]>>({})
  const loadedWith = useRef<Record<string, number>>({})
  // Single click selects (Properties title, later Navigator); `selected` is the object opened in
  // the editor area by double-click/Enter.
  const [treeSelection, setTreeSelection] = useState<TreeNode | null>(null)
  const [selected, setSelected] = useState<TreeNode | null>(null)
  const [selectedProject, setSelectedProject] = useState('')
  // Open editor tabs of this window; kept in memory only.
  const [tabState, setTabState] = useState<TabState>(EMPTY_TABS)
  // Text the user typed in a Source tab (not yet accepted by the backend) or in a plain-file
  // editor (not yet written), per file; Save applies or writes it.
  const drafts = useRef(new Map<string, string>())
  const flushers = useRef(new Map<string, () => Promise<void>>())
  // Undo/redo availability per object, so it follows the active tab.
  const historyFlags = useRef(new Map<string, { undo: boolean; redo: boolean }>())
  const [value, setValue] = useState<WireValue | null>(null)
  const [, setDiagnostics] = useState<DiagnosticDto[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [unsaved, setUnsaved] = useState<Set<string>>(() => new Set())
  const [status, setStatus] = useState('')
  // The last opened project is only offered, never opened automatically (see
  // p7-bugfix-empty-project-root-notes.md).
  const [recent, setRecent] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [runConfig, setRunConfig] = useState('')
  // Element chosen in the Navigator; its properties replace the object's in the Properties panel.
  const [navSel, setNavSel] = useState<{ nodeId: string; path: string; label: string } | null>(null)
  const [sheetVersion, setSheetVersion] = useState(0)

  const [layout, setLayout] = useState<LayoutState>(loadLayout)
  const [projectsTab, setProjectsTab] = useState<'projects' | 'services'>('projects')
  const [outputTab, setOutputTab] = useState<OutputMainTab>('output')
  const [outputSub, setOutputSub] = useState<OutputSubTab>('build')
  const [logs, setLogs] = useState(EMPTY_LOGS)

  const [engine, setEngine] = useState<TranspilerEngineId>(DEFAULT_ENGINE)
  const [transpileRunning, setTranspileRunning] = useState(false)
  const [installDir, setInstallDir] = useState<string | null>(null)
  // Object whose file changed on disk (for example by Git) while it holds unsaved edits; set when a save is refused.
  const [conflict, setConflict] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'options' | 'about' | 'deploy' | 'openModel' | 'plugins' | 'updates' | 'localData' | 'tableCenter' | 'git' | 'sync' | null>(null)
  const [gitView, setGitView] = useState<{ tab: 'changes' | 'history' | 'branches'; target: { local?: string; remote?: string } | null }>({ tab: 'changes', target: null })
  // Services tab: connection state (polled, so a dying tunnel shows up) and the text of the open
  // SQL editors, which survives tab switches.
  const [db, setDb] = useState<DbStatus>(NO_DB)
  // Tree context menu: the open popup, the object copied with Copy and the two confirmations.
  const [ctxMenu, setCtxMenu] = useState<{ node: TreeNode; top: TreeNode; x: number; y: number } | null>(null)
  const [clipboard, setClipboard] = useState<TreeMenuContext['clipboard']>(null)
  const configSection = useConfigSection()
  const [aliasSel, setAliasSel] = useState<{ config: AliasConfigDto; system: string } | null>(null)
  const removeElementRef = useRef<(path: string, label: string) => void>(() => {})
  const [fileClipboard, setFileClipboard] = useState<{ path: string; cut: boolean } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ node: TreeNode; top: TreeNode } | null>(null)
  const [pasteTarget, setPasteTarget] = useState<{ destRoot: string } | null>(null)
  const [newTarget, setNewTarget] = useState<{ project: string; folder: string | null } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ node: TreeNode; project: string } | null>(null)
  const [zipMode, setZipMode] = useState<'export' | 'import' | null>(null)
  // Model file just created by File > New: opened as soon as the reloaded tree contains it.
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const sqlTexts = useRef(new Map<string, string>())
  const sqlCount = useRef(0)
  const [theme, toggleTheme] = useTheme()
  const problemList = useSyncExternalStore(subscribeProblems, getProblems)
  const problemCounts = useMemo(() => countsByNode(problemList), [problemList])
  const [scanning, setScanning] = useState(false)
  const [refactoring, setRefactoring] = useState<RefactoringState | null>(null)
  const [toolbarPrefs, setToolbarPrefs] = useState<ToolbarPrefs>(loadToolbarPrefs)
  const editorPrefs = useSyncExternalStore(subscribeEditorPrefs, getEditorPrefs)
  const pluginPrefs = useSyncExternalStore(subscribePluginPrefs, getPluginPrefs)
  const gitActive = isPluginActive('git', pluginPrefs)
  const sqlActive = isPluginActive('sql', pluginPrefs)
  const layoutBeforeOnlyEditor = useRef<LayoutState | null>(null)
  const [scanTick, setScanTick] = useState(0)
  const [reveal, setReveal] = useState<{ nodeId: string; line: number; column?: number; token: number } | null>(null)

  useEffect(() => saveLayout(layout), [layout])
  const tunnelState = useTunnelState()
  useSystemTunnels(api, projects, trees)
  const [nowTick, setNowTick] = useState(0)
  const connectingCount = Object.keys(tunnelState.progressBy).length
  useEffect(() => {
    if (connectingCount === 0) return
    const t = setInterval(() => setNowTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [connectingCount])
  const changeDb = useCallback(
    (next: DbStatus) => {
      setDb(next)
      void api.dbSystems().then(setSystemsDb).catch(() => {})
    },
    [api],
  )
  const [floatingViews, setFloatingViews] = useState<string[]>([])
  const floatApiRef = useRef<{ floating: FloatView[]; floatView: (v: FloatView, g?: Geometry | null) => Promise<void>; dockView: (v: FloatView) => Promise<void>; dockAll: () => Promise<void> } | null>(null)
  const editorWindowsRef = useRef<ReturnType<typeof useEditorWindows> | null>(null)
  const newWindowOpen = useRef(false)
  const openWindowOpen = useRef(false)
  const optionsWindowOpen = useRef(false)
  const scm = useScm()

  useEffect(() => {
    let cancelled = false
    const poll = () =>
      api
        .dbSystems()
        .then((list) => {
          if (cancelled) return
          setSystemsDb(list)
          const s = list.find((e) => e.active)?.status ?? NO_DB
          setDb((prev) => (prev.connected === s.connected && prev.tunnel_up === s.tunnel_up && prev.database === s.database ? prev : s))
        })
        .catch(() => {})
    void poll()
    const timer = setInterval(poll, DB_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [api])

  const root = activeProject && projects.some((p) => samePath(p, activeProject)) ? activeProject : (projects[0] ?? '')
  const gitIndex = useMemo(() => (scm.root === root ? indexOf(scm.overview) : null), [scm.overview, scm.root, root])
  const gitFor = useCallback(
    (node: TreeNode) => {
      const code = decorationFor(gitIndex, node.code ? '' : node.id, node.kind ?? (node.object_type ? 'object' : 'folder'))
      return code ? { code, title: `${GIT_CODE_LABEL[code]} (Git)` } : null
    },
    [gitIndex],
  )

  useEffect(() => {
    api
      .restoreOpenProjects()
      .then((restored) => {
        if (restored.length === 0) return
        setProjects((prev) => [...prev, ...restored.filter((r) => !prev.some((p) => samePath(p, r)))])
        setActiveProject((prev) => prev ?? restored[0])
      })
      .catch(() => {})
  }, [api])

  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    for (const p of projects) {
      // Blank entries never reach the scanner (R41); each project is scanned once per refresh.
      if (!p.trim() || loadedWith.current[p] === reloadToken) continue
      loadedWith.current[p] = reloadToken
      setLoadingProjects((prev) => new Set(prev).add(p))
      api
        .openProject(p)
        .then((t) => setTrees((prev) => ({ ...prev, [p]: t })))
        .catch((e) => setStatus(String(e)))
        .finally(() =>
          setLoadingProjects((prev) => {
            const next = new Set(prev)
            next.delete(p)
            return next
          }),
        )
    }
  }, [api, projects, reloadToken])

  const tree = useMemo(() => projects.flatMap((p) => trees[p] ?? []), [projects, trees])
  const treeRef = useRef(tree)
  treeRef.current = tree
  const objectsByType = useMemo(() => collectByType(tree), [tree])
  const openableModels = useMemo(
    () =>
      [...objectsByType.entries()]
        .flatMap(([type, names]) => [...names].map((name) => ({ type, name })))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [objectsByType],
  )
  const activeTree = useMemo(() => trees[root] ?? [], [trees, root])

  // Project-wide problem scan (read-only): after a project opens or refreshes and after saves.
  useEffect(() => {
    const open = projects.filter((p) => p.trim() && trees[p])
    if (open.length === 0) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setScanning(true)
      Promise.all(
        open.map((p) =>
          api
            .scanProblems(p)
            .then((list) => {
              if (!cancelled) setProblems(`scan:${p}`, list.map((d) => fromProblemDto(d, `scan:${p}`)))
            })
            .catch(() => {}),
        ),
      ).finally(() => {
        if (!cancelled) setScanning(false)
      })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Only the set of loaded projects and explicit triggers start a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projects.join('|'), Object.keys(trees).join('|'), reloadToken, scanTick])

  // Git status of the active project: after opening, after reloads, after saves and when the window gets focus.
  useEffect(() => {
    if (gitActive && root.trim()) void refreshScm(api, root)
  }, [api, root, reloadToken, gitActive])
  useEffect(() => {
    if (!gitActive) return
    let timer: number | undefined
    const onFocus = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => root.trim() && void refreshScm(api, root), 300)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [api, root, gitActive])

  useEffect(() => {
    setBranch(null)
    if (!root.trim()) return
    let cancelled = false
    api
      .getCurrentBranch(root)
      .then((b) => {
        if (!cancelled) setBranch(b)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [api, root, reloadToken])

  useEffect(() => {
    api.getRecentProject().then(setRecent).catch(() => setRecent(null))
    api
      .getSettings()
      .then((s) => setInstallDir(s.designer_install_dir))
      .catch(() => setInstallDir(null))
  }, [api])

  const systemEntries = useMemo(() => collectSystems(activeTree), [activeTree])
  const systems = useMemo(() => systemEntries.map((s) => s.name), [systemEntries])
  const defaultSystem = systemEntries.find((s) => s.isDefault)?.name
  const activeSystem = systems.includes(runConfig) ? runConfig : (defaultSystem ?? systems[0] ?? '')
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

  const markUnsaved = useCallback((nodeId: string, dirty: boolean) => {
    setUnsaved((prev) => {
      if (prev.has(nodeId) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
  }, [])

  const openProjectAt = useCallback(
    (path: string) => {
      if (!path.trim()) return
      setProjects((prev) => (prev.some((p) => samePath(p, path)) ? prev : [...prev, path]))
      setActiveProject(path)
      setStatus('')
      api.addOpenProject(path).catch(() => {})
    },
    [api],
  )

  const closeProjects = useCallback(
    (toClose: string[]) => {
      if (toClose.length === 0) return
      setProjects((prev) => prev.filter((p) => !toClose.some((c) => samePath(c, p))))
      setTrees((prev) => {
        const next = { ...prev }
        for (const c of toClose) delete next[c]
        return next
      })
      clearChannelsWhere((ch) => toClose.some((c) => ch === `scan:${c}`))
      for (const c of toClose) {
        delete loadedWith.current[c]
        api.removeOpenProject(c).catch(() => {})
      }
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
    [api, tabState],
  )

  const projectOf = useCallback(
    (top: TreeNode) => projects.find((p) => trees[p]?.includes(top)) ?? root,
    [projects, trees, root],
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

  // Makes a node the object shown in the editor area, Properties and Navigator.
  const activateNode = useCallback(
    async (node: TreeNode, project: string) => {
      setSelected(node)
      // A code tab of a property shows the Properties of the object it belongs to.
      setTreeSelection(ownerNodeOf(treeRef.current, node) ?? node)
      setActiveProject(project)
      setSelectedProject(project)
      const flags = historyFlags.current.get(node.id)
      setCanUndo(flags?.undo ?? false)
      setCanRedo(flags?.redo ?? false)
      if (isFileNode(node) || isServiceNode(node)) {
        setValue(null)
        setDiagnostics([])
        return
      }
      try {
        const v = await api.getPropertyTree(node.id)
        setValue(v)
        refreshDiagnostics(node.id)
      } catch (e) {
        setStatus(String(e))
      }
    },
    [api, refreshDiagnostics],
  )
  const activateNodeRef = useRef(activateNode)
  activateNodeRef.current = activateNode

  // Double click, Enter or Go to: opens (or focuses) the editor tab of the node.
  const handleOpen = useCallback(
    async (node: TreeNode, top?: TreeNode) => {
      const project = top ? projectOf(top) : root
      // A document lives in one window only: when it was moved out, that window comes forward.
      if (editorWindowsRef.current?.detachedRef.current[node.id]) {
        void editorWindowsRef.current.focus(node.id)
        return
      }
      if (node.object_type === 'process' && nodeKind(node) === 'object' && !node.id.startsWith('missing:')) {
        try {
          const code = await processCodeTarget(api, node)
          if (code) {
            const codeNode = codeTabNode(code, false)
            if (editorWindowsRef.current?.detachedRef.current[codeNode.id]) {
              void editorWindowsRef.current.focus(codeNode.id)
              return
            }
            setTabState((prev) => openTab(prev, codeNode, project))
            await activateNode(codeNode, project)
            return
          }
        } catch {
          // Falls back to the object tab below.
        }
      }
      setTabState((prev) => openTab(prev, node, project))
      await activateNode(node, project)
    },
    [api, activateNode, projectOf, root],
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


  // Tab switch: the selection (Properties, Navigator) follows the tab's object.
  const handleActivateTab = useCallback(
    (id: string) => {
      const tab = tabState.tabs.find((t) => t.id === id)
      if (!tab) return
      setAliasSel(null)
      setTabState((prev) => activateTab(prev, id))
      void activateNode(tab.node, tab.project)
    },
    [tabState, activateNode],
  )

  const closeTabNow = useCallback(
    (id: string) => {
      const wasActive = tabState.activeId === id
      const next = closeTab(tabState, id)
      setTabState(next)
      if (!wasActive) return
      const tab = activeTab(next)
      if (tab) {
        void activateNode(tab.node, tab.project)
      } else {
        setSelected(null)
        setValue(null)
        setDiagnostics([])
      }
    },
    [tabState, activateNode],
  )

  // A file or code tab with unsaved text asks first: save, discard or stay.
  const handleCloseTab = useCallback(
    (id: string) => {
      const tab = tabState.tabs.find((t) => t.id === id)
      if (tab && isFileNode(tab.node) && unsaved.has(id)) {
        void choiceDialog(
          `${tab.node.label} has unsaved changes.`,
          [
            { id: 'save', label: 'Save' },
            { id: 'discard', label: "Don't Save" },
            { id: 'cancel', label: 'Cancel' },
          ],
          'Close',
        ).then(async (choice) => {
          if (choice === 'save') {
            if (await saveIdsRef.current?.([id])) closeTabNow(id)
          } else if (choice === 'discard') {
            drafts.current.delete(id)
            markUnsaved(id, false)
            closeTabNow(id)
          }
        })
        return
      }
      closeTabNow(id)
    },
    [tabState, unsaved, closeTabNow, markUnsaved],
  )

  // Tab context menu: closes tabs without saving, like the single close button.
  const closeMany = useCallback(
    (shouldClose: (tabId: string) => boolean, keepActive: string | null) => {
      const remaining = closeTabsWhere(tabState, (t) => shouldClose(t.id))
      for (const t of tabState.tabs) {
        if (shouldClose(t.id)) {
          drafts.current.delete(t.id)
          historyFlags.current.delete(t.id)
        }
      }
      const next = keepActive ? activateTab(remaining, keepActive) : remaining
      setTabState(next)
      const tab = activeTab(next)
      if (tab) void activateNodeRef.current?.(tab.node, tab.project)
      else {
        setSelected(null)
        setValue(null)
        setDiagnostics([])
      }
    },
    [tabState],
  )
  const handleCloseOthers = useCallback((id: string) => closeMany((t) => t !== id, id), [closeMany])
  const handleCloseAll = useCallback(() => closeMany(() => true, null), [closeMany])

  const selectedId = selected?.id ?? null
  const applyOutcome = useCallback(
    (nodeId: string, outcome: UndoRedoOutcome) => {
      if (nodeId === selectedId) setValue(outcome.tree)
      setSheetVersion((v) => v + 1)
      setCanUndo(outcome.can_undo)
      setCanRedo(outcome.can_redo)
      historyFlags.current.set(nodeId, { undo: outcome.can_undo, redo: outcome.can_redo })
      markUnsaved(nodeId, true)
      refreshDiagnostics(nodeId)
    },
    [markUnsaved, refreshDiagnostics, selectedId],
  )

  // The object shown in Properties and Navigator follows the single click in the tree, else the
  // object open in the editor area; it is also the target of Save/Undo/Redo.
  const treeInspectable = treeSelection !== null && ['object', 'project', 'module'].includes(nodeKind(treeSelection))
  const ownerOfSelected = selected ? ownerNodeOf(tree, selected) : null
  const inspected = treeInspectable ? treeSelection : (ownerOfSelected ?? (selected && nodeKind(selected) === 'object' ? selected : (treeSelection ?? selected)))
  const inspectedObject =
    inspected && nodeKind(inspected) === 'object' && !inspected.id.startsWith('missing:') ? inspected : null
  const editNode = inspectedObject ?? selected
  const inspectedId = inspected?.id ?? null
  useEffect(() => setNavSel(null), [inspectedId])

  const appendLog = useCallback((sub: OutputSubTab, lines: OutputLine[]) => {
    const max = getOptions().misc.outputMaxLines
    setLogs((prev) => {
      const next = [...prev[sub], ...lines]
      return { ...prev, [sub]: next.length > max ? next.slice(next.length - max) : next }
    })
  }, [])

  useEffect(() => subscribeOutput((sub, lines) => appendLog(sub, lines)), [appendLog])

  // Team > Git: the Commit dialog and the history and branch views open as dialogs, Pull and Push run
  // directly from the menu click, as in the original Designer.
  const [syncMode, setSyncMode] = useState<'pull' | 'push'>('pull')
  const [quickSearch, setQuickSearch] = useState(false)
  useDoubleCtrl(() => setQuickSearch(true))
  const openGit = useCallback((tab: 'changes' | 'history' | 'branches', target: { local?: string; remote?: string } | null = null) => {
    setGitView({ tab, target })
    setDialog('git')
  }, [])
  const runGit = useCallback(
    async (label: string, action: () => Promise<GitOutput>) => {
      try {
        const result = await action()
        if (result.ok) {
          notify(`${label} finished.`, { kind: 'success' })
          setReloadToken((t) => t + 1)
        } else notify(result.text.split('\n')[0] || `${label} failed.`, { kind: 'error', timeoutMs: 10000 })
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), { kind: 'error', timeoutMs: 10000 })
      }
      if (root.trim()) void refreshScm(api, root)
    },
    [api, root],
  )

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

  const projectIndex = useMemo(
    () => ({
      findObject: (type: string, name: string) => findObject(tree, type, name),
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

  // Applies pending Source text and writes plain-file drafts before the object is saved.
  // Source text the backend rejected blocks the save: saving would silently drop what the user
  // typed. Returns whether the object itself still has to be saved through the backend.
  const prepareSave = useCallback(
    async (id: string): Promise<'object' | 'done' | 'blocked'> => {
      await flushers.current.get(id)?.()
      if (getOptions().editor.formatOnSave) await formatBeforeSave(id)
      const tab = tabState.tabs.find((t) => t.id === id)
      const draft = drafts.current.get(id)
      if (tab && isFileNode(tab.node)) {
        if (draft !== undefined) {
          const code = tab.node.code
          if (code) {
            try {
              const result = await saveCodeProperty(api, code, draft, tab.project || root)
              code.isNew = false
              if (result.outcome) applyOutcome(code.ownerNodeId, result.outcome)
              else setSheetVersion((v) => v + 1)
              if (result.message) setStatus(result.message)
            } catch (e) {
              setStatus(e instanceof Error ? e.message : String(e))
              return 'blocked'
            }
          } else {
            await api.writeLinkedFile(tab.project, id, draft)
          }
          drafts.current.delete(id)
        }
        return 'done'
      }
      if (draft !== undefined) {
        setStatus('The Source text of this object has errors and was not applied; fix it before saving.')
        return 'blocked'
      }
      return 'object'
    },
    [api, tabState, root, applyOutcome],
  )

  const saveIds = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        const windows = editorWindowsRef.current
        if (windows?.detachedRef.current[id]) {
          if (!(await windows.saveDetached(id))) return false
          markUnsaved(id, false)
          continue
        }
        const step = await prepareSave(id)
        if (step === 'blocked') return false
        if (step === 'object') {
          try {
            await api.save(id)
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            if (!message.startsWith('CONFLICT:')) throw e
            setConflict(id)
            setStatus(message)
            return false
          }
        }
        markUnsaved(id, false)
      }
      if (getOptions().general.refreshScanOnChange) setScanTick((t) => t + 1)
      if (gitActive && root.trim()) void refreshScm(api, root)
      return true
    },
    [api, prepareSave, markUnsaved, gitActive, root],
  )

  const saveIdsRef = useRef(saveIds)
  saveIdsRef.current = saveIds

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

  // Changes made outside the app (Git, another editor): the project tree is refreshed, open objects
  // are re-read from disk when they hold no unsaved edits; with unsaved edits the next save asks.
  const watchRef = useRef({ tabs: tabState.tabs, unsaved, projects, active: null as string | null, detached: editorWindows.detached })
  watchRef.current = { tabs: tabState.tabs, unsaved, projects, active: activeTab(tabState)?.id ?? null, detached: editorWindows.detached }
  const notifiedConflicts = useRef(new Set<string>())
  useEffect(() => {
    let running = false
    const tick = async () => {
      if (running || !document.hasFocus()) return
      running = true
      try {
        const w = watchRef.current
        for (const p of w.projects) {
          if (p.trim() && (await api.projectChanged(p))) {
            setReloadToken((t) => t + 1)
            setScanTick((t) => t + 1)
          }
        }
        const inWindows = Object.values(w.detached).map((d) => ({ id: d.node.id, node: d.node, project: d.project, sub: d.sub }))
        const objectTabs = [...w.tabs, ...inWindows].filter((t) => !isFileNode(t.node) && !isServiceNode(t.node) && !isTunnelNode(t.node))
        if (objectTabs.length === 0) return
        const changed = await api.externalChanges(objectTabs.map((t) => t.id))
        for (const id of changed) {
          const tab = objectTabs.find((t) => t.id === id)
          if (!tab) continue
          if (w.unsaved.has(id)) {
            if (!notifiedConflicts.current.has(id)) {
              notifiedConflicts.current.add(id)
              setStatus(`${tab.node.label} was changed on disk and has unsaved edits here. Saving will ask how to proceed.`)
            }
            continue
          }
          notifiedConflicts.current.delete(id)
          await api.reloadObject(id)
          if (w.detached[id]) editorWindowsRef.current?.refresh(id)
          if (w.active === id) {
            await activateNodeRef.current?.(tab.node, tab.project)
            setSheetVersion((v) => v + 1)
          }
          setStatus(`${tab.node.label} was changed on disk and has been reloaded.`)
        }
      } catch {
        // A failed poll is retried on the next tick; it must never disturb editing.
      } finally {
        running = false
      }
    }
    const timer = window.setInterval(() => void tick(), 3000)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [api])

  const resolveConflict = useCallback(
    async (choice: 'overwrite' | 'reload') => {
      const id = conflict
      setConflict(null)
      if (!id) return
      const tab = tabState.tabs.find((t) => t.id === id)
      try {
        if (choice === 'overwrite') {
          await api.saveOverwrite(id)
          markUnsaved(id, false)
          setStatus('Saved. The version that was on disk is kept in the backup folder (Help > Open Backup Folder).')
        } else {
          await api.reloadObject(id)
          markUnsaved(id, false)
          if (tab) await activateNodeRef.current?.(tab.node, tab.project)
          setSheetVersion((v) => v + 1)
          setStatus('Reloaded from disk, your unsaved edits of this object were discarded.')
        }
        notifiedConflicts.current.delete(id)
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e))
      }
    },
    [api, conflict, tabState, markUnsaved],
  )

  const [connectionPick, setConnectionPick] = useState<{ connections: LiquibaseConnection[]; preferredAlias: string; title: string; resolve: (c: LiquibaseChoice | null) => void; onTranspile: () => Promise<boolean> } | null>(null)
  const busy = useRef(false)
  const transpile = useCallback(
    async (mode: TranspileMode, project: string = root): Promise<boolean> => {
      if (!project.trim() || busy.current) return false
      // A module is not built on its own: it only needs a transpile when its package.json changed.
      if (trees[project]?.some((n) => n.module_project) && !(await confirmDialog('This is a module project. A module is normally not built; transpile it only when its package.json changed. Transpile anyway?', { title: 'Transpile module project', okLabel: 'Transpile', cancelLabel: 'Cancel' }))) return false
      busy.current = true
      setBuildProgress(null)
      setProblems('build', [])
      setTranspileRunning(true)
      showToolWindow('output', false)
      setOutputSub('build')
      const started = Date.now()
      appendLog('build', [
        { level: 'info', text: `[${timestamp()}] Transpile (${mode}) started - ${ENGINE_LABELS[engine]} - ${project}` },
      ])
      try {
        await api.executeAction('transpile', project, transpileParams(engine, mode, installDir))
        const secs = ((Date.now() - started) / 1000).toFixed(1)
        appendLog('build', [{ level: 'success', text: `[${timestamp()}] BUILD SUCCESS (${secs} s)` }])
        setStatus('Transpile finished.')
        return true
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        appendLog('build', [{ level: 'error', text: `[${timestamp()}] BUILD FAILED: ${message}` }])
        const found = problemsFromBuildLog(message)
        setProblems(
          'build',
          found.length > 0
            ? found
            : [{ id: 'build|failed', channel: 'build', source: 'build', severity: 'Error', message: message.split(/\r?\n/)[0].slice(0, 400) }],
        )
        setStatus('Transpile failed, see Output > Build.')
        return false
      } finally {
        busy.current = false
        setTranspileRunning(false)
      }
    },
    [api, root, engine, installDir, appendLog, showToolWindow, trees],
  )

  // Deploy and Build and Deploy: first dialog (project, system, options) as a window of its own, then
  // the optional build, then the plan with its explicit confirmation. Nothing is written silently.
  const [deployOptions, setDeployOptions] = useState<{ payload: DeployOptionsPayload; resolve: (r: DeployOptionsResult | null) => void } | null>(null)
  const [deployRun, setDeployRun] = useState<{ project: string; system: string; force: boolean; checkScan: boolean; warning: string | null } | null>(null)
  const startDeploy = useCallback(
    async (buildFirst: boolean) => {
      if (!root.trim()) return
      const systemsOfProject = async (project: string) => {
        const top = tree.find((t) => projectOf(t) === project) ?? tree[0]
        const nodes = (top?.children.find((c) => c.folder === 'system')?.children ?? []).filter((n) => n.object_type === 'system' && !n.id.startsWith('missing:'))
        const list: DeploySystem[] = await Promise.all(
          nodes.map(async (n) => {
            const t = await api.getPropertyTree(n.id).catch(() => null)
            const text = (k: string) => (t ? (textField(t, k) ?? '') : '')
            return {
              name: n.label,
              tunnelRef: text('tunnelConfigPath'),
              serverRef: text('serverConfigPath'),
              productive: t ? boolField(t, 'productiveSystem') === true : false,
              cloud: text('cloudSystemId') !== '' || /cloud/i.test(text('serverConfigPath')),
            }
          }),
        )
        return { systems: list, defaultSystem: nodes.find((n) => n.bold)?.label ?? list[0]?.name ?? '' }
      }
      const openProjects = projects.length > 0 ? projects : [root]
      const systemsByProject: Record<string, { systems: DeploySystem[]; defaultSystem: string }> = {}
      for (const p of openProjects) systemsByProject[p] = await systemsOfProject(p)
      const systems = systemsByProject[root]?.systems ?? (await systemsOfProject(root)).systems
      const payload: DeployOptionsPayload = {
        projects: projects.length > 0 ? projects : [root],
        project: root,
        systems,
        defaultSystem: systemsByProject[root]?.defaultSystem ?? systems[0]?.name ?? '',
        systemsByProject,
        connectedSystem: getTunnelState().connectedSystem,
        openSystems: Object.entries(getTunnelState().bySystem).filter(([, v]) => v.connected || v.tunnel_up).map(([k]) => k).filter(Boolean),
        buildFirst,
        checkScan: getOptions().general.checkScanOnDeploy,
      }
      const result = osWindowsAvailable()
        ? await openDialogWindow<DeployOptionsResult>('deploy', buildFirst ? 'Build and Deploy' : 'Deploy', { width: 460, height: 420 }, payload, { modal: true }).catch(() => null)
        : await new Promise<DeployOptionsResult | null>((resolve) => setDeployOptions({ payload, resolve }))
      setDeployOptions(null)
      if (!result) return
      if (result.connectedSystem) await api.dbActivate(result.connectedSystem).catch(() => false)
      setSystemsDb(await api.dbSystems().catch(() => []))
      setConnectedSystem(result.connectedSystem)
      if (result.build) {
        const ok = await transpile('partial', result.project)
        if (!ok) {
          notify('Build and Deploy stopped: the build failed. See Output > Build and Problems.', { kind: 'error', timeoutMs: 10000 })
          return
        }
      }
      setDeployRun({ project: result.project, system: result.system, force: result.force, checkScan: result.checkScan, warning: systemWarning((systemsByProject[result.project]?.systems ?? systems).find((x) => x.name === result.system)) })
    },
    [api, root, tree, projects, projectOf, transpile],
  )

  // Context menu actions; destructive or creating ones only open their confirmation.
  // Find Usages and Safely Delete: the usages are read from the files first; deleting happens only
  // through "Do Refactoring" in the Refactoring tab.
  const startRefactoring = useCallback(
    async (mode: 'usages' | 'delete', node: TreeNode, project: string) => {
      const type = node.object_type ?? ''
      setRefactoring({ mode, object: node.label, objectType: type, nodeId: node.id, usages: null })
      showToolWindow('refactoring', false)
      try {
        const usages = await api.findUsages(project, type, node.label)
        setRefactoring((cur) => (cur && cur.nodeId === node.id ? { ...cur, usages } : cur))
      } catch (e) {
        setRefactoring((cur) => (cur && cur.nodeId === node.id ? { ...cur, usages: [], error: String(e instanceof Error ? e.message : e) } : cur))
      }
    },
    [api, showToolWindow],
  )

  // Rename: the plan (references to change, mentions left alone) is read first; the files change
  // only through "Do Refactoring".
  const startRename = useCallback(
    async (node: TreeNode, project: string, newName: string) => {
      const type = node.object_type ?? ''
      setRefactoring({ mode: 'rename', object: node.label, objectType: type, nodeId: node.id, usages: null, newName, project })
      showToolWindow('refactoring', false)
      try {
        const plan = await api.renamePlan(project, node.id, newName)
        setRefactoring((cur) => (cur && cur.nodeId === node.id ? { ...cur, usages: plan.changes, hits: plan.hits } : cur))
      } catch (e) {
        setRefactoring((cur) => (cur && cur.nodeId === node.id ? { ...cur, usages: [], error: String(e instanceof Error ? e.message : e) } : cur))
      }
    },
    [api, showToolWindow],
  )

  const doRefactoring = useCallback(async () => {
    if (refactoring?.mode === 'rename' && refactoring.newName && refactoring.project) {
      const touched = [refactoring.nodeId, ...(refactoring.usages ?? []).map((u) => u.node_id)]
      const dirty = touched.find((id) => unsaved.has(id))
      if (dirty) {
        setRefactoring({ ...refactoring, error: 'Save or close the open changes of the affected models first.' })
        return
      }
      try {
        await api.renameObject(refactoring.project, refactoring.nodeId, refactoring.newName)
        for (const id of new Set(touched)) if (tabState.tabs.some((t) => t.id === id)) closeTabNow(id)
        setReloadToken((t) => t + 1)
        setStatus(`Renamed ${refactoring.object} to ${refactoring.newName}. Transpile to renew dist.`)
        setRefactoring(null)
      } catch (e) {
        setRefactoring({ ...refactoring, error: String(e instanceof Error ? e.message : e) })
      }
      return
    }
    if (!refactoring || refactoring.mode !== 'delete') return
    try {
      await api.deleteObject(refactoring.nodeId)
      if (tabState.tabs.some((t) => t.id === refactoring.nodeId)) handleCloseTab(refactoring.nodeId)
      setReloadToken((t) => t + 1)
      setStatus(`Deleted ${refactoring.object}.`)
      setRefactoring(null)
    } catch (e) {
      setRefactoring({ ...refactoring, error: String(e instanceof Error ? e.message : e) })
    }
  }, [api, refactoring, tabState, handleCloseTab, closeTabNow, unsaved])

  // Files of the Projects tree: paste (copy or cut), delete, rename; every change reloads the tree.
  const folderOf = (node: TreeNode): string | null => {
    if (node.id.startsWith('dir:')) return node.id.slice('dir:'.length)
    if (nodeKind(node) === 'file') return node.id.replace(/[\\/][^\\/]+$/, '')
    return null
  }
  const pasteFile = async (node: TreeNode, project: string) => {
    const dest = folderOf(node)
    if (!fileClipboard || !dest) return
    try {
      const target = await api.filePaste(project, fileClipboard.path, dest, fileClipboard.cut)
      if (fileClipboard.cut) {
        setFileClipboard(null)
        if (tabState.tabs.some((t) => t.id === fileClipboard.path)) closeTabNow(fileClipboard.path)
      }
      setReloadToken((t) => t + 1)
      notify(`${fileClipboard.cut ? 'Moved' : 'Copied'} to ${target}.`, { kind: 'success' })
    } catch (e) {
      notify(String(e instanceof Error ? e.message : e), { kind: 'error', timeoutMs: 10000 })
    }
  }
  const deleteFile = async (node: TreeNode, project: string) => {
    if (nodeKind(node) !== 'file') return
    if (!(await confirmDialog(`Delete ${node.label}? A copy is kept in the backup folder.`, { title: 'Delete', okLabel: 'Delete' }))) return
    try {
      await api.fileDelete(project, node.id)
      if (tabState.tabs.some((t) => t.id === node.id)) closeTabNow(node.id)
      setReloadToken((t) => t + 1)
      notify(`Deleted ${node.label}.`, { kind: 'success' })
    } catch (e) {
      notify(String(e instanceof Error ? e.message : e), { kind: 'error', timeoutMs: 10000 })
    }
  }
  const renameFile = async (node: TreeNode, project: string) => {
    if (nodeKind(node) !== 'file') return
    const name = await promptDialog('New file name', { title: 'Rename', initial: node.label, okLabel: 'Rename' })
    if (!name || name === node.label) return
    try {
      await api.fileRename(project, node.id, name)
      if (tabState.tabs.some((t) => t.id === node.id)) closeTabNow(node.id)
      setReloadToken((t) => t + 1)
      notify(`Renamed ${node.label} to ${name}.`, { kind: 'success' })
    } catch (e) {
      notify(String(e instanceof Error ? e.message : e), { kind: 'error', timeoutMs: 10000 })
    }
  }

  // NodeJS menu of package.json: npm runs in the project folder, its output appears live in Output >
  // NodeJS. Login and publish change the account or the registry and run only after an explicit confirmation.
  const npmBusy = useRef(false)
  useEffect(() => {
    let stop: (() => void) | null = null
    let gone = false
    void getWindowBackend()
      .listen('forge://npm-output', (p) => {
        const e = p as { line: string; error: boolean }
        appendLog('nodejs', [{ level: e.error ? 'warn' : 'info', text: e.line }])
      })
      .then((u) => (gone ? u() : (stop = u)))
      .catch(() => {})
    return () => {
      gone = true
      stop?.()
    }
  }, [appendLog])
  // Live lines of the official transpiler (DEBUG, INFO ...) go to Output > Build while it runs.
  useEffect(() => {
    let stop: (() => void) | null = null
    let gone = false
    void getWindowBackend()
      .listen('forge://build-output', (p) => {
        const e = p as { line: string; error: boolean }
        appendLog('build', [{ level: e.error ? 'warn' : 'info', text: e.line }])
      })
      .then((u) => (gone ? u() : (stop = u)))
      .catch(() => {})
    return () => {
      gone = true
      stop?.()
    }
  }, [appendLog])
  // How far the built-in transpiler is: a bar with the percentage in the corner panel.
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null)
  useEffect(() => {
    let stop: (() => void) | null = null
    let gone = false
    void getWindowBackend()
      .listen('forge://transpile-progress', (p) => {
        const e = p as { percent: number; stage: string }
        setBuildProgress({ percent: Math.max(0, Math.min(100, Math.round(e.percent))), stage: e.stage })
      })
      .then((u) => (gone ? u() : (stop = u)))
      .catch(() => {})
    return () => {
      gone = true
      stop?.()
    }
  }, [])
  // Phases of a connect (Starting ssh/plink, Forwarding the port, Waiting for the database) as they
  // happen: the tree dot, status bar and editors show them, Output > Default gets one line each.
  useEffect(() => {
    let stop: (() => void) | null = null
    let gone = false
    void getWindowBackend()
      .listen('forge://tunnel-progress', (p) => {
        const e = p as { system: string; phase: string; finished: boolean }
        const label = systemNameOf(e.system) || 'database'
        const started = getTunnelState().progressBy[e.system]?.startedAt
        setProgress(e.system, e.phase, e.finished)
        if (e.finished && e.phase === 'Connected') {
          const secs = started ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0
          appendLog('default', [{ level: 'success', text: `[${timestamp()}] ${label}: Connected in ${secs} s` }])
        } else if (e.finished) {
          appendLog('default', [{ level: 'error', text: `[${timestamp()}] ${label}: ${e.phase}` }])
          notify(`${label}: ${e.phase.replace(/^Failed: /, '')}`, { kind: 'error', timeoutMs: 10000 })
        } else {
          appendLog('default', [{ level: 'info', text: `[${timestamp()}] ${label}: ${e.phase}...` }])
        }
      })
      .then((u) => (gone ? u() : (stop = u)))
      .catch(() => {})
    return () => {
      gone = true
      stop?.()
    }
  }, [appendLog])
  // The macOS menu bar (Preferences...) reaches the window as an event from the Rust side.
  useEffect(() => {
    let stop: (() => void) | null = null
    let gone = false
    void getWindowBackend()
      .listen('forge://native-menu', (p) => {
        if (p === 'preferences') setDialog('options')
      })
      .then((u) => (gone ? u() : (stop = u)))
      .catch(() => {})
    return () => {
      gone = true
      stop?.()
    }
  }, [])
  const cancelBuild = useCallback(async () => {
    if (!(await confirmDialog('Stop the running build? The transpiler process is ended; dist may be incomplete afterwards.', { title: 'Cancel build', okLabel: 'Stop build', cancelLabel: 'Keep running' }))) return
    await api.cancelBuild().catch(() => false)
  }, [api])
  const runNpm = async (project: string, action: string) => {
    if (npmBusy.current) {
      notify('An npm command is still running.', { kind: 'error' })
      return
    }
    if (action === 'login' || action === 'publish') {
      const text =
        action === 'login'
          ? 'npm login signs in to your npm registry account and stores a token on this computer. Run it now?'
          : 'npm publish uploads this project as a package to the registry named in package.json. This cannot be undone. Run it now?'
      if (!(await confirmDialog(text, { title: `npm ${action}`, okLabel: `Run npm ${action}` }))) return
    }
    npmBusy.current = true
    showToolWindow('output', false)
    setOutputSub('nodejs')
    appendLog('nodejs', [{ level: 'info', text: `[${timestamp()}] npm ${action} in ${project}` }])
    try {
      const code = await api.npmRun(project, action, true)
      appendLog('nodejs', [{ level: code === 0 ? 'success' : 'error', text: `[${timestamp()}] npm ${action} finished with exit code ${code}` }])
      if (code === 0) notify(`npm ${action} finished.`, { kind: 'success' })
      else notify(`npm ${action} failed (exit code ${code}). See Output > NodeJS.`, { kind: 'error', timeoutMs: 10000 })
      setReloadToken((t) => t + 1)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      appendLog('nodejs', [{ level: 'error', text: `[${timestamp()}] npm ${action}: ${message}` }])
      notify(message, { kind: 'error', timeoutMs: 10000 })
    } finally {
      npmBusy.current = false
    }
  }

  // Liquibase > Update of a database alias: asks which database it would change, then runs the
  // changelogs of .liquibase/<alias>; the lines of Liquibase appear in Output > Build.
  const runLiquibaseUpdate = useCallback(
    async (node: TreeNode, project: string) => {
      const alias = objectLayout(node.id)?.name
      if (!alias) return
      const prefix = systemKey(project, '')
      const connected = Object.entries(getTunnelState().bySystem)
        .filter(([key, value]) => value.connected && key.startsWith(prefix) && !key.includes('|alias:'))
        .map(([key]) => key)
      if (connected.length === 0) {
        notify('Connect a system first (Services): Liquibase updates the database of a connected system.', { kind: 'error', timeoutMs: 10000 })
        return
      }
      let system = connected[0]
      if (connected.length > 1) {
        const pick = await choiceDialog('Which system should be updated?', [...connected.map((key) => ({ id: key, label: systemNameOf(key) })), { id: '', label: 'Cancel' }], 'Liquibase Update')
        if (!pick) return
        system = pick
      }
      const log = (level: 'info' | 'error', text: string) => appendLog('build', [{ level, text: `[${timestamp()}] ${text}` }])
      try {
        // A project alias belongs to a target alias (THHIT_Data_alias -> Data_alias): that one owns the
        // database and the master changelog, which includes the changelogs of every module and alias.
        const plan = await api.liquibasePlan(project, alias)
        const connections = await api.liquibaseConnections(system)
        const choice = await new Promise<LiquibaseChoice | null>((resolve) =>
          setConnectionPick({
            connections,
            preferredAlias: plan.target_alias,
            title: `Which database should the changelogs of ${alias === plan.target_alias ? alias : `${alias} (part of ${plan.target_alias})`} update?`,
            resolve,
            onTranspile: () => transpile('partial', project),
          }),
        )
        if (!choice) return
        showToolWindow('output', false)
        setOutputSub('build')
        log('info', `Liquibase update of ${plan.target_alias} started`)
        if (!choice.useDist && !(await transpile('partial', project))) {
          log('error', 'The transpile failed, so the update did not start.')
          return
        }
        const message = await api.liquibaseUpdate(system, plan.target_alias, project, choice.connection.alias, true)
        const done = `Update successful: ${plan.target_alias} on ${choice.connection.database}`
        log('info', done)
        notify(done, { kind: 'success' })
        setStatus(done)
        void message
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e)
        log('error', text)
        notify(text, { kind: 'error', timeoutMs: 10000 })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, showToolWindow, appendLog, transpile],
  )

  const runTreeAction = useCallback(
    (id: string, node: TreeNode, top: TreeNode) => {
      const project = projectOf(top)
      const openWith = (sub: SubTab) => {
        setTabState((prev) => setSubTab(openTab(prev, node, project), node.id, sub))
        void activateNode(node, project)
      }
      switch (id) {
        case 'open':
          void handleOpen(node, top)
          return
        case 'openSource':
          openWith('source')
          return
        case 'history.show':
          openWith('history')
          return
        case 'copy': {
          const layout = objectLayout(node.id)
          if (layout) {
            setClipboard({ path: node.id, folder: layout.folder, name: layout.name })
            setStatus(`Copied ${layout.name}.`)
          }
          return
        }
        case 'paste':
          setPasteTarget({ destRoot: project })
          return
        case 'createModification':
          void api
            .enableModification(node.id, project)
            .then(async () => {
              await handleOpen(node, top)
              setStatus(`Modification mode for ${node.label}: edits in the Properties panel are written to modification/ of the project.`)
            })
            .catch((e) => setStatus(String(e)))
          return
        case 'delete':
          setDeleteTarget({ node, top })
          return
        case 'new':
          setNewTarget({ project, folder: nodeKind(node) === 'folder' ? diskFolderOf(node.folder) : null })
          return
        case 'rename':
          setRenameTarget({ node, project })
          return
        case 'findUsages':
          void startRefactoring('usages', node, project)
          return
        case 'refresh':
          setReloadToken((t) => t + 1)
          return
        case 'properties':
          showToolWindow('properties', false)
          return
        case 'closeProject':
          closeProjects([project])
          return
        case 'transpile.partial':
          void transpile('partial')
          return
        case 'transpile.full':
          void transpile('full')
          return
        case 'deploy.project':
          void startDeploy(false)
          return
        case 'file.openSystem':
          void api.openInSystem(node.id).catch((e) => notify(String(e instanceof Error ? e.message : e), { kind: 'error' }))
          return
        case 'file.cut':
        case 'file.copy':
          setFileClipboard({ path: node.id, cut: id === 'file.cut' })
          setStatus(`${id === 'file.cut' ? 'Cut' : 'Copied'} ${node.label}.`)
          return
        case 'file.paste':
          void pasteFile(node, project)
          return
        case 'file.delete':
          void deleteFile(node, project)
          return
        case 'file.rename':
          void renameFile(node, project)
          return
        case 'nodejs.install':
        case 'nodejs.clean-install':
        case 'nodejs.outdated':
        case 'nodejs.update':
        case 'nodejs.login':
        case 'nodejs.publish':
          void runNpm(project, id.slice('nodejs.'.length))
          return
        case 'buildDeploy':
          void startDeploy(true)
          return
        case 'liquibase.update':
          void runLiquibaseUpdate(node, project)
          return
        case 'git.commit':
          if (gitActive) openGit('changes')
          return
        case 'git.pull':
          if (gitActive) void runGit('Pull', () => api.gitPull(root))
          return
        case 'git.push':
          if (gitActive) void runGit('Push', () => api.gitPush(root))
          return
        case 'git.branches':
          if (gitActive) openGit('branches')
          return
        case 'git.history':
          if (gitActive) openGit('history')
          return
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectOf, activateNode, handleOpen, showToolWindow, closeProjects, transpile, gitActive, startRefactoring, startDeploy, fileClipboard, root],
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

  const usageNode =
    treeSelection && nodeKind(treeSelection) === 'object' && !treeSelection.id.startsWith('missing:') && ['entity', 'neonView', 'entityWebservice'].includes(treeSelection.object_type ?? '') && !/[\/]node_modules[\/]/i.test(treeSelection.id)
      ? treeSelection
      : null

  // Diff of a Source Control file as an editor tab (service-like tab: no file behind it).
  const openDiff = useCallback(
    (target: DiffTarget) => {
      const node: TreeNode = {
        id: `diff:${target.side}:${target.hash ?? ''}:${target.path}`,
        label: diffTitle(target),
        object_type: null,
        is_leaf: true,
        children: [],
        kind: 'service',
        diff: target,
      }
      void handleOpen(node)
    },
    [handleOpen],
  )

  // Status bar branch quick pick: a click on a branch is the confirmation, so it switches right away.
  const quickBranch = useCallback(
    async (t: { local?: string; remote?: string }) => {
      if (!root.trim()) return
      try {
        if (t.local) {
          const r = await api.gitCheckout(root, t.local)
          if (r.ok) notify(`Switched to ${t.local}.`, { kind: 'success' })
          else notify(r.text.split('\n')[0] || 'The branch could not be switched.', { kind: 'error', timeoutMs: 10000 })
        } else {
          const name = await promptDialog(t.remote ? `Create a local branch from ${t.remote}.` : 'Create a new branch from the current commit and switch to it.', {
            title: 'New Branch',
            label: 'Branch name',
            initial: t.remote ? t.remote.replace(/^[^/]+\//, '') : '',
            okLabel: 'Create',
            validate: (v) => (v.trim() === '' || /^[A-Za-z0-9._/-]+$/.test(v.trim()) ? null : 'Use letters, digits and _ - . / only.'),
          })
          if (!name) return
          const r = await api.gitCreateBranch(root, name.trim(), t.remote ?? null)
          if (r.ok) notify(`Created and switched to ${name.trim()}.`, { kind: 'success' })
          else notify(r.text.split('\n')[0] || 'The branch could not be created.', { kind: 'error', timeoutMs: 10000 })
        }
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), { kind: 'error', timeoutMs: 10000 })
      }
      setReloadToken((x) => x + 1)
      void refreshScm(api, root)
    },
    [api, root],
  )

  const updateToolbar = useCallback((next: ToolbarPrefs) => {
    setToolbarPrefs(next)
    saveToolbarPrefs(next)
  }, [])
  const toggleToolbarGroup = useCallback(
    (group: ToolbarGroup) => updateToolbar({ ...toolbarPrefs, groups: { ...toolbarPrefs.groups, [group]: !toolbarPrefs.groups[group] } }),
    [toolbarPrefs, updateToolbar],
  )

  const runCommand = useCallback(
    async (command: string, arg?: string) => {
      const node = editNode
      try {
        switch (command) {
          case 'file.openProject': {
            const picked = await api.pickProjectFolder()
            if (!picked) return
            openProjectAt(picked)
            api.setRecentProject(picked).catch(() => {})
            setRecent(picked)
            return
          }
          case 'file.openRecent':
            if (arg) openProjectAt(arg)
            return
          case 'file.closeProject':
            if (root) closeProjects([root])
            return
          case 'file.closeOtherProjects':
            closeProjects(projects.filter((p) => !samePath(p, root)))
            return
          case 'file.closeAllProjects':
            closeProjects(projects)
            return
          case 'file.save':
            if (!node || isServiceNode(node)) return
            if (await saveIds([node.id])) setStatus('Saved.')
            return
          case 'file.saveAll':
            if (await saveIds([...unsaved])) setStatus('All changes saved.')
            return
          case 'file.exit':
            await closeWindow()
            return
          case 'edit.undo':
            if (node) applyOutcome(node.id, await api.undo(node.id))
            return
          case 'edit.redo':
            if (node) applyOutcome(node.id, await api.redo(node.id))
            return
          case 'edit.cut':
          case 'edit.copy':
          case 'edit.paste':
            if (typeof document.execCommand === 'function') document.execCommand(command.slice(5))
            return
          case 'file.reloadAll':
          case 'project.refresh':
            setReloadToken((t) => t + 1)
            return
          case 'view.theme':
            if (arg && arg !== theme) toggleTheme(arg as ThemeName)
            return
          case 'tools.transpilePartial':
            await transpile('partial')
            return
          case 'tools.transpileFull':
            await transpile('full')
            return
          case 'tools.engine':
            if (arg === 'official' || arg === 'experimental') setEngine(arg)
            return
          case 'project.deploy':
            void startDeploy(false)
            return
          case 'project.buildDeploy':
            void startDeploy(true)
            return
          case 'tools.generateUuid':
            setStatus(await copyNewUuid())
            return
          case 'tools.options':
            setDialog('options')
            return
          case 'window.open':
            showToolWindow(arg as ToolWindowId)
            return
          case 'window.float': {
            const v = arg as FloatView
            const f = floatApiRef.current
            if (!f) return
            if (f.floating.includes(v)) await f.dockView(v)
            else await f.floatView(v)
            return
          }
          case 'window.dockAll':
            await floatApiRef.current?.dockAll()
            return
          case 'window.moveEditor': {
            const tab = activeTab(tabState)
            if (tab) await editorWindows.moveToWindow(tab)
            return
          }
          case 'window.dockEditors':
            for (const id of Object.keys(editorWindows.detached)) editorWindows.requestDock(id)
            return
          case 'window.resetLayout':
            setLayout(defaultLayout())
            return
          case 'team.commit':
            openGit('changes')
            return
          case 'team.pullView':
            setSyncMode('pull')
            setDialog('sync')
            return
          case 'team.pushView':
            setSyncMode('push')
            setDialog('sync')
            return
          case 'team.pull':
            void runGit('Pull', () => api.gitPull(root))
            return
          case 'team.push':
            void runGit('Push', () => api.gitPush(root))
            return
          case 'team.switchBranch':
            openGit('branches')
            return
          case 'team.history':
            openGit('history')
            return
          case 'help.about':
            setDialog('about')
            return
          case 'help.checkUpdates':
            setDialog('updates')
            return
          case 'help.localData':
            setDialog('localData')
            return
          case 'help.openLogFolder':
            setStatus(`Log folder: ${await api.openLogFolder()}`)
            return
          case 'help.openBackupFolder':
            setStatus(`Backup folder: ${await api.openBackupFolder()}`)
            return
          case 'tools.plugins':
            setDialog('plugins')
            return
          case 'file.find':
            if (root.trim()) setDialog('openModel')
            return
          case 'file.projectProperties': {
            const top = activeTree[0]
            if (top) setTreeSelection(top)
            showToolWindow('properties', false)
            return
          }
          case 'tools.sqlPrompt':
            if (sqlActive) openSql('')
            return
          case 'editor.action':
            if (arg) runEditorAction(arg)
            return
          case 'view.toolbarGroup':
            if (arg) toggleToolbarGroup(arg as ToolbarGroup)
            return
          case 'view.toolbarSmall':
            updateToolbar({ ...toolbarPrefs, smallIcons: !toolbarPrefs.smallIcons })
            return
          case 'view.resetToolbars':
            updateToolbar(defaultToolbarPrefs())
            return
          case 'view.editorPref':
            if (arg) setEditorPref(arg as keyof EditorPrefs, !getEditorPrefs()[arg as keyof EditorPrefs])
            return
          case 'view.onlyEditor':
            if (layoutBeforeOnlyEditor.current) {
              setLayout(layoutBeforeOnlyEditor.current)
              layoutBeforeOnlyEditor.current = null
            } else {
              layoutBeforeOnlyEditor.current = layout
              setLayout({ ...layout, panels: { projects: 'closed', properties: 'closed', navigator: 'closed', output: 'closed' } })
            }
            return
          case 'file.new':
            if (root.trim()) setNewTarget({ project: root, folder: null })
            return
          case 'file.importProject':
            if (root.trim()) setZipMode('import')
            return
          case 'file.exportProject':
            if (root.trim()) setZipMode('export')
            return
          case 'refactor.rename':
            if (usageNode) setRenameTarget({ node: usageNode, project: root })
            return
          case 'refactor.usages':
          case 'refactor.safeDelete':
            if (usageNode) void startRefactoring(command === 'refactor.usages' ? 'usages' : 'delete', usageNode, root)
            return
          case 'view.fullScreen':
            if (document.fullscreenElement) void document.exitFullscreen?.()
            else void document.documentElement.requestFullscreen?.()
            return
        }
      } catch (e) {
        setStatus(String(e))
      }
    },
    [api, editNode, unsaved, saveIds, theme, toggleTheme, transpile, openProjectAt, closeProjects, projects, root, markUnsaved, applyOutcome, showToolWindow, activeTree, sqlActive, openSql, toolbarPrefs, toggleToolbarGroup, updateToolbar, layout, usageNode, startRefactoring],
  )

  const currentTabForMenu = activeTab(tabState)
  const codeEditorOpen = !!currentTabForMenu && !isTunnelNode(currentTabForMenu.node) && (isFileNode(currentTabForMenu.node) || isServiceNode(currentTabForMenu.node) || currentTabForMenu.sub === 'source')

  const currentTabNode = activeTab(tabState)?.node ?? null
  const menus = useMemo(
    () =>
      buildMenus({
        hasProject: root.trim() !== '',
        hasSelection: selected !== null,
        hasUnsaved: unsaved.size > 0,
        canUndo,
        canRedo,
        recentProject: recent,
        theme,
        projectName: root.trim() ? baseName(root) : null,
        projectCount: projects.length,
        transpileRunning,
        engine,
        hasCodeEditor: codeEditorOpen,
        usageTarget: !!usageNode,
        toolbar: toolbarPrefs,
        editorPrefs,
        gitActive,
        floating: floatingViews,
        canMoveEditor: osWindowsAvailable() && !!currentTabNode && canMoveToWindow(currentTabNode),
        editorWindows: Object.keys(editorWindows.detached).length,
        onlyEditor: layoutBeforeOnlyEditor.current !== null,
        fullScreen: typeof document !== 'undefined' && !!document.fullscreenElement,
      }),
    [layout, floatingViews, currentTabNode, editorWindows.detached, root, projects.length, selected, unsaved, canUndo, canRedo, recent, theme, transpileRunning, engine, codeEditorOpen, toolbarPrefs, editorPrefs, gitActive, usageNode],
  )

  useEffect(() => {
    const items = shortcutItems(menus)
    function onKeyDown(e: KeyboardEvent) {
      if (dialog) return
      const hit = items.find((i) => [i.shortcut!, ...(i.extraShortcuts ?? [])].some((s) => matchesShortcut(e, s)))
      if (!hit) return
      // Inside a code editor Undo/Redo and the clipboard belong to the editor itself.
      const inCodeEditor = e.target instanceof Element && e.target.closest('.monaco-editor') !== null
      if (inCodeEditor && /^edit\.(undo|redo|cut|copy|paste)$/.test(hit.command!)) return
      e.preventDefault()
      runCommand(hit.command!, hit.arg)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menus, runCommand, dialog])

  const onMenuCommand = useCallback((item: MenuItemDef) => runCommand(item.command!, item.arg), [runCommand])

  const Editor = getEditorFor(selected?.object_type ?? null)
  const hasProject = root.trim() !== ''
  const totalErrors = errorCount(problemList)
  const currentTab = activeTab(tabState)
  const nodeProblems = useMemo(
    () => (currentTab ? problemList.filter((p) => p.nodeId && normId(p.nodeId) === normId(currentTab.node.id) && p.line && p.source !== 'js' && p.source !== 'build') : []),
    [problemList, currentTab],
  )

  const registerFlush = useCallback((nodeId: string, flush: (() => Promise<void>) | null) => {
    if (flush) flushers.current.set(nodeId, flush)
    else flushers.current.delete(nodeId)
  }, [])

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

  // Navigator > Set to Default: the element's definition leaves the file (module objects: the modification is deleted).
  const resetNavElement = async (path: string, label: string) => {
    if (!inspectedObject) return
    const id = inspectedObject.id
    try {
      const sheet = await api.getPropertySheet(id, '$')
      if (sheet.read_only && !sheet.modification) {
        if (!root.trim()) {
          setStatus('Open a project first: a module object is set to default by deleting the modification of that project.')
          return
        }
        if (!(await confirmDialog(`Delete the modification of ${label} in the project and use the module's definition again?`, { title: 'Set to Default', okLabel: 'Delete' }))) return
        await api.enableModification(id, root)
      }
      const out = await api.resetSheetElement(id, path)
      applyOutcome(id, out.tree)
      setNavSel(null)
      setStatus(out.modification?.dir ? `Modification ${out.modification.dir} deleted.` : `Set ${label} to default.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const elementSel = navSel && inspectedObject && navSel.nodeId === inspectedObject.id ? navSel : null
  const focusLabel = elementSel?.label ?? inspected?.label ?? null
  const userSel = useUserSelection()
  const propertiesTitle = userSel ? `${userSel.title || userSel.user} - Properties` : aliasSel ? `${isConfigurationAlias(aliasSel.config.name) ? sectionLabel(configSection) : aliasSel.config.name} - Properties` : focusLabel ? `${focusLabel} - Properties` : 'Properties'
  const configRef = currentTab && isAliasConfigNode(currentTab.node) ? parseAliasConfigRef(currentTab.node.path) : null
  const configTabOpen = !!configRef && !currentTab?.node.id.startsWith('dbbrowser:') && isConfigurationAlias(configRef.alias)
  const navigatorTitle = configTabOpen ? 'Navigator' : inspectedObject && focusLabel ? `${focusLabel} - Navigator` : 'Navigator'
  const inspectedKind = inspected ? nodeKind(inspected) : null
  const propertiesBody = userSel ? (
    <UserPropertiesPanel api={api} selection={userSel} />
  ) : aliasSel ? (
    <AliasConfigPanel config={aliasSel.config} system={aliasSel.system} />
  ) : !inspected ? (
    <div className="forge-panel-empty">&lt;No Properties&gt;</div>
  ) : inspectedKind === 'project' || inspectedKind === 'module' ? (
    <ProjectPropertiesPanel api={api} name={inspected.type_label ?? inspected.label} path={inspected.path ?? inspected.id} />
  ) : inspected && inspectedKind === 'file' && !inspected.code && !inspected.id.startsWith('tunnel:') ? (
    <FilePropertiesPanel api={api} path={inspected.id} />
  ) : inspectedObject ? (
    <PropertySheetPanel
      api={api}
      target={{ nodeId: inspectedObject.id, path: elementSel?.path ?? '$' }}
      linkedRoot={objectRoot(inspectedObject.id)}
      projectRoot={root}
      version={sheetVersion}
      referenceOptions={(type) => [...(objectsByType.get(type) ?? [])].sort((a, b) => a.localeCompare(b))}
      onGoTo={(type, name) => {
        const target = findObject(tree, type, name)
        if (target) void handleOpen(target)
        else setStatus(`${name} not found in the open projects.`)
      }}
      onEdited={(nodeId, outcome) => applyOutcome(nodeId, outcome)}
      onStatus={setStatus}
      onOpenCode={(code, readOnly) => void handleOpen(codeTabNode(code, readOnly))}
      onOpenFile={(path) => void handleOpen({ id: path, label: baseName(path), object_type: null, kind: 'file', is_leaf: true, children: [] })}
      onModificationChanged={() => setReloadToken((t) => t + 1)}
      onEditConfig={
        inspectedObject.object_type === 'system'
          ? (name, reference) => {
              if (name === 'tunnelConfigPath') {
                if (reference) void handleOpen(tunnelTabNode(inspectedObject.id, inspectedObject.label, reference))
              } else if (reference) {
                const file = resolvePathVariables('serverConfigPath', reference, { projectHome: projectOfPath(projects, inspectedObject.id) ?? root }).resolved
                void handleOpen({ id: file, label: baseName(file), object_type: null, kind: 'file', is_leaf: true, children: [] })
              } else {
                setStatus('serverConfigPath of this system is not set yet. Choose the file with the ... button.')
              }
            }
          : undefined
      }
    />
  ) : (
    <div className="forge-panel-empty">&lt;No Properties&gt;</div>
  )

  // Panels in windows of their own: what they draw from, and what they send back.
  const propsFloating = floatingViews.includes('properties')
  const objectsRecord = useMemo(
    () => (propsFloating ? Object.fromEntries([...objectsByType.entries()].map(([type, names]) => [type, [...names]])) : {}),
    [objectsByType, propsFloating],
  )
  const mainState = useMemo<MainState>(
    () => ({
      root,
      kind: !inspected ? 'none' : inspectedKind === 'project' || inspectedKind === 'module' ? inspectedKind : inspectedObject ? 'object' : 'none',
      objectId: inspectedObject?.id ?? null,
      objectType: inspectedObject?.object_type ?? null,
      origin: inspectedObject ? originLabel(inspectedObject) : '',
      title: focusLabel ?? '',
      projectName: inspected ? (inspected.type_label ?? inspected.label) : '',
      projectPath: inspected ? (inspected.path ?? inspected.id) : '',
      linkedRoot: inspectedObject ? objectRoot(inspectedObject.id) : '',
      readOnlyHint: '',
      selectedPath: elementSel?.path ?? null,
      version: sheetVersion,
      objectsByType: objectsRecord,
    }),
    [root, inspected, inspectedKind, inspectedObject, focusLabel, elementSel, sheetVersion, objectsRecord],
  )

  // Navigator > Activate (or double click) on a grey entry: its definition is created, a module object
  // gets a modification of the open project.
  const activateNavElement = async (path: string, label: string) => {
    if (!inspectedObject) return
    const id = inspectedObject.id
    try {
      const sheet = await api.getPropertySheet(id, '$')
      if (sheet.read_only && !sheet.modification) {
        if (!root.trim()) {
          setStatus('Open a project first: an entry of a module object is activated as a modification of that project.')
          return
        }
        await api.enableModification(id, root)
      }
      const out = await api.activateMapping(id, path)
      applyOutcome(id, out.tree)
      setNavSel({ nodeId: id, path: out.path, label })
      if (out.modification?.dir) notify(`Modification ${out.modification.action === 'created' ? 'created' : 'extended'}: modification/${out.modification.dir}`, { kind: 'success' })
      setReloadToken((t) => t + 1)
      setStatus(`Activated ${label}.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }
  removeElementRef.current = (path, label) => void resetNavElement(path, label)
  const activateNavRef = useRef(activateNavElement)
  activateNavRef.current = activateNavElement
  const resetNavRef = useRef(resetNavElement)
  resetNavRef.current = resetNavElement
  const onFloatAction = useCallback(
    (a: FloatAction) => {
      switch (a.type) {
        case 'navSelect':
          setNavSel(a.path === '$' ? null : { nodeId: a.nodeId, path: a.path, label: a.label })
          return
        case 'navReset':
          void resetNavRef.current(a.path, a.label)
          return
        case 'navActivate':
          void activateNavRef.current(a.path, a.label)
          return
        case 'edited':
          void api.getPropertyTree(a.nodeId).then((v) => {
            if (a.nodeId === selectedId) setValue(v)
            setSheetVersion((x) => x + 1)
            setCanUndo(true)
            markUnsaved(a.nodeId, true)
            refreshDiagnostics(a.nodeId)
          })
          return
        case 'status':
          setStatus(a.text)
          return
        case 'goTo': {
          const target = findObject(tree, a.objectType, a.name)
          if (target) void handleOpen(target)
          else setStatus(`${a.name} not found in the open projects.`)
          return
        }
        case 'openCode':
          void handleOpen(codeTabNode(a.code, false))
          return
        case 'openFile':
          void handleOpen({ id: a.path, label: baseName(a.path), object_type: null, kind: 'file', is_leaf: true, children: [] })
          return
        case 'modificationChanged':
        case 'reload':
          setReloadToken((t) => t + 1)
          return
        case 'openDiff':
          openDiff(a.target)
          return
        case 'openSql':
          openSql(a.sql)
          return
        case 'scmChanged':
          if (root.trim()) void refreshScm(api, root)
          return
        case 'editorDirty':
          markUnsaved(a.id, a.dirty)
          return
        case 'editorSaved':
          editorWindowsRef.current?.saved(a.id, a.ok)
          return
        case 'inspect': {
          const target = findNodeByPath(treeRef.current, normId(a.nodeId))
          setAliasSel(null)
          if (target) setTreeSelection(target)
          setNavSel(a.path === '$' ? null : { nodeId: a.nodeId, path: a.path, label: a.label })
          return
        }
      }
    },
    [api, root, selectedId, tree, handleOpen, openDiff, openSql, markUnsaved, refreshDiagnostics],
  )
  const bridge = useFloatBridge({ root, state: mainState, onAction: onFloatAction, onError: (m) => notify(m, { kind: 'error', timeoutMs: 10000 }) })
  floatApiRef.current = bridge
  useEffect(() => setFloatingViews(bridge.floating), [bridge.floating])
  useEffect(() => {
    if (bridge.floating.includes(projectsTab as FloatView)) setProjectsTab('projects')
  }, [bridge.floating, projectsTab])
  // The floating Output window gets the log lines of the main window.
  useEffect(() => {
    if (!bridge.floating.includes('output')) return
    const t = window.setTimeout(() => void getWindowBackend().emit(EVENTS.outputLines, logs), 100)
    return () => window.clearTimeout(t)
  }, [bridge.floating, logs])
  const effectiveLayout = useMemo(
    () => ({
      ...layout,
      panels: {
        ...layout.panels,
        navigator: bridge.floating.includes('navigator') ? ('closed' as const) : layout.panels.navigator,
        properties: bridge.floating.includes('properties') ? ('closed' as const) : layout.panels.properties,
        output: bridge.floating.includes('output') ? ('closed' as const) : layout.panels.output,
      },
    }),
    [layout, bridge.floating],
  )

  // New and Open open as windows of their own (modal: the main window is locked meanwhile); in a plain browser the embedded dialogs below are used.
  useEffect(() => {
    if (!newTarget || !osWindowsAvailable() || newWindowOpen.current) return
    newWindowOpen.current = true
    const target = newTarget
    void openDialogWindow<{ aod: string; folder: string; name: string }>('new', 'Create New Model', { width: 433, height: 340 }, { projectRoot: target.project, projects, folder: target.folder }, { modal: true, resizable: false })
      .then((r) => {
        if (r) {
          setReloadToken((t) => t + 1)
          setPendingOpen(r.aod)
          setStatus(`Created ${r.folder}/${r.name}.`)
        }
      })
      .catch((e) => notify(e instanceof Error ? e.message : String(e), { kind: 'error' }))
      .finally(() => {
        newWindowOpen.current = false
        setNewTarget(null)
      })
  }, [newTarget])
  useEffect(() => {
    if (dialog !== 'options' || !osWindowsAvailable() || optionsWindowOpen.current) return
    optionsWindowOpen.current = true
    void openDialogWindow<OptionsWindowResult>('options', 'Options', { width: 860, height: 640 }, { engine, theme, keymap: keymapEntries(menus) }, { modal: true })
      .then((r) => {
        if (!r) return
        reloadCustomThemes()
        reloadOptions()
        reloadEditorPrefs()
        setInstallDir(r.installDir)
        if (r.engine !== engine) setEngine(r.engine)
        if (r.theme !== theme) toggleTheme(r.theme)
      })
      .catch((e) => notify(e instanceof Error ? e.message : String(e), { kind: 'error' }))
      .finally(() => {
        optionsWindowOpen.current = false
        setDialog(null)
      })
    // Opens once per request; the values it was given are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])
  useEffect(() => {
    if (dialog !== 'openModel' || !hasProject || !osWindowsAvailable() || openWindowOpen.current) return
    openWindowOpen.current = true
    void openDialogWindow<{ type: string; name: string }>('open', 'Open', { width: 680, height: 540 }, { models: openableModels }, { modal: true })
      .then((m) => {
        if (!m) return
        const node = findObject(tree, m.type, m.name)
        if (node) void handleOpen(node)
      })
      .catch((e) => notify(e instanceof Error ? e.message : String(e), { kind: 'error' }))
      .finally(() => {
        openWindowOpen.current = false
        setDialog(null)
      })
  }, [dialog, hasProject, openableModels, tree, handleOpen])

  // Further dialogs also open as windows of their own (modal); the embedded versions below stay for a plain browser.
  useOsDialog<{ name: string }>(
    renameTarget !== null,
    () => ({ name: 'rename', title: 'Rename', size: { width: 480, height: 280 }, payload: { folder: renameTarget?.node.object_type ?? '', initial: renameTarget?.node.label ?? '' }, resizable: false }),
    (r) => {
      if (r && renameTarget) void startRename(renameTarget.node, renameTarget.project, r.name)
    },
    () => setRenameTarget(null),
  )
  useOsDialog<{ message: string }>(
    zipMode !== null,
    () => ({ name: 'zip', title: zipMode === 'import' ? 'Import Project' : 'Export Project', size: { width: 760, height: 580 }, payload: { projectRoot: root, mode: zipMode } }),
    (r) => {
      if (!r) return
      setStatus(r.message)
      setReloadToken((t) => t + 1)
    },
    () => setZipMode(null),
  )
  useOsDialog<{ message: string }>(
    deployRun !== null,
    () => ({ name: 'deployplan', title: 'Deploy', size: { width: 900, height: 660 }, payload: { project: deployRun?.project, system: deployRun?.system, force: deployRun?.force, checkScan: deployRun?.checkScan, warning: deployRun?.warning } }),
    (r) => {
      if (!r) return
      notify(r.message, { kind: 'success', timeoutMs: 10000 })
      setStatus(r.message)
    },
    () => setDeployRun(null),
  )
  useOsDialog<{ message: string }>(
    dialog === 'deploy' && hasProject,
    () => ({ name: 'deployplan', title: 'Deploy', size: { width: 900, height: 660 }, payload: { project: root } }),
    (r) => {
      if (r) setStatus(r.message)
    },
    () => setDialog((d) => (d === 'deploy' ? null : d)),
  )
  useOsDialog<unknown>(dialog === 'about', () => ({ name: 'about', title: 'About Dito Designer', size: { width: 600, height: 560 }, payload: {} }), () => {}, () => setDialog((d) => (d === 'about' ? null : d)))
  useOsDialog<unknown>(
    dialog === 'plugins',
    () => ({ name: 'plugins', title: 'Plugins', size: { width: 760, height: 560 }, payload: {} }),
    () => reloadPluginPrefs(),
    () => setDialog((d) => (d === 'plugins' ? null : d)),
  )
  useOsDialog<unknown>(dialog === 'localData', () => ({ name: 'localdata', title: 'Local Data', size: { width: 720, height: 560 }, payload: {} }), () => {}, () => setDialog((d) => (d === 'localData' ? null : d)))
  useOsDialog<{ tableCenter?: boolean }>(
    dialog === 'updates',
    () => ({ name: 'updates', title: 'Check for Updates', size: { width: 600, height: 560 }, payload: {} }),
    (r) => {
      if (r?.tableCenter) setDialog('tableCenter')
    },
    () => setDialog((d) => (d === 'updates' ? null : d)),
  )

  useOsDialog<{ changed?: boolean }>(
    dialog === 'git' && hasProject,
    () => ({ name: 'git', title: gitView.tab === 'changes' ? 'Commit' : gitView.tab === 'history' ? 'Log' : 'Branches', size: { width: 1100, height: 760 }, payload: { project: root, tab: gitView.tab, target: gitView.target } }),
    (r) => {
      if (r?.changed) setReloadToken((t) => t + 1)
      if (root.trim()) void refreshScm(api, root)
    },
    () => setDialog((d) => (d === 'git' ? null : d)),
  )

  const panels: Record<PanelId, PanelContent> = {
    projects: {
      title: projectsTab === 'projects' ? 'Projects' : 'Services',
      header: (
        <div className="forge-panel-tabs" role="tablist" aria-label="Project windows">
          {(['projects', 'services'] as const).filter((t) => !bridge.floating.includes(t as FloatView)).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={projectsTab === t}
              className={`forge-panel-tab${projectsTab === t ? ' is-active' : ''}`}
              onClick={() => setProjectsTab(t)}
            >
              {t === 'projects' ? 'Projects' : 'Services'}
            </button>
          ))}
        </div>
      ),
      body:
        projectsTab === 'projects' ? (
          <div className="projects-panel">
            <ProjectTree
              roots={tree}
              loading={loadingProjects.size > 0}
              onSelect={handleTreeSelect}
              onOpen={handleOpen}
              loadChildren={(n) => api.listTreeChildren(n.id)}
              onContextMenu={(node, top, x, y) => setCtxMenu({ node, top, x, y })}
              problemCounts={problemCounts}
              badgeFor={systemBadge}
              onSystemTunnel={(node) =>
                void api
                  .getPropertyTree(node.id)
                  .then((t) => {
                    const reference = textField(t, 'tunnelConfigPath') ?? ''
                    if (reference) void handleOpen(tunnelTabNode(node.id, node.label, reference))
                    else setStatus(`${node.label} has no tunnelConfigPath yet. Choose the tunnel config in its properties (the ... button).`)
                  })
                  .catch((e) => setStatus(e instanceof Error ? e.message : String(e)))
              }
              gitFor={gitFor}
              onFileKey={(key, node, top) => runTreeAction(key === 'cut' ? 'file.cut' : key === 'copy' ? 'file.copy' : key === 'paste' ? 'file.paste' : 'file.delete', node, top)}
            />
            {root ? (
              <div className="projects-active-bar" aria-label="Active project">
                <ProjectIcon />
                <span className="projects-active-name" title={root}>
                  {baseName(root)}
                </span>
                <button type="button" aria-label={`Close project ${baseName(root)}`} title="Close Project" onClick={() => closeProjects([root])}>
                  ×
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <ServicesPanel api={api} db={db} onDbChange={changeDb} onOpenSql={openSql} />
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
          onClear={(sub) => setLogs((prev) => ({ ...prev, [sub]: [] }))}
          onRefreshScan={() => setScanTick((t) => t + 1)}
          refactoring={refactoring}
          onOpenUsage={(u) => openProblem({ id: u.node_id, channel: 'usage', source: 'reference', severity: 'Info', message: u.kind, nodeId: u.node_id, line: u.line ?? undefined, column: u.column ?? undefined })}
          onCloseRefactoring={() => setRefactoring(null)}
          onDoRefactoring={() => void doRefactoring()}
        />
      ),
    },
  }

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
        branch={scm.root === root && scm.overview ? scm.overview.branch : branch}
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
          setDb(NO_DB)
        }}
        gitEnabled={gitActive && hasProject}
        loadBranches={() => api.gitOverview(root)}
        onCheckoutBranch={(t) => void quickBranch(t)}
        onGit={(a) => (a === 'newBranch' ? void quickBranch({}) : openGit('branches'))}
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
          entries={buildTreeMenu(ctxMenu.node, { clipboard, hasProject, fileClipboard })}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onPick={(id) => runTreeAction(id, ctxMenu.node, ctxMenu.top)}
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
              setStatus(e instanceof Error ? e.message : String(e))
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
              setStatus(e instanceof Error ? e.message : String(e))
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
        <Modal
          title="File changed on disk"
          onClose={() => setConflict(null)}
          footer={
            <>
              <button type="button" onClick={() => void resolveConflict('overwrite')}>
                Overwrite file on disk
              </button>
              <button type="button" onClick={() => void resolveConflict('reload')}>
                Reload from disk
              </button>
              <button type="button" onClick={() => setConflict(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p>{tabState.tabs.find((t) => t.id === conflict)?.node.label ?? 'This object'} was changed on disk (for example by Git) after you opened it, and you have unsaved edits.</p>
          <p className="forge-field-hint">Overwrite keeps your edits and backs up the disk version first. Reload discards your edits and shows the disk version.</p>
        </Modal>
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
      {dialog === 'localData' && !osWindowsAvailable() ? <LocalDataDialog api={api} onClose={() => setDialog(null)} /> : null}
      {dialog === 'git' && hasProject && !osWindowsAvailable() ? (
        <GitDialog api={api} projectRoot={root} initialTab={gitView.tab} initialTarget={gitView.target} onClose={() => setDialog(null)} onChanged={() => setReloadToken((t) => t + 1)} />
      ) : null}
      {dialog === 'sync' && hasProject && !osWindowsAvailable() ? <SyncDialog api={api} projectRoot={root} mode={syncMode} onClose={() => setDialog(null)} onDone={() => setReloadToken((t) => t + 1)} /> : null}
      {dialog === 'updates' && !osWindowsAvailable() ? <UpdatesDialog api={api} onClose={() => setDialog(null)} onOpenTableCenter={() => setDialog('tableCenter')} /> : null}
      {dialog === 'tableCenter' ? <TableCenterDialog api={api} db={db} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}
