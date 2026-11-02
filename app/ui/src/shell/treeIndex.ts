import type { TreeNode } from '../wire/types'

// Lookups in the project tree that the main window and the windows of moved editors share.

// `process:executables`: processes of the tree group `executables` (variant EXECUTABLE of the .aod; the
// Navigator filter "Executables Only" of the application editor uses it).
export function collectByType(nodes: TreeNode[], out: Map<string, Set<string>> = new Map(), parentLabel = '') {
  for (const n of nodes) {
    if (n.object_type && !n.id.startsWith('missing:') && (n.kind ?? 'object') === 'object') {
      if (!out.has(n.object_type)) out.set(n.object_type, new Set())
      out.get(n.object_type)!.add(n.label)
      if (n.object_type === 'process' && parentLabel === 'executables') {
        if (!out.has('process:executables')) out.set('process:executables', new Set())
        out.get('process:executables')!.add(n.label)
      }
    }
    collectByType(n.children, out, n.label)
  }
  return out
}

export function findObject(nodes: TreeNode[], objectType: string, label: string): TreeNode | null {
  for (const n of nodes) {
    if (n.object_type === objectType && n.label === label && !n.id.startsWith('missing:')) return n
    const hit = findObject(n.children, objectType, label)
    if (hit) return hit
  }
  return null
}

// Entity shown below the context that lists the view (tree: context > entity + views).
export function entityOfView(nodes: TreeNode[], viewName: string): TreeNode | null {
  for (const n of nodes) {
    if (n.object_type === 'neonContext' && n.children.some((c) => c.object_type === 'neonView' && c.label === viewName)) {
      return n.children.find((c) => c.object_type === 'entity' && !c.id.startsWith('missing:')) ?? null
    }
    const hit = entityOfView(n.children, viewName)
    if (hit) return hit
  }
  return null
}
