import { useCallback, useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { runCommandAsync } from '../../core/plugins/registry'
import { copyNewUuid } from '../../core/uuid'
import { matchesShortcut } from '../../core/shortcuts'
import { closeWindow } from '../../chrome/tauriWindow'
import { getEditorPrefs, setEditorPref, type EditorPrefs } from '../../theme/editorPrefs'
import { runEditorAction } from '../../theme/monacoActions'
import type { ThemeName } from '../../theme/useTheme'
import { activeTab, isFileNode, isServiceNode, isTunnelNode, type TabState } from '../../tabs/tabModel'
import type { TreeNode, UndoRedoOutcome } from '../../wire/types'
import { useEditorWindows } from '../../windows/useEditorWindows'
import { canMoveToWindow } from '../../windows/editorWindows'
import { osWindowsAvailable } from '../../windows/windowService'
import { defaultLayout, type LayoutState } from '../layoutState'
import { buildMenus, shortcutItems, type MenuItemDef, type ToolWindowId } from '../menuModel'
import { defaultToolbarPrefs, type ToolbarGroup, type ToolbarPrefs } from '../toolbarPrefs'
import { baseName, samePath } from '../shellHelpers'
import type { ShellDialog } from './dialogTypes'
import { findCommand, type CommandMap } from './commandTypes'
import type { useRefactoring } from './useRefactoring'
import type { useTranspile } from './useTranspile'

export interface ShellCommandsDeps {
  api: ForgeApi
  root: string
  projects: string[]
  activeTree: TreeNode[]
  tabState: TabState
  unsaved: Set<string>
  editNode: TreeNode | null
  selected: TreeNode | null
  canUndo: boolean
  canRedo: boolean
  recent: string | null
  dialog: ShellDialog
  layout: LayoutState
  theme: ThemeName
  toggleTheme: (next?: ThemeName) => void
  transpile: ReturnType<typeof useTranspile>['transpile']
  engine: ReturnType<typeof useTranspile>['engine']
  transpileRunning: boolean
  usageNode: TreeNode | null
  startRefactoring: ReturnType<typeof useRefactoring>['startRefactoring']
  gitActive: boolean
  sqlActive: boolean
  floatingViews: string[]
  editorWindows: ReturnType<typeof useEditorWindows>
  toolbarPrefs: ToolbarPrefs
  editorPrefs: EditorPrefs
  layoutBeforeOnlyEditor: MutableRefObject<LayoutState | null>
  extraCommands: CommandMap[]
  openProjectAt: (path: string) => void
  closeProjects: (toClose: string[]) => void
  saveIds: (ids: string[]) => Promise<boolean>
  applyOutcome: (nodeId: string, outcome: UndoRedoOutcome) => void
  markUnsaved: (nodeId: string, dirty: boolean) => void
  showToolWindow: (id: ToolWindowId, focus?: boolean) => void
  openSql: (sql: string) => void
  toggleToolbarGroup: (group: ToolbarGroup) => void
  updateToolbar: (next: ToolbarPrefs) => void
  setStatus: (text: string) => void
  setNewProjectOpen: (open: boolean) => void
  setRecent: (path: string | null) => void
  setReloadToken: (update: (t: number) => number) => void
  setDialog: (dialog: ShellDialog) => void
  setLayout: Dispatch<SetStateAction<LayoutState>>
  setTreeSelection: (node: TreeNode | null) => void
}

// Befehle, Menüs und Tastenkürzel des Hauptfensters. `extraCommands` sind die Befehls-Maps der anderen Hooks (Transpile, Deploy, ...).
export function useShellCommands({
  api, root, projects, activeTree, tabState, unsaved, editNode, selected, canUndo, canRedo, recent, dialog, layout, theme, toggleTheme, transpile, engine, transpileRunning, usageNode, startRefactoring,
  gitActive, sqlActive, floatingViews, editorWindows, toolbarPrefs, editorPrefs, layoutBeforeOnlyEditor, extraCommands, openProjectAt, closeProjects, saveIds, applyOutcome, markUnsaved,
  showToolWindow, openSql, toggleToolbarGroup, updateToolbar, setStatus, setNewProjectOpen, setRecent, setReloadToken, setDialog, setLayout, setTreeSelection,
}: ShellCommandsDeps) {
  const commands: CommandMap = {
    ...Object.assign({}, ...extraCommands),
    'file.newProject': () => {
      setNewProjectOpen(true)
    },
    'file.openProject': async () => {
      const picked = await api.pickProjectFolder()
      if (!picked) return
      openProjectAt(picked)
      api.setRecentProject(picked).catch(() => {})
      setRecent(picked)
    },
    'file.openRecent': (arg) => {
      if (arg) openProjectAt(arg)
    },
    'file.closeProject': () => {
      if (root) closeProjects([root])
    },
    'file.closeOtherProjects': () => {
      closeProjects(projects.filter((p) => !samePath(p, root)))
    },
    'file.closeAllProjects': () => {
      closeProjects(projects)
    },
    'file.save': async () => {
      const node = editNode
      if (!node || isServiceNode(node)) return
      if (await saveIds([node.id])) setStatus('Saved.')
    },
    'file.saveAll': async () => {
      if (await saveIds([...unsaved])) setStatus('All changes saved.')
    },
    'file.exit': async () => {
      await closeWindow()
    },
    'edit.undo': async () => {
      const node = editNode
      if (node) applyOutcome(node.id, await api.undo(node.id))
    },
    'edit.redo': async () => {
      const node = editNode
      if (node) applyOutcome(node.id, await api.redo(node.id))
    },
    'edit.cut': () => {
      if (typeof document.execCommand === 'function') document.execCommand('cut')
    },
    'edit.copy': () => {
      if (typeof document.execCommand === 'function') document.execCommand('copy')
    },
    'edit.paste': () => {
      if (typeof document.execCommand === 'function') document.execCommand('paste')
    },
    'file.reloadAll': () => {
      setReloadToken((t) => t + 1)
    },
    'project.refresh': () => {
      setReloadToken((t) => t + 1)
    },
    'view.theme': (arg) => {
      if (arg && arg !== theme) toggleTheme(arg as ThemeName)
    },
    'tools.generateUuid': async () => {
      setStatus(await copyNewUuid())
    },
    'tools.options': () => {
      setDialog('options')
    },
    'window.open': (arg) => {
      showToolWindow(arg as ToolWindowId)
    },
    'window.moveEditor': async () => {
      const tab = activeTab(tabState)
      if (tab) await editorWindows.moveToWindow(tab)
    },
    'window.dockEditors': () => {
      for (const id of Object.keys(editorWindows.detached)) editorWindows.requestDock(id)
    },
    'window.resetLayout': () => {
      setLayout(defaultLayout())
    },
    'help.about': () => {
      setDialog('about')
    },
    'help.checkUpdates': () => {
      setDialog('updates')
    },
    'help.localData': () => {
      setDialog('localData')
    },
    'help.openLogFolder': async () => {
      setStatus(`Log folder: ${await api.openLogFolder()}`)
    },
    'help.openBackupFolder': async () => {
      setStatus(`Backup folder: ${await api.openBackupFolder()}`)
    },
    'tools.plugins': () => {
      setDialog('plugins')
    },
    'file.find': () => {
      if (root.trim()) setDialog('openModel')
    },
    'file.projectProperties': () => {
      const top = activeTree[0]
      if (top) setTreeSelection(top)
      showToolWindow('properties', false)
    },
    'tools.sqlPrompt': () => {
      if (sqlActive) openSql('')
    },
    'editor.action': (arg) => {
      if (arg) runEditorAction(arg)
    },
    'view.toolbarGroup': (arg) => {
      if (arg) toggleToolbarGroup(arg as ToolbarGroup)
    },
    'view.toolbarSmall': () => {
      updateToolbar({ ...toolbarPrefs, smallIcons: !toolbarPrefs.smallIcons })
    },
    'view.resetToolbars': () => {
      updateToolbar(defaultToolbarPrefs())
    },
    'view.editorPref': (arg) => {
      if (arg) setEditorPref(arg as keyof EditorPrefs, !getEditorPrefs()[arg as keyof EditorPrefs])
    },
    'view.onlyEditor': () => {
      if (layoutBeforeOnlyEditor.current) {
        setLayout(layoutBeforeOnlyEditor.current)
        layoutBeforeOnlyEditor.current = null
      } else {
        layoutBeforeOnlyEditor.current = layout
        setLayout({ ...layout, panels: { projects: 'closed', properties: 'closed', navigator: 'closed', output: 'closed' } })
      }
    },
    'view.fullScreen': () => {
      if (document.fullscreenElement) void document.exitFullscreen?.()
      else void document.documentElement.requestFullscreen?.()
    },
  }

  // Der Befehl kommt aus der Map der Render-Runde, in der sich die Abhängigkeiten zuletzt geändert haben.
  const runCommand = useCallback(
    async (command: string, arg?: string) => {
      try {
        const own = findCommand(commands, command)
        if (own) await own(arg)
        else await runCommandAsync(command, arg)
      } catch (e) {
        setStatus(String(e))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return { menus, runCommand, onMenuCommand }
}
