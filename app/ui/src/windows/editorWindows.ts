import { configGet, configSet } from '../settings/appConfig'
import { pathKey } from '../platform/pathKey'
import type { SubTab } from '../tabs/tabModel'
import { isServiceNode } from '../tabs/tabModel'
import type { TreeNode } from '../wire/types'
import type { Geometry } from './protocol'

// Editors that were moved out of the main window into windows of their own: the window name of a
// document, which documents can move at all, and the arrangement remembered per project so that a
// project comes back with the same windows. Only a user-level convenience: a missing entry
// just means everything starts in the main window.

/** Window name of the document with this id: stable, so the same document always gets the same window. */
export function editorWindowName(id: string): string {
  let hash = 0x811c9dc5
  for (const ch of pathKey(id)) {
    hash ^= ch.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `ed-${hash.toString(16).padStart(8, '0')}`
}

/** Objects and plain or code files can move; the virtual tabs of the Services area (SQL, tunnel, alias config) and diffs stay. */
export function canMoveToWindow(node: TreeNode): boolean {
  return !isServiceNode(node) && !node.diff && !node.id.startsWith('missing:')
}

export interface SavedEditorWindow {
  node: TreeNode
  sub: SubTab
  geometry: Geometry | null
}

// Abschnitt [windows.editors] in designer.conf, ein Eintrag je Projekt.
const PATH = ['windows', 'editors'] as const

type Store = Record<string, SavedEditorWindow[]>

function read(): Store {
  const parsed = configGet<unknown>(...PATH)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {}
}

function write(store: Store): void {
  configSet(PATH, store)
}

function validGeometry(g: unknown): g is Geometry {
  if (!g || typeof g !== 'object') return false
  const o = g as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number)) && (o.w as number) >= 200 && (o.h as number) >= 120
}

function validEntry(e: unknown): e is SavedEditorWindow {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  const node = o.node as Record<string, unknown> | undefined
  return !!node && typeof node.id === 'string' && typeof node.label === 'string' && typeof o.sub === 'string'
}

/** Editor windows the project had open the last time, with their last geometry. */
export function loadEditorWindows(root: string): SavedEditorWindow[] {
  const list = read()[pathKey(root)]
  if (!Array.isArray(list)) return []
  // Leere Werte (null, leere Listen) stehen nicht in der Datei: sie bekommen hier ihre Standardwerte zurück.
  return list.filter(validEntry).map((e) => ({ node: Object.assign({ object_type: null, children: [] }, e.node) as TreeNode, sub: e.sub, geometry: validGeometry(e.geometry) ? e.geometry : null }))
}

export function rememberEditorWindow(root: string, entry: SavedEditorWindow): void {
  if (!root.trim()) return
  const store = read()
  const key = pathKey(root)
  const rest = (store[key] ?? []).filter((e) => validEntry(e) && pathKey(e.node.id) !== pathKey(entry.node.id))
  const previous = (store[key] ?? []).find((e) => validEntry(e) && pathKey(e.node.id) === pathKey(entry.node.id))
  store[key] = [...rest, { ...entry, geometry: entry.geometry && validGeometry(entry.geometry) ? entry.geometry : (previous?.geometry ?? null) }]
  write(store)
}

export function forgetEditorWindow(root: string, id: string): void {
  if (!root.trim()) return
  const store = read()
  const key = pathKey(root)
  if (!store[key]) return
  store[key] = store[key].filter((e) => validEntry(e) && pathKey(e.node.id) !== pathKey(id))
  write(store)
}
