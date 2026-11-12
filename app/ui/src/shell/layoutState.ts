import { configGet, configSet } from '../settings/appConfig'
// Docking layout of the main window (LAYOUT_SPEC §3): which tool windows are open, minimized or
// closed, and how large they are. Survives restarts like the original Designer's window layout,
// but a damaged or foreign stored value must never keep the app from opening - it then simply
// starts from the default layout.

export type PanelId = 'projects' | 'properties' | 'navigator' | 'output'
export type PanelMode = 'open' | 'minimized' | 'closed'

export interface LayoutState {
  leftWidth: number
  rightWidth: number
  bottomHeight: number
  // Share of the left column taken by Projects/Services; the rest belongs to Properties.
  leftSplit: number
  panels: Record<PanelId, PanelMode>
}

export const PANEL_IDS: PanelId[] = ['projects', 'properties', 'navigator', 'output']

export const PANEL_TITLES: Record<PanelId, string> = {
  projects: 'Projects',
  properties: 'Properties',
  navigator: 'Navigator',
  output: 'Output',
}

export const LAYOUT_PATH = ['layout', 'main'] as const

export const LIMITS = {
  leftWidth: [160, 900],
  rightWidth: [120, 700],
  bottomHeight: [80, 800],
  leftSplit: [0.15, 0.85],
} as const

export function defaultLayout(): LayoutState {
  return {
    leftWidth: 340,
    rightWidth: 260,
    bottomHeight: 240,
    leftSplit: 0.62,
    panels: { projects: 'open', properties: 'open', navigator: 'open', output: 'open' },
  }
}

export function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value))
}

function isMode(v: unknown): v is PanelMode {
  return v === 'open' || v === 'minimized' || v === 'closed'
}

function num(v: unknown, fallback: number, limits: readonly [number, number]): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, limits) : fallback
}

/** Accepts only well-formed values; anything unknown falls back field by field to the default. */
export function sanitizeLayout(raw: unknown): LayoutState {
  const d = defaultLayout()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const panelsRaw = (r.panels && typeof r.panels === 'object' ? r.panels : {}) as Record<string, unknown>
  const panels = { ...d.panels }
  for (const id of PANEL_IDS) if (isMode(panelsRaw[id])) panels[id] = panelsRaw[id]
  return {
    leftWidth: num(r.leftWidth, d.leftWidth, LIMITS.leftWidth),
    rightWidth: num(r.rightWidth, d.rightWidth, LIMITS.rightWidth),
    bottomHeight: num(r.bottomHeight, d.bottomHeight, LIMITS.bottomHeight),
    leftSplit: num(r.leftSplit, d.leftSplit, LIMITS.leftSplit),
    panels,
  }
}

export function loadLayout(): LayoutState {
  const stored = configGet<unknown>(...LAYOUT_PATH)
  return stored ? sanitizeLayout(stored) : defaultLayout()
}

export function saveLayout(layout: LayoutState): void {
  configSet(LAYOUT_PATH, layout)
}
