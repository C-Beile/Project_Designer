import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { _resetFieldEditorsForTests, findFieldEditor, getFieldActions, registerFieldAction, registerFieldEditor, type FieldContext } from '../../contrib/fieldEditors'
import type { SheetRow } from '../../../wire/types'
import { PropertyGrid } from './PropertyGrid'

type Row = [string, string]
const rows: Row[] = [
  ['Name', 'Customer'],
  ['Empty', ''],
]
const groups = [{ key: 'g', label: 'Main', rows }]

function Grid({ onSelect = () => {} }: { onSelect?: (k: string) => void }) {
  return <PropertyGrid ariaLabel="demo" groups={groups} rowKey={([k]) => k} rowLabel={([k]) => k} isUnset={([, v]) => !v} selected="Name" onSelect={onSelect} renderValue={([, v]) => <span>{v}</span>} />
}

afterEach(() => _resetFieldEditorsForTests())

describe('PropertyGrid', () => {
  it('shows groups and rows, marks the selected and the unset row and reports a click', async () => {
    const picked: string[] = []
    render(<Grid onSelect={(k) => picked.push(k)} />)
    expect(screen.getByRole('grid', { name: 'demo' })).toBeInTheDocument()
    expect(screen.getByText('Customer')).toBeInTheDocument()
    const [name, empty] = screen.getAllByRole('row').filter((r) => r.className.includes('psheet-row'))
    expect(name).toHaveClass('is-selected')
    expect(empty).toHaveClass('is-unset')
    await userEvent.click(screen.getByText('Empty'))
    expect(picked).toContain('Empty')
  })

  it('collapses a group', async () => {
    render(<Grid />)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Main' }))
    expect(screen.queryByText('Customer')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Main' }))
    expect(screen.getByText('Customer')).toBeInTheDocument()
  })
})

describe('field editor register', () => {
  const row = { name: 'secret', kind: 'text' } as SheetRow
  const Dummy = () => null

  it('the editor with the lowest order that matches wins, and a new id replaces an old one', () => {
    registerFieldEditor({ id: 'fallback', order: 100, matches: () => true, component: Dummy })
    registerFieldEditor({ id: 'secret', order: 0, matches: (r) => r.name === 'secret', component: Dummy })
    expect(findFieldEditor(row)?.id).toBe('secret')
    registerFieldEditor({ id: 'secret', order: 0, matches: () => false, component: Dummy })
    expect(findFieldEditor(row)?.id).toBe('fallback')
  })

  it('actions are all that match', () => {
    registerFieldAction({ id: 'a', matches: () => true, component: Dummy })
    registerFieldAction({ id: 'b', matches: () => false, component: Dummy })
    expect(getFieldActions(row, {} as FieldContext).map((a) => a.id)).toEqual(['a'])
  })
})
