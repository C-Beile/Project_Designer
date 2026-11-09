import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { errorText } from '../../core/errorText'
import { activeTab, isFileNode, isServiceNode, isTunnelNode, type TabState } from '../../tabs/tabModel'
import type { DetachedEditor, useEditorWindows } from '../../windows/useEditorWindows'
import type { TreeNode } from '../../wire/types'

export interface ExternalChangesDeps {
  api: ForgeApi
  tabState: TabState
  unsaved: Set<string>
  projects: string[]
  detached: Record<string, DetachedEditor>
  conflict: string | null
  setConflict: (id: string | null) => void
  markUnsaved: (nodeId: string, dirty: boolean) => void
  activateNodeRef: MutableRefObject<((node: TreeNode, project: string) => Promise<void>) | undefined>
  editorWindowsRef: MutableRefObject<ReturnType<typeof useEditorWindows> | null>
  setReloadToken: (update: (t: number) => number) => void
  setScanTick: (update: (t: number) => number) => void
  setSheetVersion: Dispatch<SetStateAction<number>>
  setStatus: (text: string) => void
}

// Änderungen von außen (Git, anderer Editor) erkennen und den Konflikt-Dialog bedienen.
export function useExternalChanges({ api, tabState, unsaved, projects, detached, conflict, setConflict, markUnsaved, activateNodeRef, editorWindowsRef, setReloadToken, setScanTick, setSheetVersion, setStatus }: ExternalChangesDeps) {
  // Changes made outside the app (Git, another editor): the project tree is refreshed, open objects
  // are re-read from disk when they hold no unsaved edits; with unsaved edits the next save asks.
  const watchRef = useRef({ tabs: tabState.tabs, unsaved, projects, active: null as string | null, detached })
  watchRef.current = { tabs: tabState.tabs, unsaved, projects, active: activeTab(tabState)?.id ?? null, detached }
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
        setStatus(errorText(e))
      }
    },
    [api, conflict, tabState, markUnsaved],
  )

  return { resolveConflict }
}
