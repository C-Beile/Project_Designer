import type { ComponentType } from 'react'
import type { AreaName } from '../../config/layoutConfig'
import { item } from '../../shell/menuModel'
import { registerCommand, registerMenuContribution } from '../plugins/registry'
import { createStore } from '../store'

export interface PanelSpec {
  id: string
  title: string
  /** Bereich im 9-Slice-Gitter, wie `area` in `layout.toml`. */
  area: AreaName
  /** Gleiche Gruppe = Reiter im selben Stapel. */
  group: string
  opens: 'startup' | 'on-demand'
  /** Panel gehört einem Plugin: es fehlt, wenn das Plugin nicht angemeldet ist. */
  plugin?: string
  component: ComponentType
}

const panels = createStore<PanelSpec[]>([])
/** Bitte an die Docking-Fläche, ein Panel zu öffnen oder zu schließen (Menüpunkt Window > Titel). */
const requests = createStore<{ id: string; stamp: number } | null>(null)

/**
 * Neues Panel eines Plugins = ein Aufruf. Es erscheint im Docking-Gitter, lässt sich verschieben wie die eingebauten
 * und bekommt einen Menüpunkt im Menü Window. Die Abmelde-Funktion entfernt beides.
 */
export function registerPanel(spec: PanelSpec): () => void {
  const command = `window.panel.${spec.id}`
  panels.update((list) => [...list.filter((p) => p.id !== spec.id), spec])
  const offs = [
    registerCommand(command, () => requests.set({ id: spec.id, stamp: Date.now() }), spec.plugin),
    registerMenuContribution({ menu: 'window', order: 500, plugin: spec.plugin, items: [item(command, spec.title, true)] }),
  ]
  return () => {
    panels.update((list) => list.filter((p) => p !== spec))
    offs.forEach((off) => off())
  }
}

export function usePanels(): PanelSpec[] {
  return panels.use()
}

export function getPanels(): PanelSpec[] {
  return panels.get()
}

export function getPanel(id: string): PanelSpec | undefined {
  return panels.get().find((p) => p.id === id)
}

export const panelRequests = requests

export function _resetPanelsForTests(): void {
  panels.set([])
  requests.set(null)
}
