import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTreeMenu, COPY_BLOCKED_TYPES, type MenuEntry } from './contextMenu'
import type { TreeNode } from '../wire/types'

// Compares the object context menu with the popup layer of the original (designer_gui/popups.json).
const POPUPS = resolve(__dirname, '../../../../../../60_design/designer_gui/popups.json')
const haveSpec = existsSync(POPUPS)

interface LayerItem {
  kind?: string
  position?: number
  label_en?: string | null
  items?: LayerItem[]
}

const LAYER_LABEL: Record<string, string> = {
  Open: 'Open',
  OpenSourcesAction: 'Open Model Source',
  'Upgrade Model': 'Upgrade Model',
  DeploySingleAction: 'Deploy',
  'Find...': 'Find...',
  FindUsagesAction: 'Find Usages',
  Replace: 'Replace',
  Delete: 'Delete',
  'Rename...': 'Rename...',
  Tools: 'Tools',
  'Edit Properties': 'Edit Properties',
}

const object = (type: string, id = `C:/p/${type}/Person/Person.aod`): TreeNode => ({ id, label: 'Person', object_type: type, is_leaf: true, children: [], kind: 'object' })
const labelsOf = (items: MenuEntry[]) => items.filter((i) => !i.separator).map((i) => i.label.replace(/^Deploy ".*"$/, 'Deploy'))

describe.skipIf(!haveSpec)('object popup against popups.json', () => {
  const layer = (JSON.parse(readFileSync(POPUPS, 'utf8')).popups['de/adito/aod/action'].items as LayerItem[])
    .filter((i) => i.kind !== 'separator' && i.label_en != null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const expectedOrder = layer.map((i) => LAYER_LABEL[i.label_en as string]).filter(Boolean)

  it('keeps the relative order of the entries the layer lists', () => {
    const labels = labelsOf(buildTreeMenu(object('entity'), { clipboard: null, hasProject: true }))
    const present = labels.filter((l) => expectedOrder.includes(l))
    expect(present).toEqual(expectedOrder.filter((l) => labels.includes(l)))
    expect(present.length).toBeGreaterThanOrEqual(10)
  })

  it('puts the system entries between Deploy and Find as the layer positions say', () => {
    const labels = labelsOf(buildTreeMenu(object('system'), { clipboard: null, hasProject: true }))
    const at = (l: string) => labels.indexOf(l)
    expect(at('Set Default')).toBeGreaterThan(at('Upgrade Model'))
    expect(at('Set Default')).toBeLessThan(at('Deploy'))
    for (const l of ['Start Server', 'Clear Cache', 'Open Neon Client', 'Open Tunnels', 'Close Opened Tunnels']) {
      expect(at(l), l).toBeGreaterThan(at('Deploy'))
      expect(at(l), l).toBeLessThan(at('Find...'))
    }
    expect(at('Open Neon Client')).toBeLessThan(at('Open Tunnels'))
  })
})

describe('Copy enablement (behavior spec section 1)', () => {
  it('is blocked for context, preferences, application and language models', () => {
    expect(COPY_BLOCKED_TYPES).toEqual(expect.arrayContaining(['neonContext', 'preferences', 'application', 'language']))
    for (const type of COPY_BLOCKED_TYPES) {
      const copy = buildTreeMenu(object(type), { clipboard: null, hasProject: true }).find((i) => i.id === 'copy')!
      expect(copy.enabled, type).toBe(false)
      expect(copy.hint).toMatch(/cannot be copied/)
    }
    for (const type of ['entity', 'neonView', 'report', 'system']) {
      expect(buildTreeMenu(object(type), { clipboard: null, hasProject: true }).find((i) => i.id === 'copy')!.enabled, type).toBe(true)
    }
  })

  it('offers Paste only into the same type folder', () => {
    const ctx = { clipboard: { path: 'C:/p/entity/A/A.aod', folder: 'entity', name: 'A' }, hasProject: true }
    expect(buildTreeMenu(object('entity'), ctx).find((i) => i.id === 'paste')!.enabled).toBe(true)
    expect(buildTreeMenu(object('neonView', 'C:/p/neonView/V/V.aod'), ctx).find((i) => i.id === 'paste')!.enabled).toBe(false)
  })

  it('shows Upgrade Model dimmed with a reason and the project entries in the layer order', () => {
    const entity = buildTreeMenu(object('entity'), { clipboard: null, hasProject: true })
    expect(entity.find((i) => i.id === 'upgradeModel')).toMatchObject({ enabled: false, hint: expect.stringMatching(/pending upgrade/) })
    const project = buildTreeMenu({ id: 'project:C:/p', label: 'p', object_type: null, is_leaf: false, children: [], kind: 'project' }, { clipboard: null, hasProject: true })
    expect(labelsOf(project).slice(0, 4)).toEqual(['Upgrade All Models', 'Upgrade JDito', 'Partial Transpile', 'Full Transpile'])
  })
})
