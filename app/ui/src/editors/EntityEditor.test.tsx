import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EntityEditor, diagramRows, fieldRows } from './EntityEditor'
import { ProjectIndexContext } from './projectIndex'
import { createMockForgeApi } from '../test/mockApi'
import type { TreeNode, WireValue } from '../wire/types'

const text = (value: string): WireValue => ({ kind: 'text', value })
const obj = (fields: Record<string, WireValue>): WireValue => ({ kind: 'object', fields: Object.entries(fields).map(([key, value]) => ({ key, value })) })

const car: WireValue = obj({
  name: text('Car_entity'),
  entityFields: obj({
    entityProvider: { kind: 'array', items: [obj({ name: text('#PROVIDER') }), obj({ name: text('Cars') })] },
    entityProviderExtensionPoint: obj({ name: text('ProviderExtensionPoint') }),
    entityConsumer: obj({ name: text('Reservations'), dependency: obj({ name: text('dependency'), entityName: text('CarReservation_entity'), fieldName: text('ReservationsForCar') }) }),
    entityField: { kind: 'array', items: [obj({ name: text('CARID'), contentType: text('NUMBER') }), obj({ name: text('COLOR'), title: text('Color'), contentType: text('TEXT') })] },
  }),
})

const reservation: WireValue = obj({
  name: text('CarReservation_entity'),
  entityFields: obj({ entityProvider: { kind: 'array', items: [obj({ name: text('#PROVIDER') }), obj({ name: text('ReservationsForCar') })] } }),
})

describe('entity diagram data', () => {
  it('lists providers before consumers and keeps extension points apart', () => {
    expect(diagramRows(car).map((r) => `${r.kind}:${r.name}${r.extensionPoint ? ' (ep)' : ''}`)).toEqual([
      'provider:#PROVIDER',
      'provider:Cars',
      'provider:ProviderExtensionPoint (ep)',
      'consumer:Reservations',
    ])
    expect(diagramRows(car).find((r) => r.name === 'Reservations')).toMatchObject({ path: 'entityFields.entityConsumer[0]', targetEntity: 'CarReservation_entity', targetField: 'ReservationsForCar' })
  })

  it('lists the entity fields with type, title and path', () => {
    expect(fieldRows(car).map((f) => [f.name, f.type, f.title, f.path])).toEqual([
      ['CARID', 'NUMBER', '', 'entityFields.entityField[0]'],
      ['COLOR', 'TEXT', 'Color', 'entityFields.entityField[1]'],
    ])
  })
})

function setup() {
  const nodeId = 'C:/p/entity/Car_entity/Car_entity.aod'
  const otherId = 'C:/p/entity/CarReservation_entity/CarReservation_entity.aod'
  const api = createMockForgeApi({ projectTree: [], documents: { [nodeId]: car, [otherId]: reservation } })
  const node: TreeNode = { id: otherId, label: 'CarReservation_entity', object_type: 'entity', is_leaf: true, children: [] }
  const selectElement = vi.fn()
  const onTreeChange = vi.fn()
  render(
    <ProjectIndexContext.Provider value={{ findObject: (t, n) => (t === 'entity' && n === 'CarReservation_entity' ? node : null), openObject: () => {}, selectElement }}>
      <EntityEditor nodeId={nodeId} projectRoot="C:/p" tree={car} api={api} onTreeChange={onTreeChange} />
    </ProjectIndexContext.Provider>,
  )
  return { api, nodeId, selectElement, onTreeChange }
}

describe('EntityEditor', () => {
  it('draws the entity box and selects a row in the Properties panel', async () => {
    const user = userEvent.setup()
    const { selectElement, nodeId } = setup()
    const box = screen.getByLabelText('Car_entity box')
    await user.click(within(box).getByRole('button', { name: /Reservations/ }))
    expect(selectElement).toHaveBeenCalledWith(nodeId, 'entityFields.entityConsumer[0]', 'Reservations')
  })

  it('Direct dependencies adds the entity the consumer depends on', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.queryByLabelText('CarReservation_entity box')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Direct dependencies' }))
    expect(await screen.findByLabelText('CarReservation_entity box')).toBeInTheDocument()
  })

  it('edits a field title in the Fields table', async () => {
    const user = userEvent.setup()
    const { api, nodeId, onTreeChange } = setup()
    await user.click(screen.getByRole('tab', { name: 'Fields' }))
    const input = screen.getByRole('textbox', { name: 'Title of CARID' })
    await user.type(input, 'Id{Enter}')
    await waitFor(() => expect(onTreeChange).toHaveBeenCalled())
    const tree = await api.getPropertyTree(nodeId)
    const fields = tree.kind === 'object' ? tree.fields.find((f) => f.key === 'entityFields') : undefined
    expect(JSON.stringify(fields)).toContain('"Id"')
  })

  it('offers the New menu dimmed', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /New …/ }))
    expect(screen.getByRole('menuitem', { name: 'New Field' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('EntityEditor without providers or consumers', () => {
  it('still draws the box with the name and explains the empty diagram', () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const bare = obj({ name: text('Activity_entity'), entityFields: obj({ entityField: { kind: 'array', items: [obj({ name: text('ACTIVITYID') })] } }) })
    render(<EntityEditor nodeId="x.aod" projectRoot="C:/p" tree={bare} api={api} onTreeChange={() => {}} />)
    expect(within(screen.getByLabelText('Activity_entity box')).getByText('Activity_entity')).toBeInTheDocument()
    expect(screen.getByText(/no providers or consumers/)).toBeInTheDocument()
  })

  it('shows a placeholder name instead of an empty bar when the tree has no name', () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<EntityEditor nodeId="x.aod" projectRoot="C:/p" tree={obj({})} api={api} onTreeChange={() => {}} />)
    expect(screen.getByLabelText('(unnamed entity) box')).toBeInTheDocument()
  })
})