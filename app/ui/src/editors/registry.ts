import type { ComponentType } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { WireValue } from '../wire/types'

// The frontend half of architecture.md §6's extension point: "eine Komponente, die anhand des
// ausgewählten Objekttyps die passende Editor-View rendert (Registry-Pattern im Frontend, analog
// zu plugin-kernel's PluginRegistry im Backend)". A later P4 agent adding e.g. the view/context
// editor family calls `registerEditor("view", ViewEditor)` from its own module and imports that
// module once from `App.tsx` - this file itself never changes.

export interface EditorProps {
  nodeId: string
  projectRoot: string
  tree: WireValue
  api: ForgeApi
  onTreeChange: (tree: WireValue) => void
}

export type EditorComponent = ComponentType<EditorProps>

const registry = new Map<string, EditorComponent>()

export function registerEditor(objectType: string, component: EditorComponent): void {
  registry.set(objectType, component)
}

export function getEditorFor(objectType: string | null): EditorComponent | undefined {
  if (!objectType) return undefined
  return registry.get(objectType)
}

/** Test-only escape hatch - production code never needs to clear the registry. */
export function _resetRegistryForTests(): void {
  registry.clear()
}
