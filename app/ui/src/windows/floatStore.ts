import { configGet, configSet } from '../settings/appConfig'
import { pathKey } from '../platform/pathKey'
import type { FloatView, Geometry } from './protocol'
import { FLOAT_VIEWS } from './protocol'

// Which panels float as windows of their own and where, remembered per project so that a project
// comes back with the same arrangement. Only user-level convenience: a missing entry
// just means everything starts docked.

// Abschnitt [windows.floating] in designer.conf, ein Eintrag je Projekt.
const PATH = ['windows', 'floating'] as const

type Entry = Partial<Record<FloatView, Geometry | null>>
type Store = Record<string, Entry>

function norm(root: string): string {
  return pathKey(root)
}

// Ein schwebendes Panel ohne bekannte Lage steht als `true` in der Datei (leere Werte werden nie gespeichert).
function read(): Store {
  const parsed = configGet<unknown>(...PATH)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Store = {}
  for (const [project, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    out[project] = Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([view, g]) => [view, g === true ? null : g])) as Entry
  }
  return out
}

function write(store: Store): void {
  const plain = Object.fromEntries(Object.entries(store).map(([project, entry]) => [project, Object.fromEntries(Object.entries(entry).map(([view, g]) => [view, g ?? true]))]))
  configSet(PATH, plain)
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
