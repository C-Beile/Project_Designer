import { pathKey } from '../platform/pathKey'
import { normId } from '../problems/problemStore'
import type { TreeNode } from '../wire/types'

// Kleine reine Hilfsfunktionen des Hauptfensters.

export function findNodeByPath(nodes: TreeNode[], wanted: string): TreeNode | null {
  for (const n of nodes) {
    if (normId(n.id) === wanted) return n
    const hit = findNodeByPath(n.children, wanted)
    if (hit) return hit
  }
  return null
}

export function nodeKind(n: TreeNode) {
  return n.kind ?? (n.object_type ? 'object' : 'folder')
}

// Origin label as in the Projects tree; of the override chain only the last package is shown,
// like the original (`@aditosoftware/contact:8.0.0 (@3hills-IT/easescreen:1.6.5-RC1)`).
export function originLabel(n: TreeNode): string {
  if (!n.origin) return ''
  const last = n.overrides?.length ? n.overrides[n.overrides.length - 1] : null
  return last ? `${n.origin} (${last})` : n.origin
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

// Object whose Properties a code tab or a tunnel config tab shows: the owner of the property, or the
// system the tunnel config belongs to (original Designer, reference shot 81).
export function ownerNodeOf(tree: TreeNode[], node: TreeNode): TreeNode | null {
  if (node.code) return findNodeByPath(tree, normId(node.code.ownerNodeId))
  if (node.kind === 'tunnel' && node.id.startsWith('tunnel:')) return findNodeByPath(tree, normId(node.id.slice('tunnel:'.length)))
  return null
}
