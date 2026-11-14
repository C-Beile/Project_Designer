import type { AreaConfig, AreaName, PanelConfig } from '../../config/layoutConfig'

/** Wo ein Panel im Docking-Gitter landet. `reference` = Id des Panels, an dem es hängt; ohne Angabe am Fensterrand. */
export interface Placement {
  id: string
  direction: 'left' | 'right' | 'above' | 'below' | 'within'
  reference?: string
  width?: number
  height?: number
}

export interface PlanInput {
  panels: PanelConfig[]
  areas: Partial<Record<AreaName, AreaConfig>>
  /** Panel-Id des Editors in der Mitte. */
  centerId: string
  windowWidth: number
  windowHeight: number
  /** Schriftgröße / 12: Config-Pixel gelten bei Standardgröße. */
  uiFactor: number
}

const EDGE_ORDER: AreaName[] = ['right', 'top', 'bottom', 'left']
const CORNER_OF: Partial<Record<AreaName, { edge: AreaName; direction: 'above' | 'below' }>> = {
  'top-left': { edge: 'left', direction: 'above' },
  'bottom-left': { edge: 'left', direction: 'below' },
  'top-right': { edge: 'right', direction: 'above' },
  'bottom-right': { edge: 'right', direction: 'below' },
}

function sizeOf(area: AreaConfig | undefined, panel: PanelConfig, axis: 'width' | 'height', total: number, factor: number): number | undefined {
  const own = panel[axis] || area?.[axis]
  if (!own) return undefined
  const min = (axis === 'width' ? area?.minWidth : area?.minHeight) ?? 0
  const maxPercent = (axis === 'width' ? area?.maxWidthPercent : area?.maxHeightPercent) ?? 100
  return Math.round(Math.min((total * maxPercent) / 100, Math.max(min * factor, own * factor)))
}

/**
 * Reihenfolge und Lage der Panels beim Start. Mitte zuerst, dann rechts, oben, unten, links:
 * der linke Rand läuft so über die volle Höhe, Unten über den Rest der Breite (wie im ADITO Designer).
 * Gleiche `group` = Tabs. Mehrere Gruppen am selben Rand stapeln sich untereinander bzw. nebeneinander.
 */
export function planDock(input: PlanInput): Placement[] {
  const { panels, areas, centerId, windowWidth, windowHeight, uiFactor } = input
  const plan: Placement[] = []
  const groupLead = new Map<string, string>()
  const areaLead = new Map<AreaName, string>()

  function place(panel: PanelConfig, direction: Placement['direction'], reference?: string) {
    const area = areas[panel.area]
    plan.push({ id: panel.id, direction, reference, width: sizeOf(area, panel, 'width', windowWidth, uiFactor), height: sizeOf(area, panel, 'height', windowHeight, uiFactor) })
    groupLead.set(panel.group, panel.id)
    if (!areaLead.has(panel.area)) areaLead.set(panel.area, panel.id)
  }

  const edgeDirection: Partial<Record<AreaName, Placement['direction']>> = { left: 'left', right: 'right', top: 'above', bottom: 'below' }
  const stackDirection = (area: AreaName): Placement['direction'] => (area === 'top' || area === 'bottom' ? 'right' : 'below')

  for (const area of EDGE_ORDER) {
    for (const panel of panels.filter((p) => p.area === area && p.opens === 'startup')) {
      const sameGroup = groupLead.get(panel.group)
      if (sameGroup) place(panel, 'within', sameGroup)
      else if (areaLead.has(area)) place(panel, stackDirection(area), areaLead.get(area))
      else if (area === 'right' || area === 'top') place(panel, edgeDirection[area]!, centerId)
      else place(panel, edgeDirection[area]!)
    }
  }
  for (const panel of panels.filter((p) => p.area in CORNER_OF && p.opens === 'startup')) {
    const sameGroup = groupLead.get(panel.group)
    const corner = CORNER_OF[panel.area]!
    if (sameGroup) place(panel, 'within', sameGroup)
    else if (areaLead.has(corner.edge)) place(panel, corner.direction, areaLead.get(corner.edge))
    else place(panel, corner.edge === 'left' ? 'left' : 'right', centerId)
  }
  for (const panel of panels.filter((p) => p.area === 'center' && p.opens === 'startup')) place(panel, 'within', centerId)
  return plan
}
