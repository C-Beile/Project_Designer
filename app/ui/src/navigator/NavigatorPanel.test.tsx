import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavigatorPanel } from './NavigatorPanel'
import { createMockForgeApi } from '../test/mockApi'
import type { NavNode } from '../wire/types'

const leaf = (label: string, path: string | undefined, dimmed = false): NavNode => ({ label, path, icon: 'binding', dimmed, children: [] })
const outline: NavNode[] = [
  {
    label: 'Activity_entity',
    path: '$',
    icon: 'object',
    children: [
      {
        label: 'Fields',
        icon: 'folder',
        children: [{ label: 'db', path: 'recordContainers.dbRecordContainer[0]', icon: 'container', children: [leaf('ACTIVITYID.value', 'recordContainers.dbRecordContainer[0].recordFieldMappings.dbRecordFieldMapping[0]'), leaf('ACTIVITYID.displayValue', 'recordContainers.dbRecordContainer[0]#new:ACTIVITYID.displayValue', true)] }],
      },
    ],
  },
]

function setup() {
  const api = createMockForgeApi({ projectTree: [], documents: {} })
  api.getNavigator = async () => outline
  const onSelect = vi.fn()
  const onReset = vi.fn()
  const onActivate = vi.fn()
  render(<NavigatorPanel api={api} nodeId="x.aod" objectType="entity" origin="" selectedPath={null} onSelect={onSelect} onReset={onReset} onActivate={onActivate} />)
  return { onSelect, onReset, onActivate }
}

describe('Navigator', () => {
  it('Activate in the menu and a double click create the definition of a grey entry', async () => {
    const user = userEvent.setup()
    const { onActivate } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.displayValue') })
    await user.click(screen.getByRole('menuitem', { name: 'Activate' }))
    expect(onActivate).toHaveBeenCalledWith('recordContainers.dbRecordContainer[0]#new:ACTIVITYID.displayValue', 'ACTIVITYID.displayValue')
    await user.dblClick(screen.getByText('ACTIVITYID.displayValue'))
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('Activate is dimmed for an entry that already has a definition', async () => {
    const user = userEvent.setup()
    const { onActivate } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.value') })
    expect(screen.getByRole('menuitem', { name: 'Activate' })).toHaveAttribute('aria-disabled', 'true')
    await user.dblClick(screen.getByText('ACTIVITYID.value'))
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('a grey entry without a definition can be selected', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    await user.click(await screen.findByText('ACTIVITYID.displayValue'))
    expect(onSelect).toHaveBeenCalledWith('recordContainers.dbRecordContainer[0]#new:ACTIVITYID.displayValue', 'ACTIVITYID.displayValue')
  })

  it('Set to Default is offered for a defined entry and runs after the pick', async () => {
    const user = userEvent.setup()
    const { onReset } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.value') })
    await user.click(screen.getByRole('menuitem', { name: 'Set to Default' }))
    expect(onReset).toHaveBeenCalledWith('recordContainers.dbRecordContainer[0].recordFieldMappings.dbRecordFieldMapping[0]', 'ACTIVITYID.value')
  })

  it('Set to Default is dimmed with a reason for a grey entry and a folder', async () => {
    const user = userEvent.setup()
    const { onReset } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.displayValue') })
    const item = screen.getByRole('menuitem', { name: 'Set to Default' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('title', expect.stringMatching(/no definition of its own/))
    await user.click(item)
    expect(onReset).not.toHaveBeenCalled()
  })

  it('the menu closes with Escape and moves with the arrow keys', async () => {
    const user = userEvent.setup()
    setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.value') })
    expect(screen.getByRole('menu', { name: 'Context menu' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Context menu' })).toBeNull()
  })

  it('an outline with thousands of entries only puts the rows in view into the DOM', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const many: NavNode[] = [{ label: 'Big_entity', path: '$', icon: 'object', children: [{ label: 'Fields', icon: 'folder', children: Array.from({ length: 5000 }, (_, i) => leaf(`FIELD_${i}`, `f[${i}]`)) }] }]
    api.getNavigator = async () => many
    render(<NavigatorPanel api={api} nodeId="x.aod" objectType="entity" origin="" selectedPath={null} onSelect={() => {}} />)
    await screen.findByText('Big_entity')
    expect(document.querySelectorAll('.nav-row').length).toBeLessThan(120)
  })

  it('opens only the main group of an entity and remembers what the user opened per object', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const group = (label: string): NavNode => ({ label, icon: 'folder', children: [leaf(`${label}_item`, `x.${label}`)] })
    api.getNavigator = async () => [{ label: 'E_entity', path: '$', icon: 'object', children: [group('RecordContainers'), group('Fields'), group('Parameters')] }]
    const { unmount } = render(<NavigatorPanel api={api} nodeId="memory-test.aod" objectType="entity" origin="" selectedPath={null} onSelect={() => {}} />)
    expect(await screen.findByText('Fields_item')).toBeInTheDocument()
    expect(screen.queryByText('RecordContainers_item')).toBeNull()
    expect(screen.queryByText('Parameters_item')).toBeNull()
    await user.dblClick(screen.getByText('Parameters'))
    expect(await screen.findByText('Parameters_item')).toBeInTheDocument()
    unmount()
    render(<NavigatorPanel api={api} nodeId="memory-test.aod" objectType="entity" origin="" selectedPath={null} onSelect={() => {}} />)
    expect(await screen.findByText('Parameters_item')).toBeInTheDocument()
    expect(screen.queryByText('RecordContainers_item')).toBeNull()
  })
})

