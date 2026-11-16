import { parse } from 'smol-toml'
import layoutText from '../../../config/layout.toml?raw'
import { checkSection, ConfigError, type Schema } from './configSchema'

export const AREAS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const
export type AreaName = (typeof AREAS)[number]

const FILE = 'layout.toml'
const PANEL_ID = /^[a-z][a-z0-9-]*$/

const behaviorSchema: Schema = { reopen: { type: 'enum', values: ['last-position', 'default'] } }

const areaSchema: Schema = {
  width: { type: 'int', min: 0, max: 1200 },
  'min-width': { type: 'int', min: 0, max: 600 },
  'max-width-percent': { type: 'int', min: 10, max: 100 },
  height: { type: 'int', min: 0, max: 1200 },
  'min-height': { type: 'int', min: 0, max: 600 },
  'max-height-percent': { type: 'int', min: 10, max: 100 },
}

const panelSchema: Schema = {
  title: { type: 'string' },
  area: { type: 'enum', values: AREAS },
  group: { type: 'string', pattern: /^[a-z][a-z0-9-]*$/, hint: 'kleingeschriebene Gruppen-Id' },
  opens: { type: 'enum', values: ['startup', 'on-demand'] },
  closable: { type: 'bool' },
  width: { type: 'int', min: 0, max: 1200, optional: true },
  height: { type: 'int', min: 0, max: 1200, optional: true },
}

export interface AreaConfig {
  width: number
  minWidth: number
  maxWidthPercent: number
  height: number
  minHeight: number
  maxHeightPercent: number
}

export interface PanelConfig {
  id: string
  title: string
  area: AreaName
  group: string
  opens: 'startup' | 'on-demand'
  closable: boolean
  width?: number
  height?: number
}

export interface LayoutConfig {
  reopen: 'last-position' | 'default'
  areas: Partial<Record<AreaName, AreaConfig>>
  panels: PanelConfig[]
}

export function parseLayoutConfig(text: string): LayoutConfig {
  const doc = parse(text) as Record<string, unknown>
  for (const key of Object.keys(doc)) if (!['behavior', 'area', 'panel'].includes(key)) throw new ConfigError(FILE, key, 'ist unbekannt. Erlaubt: behavior, area, panel')

  const behavior = checkSection(FILE, 'behavior', doc.behavior, behaviorSchema)
  const areas: LayoutConfig['areas'] = {}
  for (const [name, raw] of Object.entries((doc.area ?? {}) as Record<string, unknown>)) {
    if (!(AREAS as readonly string[]).includes(name)) throw new ConfigError(FILE, `area.${name}`, `ist kein Bereich. Erlaubt: ${AREAS.join(' | ')}`)
    const a = checkSection(FILE, `area.${name}`, raw, areaSchema) as Record<string, number>
    areas[name as AreaName] = {
      width: a.width,
      minWidth: a['min-width'],
      maxWidthPercent: a['max-width-percent'],
      height: a.height,
      minHeight: a['min-height'],
      maxHeightPercent: a['max-height-percent'],
    }
  }

  const rawPanels = doc.panel
  if (!rawPanels || typeof rawPanels !== 'object' || Array.isArray(rawPanels) || Object.keys(rawPanels).length === 0) throw new ConfigError(FILE, 'panel', 'braucht mindestens einen Abschnitt [panel.<id>]')
  const panels = Object.entries(rawPanels as Record<string, unknown>).map(([id, raw]) => {
    if (!PANEL_ID.test(id)) throw new ConfigError(FILE, `panel.${id}`, 'ist keine gültige Panel-Id (kleingeschrieben, Ziffern und -)')
    const p = checkSection(FILE, `panel.${id}`, raw, panelSchema)
    return { id, title: p.title, area: p.area, group: p.group, opens: p.opens, closable: p.closable, width: p.width, height: p.height } as PanelConfig
  })

  return { reopen: behavior.reopen as LayoutConfig['reopen'], areas, panels }
}

export const layoutConfig: LayoutConfig = parseLayoutConfig(layoutText)
