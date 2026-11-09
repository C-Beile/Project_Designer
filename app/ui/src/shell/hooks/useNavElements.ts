import { useRef, type MutableRefObject } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { confirmDialog } from '../../core/dialogService'
import { errorText } from '../../core/errorText'
import { notify } from '../../core/notifications'
import type { TreeNode, UndoRedoOutcome } from '../../wire/types'

export type NavSelection = { nodeId: string; path: string; label: string } | null

export interface NavElementsDeps {
  api: ForgeApi
  root: string
  inspectedObject: TreeNode | null
  applyOutcome: (nodeId: string, outcome: UndoRedoOutcome) => void
  setNavSel: (sel: NavSelection) => void
  setReloadToken: (update: (t: number) => number) => void
  setStatus: (text: string) => void
  // Der Navigator im Projekt-Index ruft "Set to Default" über diese Ref auf.
  removeElementRef: MutableRefObject<(path: string, label: string) => void>
}

// Navigator > Set to Default / Activate: ändert die Definition des gewählten Elements.
export function useNavElements({ api, root, inspectedObject, applyOutcome, setNavSel, setReloadToken, setStatus, removeElementRef }: NavElementsDeps) {
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
      setStatus(errorText(e))
    }
  }

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
      setStatus(errorText(e))
    }
  }
  removeElementRef.current = (path, label) => void resetNavElement(path, label)
  const activateNavRef = useRef(activateNavElement)
  activateNavRef.current = activateNavElement
  const resetNavRef = useRef(resetNavElement)
  resetNavRef.current = resetNavElement

  return { resetNavElement, activateNavElement, resetNavRef, activateNavRef }
}
