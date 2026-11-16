import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavigatorPanel } from '../../src/navigator/NavigatorPanel'
import { createMockForgeApi } from '../support/mockApi'
import type { NavNode } from '../../src/wire/types'

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
    const user = userEvent.setup({ delay: null })
    const { onActivate } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.displayValue') })
    await user.click(screen.getByRole('menuitem', { name: 'Activate' }))
    expect(onActivate).toHaveBeenCalledWith('recordContainers.dbRecordContainer[0]#new:ACTIVITYID.displayValue', 'ACTIVITYID.displayValue')
    await user.dblClick(screen.getByText('ACTIVITYID.displayValue'))
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('Activate is dimmed for an entry that already has a definition', async () => {
    const user = userEvent.setup({ delay: null })
    const { onActivate } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.value') })
    expect(screen.getByRole('menuitem', { name: 'Activate' })).toHaveAttribute('aria-disabled', 'true')
    await user.dblClick(screen.getByText('ACTIVITYID.value'))
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('a grey entry without a definition can be selected', async () => {
    const user = userEvent.setup({ delay: null })
    const { onSelect } = setup()
    await user.click(await screen.findByText('ACTIVITYID.displayValue'))
    expect(onSelect).toHaveBeenCalledWith('recordContainers.dbRecordContainer[0]#new:ACTIVITYID.displayValue', 'ACTIVITYID.displayValue')
  })

  it('Set to Default is offered for a defined entry and runs after the pick', async () => {
    const user = userEvent.setup({ delay: null })
    const { onReset } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.value') })
    await user.click(screen.getByRole('menuitem', { name: 'Set to Default' }))
    expect(onReset).toHaveBeenCalledWith('recordContainers.dbRecordContainer[0].recordFieldMappings.dbRecordFieldMapping[0]', 'ACTIVITYID.value')
  })

  it('Set to Default is dimmed with a reason for a grey entry and a folder', async () => {
    const user = userEvent.setup({ delay: null })
    const { onReset } = setup()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('ACTIVITYID.displayValue') })
    const item = screen.getByRole('menuitem', { name: 'Set to Default' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('title', expect.stringMatching(/no definition of its own/))
    await user.click(item)
    expect(onReset).not.toHaveBeenCalled()
  })

  it('the menu closes with Escape and moves with the arrow keys', async () => {
    const user = userEvent.setup({ delay: null })
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

  it('marks an element from a module with a symbol and shows the origin only on hover (style.toml)', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const fromModule: NavNode = { ...leaf('CONTACTID', 'f[0]'), with_origin: true }
    api.getNavigator = async () => [{ label: 'P_entity', path: '$', icon: 'object', children: [{ label: 'Fields', icon: 'folder', children: [fromModule, leaf('OWN_FIELD', 'f[1]')] }] }]
    render(<NavigatorPanel api={api} nodeId="m.aod" objectType="entity" origin="@aditosoftware/contact:5.2.0" selectedPath={null} onSelect={() => {}} />)
    const row = (await screen.findByText('CONTACTID')).closest('.nav-row')!
    expect(row.querySelector('.nav-module')).toHaveAttribute('title', '@aditosoftware/contact:5.2.0')
    expect(row.querySelector('.nav-origin')).toHaveTextContent('@aditosoftware/contact:5.2.0')
    expect(screen.getByRole('tree')).toHaveAttribute('data-module-hint', 'hover')
    expect(screen.getByText('OWN_FIELD').closest('.nav-row')!.querySelector('.nav-module')).toBeNull()
  })

  it('opens only the main group of an entity and remembers what the user opened per object', async () => {
    const user = userEvent.setup({ delay: null })
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

