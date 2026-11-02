import type { ForgeApi } from '../api/ForgeApi'
import { notify } from '../shell/notifications'
import { objectRoot } from './objectRoot'
import type { CodeTarget, TreeNode, UndoRedoOutcome } from '../wire/types'

// Saving the code tab of a property: a new property gets its file and its reference in one go; module
// objects are never changed themselves, the script becomes a modification of the open project.

export function codeFilePath(target: Pick<CodeTarget, 'linkedRoot' | 'reference'>): string {
  const root = target.linkedRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${root}/${target.reference.replace(/^%aditoprj%\//, '')}`
}

export function codeTabNode(target: CodeTarget, readOnly: boolean): TreeNode {
  const id = codeFilePath(target)
  return { id, label: id.split('/').pop() ?? target.reference, object_type: null, kind: 'file', is_leaf: true, children: [], read_only: readOnly, code: target }
}

// Code file of a process object (its `process` property): double-clicking a process opens this file
// straight away instead of an empty object tab. Null when the object has no such property.
export async function processCodeTarget(api: ForgeApi, node: TreeNode): Promise<CodeTarget | null> {
  const sheet = await api.getPropertySheet(node.id, '$')
  const row = sheet.groups.flatMap((g) => g.rows).find((r) => r.name === 'process')
  if (!row) return null
  const stored = row.set && row.value?.kind === 'text' ? row.value.value : ''
  const reference = stored || row.new_reference || ''
  if (!reference) return null
  const linkedRoot = objectRoot(node.id)
  return { ownerNodeId: node.id, ownerName: sheet.name, path: '$', prop: 'process', reference, linkedRoot, isNew: !row.set }
}

export interface CodeSaveResult {
  /** Present when the object itself changed (a reference was written). */
  outcome?: UndoRedoOutcome
  message?: string
}

export async function saveCodeProperty(
  api: ForgeApi,
  target: CodeTarget,
  content: string,
  projectRoot: string,
): Promise<CodeSaveResult> {
  const sheet = await api.getPropertySheet(target.ownerNodeId, target.path)
  let modification = !!sheet.modification
  if (!modification && sheet.read_only) {
    if (!projectRoot.trim()) throw new Error('Open a project first: edits of module objects are written as a modification of that project.')
    await api.enableModification(target.ownerNodeId, projectRoot)
    modification = true
  }
  if (modification) {
    const out = await api.setModificationScript(target.ownerNodeId, target.path, target.prop, content)
    if (out.dir) notify(`Modification ${out.action === 'created' ? 'created' : 'extended'}: modification/${out.dir}`, { kind: 'success' })
    return { message: out.dir ? `Modification ${out.action}: modification/${out.dir}` : undefined }
  }
  await api.writeLinkedFile(target.linkedRoot, target.reference, content)
  if (target.isNew) {
    const outcome = await api.setSheetProperty(target.ownerNodeId, target.path, target.prop, { kind: 'text', value: target.reference }, false)
    return { outcome }
  }
  return {}
}
