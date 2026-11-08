import { useCallback, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import type { TabState } from '../../tabs/tabModel'
import type { TreeNode } from '../../wire/types'
import type { ToolWindowId } from '../menuModel'
import type { RefactoringState } from '../RefactoringPanel'
import type { CommandMap } from './commandTypes'

export interface RefactoringDeps {
  api: ForgeApi
  root: string
  tabState: TabState
  unsaved: Set<string>
  usageNode: TreeNode | null
  showToolWindow: (id: ToolWindowId, focus?: boolean) => void
  closeTabNow: (id: string) => void
  handleCloseTab: (id: string) => void
  setReloadToken: (update: (t: number) => number) => void
  setStatus: (text: string) => void
}

// Find Usages, Safely Delete and Rename: the plan is read first; files change only through "Do Refactoring".
export function useRefactoring({ api, root, tabState, unsaved, usageNode, showToolWindow, closeTabNow, handleCloseTab, setReloadToken, setStatus }: RefactoringDeps) {
  const [refactoring, setRefactoring] = useState<RefactoringState | null>(null)

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

  const commands: CommandMap = {
    'refactor.usages': () => {
      if (usageNode) void startRefactoring('usages', usageNode, root)
    },
    'refactor.safeDelete': () => {
      if (usageNode) void startRefactoring('delete', usageNode, root)
    },
  }

  return { refactoring, setRefactoring, startRefactoring, startRename, doRefactoring, commands }
}
