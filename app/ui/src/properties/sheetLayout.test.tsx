import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PropertySheetPanel } from './PropertySheetPanel'
import { categoryTitle, layoutSheet, modelKeyFor, tabTitle } from './sheetLayout'
import { SHEET_CATEGORIES, SHEET_MODELS, SHEET_TABS } from './sheetModel.generated'
import { createMockForgeApi } from '../test/mockApi'
import type { PropertySheet, SheetRow } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const SPEC = resolve(__dirname, '../../../../../../60_design/designer_gui/sheet_model.json')

const row = (name: string, extra: Partial<SheetRow> = {}): SheetRow => ({ name, kind: 'text', display: '', set: false, editable: true, typed: false, ...extra })

function entitySheet(over: Partial<PropertySheet> = {}): PropertySheet {
  return {
    name: 'Person_entity',
    type_label: 'entity',
    path: '$',
    catalog_missing: false,
    groups: [
      { key: 'GENERAL', label: '', rows: [row('title', { display: 'Person', set: true }), row('description'), row('comment')] },
      { key: 'PROCESSES', label: 'Processes', rows: [row('onInit', { kind: 'linked' }), row('afterSave', { kind: 'linked' })] },
      { key: 'GRANT', label: 'Grant', rows: [row('grantCreate')] },
    ],
    ...over,
  }
}

describe.skipIf(!existsSync(SPEC))('generated sheet model against sheet_model.json', () => {
  const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as Record<string, { model_type_id: number; properties: { name: string; sheetTab?: string; sheetTabCategory?: string; position: string }[] }>

  it('covers all 210 model types and 2169 properties', () => {
    expect(Object.keys(SHEET_MODELS)).toHaveLength(Object.keys(spec).length)
    expect(Object.keys(SHEET_MODELS)).toHaveLength(210)
    expect(Object.values(SHEET_MODELS).reduce((n, m) => n + m.props.length, 0)).toBe(2169)
  })

  it('keeps tab, category and position of every property', () => {
    for (const [model, entry] of Object.entries(spec)) {
      const generated = SHEET_MODELS[model]
      expect(generated.id).toBe(entry.model_type_id)
      entry.properties.forEach((p, i) => {
        expect(generated.props[i].slice(0, 4), `${model}.${p.name}`).toEqual([p.name, p.sheetTab ?? 'PROPERTIES', p.sheetTabCategory ?? 'GENERAL', Number.parseInt(p.position, 10) || 0])
      })
    }
  })

  it('knows a title for every tab and category that occurs', () => {
    const tabs = new Set(SHEET_TABS.map((t) => t[0]))
    const cats = new Set(SHEET_CATEGORIES.map((c) => c[0]))
    for (const m of Object.values(SHEET_MODELS)) {
      for (const p of m.props) {
        expect(tabs.has(p[1]), p[1]).toBe(true)
        expect(cats.has(p[2]), p[2]).toBe(true)
      }
    }
  })
})

describe('titles', () => {
  it('uses the English and German titles of tabs and categories', () => {
    expect(tabTitle('PROPERTIES')).toBe('Properties')
    expect(tabTitle('PROPERTIES', 'de')).toBe('Eigenschaften')
    expect(tabTitle('NOTIFICATIONCENTER', 'de')).toBe('Benachrichtigungen')
    expect(categoryTitle('GENERAL')).toBe('General')
    expect(categoryTitle('GENERAL', 'de')).toBe('Allgemein')
    expect(categoryTitle('POSITION_SIZE', 'de')).toBe('Position / Größe')
    expect(categoryTitle('INDEXSEARCH_AUTO_COMMIT')).toBe('Indexsearch Auto Commit')
  })

  it('maps element types to their data model', () => {
    expect(modelKeyFor('entity')).toBe('EntityDataModel')
    expect(modelKeyFor('neonView')).toBe('NeonViewDataModel')
    expect(modelKeyFor('dbRecordFieldMappingType')).toBe('DBRecordFieldMappingDataModel')
    expect(modelKeyFor('somethingUnknown')).toBeNull()
  })
})

describe('layoutSheet', () => {
  it('orders the categories and rows of an entity and titles the categories', () => {
    const layout = layoutSheet(entitySheet())
    expect(layout.modelKey).toBe('EntityDataModel')
    expect(layout.tabs.map((t) => t.id)).toEqual(['PROPERTIES'])
    const groups = layout.tabs[0].groups
    expect(groups.map((g) => g.key)).toEqual(['GENERAL', 'PROCESSES', 'GRANT'])
    expect(groups.map((g) => g.label)).toEqual(['General', 'Processes', 'Grant'])
    expect(groups[0].rows.map((r) => r.name)).toEqual(['title', 'description', 'comment'])
    expect(groups[1].rows.map((r) => r.name)).toEqual(['onInit', 'afterSave'])
  })

  it('takes tab and category from the model, not from the backend group', () => {
    const sheet = entitySheet({ groups: [{ key: 'GENERAL', label: '', rows: [row('afterSave'), row('title'), row('grantUpdate')] }] })
    const groups = layoutSheet(sheet).tabs[0].groups
    expect(groups.map((g) => g.key)).toEqual(expect.arrayContaining(['GENERAL', 'PROCESSES', 'GRANT']))
    expect(groups.find((g) => g.key === 'PROCESSES')!.rows.map((r) => r.name)).toEqual(['afterSave'])
  })

  it('splits preferences into tabs in enum order', () => {
    const names = [...new Set(SHEET_MODELS.PreferencesDataModel.props.map((p) => p[0]))]
    const sheet: PropertySheet = { name: 'prefs', type_label: 'preferences', path: '$', catalog_missing: false, groups: [{ key: 'GENERAL', label: '', rows: names.map((n) => row(n)) }] }
    const layout = layoutSheet(sheet)
    expect(layout.modelKey).toBe('PreferencesDataModel')
    const ids = layout.tabs.map((t) => t.id)
    const order = SHEET_TABS.map((t) => t[0])
    expect(ids.length).toBeGreaterThan(3)
    expect([...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(ids)
  })

  it('leaves types missing from the model untouched', () => {
    const sheet: PropertySheet = { name: 'x', type_label: 'somethingUnknown', path: '$', catalog_missing: false, groups: [{ key: 'A', label: 'A', rows: [row('p')] }] }
    const layout = layoutSheet(sheet)
    expect(layout.modelKey).toBeNull()
    expect(layout.tabs).toHaveLength(1)
    expect(layout.tabs[0].groups).toBe(sheet.groups)
  })

  it('lists the remaining properties as unset read-only rows when the catalog is missing', () => {
    const sheet = entitySheet({ catalog_missing: true, groups: [{ key: 'GENERAL', label: '', rows: [row('title', { display: 'Person', set: true })] }] })
    const layout = layoutSheet(sheet, 'en', { 'INeonPropertyTitlePluralDataModel.titlePlural': 'Plural title' })
    const rows = layout.tabs.flatMap((t) => t.groups).flatMap((g) => g.rows)
    expect(rows.find((r) => r.name === 'titlePlural')).toMatchObject({ set: false, editable: false, description: 'Plural title' })
    expect(rows.find((r) => r.name === 'title')!.editable).toBe(true)
    expect(rows.length).toBeGreaterThan(30)
  })

  it('fills missing descriptions from the specification texts but keeps the backend text', () => {
    const sheet = entitySheet({ groups: [{ key: 'GENERAL', label: '', rows: [row('titlePlural'), row('title', { description: 'Own text' })] }] })
    const rows = layoutSheet(sheet, 'en', { 'INeonPropertyTitlePluralDataModel.titlePlural': 'Spec text', 'EntityDataModel.title': 'Other' }).tabs[0].groups[0].rows
    expect(rows.find((r) => r.name === 'titlePlural')!.description).toBe('Spec text')
    expect(rows.find((r) => r.name === 'title')!.description).toBe('Own text')
  })
})

describe('PropertySheetPanel with tabs', () => {
  it('shows a tab strip for preferences and switches the visible categories', async () => {
    const user = userEvent.setup()
    const nodeId = 'C:/p/preferences/_____PREFERENCES_PROJECT/_____PREFERENCES_PROJECT.aod'
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const byTab = new Map<string, string>()
    for (const p of SHEET_MODELS.PreferencesDataModel.props) if (!byTab.has(p[1])) byTab.set(p[1], p[0])
    const names = [...byTab.values()]
    api.getPropertySheet = async () => ({ name: 'prefs', type_label: 'preferences', path: '$', catalog_missing: false, groups: [{ key: 'GENERAL', label: '', rows: names.map((n) => row(n)) }] })
    render(<PropertySheetPanel api={api} target={{ nodeId, path: '$' }} linkedRoot="C:/p" version={0} referenceOptions={() => []} onGoTo={() => {}} onEdited={() => {}} onStatus={() => {}} />)
    const tablist = await screen.findByRole('tablist', { name: 'Property tabs' })
    expect(tablist.querySelectorAll('[role="tab"]').length).toBe(byTab.size)
    const second = tablist.querySelectorAll<HTMLElement>('[role="tab"]')[1]
    await user.click(second)
    await waitFor(() => expect(second).toHaveAttribute('aria-selected', 'true'))
    const secondTab = [...byTab.keys()].sort((x, y) => SHEET_TABS.findIndex((t) => t[0] === x) - SHEET_TABS.findIndex((t) => t[0] === y))[1]
    expect(screen.getByLabelText(byTab.get(secondTab)!)).toBeInTheDocument()
  })

  it('shows no tab strip for an entity with one tab but titles its categories', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    api.getPropertySheet = async () => entitySheet()
    render(<PropertySheetPanel api={api} target={{ nodeId: 'C:/p/entity/Person_entity/Person_entity.aod', path: '$' }} linkedRoot="C:/p" version={0} referenceOptions={() => []} onGoTo={() => {}} onEdited={() => {}} onStatus={() => {}} />)
    expect(await screen.findByText('Processes')).toBeInTheDocument()
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})
