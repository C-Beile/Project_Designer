import type { ComponentType } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { WireValue } from '../wire/types'

// Das Frontend-Gegenstück zum Erweiterungspunkt aus architecture.md §6: "eine Komponente, die anhand des
// ausgewählten Objekttyps die passende Editor-View rendert" (Registry-Pattern, analog zur Registry im
// Backend, `plugin-api`). Ein neuer Editor ruft `registerEditor("view", ViewEditor)` aus seinem eigenen
// Modul auf und importiert es einmal in `App.tsx`. Diese Datei ändert sich dabei nicht.

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
