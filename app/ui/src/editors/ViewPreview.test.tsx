import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ViewPreview, entityFieldsOf, labelOf, typeLabel } from './ViewPreview'
import { ProjectIndexContext } from './projectIndex'
import { createMockForgeApi } from '../test/mockApi'
import type { TreeNode, WireValue } from '../wire/types'

const text = (value: string): WireValue => ({ kind: 'text', value })
const obj = (...fields: [string, WireValue][]): WireValue => ({ kind: 'object', fields: fields.map(([key, value]) => ({ key, value })) })
const arr = (...items: WireValue[]): WireValue => ({ kind: 'array', items })

const entityTree = obj([
  'entityFields',
  obj([
    'entityField',
    arr(
      obj(['name', text('PRICE')], ['title', text('Preis')], ['contentType', text('NUMBER')]),
      obj(['name', text('COLOR')], ['title', text('Farbe')]),
      obj(['name', text('BUILT')], ['title', text('Baujahr')], ['contentType', text('DATE')]),
    ),
  ]),
])

function viewWith(fields: string[]): WireValue {
  return obj(
    ['name', text('CarEdit_View')],
    [
      'children',
      obj([
        'genericViewTemplate',
        obj(['name', text('Edit')], ['editMode', obj()], ['fields', obj(['entityFieldLink', arr(...fields.map((f) => obj(['entityField', text(f)])))])]),
      ]),
    ],
  )
}

const entityNode: TreeNode = { id: 'C:/p/entity/Car_entity/Car_entity.aod', label: 'Car_entity', object_type: 'entity', is_leaf: true, children: [] }

describe('entity field metadata', () => {
  it('reads title and content type, defaulting to text', () => {
    const fields = entityFieldsOf(entityTree)
    expect(fields.get('PRICE')).toEqual({ title: 'Preis', type: 'NUMBER' })
    expect(fields.get('COLOR')).toEqual({ title: 'Farbe', type: 'TEXT' })
    expect(labelOf('PRICE', fields)).toBe('Preis')
    expect(labelOf('UNKNOWN_FIELD', fields)).toBe('Unknown field')
    expect(labelOf('PRICE', null)).toBe('Price')
    expect(typeLabel('DATE')).toBe('Date')
    expect(typeLabel('CUSTOMTYPE')).toBe('Customtype')
  })
})

describe('ViewPreview with entity metadata', () => {
  it('shows the entity titles and types of the fields, and falls back for unknown fields', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: { [entityNode.id]: entityTree } })
    const index = { findObject: () => null, openObject: () => {}, entityOfView: (v: string) => (v === 'CarEdit_View' ? entityNode : null) }
    render(
      <ProjectIndexContext.Provider value={index}>
        <ViewPreview api={api} tree={viewWith(['PRICE', 'BUILT', 'OTHER_FIELD'])} name="CarEdit_View" />
      </ProjectIndexContext.Provider>,
    )
    expect(await screen.findByText('Preis')).toBeInTheDocument()
    expect(screen.getByText('Baujahr')).toBeInTheDocument()
    expect(screen.getByText('Number')).toBeInTheDocument()
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Other field')).toBeInTheDocument()
  })

  it('keeps the readable names and says why when the view belongs to no context', () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const index = { findObject: () => null, openObject: () => {}, entityOfView: () => null }
    render(
      <ProjectIndexContext.Provider value={index}>
        <ViewPreview api={api} tree={viewWith(['PRICE'])} name="CarEdit_View" />
      </ProjectIndexContext.Provider>,
    )
    expect(screen.getByText('Price')).toBeInTheDocument()
    expect(screen.getByText(/this view is in no context/)).toBeInTheDocument()
  })
})
