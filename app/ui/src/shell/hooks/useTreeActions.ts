import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { confirmDialog, promptDialog } from '../../core/dialogService'
import { errorText } from '../../core/errorText'
import { notify } from '../../core/notifications'
import { setSubTab, openTab, type SubTab, type TabState } from '../../tabs/tabModel'
import { diskFolderOf, objectLayout, type TreeMenuContext } from '../../tree/contextMenu'
import type { TreeNode } from '../../wire/types'
import { useOsDialog } from '../../windows/useOsDialog'
import { openDialogWindow, osWindowsAvailable } from '../../windows/windowService'
import type { GitOutput } from '../../wire/types'
import type { OutputLine, OutputSubTab } from '../OutputPanel'
import { nodeKind } from '../shellHelpers'
import { listenBackend } from './backendEvent'
import type { CommandMap } from './commandTypes'
import { timestamp } from './timestamp'

export interface TreeActionsDeps {
  api: ForgeApi
  root: string
  projects: string[]
  tabState: TabState
  setTabState: Dispatch<SetStateAction<TabState>>
  closeTabNow: (id: string) => void
  activateNode: (node: TreeNode, project: string) => Promise<void>
  handleOpen: (node: TreeNode, top?: TreeNode) => Promise<void>
  projectOf: (top: TreeNode) => string
  showToolWindow: (id: 'output' | 'properties', focus?: boolean) => void
  setOutputSub: (sub: OutputSubTab) => void
  appendLog: (sub: OutputSubTab, lines: OutputLine[]) => void
  closeProjects: (toClose: string[]) => void
  transpile: (mode: 'partial' | 'full') => Promise<boolean>
  gitActive: boolean
  startRefactoring: (mode: 'usages' | 'delete', node: TreeNode, project: string) => Promise<void>
  startRename: (node: TreeNode, project: string, newName: string) => Promise<void>
  startDeploy: (buildFirst: boolean) => Promise<void>
  openGit: (tab: 'changes' | 'history' | 'branches') => void
  runGit: (label: string, action: () => Promise<GitOutput>) => Promise<void>
  runLiquibaseUpdate: (node: TreeNode, project: string) => Promise<void>
  usageNode: TreeNode | null
  setPendingOpen: (path: string | null) => void
  setStatus: (text: string) => void
  setReloadToken: (update: (t: number) => number) => void
}

// Context menu of the Projects tree and what hangs off it: the open popup, the copied object or
// file, the confirmations, file operations, npm and the New / Rename / Import-Export windows.
export function useTreeActions(d: TreeActionsDeps) {
  const { api, root, projects, tabState, setTabState, closeTabNow, activateNode, handleOpen, projectOf, showToolWindow, setOutputSub, appendLog, closeProjects, transpile, gitActive, startRefactoring, startRename, startDeploy, openGit, runGit, runLiquibaseUpdate, usageNode, setPendingOpen, setStatus, setReloadToken } = d
  // Tree context menu: the open popup, the object copied with Copy and the two confirmations.
  const [ctxMenu, setCtxMenu] = useState<{ node: TreeNode; top: TreeNode; x: number; y: number } | null>(null)
  const [clipboard, setClipboard] = useState<TreeMenuContext['clipboard']>(null)
  const [fileClipboard, setFileClipboard] = useState<{ path: string; cut: boolean } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ node: TreeNode; top: TreeNode } | null>(null)
  const [pasteTarget, setPasteTarget] = useState<{ destRoot: string } | null>(null)
  const [newTarget, setNewTarget] = useState<{ project: string; folder: string | null } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ node: TreeNode; project: string } | null>(null)
  const [zipMode, setZipMode] = useState<'export' | 'import' | null>(null)
  const newWindowOpen = useRef(false)

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
  useEffect(
    () =>
      listenBackend('forge://npm-output', (p) => {
        const e = p as { line: string; error: boolean }
        appendLog('nodejs', [{ level: e.error ? 'warn' : 'info', text: e.line }])
      }),
    [appendLog],
  )
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
      const message = errorText(e)
      appendLog('nodejs', [{ level: 'error', text: `[${timestamp()}] npm ${action}: ${message}` }])
      notify(message, { kind: 'error', timeoutMs: 10000 })
    } finally {
      npmBusy.current = false
    }
  }

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

  // New opens as a window of its own (modal: the main window is locked meanwhile); in a plain browser the embedded dialog is used.
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
      .catch((e) => notify(errorText(e), { kind: 'error' }))
      .finally(() => {
        newWindowOpen.current = false
        setNewTarget(null)
      })
  }, [newTarget])

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

  const commands: CommandMap = {
    'file.new': () => {
      if (root.trim()) setNewTarget({ project: root, folder: null })
    },
    'file.importProject': () => {
      if (root.trim()) setZipMode('import')
    },
    'file.exportProject': () => {
      if (root.trim()) setZipMode('export')
    },
    'refactor.rename': () => {
      if (usageNode) setRenameTarget({ node: usageNode, project: root })
    },
  }

  return { ctxMenu, setCtxMenu, clipboard, fileClipboard, deleteTarget, setDeleteTarget, pasteTarget, setPasteTarget, newTarget, setNewTarget, renameTarget, setRenameTarget, zipMode, setZipMode, runTreeAction, commands }
}
