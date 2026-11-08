import { useEffect, useState } from 'react'
import type { TreeNode } from '../../wire/types'
import { nodeKind, ownerNodeOf } from '../shellHelpers'

// Was Properties, Navigator und Speichern/Undo/Redo gerade betrifft: Klick im Baum, offener Tab und gewähltes Navigator-Element.
export function useSelection(tree: TreeNode[]) {
  // Single click selects (Properties title, later Navigator); `selected` is the object opened in
  // the editor area by double-click/Enter.
  const [treeSelection, setTreeSelection] = useState<TreeNode | null>(null)
  const [selected, setSelected] = useState<TreeNode | null>(null)
  const [selectedProject, setSelectedProject] = useState('')
  // Element chosen in the Navigator; its properties replace the object's in the Properties panel.
  const [navSel, setNavSel] = useState<{ nodeId: string; path: string; label: string } | null>(null)

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
  const elementSel = navSel && inspectedObject && navSel.nodeId === inspectedObject.id ? navSel : null
  const focusLabel = elementSel?.label ?? inspected?.label ?? null
  const inspectedKind = inspected ? nodeKind(inspected) : null

  return { treeSelection, setTreeSelection, selected, setSelected, selectedProject, setSelectedProject, navSel, setNavSel, inspected, inspectedObject, editNode, elementSel, focusLabel, inspectedKind }
}
