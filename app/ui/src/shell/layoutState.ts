import { configGet, configSet } from '../settings/appConfig'
import { layoutConfig } from '../config/layoutConfig'
// Layout des Hauptfensters: welche Tool-Fenster offen oder zu sind und die Anordnung des Docking-Gitters
// (`dock`, von dockview). Es überlebt Neustarts, aber ein beschädigter oder fremder gespeicherter Wert
// darf die App nie am Öffnen hindern: dann gilt die Standard-Anordnung aus `app/config/layout.toml`.

export type PanelId = 'projects' | 'properties' | 'navigator' | 'output'
export type PanelMode = 'open' | 'closed'

export interface LayoutState {
  panels: Record<PanelId, PanelMode>
  /** Serialisiertes dockview-Gitter; leer = Standard-Anordnung. */
  dock?: unknown
  /** Größenfaktor der Standard-Anordnung (Voreinstellung "Compact"); 1 = wie in layout.toml. */
  scale?: number
  /** Wird nur im Speicher gesetzt: ein neuer Wert baut das Gitter neu (Reset, Voreinstellung, gespeichertes Layout laden). */
  reset?: number
}

export const PANEL_IDS: PanelId[] = ['projects', 'properties', 'navigator', 'output']

export const PANEL_TITLES: Record<PanelId, string> = {
  projects: 'Projects',
  properties: 'Properties',
  navigator: 'Navigator',
  output: 'Output',
}

export const LAYOUT_PATH = ['layout', 'main'] as const

export function defaultLayout(): LayoutState {
  const opens = (id: PanelId): PanelMode => (layoutConfig.panels.find((p) => p.id === id)?.opens === 'on-demand' ? 'closed' : 'open')
  return { panels: { projects: opens('projects'), properties: opens('properties'), navigator: opens('navigator'), output: opens('output') } }
}

/** Nur wohlgeformte Werte; alles Unbekannte fällt Feld für Feld auf den Standard zurück. Der alte Modus "minimized" gilt als zu. */
export function sanitizeLayout(raw: unknown): LayoutState {
  const d = defaultLayout()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const panelsRaw = (r.panels && typeof r.panels === 'object' ? r.panels : {}) as Record<string, unknown>
  const panels = { ...d.panels }
  for (const id of PANEL_IDS) {
    if (panelsRaw[id] === 'open') panels[id] = 'open'
    else if (panelsRaw[id] === 'closed' || panelsRaw[id] === 'minimized') panels[id] = 'closed'
  }
  // Panels von Plugins (core/contrib/panels.ts) haben eigene Ids; ihr Zustand bleibt erhalten.
  for (const [id, mode] of Object.entries(panelsRaw)) {
    if (!PANEL_IDS.includes(id as PanelId) && (mode === 'open' || mode === 'closed')) (panels as Record<string, PanelMode>)[id] = mode
  }
  const scale = typeof r.scale === 'number' && r.scale >= 0.5 && r.scale <= 1.5 ? r.scale : undefined
  return { panels, dock: r.dock && typeof r.dock === 'object' ? r.dock : undefined, scale }
}

export function loadLayout(): LayoutState {
  const stored = configGet<unknown>(...LAYOUT_PATH)
  return stored ? sanitizeLayout(stored) : defaultLayout()
}

export function saveLayout(layout: LayoutState): void {
  const { reset: _memoryOnly, ...stored } = layout
  configSet(LAYOUT_PATH, stored)
}
