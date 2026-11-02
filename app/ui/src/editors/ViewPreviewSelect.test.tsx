import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewCanvasEditor } from './ViewCanvasEditor'
import { ProjectIndexContext, type ProjectIndex } from './projectIndex'
import type { TreeNode, WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'
import { DialogHost } from '../shell/dialogService'

const text = (value: string): WireValue => ({ kind: 'text', value })
const obj = (...fields: [string, WireValue][]): WireValue => ({ kind: 'object', fields: fields.map(([key, value]) => ({ key, value })) })
const arr = (...items: WireValue[]): WireValue => ({ kind: 'array', items })

const ID = 'C:/p/neonView/Main_view/Main_view.aod'
const DETAIL_ID = 'C:/p/neonView/Detail_view/Detail_view.aod'

const SOURCE = `<neonView>
  <name>Main_view</name>
  <children>
    <neonViewReference>
      <name>uuid-1</name>
      <entityField>#ENTITY</entityField>
      <view>Detail_view</view>
    </neonViewReference>
    <genericViewTemplate>
      <name>Info</name>
      <fields>
        <entityFieldLink>
          <entityField>NAME</entityField>
        </entityFieldLink>
        <entityFieldLink>
          <entityField>CITY</entityField>
        </entityFieldLink>
      </fields>
    </genericViewTemplate>
    <titledListViewTemplate>
      <name>Links</name>
      <titleField>NAME</titleField>
    </titledListViewTemplate>
  </children>
</neonView>
`

// The property tree groups the children by kind: references first, then the templates.
const main = obj(
  ['name', text('Main_view')],
  [
    'children',
    obj(
      ['neonViewReference', obj(['name', text('uuid-1')], ['entityField', text('#ENTITY')], ['view', text('Detail_view')])],
      ['genericViewTemplate', obj(['name', text('Info')], ['fields', obj(['entityFieldLink', arr(obj(['entityField', text('NAME')]), obj(['entityField', text('CITY')]))])])],
      ['titledListViewTemplate', obj(['name', text('Links')], ['titleField', text('NAME')])],
    ),
  ],
)
const detail = obj(['name', text('Detail_view')], ['children', obj(['genericViewTemplate', obj(['name', text('Inner')], ['fields', obj(['entityFieldLink', obj(['entityField', text('INNERFIELD')])])])])])

const detailNode: TreeNode = { id: DETAIL_ID, label: 'Detail_view', object_type: 'neonView', is_leaf: true, children: [] }

function setup(readOnly = false) {
  const id = readOnly ? 'C:/p/node_modules/@a/m/neonView/Main_view/Main_view.aod' : ID
  const api = createMockForgeApi({ projectTree: [], documents: { [id]: main, [DETAIL_ID]: detail }, sources: { [id]: SOURCE } })
  const selectElement = vi.fn()
  const openObject = vi.fn()
  const removeElement = vi.fn()
  const onTreeChange = vi.fn()
  const index: ProjectIndex = {
    findObject: (type, name) => (type === 'neonView' && name === 'Detail_view' ? detailNode : null),
    openObject,
    selectElement,
    removeElement,
    selection: null,
  }
  const view = render(
    <ProjectIndexContext.Provider value={index}>
      <ViewCanvasEditor nodeId={id} projectRoot="C:/p" tree={main} api={api} onTreeChange={onTreeChange} />
      <DialogHost />
    </ProjectIndexContext.Provider>,
  )
  return { api, id, selectElement, openObject, removeElement, onTreeChange, view, index }
}

describe('View preview: click, double click, menu and drag', () => {
  it('a click on the frame of an embedded view selects its neonViewReference', async () => {
    const user = userEvent.setup()
    const { selectElement, id } = setup()
    await user.click(await screen.findByText('Detail_view', { selector: 'legend' }))
    expect(selectElement).toHaveBeenCalledWith(id, 'children.neonViewReference', 'Detail_view')
  })

  it('a click inside an embedded view selects the frame, not the element of the other view', async () => {
    const user = userEvent.setup()
    const { selectElement, id } = setup()
    await screen.findByText('Detail_view', { selector: 'legend' })
    await user.click(await screen.findByText('Innerfield'))
    expect(selectElement).toHaveBeenLastCalledWith(id, 'children.neonViewReference', 'Detail_view')
  })

  it('a click on a field or a component selects that element', async () => {
    const user = userEvent.setup()
    const { selectElement, id } = setup()
    await user.click(await screen.findByText('City'))
    expect(selectElement).toHaveBeenLastCalledWith(id, 'children.genericViewTemplate.fields.entityFieldLink[1]', 'CITY')
    await user.click(await screen.findByText('Titled list (Links)'))
    expect(selectElement).toHaveBeenLastCalledWith(id, 'children.titledListViewTemplate', 'Links')
  })

  it('a double click on the frame opens the referenced view', async () => {
    const user = userEvent.setup()
    const { openObject } = setup()
    await user.dblClick(await screen.findByText('Detail_view', { selector: 'legend' }))
    expect(openObject).toHaveBeenCalledWith(detailNode)
  })

  it('shows the elements in the order of the file and marks the selected one', async () => {
    const { index } = setup()
    const all = await screen.findAllByText(/Titled list|Info|Detail_view/)
    expect(all.length).toBeGreaterThan(0)
    expect(index.selection).toBeNull()
  })

  it('the right-click menu opens, offers Properties and Remove, and Add is available', async () => {
    const user = userEvent.setup()
    const { selectElement, removeElement, id } = setup()
    const legend = await screen.findByText('Detail_view', { selector: 'legend' })
    await user.pointer({ keys: '[MouseRight]', target: legend })
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('menuitem', { name: 'Add...' })).toHaveAttribute('aria-disabled', 'false')
    await user.click(screen.getByRole('menuitem', { name: 'Properties' }))
    expect(selectElement).toHaveBeenLastCalledWith(id, 'children.neonViewReference', 'Detail_view')
    await user.pointer({ keys: '[MouseRight]', target: legend })
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(removeElement).toHaveBeenCalledWith(id, 'children.neonViewReference', 'Detail_view')
  })

  it('dragging a block in front of another changes only the order in the file', async () => {
    const { api, id, onTreeChange } = setup()
    await screen.findByText('Titled list (Links)')
    const list = screen.getByText('Titled list (Links)').closest('.vp-block')!
    const info = screen.getByText('Generic (Info)').closest('.vp-block')!
    const store: Record<string, string> = {}
    const dataTransfer = { setData: (k: string, v: string) => (store[k] = v), getData: (k: string) => store[k] ?? '', effectAllowed: '' }
    fireEvent.dragStart(list, { dataTransfer })
    fireEvent.drop(info, { dataTransfer })
    await waitFor(() => expect(onTreeChange).toHaveBeenCalled())
    const next = (await api.getObjectSource(id)).text
    expect(next.indexOf('<name>Links</name>')).toBeLessThan(next.indexOf('<name>Info</name>'))
    expect(next.indexOf('<name>uuid-1</name>')).toBeLessThan(next.indexOf('<name>Links</name>'))
  })

  it('module objects cannot be reordered, Move is dimmed', async () => {
    const user = userEvent.setup()
    setup(true)
    const block = (await screen.findByText('Titled list (Links)')).closest('[data-path]')!
    expect(block).not.toHaveAttribute('draggable')
    await user.pointer({ keys: '[MouseRight]', target: block as Element })
    expect(screen.getByRole('menuitem', { name: 'Move Up' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('templates after the ADITO reference', () => {
  it('TitledList shows the title on the left and the "+ X more" link', async () => {
    setup()
    expect(await screen.findByText('+ X more')).toBeInTheDocument()
  })
})


describe('inserting into the view', () => {
  const ENTITY_ID = 'C:/p/entity/Person_entity/Person_entity.aod'
  const entityNode: TreeNode = { id: ENTITY_ID, label: 'Person_entity', object_type: 'entity', is_leaf: true, children: [] }
  const entity = obj(
    ['name', text('Person_entity')],
    ['entityFields', obj(['entityField', arr(obj(['name', text('NAME')], ['title', text('Name')]), obj(['name', text('CITY')], ['title', text('City')]), obj(['name', text('PHONE')], ['title', text('Phone')], ['contentType', text('TELEPHONE')])) ])],
  )

  function setupWithEntity(readOnly = false) {
    const id = readOnly ? 'C:/p/node_modules/@a/m/neonView/Main_view/Main_view.aod' : ID
    const api = createMockForgeApi({ projectTree: [], documents: { [id]: main, [DETAIL_ID]: detail, [ENTITY_ID]: entity }, sources: { [id]: SOURCE } })
    const index: ProjectIndex = {
      findObject: (type, name) => (type === 'neonView' && name === 'Detail_view' ? detailNode : null),
      openObject: () => {},
      selectElement: () => {},
      removeElement: () => {},
      selection: null,
      entityOfView: () => entityNode,
      namesOf: (type) => (type === 'neonView' ? ['Main_view', 'Detail_view', 'Other_view'] : []),
    }
    const onTreeChange = vi.fn()
    render(
      <ProjectIndexContext.Provider value={index}>
        <ViewCanvasEditor nodeId={id} projectRoot="C:/p" tree={main} api={api} onTreeChange={onTreeChange} />
        <DialogHost />
      </ProjectIndexContext.Provider>,
    )
    return { api, id, onTreeChange }
  }

  const transfer = () => {
    const store: Record<string, string> = {}
    return { setData: (k: string, v: string) => (store[k] = v), getData: (k: string) => store[k] ?? '', effectAllowed: '', dropEffect: '', types: [] as string[], store }
  }

  it('lists the entity fields at the left and drops one into a Generic template in front of the field it was dropped on', async () => {
    const { api, id } = setupWithEntity()
    const item = await screen.findByText('Phone')
    const dt = transfer()
    fireEvent.dragStart(item.closest('.vp-entity-item')!, { dataTransfer: dt })
    dt.types = Object.keys(dt.store)
    const city = (await screen.findAllByText('City')).find((e) => e.closest('.vp-field'))!
    fireEvent.drop(city.closest('.vp-field')!, { dataTransfer: dt })
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<entityField>PHONE</entityField>'))
    const next = (await api.getObjectSource(id)).text
    expect(next.indexOf('<entityField>PHONE</entityField>')).toBeLessThan(next.indexOf('<entityField>CITY</entityField>'))
    expect(next.indexOf('<entityField>PHONE</entityField>')).toBeGreaterThan(next.indexOf('<entityField>NAME</entityField>'))
  })

  it('refuses to drop a field that is already in the template and says why', async () => {
    setupWithEntity()
    const item = await screen.findByText('Name', { selector: '.vp-entity-item span' })
    const dt = transfer()
    fireEvent.dragStart(item.closest('.vp-entity-item')!, { dataTransfer: dt })
    dt.types = Object.keys(dt.store)
    const block = screen.getByText('Generic (Info)').closest('.vp-block')!
    fireEvent.drop(block.querySelector('.vp-form')!, { dataTransfer: dt })
    expect(await screen.findByRole('alert')).toHaveTextContent('NAME is already in Info.')
  })

  it('module objects cannot take fields: the list items do not drag', async () => {
    setupWithEntity(true)
    const item = await screen.findByText('Phone')
    expect(item.closest('.vp-entity-item')).not.toHaveAttribute('draggable', 'true')
  })

  it('Add... opens a dialog that adds an entity field to the chosen template', async () => {
    const user = userEvent.setup()
    const { api, id } = setupWithEntity()
    const legend = await screen.findByText('Detail_view', { selector: 'legend' })
    await user.pointer({ keys: '[MouseRight]', target: legend })
    await user.click(screen.getByRole('menuitem', { name: 'Add...' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Entity field' }), 'PHONE')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<entityField>PHONE</entityField>'))
  })

  it('Add... can add a reference to another view', async () => {
    const user = userEvent.setup()
    const { api, id } = setupWithEntity()
    const legend = await screen.findByText('Detail_view', { selector: 'legend' })
    await user.pointer({ keys: '[MouseRight]', target: legend })
    await user.click(screen.getByRole('menuitem', { name: 'Add...' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'What to add' }), 'view')
    await user.selectOptions(screen.getByRole('combobox', { name: 'View' }), 'Other_view')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<view>Other_view</view>'))
    const text = (await api.getObjectSource(id)).text
    expect(text).toMatch(/<neonViewReference>\s+<name>[0-9a-f-]{36}<\/name>\s+<entityField>#ENTITY<\/entityField>\s+<view>Other_view<\/view>/)
  })
})
