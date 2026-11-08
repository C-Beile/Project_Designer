import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { choiceDialog } from '../../core/dialogService'
import { codeTabNode, processCodeTarget } from '../../properties/codeSave'
import { EMPTY_TABS, activateTab, activeTab, closeTab, closeTabsWhere, isFileNode, isServiceNode, openTab, type TabState } from '../../tabs/tabModel'
import type { DiagnosticDto, TreeNode, WireValue } from '../../wire/types'
import type { useEditorWindows } from '../../windows/useEditorWindows'
import { nodeKind, ownerNodeOf } from '../shellHelpers'

export interface TabsDeps {
  api: ForgeApi
  root: string
  treeRef: MutableRefObject<TreeNode[]>
  editorWindowsRef: MutableRefObject<ReturnType<typeof useEditorWindows> | null>
  saveIdsRef: MutableRefObject<(ids: string[]) => Promise<boolean>>
  projectOf: (top: TreeNode) => string
  refreshDiagnostics: (nodeId: string) => void
  setSelected: (node: TreeNode | null) => void
  setTreeSelection: (node: TreeNode | null) => void
  setActiveProject: (project: string | null) => void
  setSelectedProject: (project: string) => void
  setValue: (value: WireValue | null) => void
  setDiagnostics: Dispatch<SetStateAction<DiagnosticDto[]>>
  setCanUndo: (v: boolean) => void
  setCanRedo: (v: boolean) => void
  setAliasSel: (sel: null) => void
  setStatus: (text: string) => void
}

// Offene Editor-Tabs: öffnen, wechseln, schließen. Dazu die Entwürfe (Source-/Dateitext), Flusher und der Ungespeichert-Zustand je Tab.
export function useTabs({ api, root, treeRef, editorWindowsRef, saveIdsRef, projectOf, refreshDiagnostics, setSelected, setTreeSelection, setActiveProject, setSelectedProject, setValue, setDiagnostics, setCanUndo, setCanRedo, setAliasSel, setStatus }: TabsDeps) {
  // Open editor tabs of this window; kept in memory only.
  const [tabState, setTabState] = useState<TabState>(EMPTY_TABS)
  // Text the user typed in a Source tab (not yet accepted by the backend) or in a plain-file
  // editor (not yet written), per file; Save applies or writes it.
  const drafts = useRef(new Map<string, string>())
  const flushers = useRef(new Map<string, () => Promise<void>>())
  // Undo/redo availability per object, so it follows the active tab.
  const historyFlags = useRef(new Map<string, { undo: boolean; redo: boolean }>())
  const [unsaved, setUnsaved] = useState<Set<string>>(() => new Set())

  const markUnsaved = useCallback((nodeId: string, dirty: boolean) => {
    setUnsaved((prev) => {
      if (prev.has(nodeId) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
  }, [])

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

  return { tabState, setTabState, drafts, flushers, historyFlags, unsaved, markUnsaved, activateNode, activateNodeRef, handleOpen, handleActivateTab, closeTabNow, handleCloseTab, handleCloseOthers, handleCloseAll }
}
