import type { TreeNode } from '../wire/types'

// Editor tab state of one window (LAYOUT_SPEC §6). Pure functions so the order and activation
// rules are testable without rendering.

export type SubTab = 'editor' | 'users' | 'source' | 'history'

export const SUB_TAB_LABELS: Record<SubTab, string> = { editor: 'Editor', users: 'Users', source: 'Source', history: 'History' }

export interface EditorTab {
  /** File path of the object or file; one tab per file even if the tree shows it twice. */
  id: string
  node: TreeNode
  /** Root folder of the project the tab was opened from. */
  project: string
  sub: SubTab
}

export interface TabState {
  tabs: EditorTab[]
  activeId: string | null
}

export const EMPTY_TABS: TabState = { tabs: [], activeId: null }

export function isFileNode(node: TreeNode): boolean {
  return node.kind === 'file'
}

// Virtual tabs of the Services tab (SQL editors): no file behind them.
export function isServiceNode(node: TreeNode): boolean {
  return node.kind === 'service' || node.kind === 'tunnel' || node.kind === 'aliasconfig'
}

// Tab of one alias config of a system (shot 84); `node.path` holds its reference as JSON.
export function isAliasConfigNode(node: TreeNode): boolean {
  return node.kind === 'aliasconfig'
}

// Tunnel config editor tab of a system; `node.path` holds the `$PROJECTHOME/...` reference.
export function isTunnelNode(node: TreeNode): boolean {
  return node.kind === 'tunnel'
}

export function tunnelTabNode(systemId: string, systemName: string, reference: string): TreeNode {
  const file = reference.split(/[\/]/).pop() ?? reference
  return { id: `tunnel:${systemId}`, label: `${file} - ${systemName}`, object_type: null, kind: 'tunnel', path: reference, is_leaf: true, children: [] }
}

// Only a system shows its users as an extra view (the users live in the database of that system, so an alias
// definition of a module or of the project has none); plain files have no object structure, so they get the
// text editor and the history only.
export function subTabsFor(node: TreeNode): SubTab[] {
  if (isServiceNode(node)) return ['editor']
  if (isFileNode(node)) return ['editor', 'history']
  if (node.object_type === 'system') return ['editor', 'users', 'source', 'history']
  return ['editor', 'source', 'history']
}

export function openTab(state: TabState, node: TreeNode, project: string): TabState {
  if (state.tabs.some((t) => t.id === node.id)) return { ...state, activeId: node.id }
  return { tabs: [...state.tabs, { id: node.id, node, project, sub: 'editor' }], activeId: node.id }
}

export function activateTab(state: TabState, id: string): TabState {
  return state.tabs.some((t) => t.id === id) ? { ...state, activeId: id } : state
}

// Closing the active tab activates its right neighbour, else the left one, as in most editors.
export function closeTab(state: TabState, id: string): TabState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index < 0) return state
  const tabs = state.tabs.filter((t) => t.id !== id)
  if (state.activeId !== id) return { ...state, tabs }
  const next = tabs[index] ?? tabs[index - 1] ?? null
  return { tabs, activeId: next?.id ?? null }
}

export function setSubTab(state: TabState, id: string, sub: SubTab): TabState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id && subTabsFor(t.node).includes(sub) ? { ...t, sub } : t)) }
}

export function closeTabsWhere(state: TabState, shouldClose: (tab: EditorTab) => boolean): TabState {
  let next = state
  for (const tab of state.tabs) if (shouldClose(tab)) next = closeTab(next, tab.id)
  return next
}

export function activeTab(state: TabState): EditorTab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null
}
