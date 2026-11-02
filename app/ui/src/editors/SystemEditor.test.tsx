import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SystemEditor } from './SystemEditor'
import type { AliasConfigDto, WireValue } from '../wire/types'
import { createMockForgeApi } from '../test/mockApi'
import { _resetTunnelStateForTests, setSystemsDb, systemKey } from '../services/tunnelState'
import { UsersTab } from '../services/UsersTable'
import { ProjectIndexContext, type ProjectIndex } from './projectIndex'
import { AliasConfigTab, aliasConfigTabNode } from '../tabs/AliasConfigTab'
import type { DbStatus, TableDump } from '../wire/types'

const ON: DbStatus = { connected: true, tunnel_up: true, database: '_____systemalias', host: 'db.svc' }

beforeEach(() => {
  _resetTunnelStateForTests()
  setSystemsDb([{ system: systemKey('C:/demo', 'dev1'), status: ON, active: true }])
})
afterEach(() => _resetTunnelStateForTests())

const REF = '$PROJECTHOME/others/cloud/x_serverconfig_system.xml'

function system(serverConfigPath = REF): WireValue {
  return {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'dev1' } },
      { key: 'serverConfigPath', value: { kind: 'text', value: serverConfigPath } },
    ],
  }
}

const aliases: AliasConfigDto[] = [
  {
    name: '_____SYSTEMALIAS',
    type_label: 'Database (MariaDB)',
    icon: 'database',
    jdbc_url: 'jdbc:mariadb://db:3306/sys',
    groups: [
      { label: 'Address', props: [{ name: 'host', value: 'db', secret: false }] },
      { label: 'Authentication', props: [{ name: 'user', value: 'adito', secret: false }, { name: 'password', value: '', secret: true }] },
    ],
  },
  { name: 'WorkflowModeler', type_label: 'Workflow engine', icon: 'file', jdbc_url: null, groups: [{ label: 'Address', props: [{ name: 'modelerUrl', value: 'https://x/y', secret: false }] }] },
]

function setup(serverConfigPath = REF) {
  const api = createMockForgeApi({ projectTree: [], documents: {}, aliasConfigs: { [REF]: aliases }, systemAliasList: aliases })
  render(<SystemEditor nodeId="n" projectRoot="C:/demo" tree={system(serverConfigPath)} api={api} onTreeChange={() => {}} />)
}

describe('SystemEditor alias table', () => {
  it('lists every alias config with type line and JDBC URL', async () => {
    setup()
    expect(await screen.findByText('_____SYSTEMALIAS')).toBeInTheDocument()
    expect(screen.getByText('Database (MariaDB)')).toBeInTheDocument()
    expect(screen.getByText('jdbc:mariadb://db:3306/sys')).toBeInTheDocument()
    expect(screen.getByText('WorkflowModeler')).toBeInTheDocument()
  })

  it('shows the selected alias with groups and a masked password', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByText('_____SYSTEMALIAS'))
    const detail = await screen.findByLabelText('_____SYSTEMALIAS properties')
    expect(detail).toHaveTextContent('Address:')
    expect(detail).toHaveTextContent('Authentication:')
    expect(detail).toHaveTextContent('adito')
    expect(detail).toHaveTextContent('\u2022\u2022\u2022')
    expect(detail.textContent).not.toMatch(/secret/i)
  })

  it('hints when serverConfigPath is empty', async () => {
    _resetTunnelStateForTests()
    setup('')
    await waitFor(() => expect(screen.getByText(/serverConfigPath is empty/)).toBeInTheDocument())
  })
})

describe('SystemEditor without connection', () => {
  it('shows only the unavailable panel, no raw table and no developer hint', async () => {
    _resetTunnelStateForTests()
    setup()
    expect(await screen.findByText('Connection to database unavailable.')).toBeInTheDocument()
    expect(screen.queryByText(/Only alias configs stored/)).toBeNull()
    expect(screen.queryByLabelText('ASYS_ALIASCONFIG')).toBeNull()
  })

  it('keeps the raw ASYS_ALIASCONFIG table inside a collapsed diagnosis section', async () => {
    setup()
    await screen.findByText('_____SYSTEMALIAS')
    expect(screen.queryByLabelText('ASYS_ALIASCONFIG')).toBeNull()
    expect(screen.getByText(/Diagnosis: raw ASYS_ALIASCONFIG/)).toBeInTheDocument()
  })
})

describe('Users tab', () => {
  const dump: TableDump = {
    columns: ['isActive', 'title', 'email', 'firstname', 'lastname'],
    rows: [
      ['true', 'Admin', 'admin@x.de', null, 'Administrator'],
      ['false', 'Zed', 'zed@x.de', 'Z', 'Zimmer'],
      ['true', 'Bob', 'bob@x.de', 'B', 'Baumann'],
    ],
    hidden_columns: [],
    truncated: false,
  }

  it('shows a clean grid with check marks, filters and sorts', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, systemUsers: dump })
    await api.dbConnect('t', 's', null)
    render(<UsersTab api={api} db={ON} />)
    expect(await screen.findByText('Administrator')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getAllByRole('checkbox', { name: 'inactive' })).toHaveLength(1)
    await user.type(screen.getByLabelText('Filter users'), 'zed')
    expect(screen.queryByText('Administrator')).toBeNull()
    expect(screen.getByText('Zimmer')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Filter users'))
    await user.click(screen.getByRole('button', { name: /lastname/ }))
    const cells = screen.getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(cells[0]).toContain('Administrator')
    await user.click(screen.getByRole('button', { name: /lastname/ }))
    expect(screen.getAllByRole('row')[1].textContent).toContain('Zimmer')
  })

  it('pages large user lists', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ['true', `T${i}`, `u${i}@x.de`, null, `L${String(i).padStart(3, '0')}`])
    const api = createMockForgeApi({ projectTree: [], documents: {}, systemUsers: { ...dump, rows } })
    await api.dbConnect('t', 's', null)
    render(<UsersTab api={api} db={ON} />)
    await screen.findByText('L000')
    expect(screen.getAllByRole('row')).toHaveLength(101)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })
})

describe('SystemEditor rows: select, open, menu', () => {
  function withIndex() {
    const openAliasConfig = vi.fn()
    const index: ProjectIndex = { findObject: () => null, openObject: () => {}, openAliasConfig }
    const api = createMockForgeApi({ projectTree: [], documents: {}, aliasConfigs: { [REF]: aliases }, systemAliasList: aliases })
    render(
      <ProjectIndexContext.Provider value={index}>
        <SystemEditor nodeId="n" projectRoot="C:/demo" tree={system()} api={api} onTreeChange={() => {}} />
      </ProjectIndexContext.Provider>,
    )
    return { openAliasConfig }
  }

  it('a double click opens the config tab of this alias for this system', async () => {
    const user = userEvent.setup()
    const { openAliasConfig } = withIndex()
    await user.dblClick(await screen.findByText('WorkflowModeler'))
    expect(openAliasConfig).toHaveBeenCalledWith({ key: systemKey('C:/demo', 'dev1'), system: 'dev1', alias: 'WorkflowModeler', reference: REF })
  })

  it('arrow keys move the selection, Enter on the selected row opens it', async () => {
    const user = userEvent.setup()
    const { openAliasConfig } = withIndex()
    const first = (await screen.findByText('_____SYSTEMALIAS')).closest('[role="row"]') as HTMLElement
    first.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('row', { name: /WorkflowModeler/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(openAliasConfig).toHaveBeenCalledWith(expect.objectContaining({ alias: 'WorkflowModeler' }))
  })

  it('the right-click menu offers Open and Refresh', async () => {
    const user = userEvent.setup()
    const { openAliasConfig } = withIndex()
    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText('WorkflowModeler') })
    await user.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(openAliasConfig).toHaveBeenCalled()
  })
})

describe('AliasConfigTab', () => {
  const api = () => createMockForgeApi({ projectTree: [], documents: {}, aliasConfigs: { [REF]: aliases }, systemAliasList: aliases })

  it('shows the groups of the alias with the password masked', async () => {
    const node = aliasConfigTabNode({ key: systemKey('C:/demo', 'dev1'), system: 'dev1', alias: '_____SYSTEMALIAS', reference: REF })
    const a = api()
    await a.dbConnect('t', 's', null, null, systemKey('C:/demo', 'dev1'))
    render(<AliasConfigTab api={a} path={node.path} />)
    expect(await screen.findByText('Authentication')).toBeInTheDocument()
    expect(screen.getByText('••••••••••••')).toBeInTheDocument()
    const host = screen.getByLabelText('host') as HTMLInputElement
    await userEvent.setup().type(host, 'x')
    expect(await screen.findByRole('status')).toHaveTextContent(/Draft: 1 change, not written/)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Discard' }))
    expect(host.value).toBe('db')
  })

  it('a system of another project without a tunnel stays unavailable', async () => {
    const node = aliasConfigTabNode({ key: systemKey('C:/other', 'dev1'), system: 'dev1', alias: '_____SYSTEMALIAS', reference: REF })
    render(<AliasConfigTab api={api()} path={node.path} />)
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument()
  })
})
