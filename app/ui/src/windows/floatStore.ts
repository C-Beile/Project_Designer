import { pathKey } from '../platform/pathKey'
import type { FloatView, Geometry } from './protocol'
import { FLOAT_VIEWS } from './protocol'

// Which panels float as windows of their own and where, remembered per project so that a project
// comes back with the same arrangement. Only user-level convenience: damaged or missing storage
// just means everything starts docked.

const KEY = 'forge.float.v1'

type Entry = Partial<Record<FloatView, Geometry | null>>
type Store = Record<string, Entry>

function norm(root: string): string {
  return pathKey(root)
}

function read(): Store {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Storage unavailable: the arrangement just does not survive this session.
  }
}

function validGeometry(g: unknown): g is Geometry {
  if (!g || typeof g !== 'object') return false
  const o = g as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number)) && (o.w as number) >= 100 && (o.h as number) >= 60
}

/** Floating views of the project with their last geometry (null: no geometry known yet). */
export function loadFloating(root: string): Entry {
  const entry = read()[norm(root)] ?? {}
  const out: Entry = {}
  for (const view of FLOAT_VIEWS) if (view in entry) out[view] = validGeometry(entry[view]) ? entry[view] : null
  return out
}

export function rememberFloating(root: string, view: FloatView, geometry: Geometry | null): void {
  if (!root.trim()) return
  const store = read()
  const key = norm(root)
  store[key] = { ...(store[key] ?? {}), [view]: geometry && validGeometry(geometry) ? geometry : (store[key]?.[view] ?? null) }
  write(store)
}

export function forgetFloating(root: string, view: FloatView): void {
  if (!root.trim()) return
  const store = read()
  const key = norm(root)
  if (!store[key] || !(view in store[key])) return
  const { [view]: _gone, ...rest } = store[key]
  store[key] = rest
  write(store)
}
