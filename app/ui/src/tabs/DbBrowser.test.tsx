import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DbBrowserTab } from './DbBrowserTab'
import { DialogHost, _resetDialogsForTests } from '../shell/dialogService'
import { aliasConfigTabNode } from './AliasConfigTab'
import { ProjectIndexContext, type ProjectIndex } from '../editors/projectIndex'
import { CATALOG_SQL, PROCEDURES_SQL, TABLES_SQL, changelogFor, columnInfos, columnsSql, foreignKeysSql, indexesSql, isSafeIdentifier, viewDataSql } from './dbBrowserSql'
import { createMockForgeApi } from '../test/mockApi'
import { _resetTunnelStateForTests, setSystemsDb, systemKey } from '../services/tunnelState'

const KEY = systemKey('C:/demo', 'dev1')
const UP = { connected: true, tunnel_up: true, database: 'sys', host: 'h' }
const COLS: (string | null)[][] = [
  ['ID', 'varchar', 'varchar(36)', '36', null, null, 'NO', null, 'PRI'],
  ['AMOUNT', 'decimal', 'decimal(10,2)', null, '10', '2', 'YES', '0', ''],
]

beforeEach(() => {
  _resetTunnelStateForTests()
  setSystemsDb([{ system: KEY, status: UP, active: true }])
})
afterEach(() => _resetDialogsForTests())

async function setup() {
  const api = createMockForgeApi({
    projectTree: [],
    documents: {},
    dbResults: {
      [CATALOG_SQL]: { columns: ['c'], rows: [['_____systemalias']], truncated: false, elapsed_ms: 1 },
      [TABLES_SQL]: { columns: ['n', 't'], rows: [['ASYS_USERS', 'BASE TABLE'], ['V_USERS', 'VIEW']], truncated: false, elapsed_ms: 1 },
      [columnsSql('ASYS_USERS')]: { columns: [], rows: COLS, truncated: false, elapsed_ms: 1 },
    },
  })
  await api.dbConnect('t', 's', null, null, KEY)
  const openSql = vi.fn()
  const index: ProjectIndex = { findObject: () => null, openObject: () => {}, openSql }
  const node = aliasConfigTabNode({ key: KEY, system: 'dev1', alias: '_____SYSTEMALIAS', reference: 'r', browse: true })
  render(
    <ProjectIndexContext.Provider value={index}>
      <DbBrowserTab api={api} path={node.path} />
      <DialogHost />
    </ProjectIndexContext.Provider>,
  )
  return { api, openSql }
}

describe('database browser', () => {
  it('lists tables and views, the columns load only when a table is selected', async () => {
    const user = userEvent.setup()
    const { api } = await setup()
    const calls = vi.spyOn(api, 'dbQuery')
    expect(await screen.findByText('ASYS_USERS')).toBeInTheDocument()
    expect(screen.getByText('V_USERS')).toBeInTheDocument()
    expect(calls).not.toHaveBeenCalledWith(columnsSql('ASYS_USERS'), false)
    await user.click(screen.getByText('ASYS_USERS'))
    expect(await screen.findByText('varchar(36)')).toBeInTheDocument()
    expect(screen.getByText('ID (key)')).toBeInTheDocument()
    expect(screen.getByText('decimal(10,2)')).toBeInTheDocument()
    expect(screen.getByLabelText('Properties')).toHaveTextContent('System')
  })

  it('the table menu opens View Data, keeps writing entries dimmed and only reads', async () => {
    const user = userEvent.setup()
    const { api, openSql } = await setup()
    const calls = vi.spyOn(api, 'dbQuery')
    fireEvent.contextMenu(await screen.findByText('ASYS_USERS'))
    for (const name of ['Add Column...', 'Delete', 'Grab Structure...', 'Recreate Table...']) expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'View Data...' }))
    expect(openSql).toHaveBeenCalledWith('SELECT * FROM `ASYS_USERS` LIMIT 100', KEY)
    expect(calls.mock.calls.every(([, write]) => write === false)).toBe(true)
  })

  it('Generate Changelog only shows the text', async () => {
    const user = userEvent.setup()
    await setup()
    fireEvent.contextMenu(await screen.findByText('ASYS_USERS'))
    await user.click(screen.getByRole('menuitem', { name: 'Generate Changelog...' }))
    await user.click(await screen.findByRole('button', { name: 'OK' }))
    const text = (await screen.findByLabelText('Generated changelog')) as HTMLTextAreaElement
    expect(text.value).toContain('<createTable tableName="ASYS_USERS">')
    await waitFor(() => expect(text.value.indexOf('<preConditions')).toBeLessThan(text.value.indexOf('<comment>')))
  })

  it('a system without its own tunnel stays unavailable', async () => {
    const node = aliasConfigTabNode({ key: systemKey('C:/other', 'dev1'), system: 'dev1', alias: 'A', reference: 'r', browse: true })
    render(<DbBrowserTab api={createMockForgeApi({ projectTree: [], documents: {} })} path={node.path} />)
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument()
  })
})

describe('database browser statements', () => {
  it('only plain identifiers reach a statement', () => {
    expect(isSafeIdentifier('ASYS_USERS')).toBe(true)
    expect(viewDataSql('a`; DROP TABLE x')).toBeNull()
    expect(columnsSql("a'b")).toContain("'a''b'")
  })

  it('maps the column rows and orders the changeset: preConditions, comment, change', () => {
    const cols = columnInfos(COLS)
    expect(cols[0]).toMatchObject({ name: 'ID', type: 'VARCHAR', length: '36', nullable: false, key: 'PRI' })
    expect(cols[1]).toMatchObject({ length: '10', scale: '2', nullable: true, defaultValue: '0' })
    const xml = changelogFor('T', cols, 'c.beile', '20261019')
    expect(xml).toContain('author="c.beile"')
    expect(xml).toContain('primaryKey="true"')
    expect(xml.indexOf('<preConditions')).toBeLessThan(xml.indexOf('<comment>'))
    expect(xml.indexOf('<comment>')).toBeLessThan(xml.indexOf('<createTable'))
  })
})

describe('database browser of another alias', () => {
  it('opens its own read-only session for Data_alias and shows indexes, foreign keys and procedures', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({
      projectTree: [],
      documents: {},
      dbResults: {
        [CATALOG_SQL]: { columns: ['c'], rows: [['cloud_data_alias']], truncated: false, elapsed_ms: 1 },
        [TABLES_SQL]: { columns: ['n', 't'], rows: [['ACTIVITY', 'BASE TABLE']], truncated: false, elapsed_ms: 1 },
        [columnsSql('ACTIVITY')]: { columns: [], rows: COLS, truncated: false, elapsed_ms: 1 },
        [indexesSql('ACTIVITY')]: { columns: [], rows: [['PRIMARY', 'ID', '0'], ['IX_DATE', 'DATE_EDIT', '1']], truncated: false, elapsed_ms: 1 },
        [foreignKeysSql('ACTIVITY')]: { columns: [], rows: [['FK_ACT_CONTACT', 'CONTACT_ID', 'CONTACT', 'ID']], truncated: false, elapsed_ms: 1 },
        [PROCEDURES_SQL]: { columns: [], rows: [['SP_CLEAN', 'PROCEDURE']], truncated: false, elapsed_ms: 1 },
      },
    })
    await api.dbConnect('t', 's', null, null, KEY)
    const connectAlias = vi.spyOn(api, 'dbConnectAlias')
    const node = aliasConfigTabNode({ key: KEY, system: 'dev1', alias: 'Data_alias', reference: 'r', browse: true, tunnelConfig: 'C:/demo/t.xml' })
    render(<DbBrowserTab api={api} path={node.path} />)
    await user.click(await screen.findByText('ACTIVITY'))
    expect(connectAlias).toHaveBeenCalledWith(KEY, 'Data_alias', 'C:/demo/t.xml', expect.any(Array))
    expect(await screen.findByText('IX_DATE')).toBeInTheDocument()
    expect(await screen.findByText('CONTACT.ID')).toBeInTheDocument()
    await user.click(screen.getByText(/^Procedures/))
    expect(await screen.findByText('SP_CLEAN (procedure)')).toBeInTheDocument()
  })
})
