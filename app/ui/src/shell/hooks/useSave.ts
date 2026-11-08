import { useCallback, type MutableRefObject } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { errorText } from '../../core/errorText'
import { refreshScm } from '../../features/git'
import { saveCodeProperty } from '../../properties/codeSave'
import { getOptions } from '../../settings/options'
import { isFileNode, type TabState } from '../../tabs/tabModel'
import { formatBeforeSave } from '../../theme/formatOnSave'
import type { UndoRedoOutcome, WireValue } from '../../wire/types'
import type { useEditorWindows } from '../../windows/useEditorWindows'

export interface SaveDeps {
  api: ForgeApi
  root: string
  gitActive: boolean
  tabState: TabState
  selectedId: string | null
  drafts: MutableRefObject<Map<string, string>>
  flushers: MutableRefObject<Map<string, () => Promise<void>>>
  historyFlags: MutableRefObject<Map<string, { undo: boolean; redo: boolean }>>
  editorWindowsRef: MutableRefObject<ReturnType<typeof useEditorWindows> | null>
  saveIdsRef: MutableRefObject<(ids: string[]) => Promise<boolean>>
  markUnsaved: (nodeId: string, dirty: boolean) => void
  refreshDiagnostics: (nodeId: string) => void
  setValue: (value: WireValue | null) => void
  setSheetVersion: (update: (v: number) => number) => void
  setCanUndo: (v: boolean) => void
  setCanRedo: (v: boolean) => void
  setConflict: (id: string | null) => void
  setScanTick: (update: (t: number) => number) => void
  setStatus: (text: string) => void
}

// Speichern: Undo/Redo-Ergebnis übernehmen, Entwürfe vor dem Speichern anwenden und Objekte schreiben.
export function useSave({ api, root, gitActive, tabState, selectedId, drafts, flushers, historyFlags, editorWindowsRef, saveIdsRef, markUnsaved, refreshDiagnostics, setValue, setSheetVersion, setCanUndo, setCanRedo, setConflict, setScanTick, setStatus }: SaveDeps) {
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
              setStatus(errorText(e))
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
            const message = errorText(e)
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

  saveIdsRef.current = saveIds

  const registerFlush = useCallback((nodeId: string, flush: (() => Promise<void>) | null) => {
    if (flush) flushers.current.set(nodeId, flush)
    else flushers.current.delete(nodeId)
  }, [])

  return { applyOutcome, saveIds, registerFlush }
}
