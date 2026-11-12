import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { errorText } from '../../core/errorText'
import { activeTab, isFileNode, isServiceNode, isTunnelNode, type TabState } from '../../tabs/tabModel'
import type { DetachedEditor, useEditorWindows } from '../../windows/useEditorWindows'
import type { ProjectChanged, TreeNode } from '../../wire/types'
import { pathKey } from '../../platform/pathKey'
import { listenBackend } from './backendEvent'

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

// Änderungen von außen (Git, anderer Editor): das Backend meldet sie als Event, hier werden Baum, Probleme und offene Tabs aktualisiert; dazu der Konflikt-Dialog.
export function useExternalChanges({ api, tabState, unsaved, projects, detached, conflict, setConflict, markUnsaved, activateNodeRef, editorWindowsRef, setReloadToken, setScanTick, setSheetVersion, setStatus }: ExternalChangesDeps) {
  // Changes made outside the app (Git, another editor): the project tree is refreshed, open objects
  // are re-read from disk when they hold no unsaved edits; with unsaved edits the next save asks.
  const watchRef = useRef({ tabs: tabState.tabs, unsaved, projects, active: null as string | null, detached })
  watchRef.current = { tabs: tabState.tabs, unsaved, projects, active: activeTab(tabState)?.id ?? null, detached }
  const notifiedConflicts = useRef(new Set<string>())

  // Open objects whose file changed on disk: re-read them when they hold no unsaved edits,
  // otherwise only say so (saving asks how to proceed; the old version stays in the backup).
  const checkOpenTabs = useCallback(async () => {
    const w = watchRef.current
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
  }, [api])

  // The backend (file watcher + project index) reports changes; nothing is polled any more, so this also
  // works while the window has no focus.
  useEffect(() => {
    const stop = listenBackend('forge://project-changed', (payload) => {
      const p = payload as ProjectChanged
      if (!p || !Array.isArray(p.changed)) return
      const w = watchRef.current
      if (!w.projects.some((x) => pathKey(x) === pathKey(p.project))) return
      if (p.full) {
        setReloadToken((t) => t + 1)
        setScanTick((t) => t + 1)
        setStatus(p.reason === 'git' ? 'Project reloaded (Git)' : p.reason === 'flood' ? 'Project reloaded (many files changed)' : 'Project reloaded')
      } else {
        const shapeChanged = p.modulesChanged || p.changed.some((c) => c.kind !== 'modified' && c.objectType !== null)
        if (shapeChanged && !p.ownOnly) setReloadToken((t) => t + 1)
        setScanTick((t) => t + 1)
      }
      if (!p.ownOnly) void checkOpenTabs().catch(() => {})
    })
    return stop
  }, [checkOpenTabs])

  // Getting the window back is a cheap safety net (stat only): it finds what the OS watcher may have lost.
  useEffect(() => {
    let timer: number | undefined
    const onFocus = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const open = watchRef.current.projects.filter((p) => p.trim())
        void Promise.all(open.map((p) => api.indexVerify(p).catch(() => null)))
          .then(() => checkOpenTabs())
          .catch(() => {})
      }, 500)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [api, checkOpenTabs])

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
