import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationEditor } from './ApplicationEditor'
import { ProjectIndexContext, type ProjectIndex } from './projectIndex'
import type { WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'
import { setApplicationFilter } from './applicationFilter'

afterEach(() => {
  for (const k of ['Process', 'Report', 'Entity', 'ExecutablesOnly'] as const) setApplicationFilter(k, false)
  for (const k of ['NeonContext', 'NeonDashboard', 'Role'] as const) setApplicationFilter(k, true)
})

const SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<application>
  <name>_____SYSTEM_APPLICATION_NEON</name>
  <entityNode>
    <name>entityNode</name>
    <kind v="200" />
    <childNodes>
      <entityNode>
        <name>Contactmanagement</name>
        <kind v="123" />
        <title>Contact Management</title>
        <icon>VAADIN:CONNECT</icon>
        <childNodes>
          <entityNode>
            <name>Group1</name>
            <kind v="123" />
            <title></title>
            <childNodes>
              <entityNode>
                <name>Person</name>
                <kind v="10077" />
              </entityNode>
              <entityNode>
                <name>INTERNAL_EVERYONE</name>
                <kind v="159" />
              </entityNode>
              <entityNode>
                <name>Ghost</name>
                <kind v="10077" />
              </entityNode>
            </childNodes>
          </entityNode>
        </childNodes>
      </entityNode>
      <entityNode>
        <name>Sales</name>
        <kind v="123" />
        <title>Sales</title>
      </entityNode>
    </childNodes>
  </entityNode>
</application>
`

const ID = 'C:/p/application/_____SYSTEM_APPLICATION_NEON/_____SYSTEM_APPLICATION_NEON.aod'
const tree: WireValue = { kind: 'object', fields: [{ key: 'name', value: { kind: 'text', value: '_____SYSTEM_APPLICATION_NEON' } }] }

const NAMES: Record<string, string[]> = { neonContext: ['Person', 'Organisation', 'Task'], neonDashboard: ['SalesDashboard'], role: ['Admin'], process: ['Run_serverProcess', 'Util_lib', 'All_test'], 'process:executables': ['Run_serverProcess'] }
const index: ProjectIndex = { findObject: () => null, openObject: () => {}, namesOf: (t) => NAMES[t] ?? [] }

function setup(id = ID) {
  const api = createMockForgeApi({ projectTree: [], documents: { [id]: tree }, sources: { [id]: SOURCE } })
  const onTreeChange = vi.fn()
  render(
    <ProjectIndexContext.Provider value={index}>
      <ApplicationEditor nodeId={id} projectRoot="C:/p" tree={tree} api={api} onTreeChange={onTreeChange} />
    </ProjectIndexContext.Provider>,
  )
  return { api, onTreeChange, id }
}

function dataTransfer() {
  const store: Record<string, string> = {}
  return {
    setData: (k: string, v: string) => (store[k] = v),
    getData: (k: string) => store[k] ?? '',
    effectAllowed: '',
    dropEffect: '',
  }
}

const DRAG = 'application/x-forge-app-menu'

describe('ApplicationEditor', () => {
  it('shows the menu as nested group tiles and the list of available entries', async () => {
    setup()
    expect(await screen.findByLabelText('Group Contactmanagement')).toBeInTheDocument()
    expect(screen.getByLabelText('Group Group1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Contact Management')).toBeInTheDocument()
    const list = screen.getByLabelText('Available entries')
    expect(within(list).getByText('Organisation')).toBeInTheDocument()
    expect(within(list).getByText('SalesDashboard')).toBeInTheDocument()
    expect(within(list).getByText('Admin')).toBeInTheDocument()
  })

  it('searches the list', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('Group Contactmanagement')
    await user.type(screen.getByLabelText('Filter list'), 'org')
    const list = screen.getByLabelText('Available entries')
    expect(within(list).getByText('Organisation')).toBeInTheDocument()
    expect(within(list).queryByText('Task')).toBeNull()
  })

  it('adds an entry by dragging it from the list into a group', async () => {
    const { api, onTreeChange, id } = setup()
    await screen.findByLabelText('Group Contactmanagement')
    const dt = dataTransfer()
    const item = within(screen.getByLabelText('Available entries')).getByText('Task')
    fireEvent.dragStart(item, { dataTransfer: dt })
    expect(JSON.parse(dt.getData(DRAG))).toEqual({ type: 'new', kind: 10077, name: 'Task' })
    fireEvent.drop(screen.getByLabelText('Group Group1'), { dataTransfer: dt })
    await waitFor(() => expect(onTreeChange).toHaveBeenCalled())
    const text = (await api.getObjectSource(id)).text
    expect(text.indexOf('<name>Task</name>')).toBeGreaterThan(text.indexOf('<name>Ghost</name>'))
    expect(text).toContain('<kind v="10077" />')
  })

  it('moves an entry in front of another entry by drag and drop', async () => {
    const { api, id } = setup()
    await screen.findByLabelText('Group Contactmanagement')
    const dt = dataTransfer()
    const tr = screen.getByRole('tree')
    const ghost = within(tr).getByText('Ghost').closest('[role="treeitem"]')!
    const person = within(tr).getByText('Person').closest('[role="treeitem"]')!
    fireEvent.dragStart(ghost, { dataTransfer: dt })
    fireEvent.drop(person, { dataTransfer: dt })
    await waitFor(async () => {
      const text = (await api.getObjectSource(id)).text
      expect(text.indexOf('<name>Ghost</name>')).toBeLessThan(text.indexOf('<name>Person</name>'))
    })
  })

  it('indents a group into the previous group and outdents it again with the buttons', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    await screen.findByLabelText('Group Sales')
    await user.click(screen.getByLabelText('Group Sales'))
    await user.click(await screen.findByRole('button', { name: 'Indent' }))
    await waitFor(async () => {
      const text = (await api.getObjectSource(id)).text
      expect(text.indexOf('<name>Sales</name>')).toBeLessThan(text.lastIndexOf('</childNodes>', text.indexOf('<name>Sales</name>') + 400) + 20)
    })
    await user.click(await screen.findByRole('button', { name: 'Outdent' }))
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toBe(SOURCE))
  })

  it('removes an entry', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    await user.click(await screen.findByRole('button', { name: 'Remove Ghost' }))
    await waitFor(async () => expect((await api.getObjectSource(id)).text).not.toContain('<name>Ghost</name>'))
  })

  it('marks references to missing objects and ignores INTERNAL_ roles', async () => {
    setup()
    await screen.findByLabelText('Group Contactmanagement')
    expect(screen.getByTitle("Context 'Ghost' not found")).toHaveTextContent('<invalid> Ghost')
    expect(screen.getByRole('button', { name: '1 broken reference' })).toBeInTheDocument()
  })

  it('edits the title of a group', async () => {
    const user = userEvent.setup()
    const { api, id } = setup()
    const field = await screen.findByLabelText('Sales title')
    await user.clear(field)
    await user.type(field, 'Vertrieb{Enter}')
    await waitFor(async () => expect((await api.getObjectSource(id)).text).toContain('<title>Vertrieb</title>'))
  })

  it('is read only for module objects', async () => {
    setup('C:/p/node_modules/@aditosoftware/x/application/_____SYSTEM_APPLICATION_NEON/_____SYSTEM_APPLICATION_NEON.aod')
    expect(await screen.findByText(/Read only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Ghost' })).toBeNull()
  })
})

describe('ApplicationEditor filter, popup and jump', () => {
  it('type chips combine with the search and the counter follows', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('Group Contactmanagement')
    const count = () => screen.getByText(/ of \d+$/).textContent ?? ''
    const before = count()
    await user.click(screen.getByRole('checkbox', { name: 'Role' }))
    expect(count()).not.toBe(before)
    expect(within(screen.getByLabelText('Available entries')).queryByText('Admin')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Role' }))
    expect(within(screen.getByLabelText('Available entries')).getByText('Admin')).toBeInTheDocument()
  })

  it('Process, Report and Entity chips are listed but their entries cannot be dragged', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('Group Contactmanagement')
    expect(screen.getByRole('checkbox', { name: 'Process' })).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('checkbox', { name: 'Process' }))
    const list = screen.getByLabelText('Available entries')
    const items = list.querySelectorAll('li.is-static')
    for (const li of items) expect(li).toHaveAttribute('draggable', 'false')
  })

  it('hovering an entry shows a popup with its name and what to do with it', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('Group Contactmanagement')
    await user.hover(within(screen.getByLabelText('Available entries')).getByText('Organisation'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Organisation/)
    await user.unhover(within(screen.getByLabelText('Available entries')).getByText('Organisation'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('the broken-reference counter jumps to the first broken entry', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('Group Contactmanagement')
    await user.click(screen.getByRole('button', { name: '1 broken reference' }))
    const ghost = screen.getByTitle("Context 'Ghost' not found")
    expect(ghost).toHaveAttribute('aria-selected', 'true')
  })
})

describe('ApplicationEditor Executables Only', () => {
  it('limits the listed processes to those of the group executables', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('Group Contactmanagement')
    await user.click(screen.getByRole('checkbox', { name: 'Process' }))
    const list = screen.getByLabelText('Available entries')
    expect(within(list).getByText('Util_lib')).toBeInTheDocument()
    expect(within(list).getByText('All_test').closest('li')!.querySelector('svg')).toHaveAttribute('data-kind', 'test')
    await user.click(screen.getByRole('checkbox', { name: 'Executables Only' }))
    expect(within(list).queryByText('Util_lib')).toBeNull()
    expect(within(list).getByText('Run_serverProcess')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Executables Only' }))
    await user.click(screen.getByRole('checkbox', { name: 'Process' }))
  })
})
