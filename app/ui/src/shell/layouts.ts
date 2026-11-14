import { configGet, configSet } from '../settings/appConfig'
import { defaultLayout, sanitizeLayout, type LayoutState } from './layoutState'

export interface LayoutPreset {
  id: string
  label: string
  build: () => LayoutState
}

const STAMP = () => Date.now()

/** Fertige Anordnungen. Jede baut das Gitter neu auf (`reset`), die Größen kommen aus `layout.toml`. */
export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'default', label: 'Default', build: () => ({ ...defaultLayout(), reset: STAMP() }) },
  { id: 'compact', label: 'Compact', build: () => ({ ...defaultLayout(), scale: 0.7, reset: STAMP() }) },
  {
    id: 'editor-focus',
    label: 'Editor Focus',
    build: () => ({ panels: { projects: 'open', properties: 'closed', navigator: 'closed', output: 'closed' }, scale: 0.8, reset: STAMP() }),
  },
]

const PATH = ['layouts'] as const

function stored(): Record<string, unknown> {
  const all = configGet<unknown>(...PATH)
  return all && typeof all === 'object' ? (all as Record<string, unknown>) : {}
}

export function listSavedLayouts(): string[] {
  return Object.keys(stored()).sort((a, b) => a.localeCompare(b))
}

export function saveNamedLayout(name: string, layout: LayoutState): void {
  const { reset: _memoryOnly, ...plain } = layout
  configSet([...PATH, name], plain)
}

export function loadNamedLayout(name: string): LayoutState | undefined {
  const raw = stored()[name]
  return raw ? { ...sanitizeLayout(raw), reset: STAMP() } : undefined
}

export function deleteNamedLayout(name: string): void {
  configSet([...PATH, name], undefined)
}
